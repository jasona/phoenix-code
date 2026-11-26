// @effect-diagnostics nodeBuiltinImport:off -- Tests inspect temporary hooks.json files and spawn a real hook command.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import {
  makeLifecycleHooksConfigLoader,
  matchHooksForEvent,
  parseLifecycleHooksConfig,
} from "./LifecycleHooksConfig.ts";
import {
  makeWithRunner,
  spawnHookCommand,
  type HookCommandInvocation,
} from "./LifecycleHooksReactor.ts";

describe("LifecycleHooksConfig", () => {
  it("parses nested groups and flat entries, clamps timeouts, and matches regex or fallback", () => {
    const config = parseLifecycleHooksConfig(
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "hook prompt", timeout: 3 }] }],
          PreToolUse: [
            { matcher: "Bash|Edit", hooks: [{ type: "command", command: "hook tool", timeout: 120 }] },
            { matcher: "[unclosed", type: "command", command: "hook invalid-regex", timeout: 50 },
            { type: "http", command: "https://ignored.invalid" },
          ],
          UnknownEvent: [{ hooks: [{ type: "command", command: "ignored" }] }],
        },
      }),
    );

    expect(matchHooksForEvent(config, "UserPromptSubmit")).toEqual([
      { command: "hook prompt", timeoutMs: 3_000 },
    ]);
    expect(matchHooksForEvent(config, "PreToolUse", "Bash")).toEqual([
      { command: "hook tool", timeoutMs: 30_000 },
    ]);
    expect(matchHooksForEvent(config, "PreToolUse", "[unclosed")).toEqual([
      { command: "hook invalid-regex", timeoutMs: 30_000 },
    ]);
    expect(matchHooksForEvent(config, "Stop")).toEqual([]);
  });

  it("caches by mtime and reloads when hooks.json changes on disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-hooks-cfg-"));
    try {
      const hooksPath = path.join(dir, "hooks.json");
      let nowMs = 1_000;
      const loader = makeLifecycleHooksConfigLoader(hooksPath, {
        statTtlMs: 500,
        now: () => nowMs,
      });

      expect(loader.load().config).toEqual({});

      fs.writeFileSync(
        hooksPath,
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "one" }] }] } }),
        "utf8",
      );
      // Within statTtlMs -> still cached empty
      expect(loader.load().config.Stop).toBeUndefined();

      nowMs += 600;
      expect(loader.load().config.Stop).toEqual([
        { command: "one", timeoutMs: 3_000, matcher: null },
      ]);

      nowMs += 600;
      fs.writeFileSync(hooksPath, "{ bad json", "utf8");
      const broken = loader.load();
      expect(broken.config).toEqual({});
      expect(broken.parseWarning).toBeTypeOf("string");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function makeTestHarness(input: {
  readonly hooksJson?: unknown;
  readonly threads?: ReadonlyArray<OrchestrationV2AppThread>;
  readonly projectTitle?: string;
  readonly projectRoot?: string;
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-hooks-reactor-"));
  if (input.hooksJson !== undefined) {
    fs.mkdirSync(path.join(dir, "userdata"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "userdata", "hooks.json"),
      JSON.stringify(input.hooksJson, null, 2),
      "utf8",
    );
  }

  const calls: Array<HookCommandInvocation> = [];
  const threadMap = new Map((input.threads ?? []).map((t) => [t.id, t]));
  const projectId = ProjectId.make("proj-1");
  const baseConfigLayer = ServerConfig.layerTest(input.projectRoot ?? dir, dir).pipe(
    Layer.provide(NodeServices.layer),
  );

  const testLayer = Effect.gen(function* () {
    const queue = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    const dependencies = Layer.mergeAll(
      Layer.mock(Orchestrator.OrchestratorV2)({
        streamDomainEvents: Stream.fromQueue(queue),
      }),
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThread: (threadId) => {
          const found = threadMap.get(threadId);
          return found
            ? Effect.succeed(found)
            : Effect.fail(new ProjectionStore.ProjectionStoreThreadNotFoundError({ threadId }));
        },
      }),
      Layer.mock(ProjectStore.ProjectStoreV2)({
        get: (id) =>
          id === projectId
            ? Effect.succeed(
                Option.some({
                  projectId,
                  title: input.projectTitle ?? "busy-bar",
                  hasCustomTitle: false,
                  workspaceRoot: input.projectRoot ?? "/work/busy-bar",
                  defaultModelSelection: null,
                  defaultThreadEnvMode: null,
                  autoPull: false,
                  faviconPath: null,
                  projectIcon: null,
                  scripts: [],
                  trackedFolders: [],
                  pinnedAt: null,
                  archivedAt: null,
                  createdAt: "2026-11-25T20:00:00.000Z" as any,
                  updatedAt: "2026-11-25T20:00:00.000Z" as any,
                  deletedAt: null,
                }),
              )
            : Effect.succeed(Option.none()),
      }),
    );

    const reactor = yield* makeWithRunner(
      (invocation) =>
        Effect.sync(() => {
          calls.push(invocation);
        }),
      { statTtlMs: 0 },
    ).pipe(Effect.provide(dependencies));

    return { reactor, queue, calls, dir, projectId };
  }).pipe(Effect.provide(baseConfigLayer));

  return testLayer;
}

function makeThread(
  id: string,
  now: DateTime.Utc,
  overrides: Partial<OrchestrationV2AppThread> = {},
): OrchestrationV2AppThread {
  const threadId = ThreadId.make(id);
  const providerInstanceId = ProviderInstanceId.make("codex");
  return {
    id: threadId,
    projectId: ProjectId.make("proj-1"),
    title: "Fix hooks",
    createdBy: "user",
    creationSource: "desktop",
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    ...overrides,
  };
}

function makeRun(threadId: ThreadId, runId: string, status: OrchestrationV2Run["status"], now: DateTime.Utc): OrchestrationV2Run {
  const providerInstanceId = ProviderInstanceId.make("omp");
  return {
    id: RunId.make(runId),
    threadId,
    ordinal: 1,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "claude-sonnet" },
    providerThreadId: null,
    userMessageId: MessageId.make("msg-1"),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: now,
    startedAt: now,
    completedAt: status === "completed" || status === "failed" || status === "cancelled" ? now : null,
    checkpointId: null,
    contextHandoffId: null,
  };
}

describe("LifecycleHooksReactor", () => {
  it.effect("maps lifecycle events, deduplicates noisy streaming updates, and skips unlisted threads", () =>
    Effect.gen(function* () {
      const now = DateTime.makeUnsafe("2026-11-25T21:00:00.000Z");
      const thread = makeThread("th-main", now);
      const subagentThread = makeThread("th-sub", now, {
        lineage: {
          rootThreadId: thread.id,
          parentThreadId: thread.id,
          relationshipToParent: "subagent",
        },
      });

      const allEvents = [
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "PermissionRequest",
        "Notification",
        "Stop",
        "RunError",
        "Interrupt",
        "SessionEnd",
      ];
      const hooks = Object.fromEntries(
        allEvents.map((ev) => [ev, [{ hooks: [{ type: "command", command: `busy-bar hook phoenix --event ${ev}`, timeout: 3 }] }]]),
      );

      const harness = yield* makeTestHarness({
        hooksJson: { hooks },
        threads: [thread, subagentThread],
        projectTitle: "busy-bar",
        projectRoot: "/work/busy-bar",
      });

      try {
        const base = { occurredAt: now, commandId: CommandId.make("cmd-1") };

        // 1. Run transitions preparing -> starting -> running fire UserPromptSubmit once
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e1"),
          type: "run.created",
          threadId: thread.id,
          payload: makeRun(thread.id, "run-1", "preparing", now),
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e2"),
          type: "run.updated",
          threadId: thread.id,
          payload: makeRun(thread.id, "run-1", "starting", now),
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e3"),
          type: "run.updated",
          threadId: thread.id,
          payload: makeRun(thread.id, "run-1", "running", now),
        });

        // 2. Streaming tool item emits PreToolUse once, then PostToolUse once
        const cmdItemBase = {
          id: TurnItemId.make("ti-cmd-1"),
          threadId: thread.id,
          runId: RunId.make("run-1"),
          nodeId: NodeId.make("n1"),
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 1,
          title: null,
          startedAt: now,
          completedAt: null,
          updatedAt: now,
          type: "command_execution" as const,
          input: "npm test",
        };
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e4"),
          type: "turn-item.updated",
          threadId: thread.id,
          payload: { ...cmdItemBase, status: "running" },
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e5"),
          type: "turn-item.updated",
          threadId: thread.id,
          payload: { ...cmdItemBase, status: "running" },
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e6"),
          type: "turn-item.updated",
          threadId: thread.id,
          payload: { ...cmdItemBase, status: "completed", completedAt: now },
        });

        // 3. Approval item + runtime request -> PermissionRequest, then resolved -> PostToolUse
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e7"),
          type: "turn-item.updated",
          threadId: thread.id,
          payload: {
            id: TurnItemId.make("ti-appr-1"),
            threadId: thread.id,
            runId: RunId.make("run-1"),
            nodeId: NodeId.make("n1"),
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 2,
            status: "pending",
            title: null,
            startedAt: now,
            completedAt: null,
            updatedAt: now,
            type: "approval_request",
            requestId: RuntimeRequestId.make("req-appr-1"),
            requestKind: "command_execution",
            prompt: "Allow npm publish?",
            appName: "Bash",
          },
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e8"),
          runId: RunId.make("run-1"),
          type: "runtime-request.updated",
          threadId: thread.id,
          payload: {
            id: RuntimeRequestId.make("req-appr-1"),
            nodeId: NodeId.make("n1"),
            providerTurnId: null,
            nativeRequestRef: null,
            kind: "command_execution",
            status: "pending",
            responseCapability: { type: "message" },
            createdAt: now,
            resolvedAt: null,
          },
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e9"),
          runId: RunId.make("run-1"),
          type: "runtime-request.updated",
          threadId: thread.id,
          payload: {
            id: RuntimeRequestId.make("req-appr-1"),
            nodeId: NodeId.make("n1"),
            providerTurnId: null,
            nativeRequestRef: null,
            kind: "command_execution",
            status: "resolved",
            responseCapability: { type: "message" },
            createdAt: now,
            resolvedAt: now,
          },
        });

        // 4. User input request -> Notification; auth_refresh -> ignored
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e10"),
          type: "turn-item.updated",
          threadId: thread.id,
          payload: {
            id: TurnItemId.make("ti-ask-1"),
            threadId: thread.id,
            runId: RunId.make("run-1"),
            nodeId: NodeId.make("n1"),
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 3,
            status: "pending",
            title: null,
            startedAt: now,
            completedAt: null,
            updatedAt: now,
            type: "user_input_request",
            requestId: RuntimeRequestId.make("req-ask-1"),
            questions: [
              { id: "q1", header: "Target", question: "Deploy to prod?", options: [] },
            ],
          },
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e11"),
          runId: RunId.make("run-1"),
          type: "runtime-request.updated",
          threadId: thread.id,
          payload: {
            id: RuntimeRequestId.make("req-ask-1"),
            nodeId: NodeId.make("n1"),
            providerTurnId: null,
            nativeRequestRef: null,
            kind: "user_input",
            status: "pending",
            responseCapability: { type: "message" },
            createdAt: now,
            resolvedAt: null,
          },
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e12"),
          runId: RunId.make("run-1"),
          type: "runtime-request.updated",
          threadId: thread.id,
          payload: {
            id: RuntimeRequestId.make("req-auth-1"),
            nodeId: NodeId.make("n1"),
            providerTurnId: null,
            nativeRequestRef: null,
            kind: "auth_refresh",
            status: "pending",
            responseCapability: { type: "message" },
            createdAt: now,
            resolvedAt: null,
          },
        });

        // 5. Error item + run stop + interrupt + archived + unlisted subagent (ignored)
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e13"),
          type: "turn-item.updated",
          threadId: thread.id,
          payload: {
            id: TurnItemId.make("ti-err-1"),
            threadId: thread.id,
            runId: RunId.make("run-1"),
            nodeId: NodeId.make("n1"),
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 4,
            status: "completed",
            title: null,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
            type: "error",
            failure: { class: "usage_limit", message: "Rate limit hit", code: null, retryable: false },
          },
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e14"),
          type: "run.updated",
          threadId: thread.id,
          payload: makeRun(thread.id, "run-1", "completed", now),
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e15"),
          type: "run.updated",
          threadId: thread.id,
          payload: makeRun(thread.id, "run-2", "cancelled", now),
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e16"),
          type: "thread.archived",
          threadId: thread.id,
          payload: { ...thread, archivedAt: now },
        });
        yield* harness.reactor.handle({
          ...base,
          id: EventId.make("e17"),
          type: "run.created",
          threadId: subagentThread.id,
          payload: makeRun(subagentThread.id, "run-sub", "running", now),
        });

        expect(harness.calls.map((c) => c.eventName)).toEqual([
          "UserPromptSubmit",
          "PreToolUse",
          "PostToolUse",
          "PermissionRequest",
          "PostToolUse",
          "Notification",
          "RunError",
          "Stop",
          "Interrupt",
          "SessionEnd",
        ]);

        const pre = harness.calls[1]!.payload;
        expect(pre.tool_name).toBe("Bash");
        expect(pre.tool_input).toEqual({ command: "npm test" });
        expect(pre.project).toBe("busy-bar");
        expect(pre.cwd).toBe("/work/busy-bar");

        const perm = harness.calls[3]!.payload;
        expect(perm.tool_name).toBe("Bash");
        expect(perm.message).toBe("Allow npm publish?");
        expect(perm.requestKind).toBe("command_execution");

        const ask = harness.calls[5]!.payload;
        expect(ask.notification_type).toBe("user_input");
        expect(ask.message).toBe("Deploy to prod?");

        const err = harness.calls[6]!.payload;
        expect(err.errorClass).toBe("usage_limit");
        expect(err.message).toBe("Rate limit hit");
      } finally {
        fs.rmSync(harness.dir, { recursive: true, force: true });
      }
    }),
  );

  it.live("streams events via start() in per-thread order and ignores missing hooks.json", () =>
    Effect.gen(function* () {
      const now = DateTime.makeUnsafe("2026-11-25T21:00:00.000Z");
      const thread = makeThread("th-stream", now);
      const harness = yield* makeTestHarness({
        hooksJson: undefined,
        threads: [thread],
      });
      try {
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* harness.reactor.start();
            yield* Queue.offer(harness.queue, {
              id: EventId.make("s1"),
              commandId: CommandId.make("cmd-s1"),
              type: "run.created",
              threadId: thread.id,
              occurredAt: now,
              payload: makeRun(thread.id, "run-s1", "running", now),
            });
            yield* Effect.sleep("30 millis");
          }),
        );
        expect(harness.calls).toEqual([]);
      } finally {
        fs.rmSync(harness.dir, { recursive: true, force: true });
      }
    }),
  );

  it.live("streams configured hooks through start() and orders per-thread execution", () =>
    Effect.gen(function* () {
      const now = DateTime.makeUnsafe("2026-11-25T21:00:00.000Z");
      const thread = makeThread("th-stream-configured", now);
      const harness = yield* makeTestHarness({
        hooksJson: {
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type: "command", command: "hook start", timeout: 3 }] }],
            Stop: [{ hooks: [{ type: "command", command: "hook stop", timeout: 3 }] }],
          },
        },
        threads: [thread],
      });
      try {
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* harness.reactor.start();
            yield* Queue.offer(harness.queue, {
              id: EventId.make("s2"),
              commandId: CommandId.make("cmd-s2"),
              type: "run.created",
              threadId: thread.id,
              occurredAt: now,
              payload: makeRun(thread.id, "run-s2", "running", now),
            });
            yield* Queue.offer(harness.queue, {
              id: EventId.make("s3"),
              commandId: CommandId.make("cmd-s3"),
              type: "run.updated",
              threadId: thread.id,
              occurredAt: now,
              payload: makeRun(thread.id, "run-s2", "completed", now),
            });
            yield* Effect.sleep("50 millis");
          }),
        );
        expect(harness.calls.map((c) => c.eventName)).toEqual(["UserPromptSubmit", "Stop"]);
      } finally {
        fs.rmSync(harness.dir, { recursive: true, force: true });
      }
    }),
  );

  it.effect("spawnHookCommand writes JSON stdin to a real subprocess and handles failures gracefully", () =>
    Effect.gen(function* () {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-hooks-exec-"));
      try {
        const outFile = path.join(dir, "captured.json");
        const script = `const fs = require("node:fs"); const raw = fs.readFileSync(0, "utf8"); fs.writeFileSync(${JSON.stringify(outFile)}, raw);`;
        yield* spawnHookCommand({
          eventName: "Stop",
          threadId: "th-real",
          command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
          timeoutMs: 3_000,
          cwd: dir,
          payload: {
            hook_event_name: "Stop",
            event: "Stop",
            session_id: "th-real",
            threadId: "th-real",
            project: "busy-bar",
            title: "Test thread",
            timestamp: "2026-11-25T21:00:00.000Z",
          },
        });

        const captured = JSON.parse(fs.readFileSync(outFile, "utf8"));
        assert.equal(captured.event, "Stop");
        assert.equal(captured.threadId, "th-real");

        // Non-zero exit must never fail the Effect
        yield* spawnHookCommand({
          eventName: "Stop",
          threadId: "th-real",
          command: `${JSON.stringify(process.execPath)} -e "process.exit(2)"`,
          timeoutMs: 2_000,
          cwd: dir,
          payload: {
            hook_event_name: "Stop",
            event: "Stop",
            session_id: "th-real",
            threadId: "th-real",
            project: "busy-bar",
            title: "Test thread",
            timestamp: "2026-11-25T21:00:00.000Z",
          },
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }),
  );
});

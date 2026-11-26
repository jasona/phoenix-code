import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  GitCommandError,
  IsoDateTime,
  MessageId,
  OrchestrationV2ConversationMessage,
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
  ProjectId,
  RunId,
  RuntimeRequestId,
  ServerProvider,
  ThreadId,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as Plugins from "./Plugins.ts";
import * as MissionControl from "./MissionControl.ts";
import * as Reviews from "./MissionControlReviews.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Projects from "../orchestration-v2/ProjectStore.ts";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as Schedules from "../scheduledTasks/ScheduledTaskService.ts";
import * as Git from "../vcs/GitVcsDriver.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";

const decodeThread = Schema.decodeUnknownSync(OrchestrationV2ThreadShell);
const decodePending = Schema.decodeUnknownSync(
  OrchestrationV2ThreadShell.fields.pendingRuntimeRequest,
);
const decodeProjection = Schema.decodeUnknownSync(OrchestrationV2ThreadProjection);
const decodeActivity = Schema.decodeUnknownSync(OrchestrationV2ProjectedTurnItem);
const decodeUnchanged = Schema.decodeUnknownSync(Schema.Struct({ unchanged: Schema.Boolean }));
const decodeMessage = Schema.decodeUnknownSync(OrchestrationV2ConversationMessage);
const now = DateTime.makeUnsafe("2026-11-25T12:00:00Z");
const project = Schema.decodeSync(Projects.ProjectRow)({
  projectId: "project",
  title: "Phoenix",
  workspaceRoot: "/project",
  hasCustomTitle: false,
  defaultModelSelection: { instanceId: "codex", model: "gpt-5.4" },
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  trackedFolders: [],
  pinnedAt: null,
  archivedAt: null,
  createdAt: "2026-11-25T12:00:00Z",
  updatedAt: "2026-11-25T12:00:00Z",
  deletedAt: null,
});
function thread(id: string, overrides: Partial<OrchestrationV2ThreadShell> = {}) {
  return decodeThread({
    id,
    projectId: project.projectId,
    title: id,
    providerInstanceId: "codex",
    modelSelection: project.defaultModelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    lineage: { rootThreadId: id, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    activeProviderThreadId: null,
    latestRunId: null,
    activeRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    createdBy: "user",
    creationSource: "web",
    ...overrides,
  });
}
const decodeSnapshot = Schema.decodeUnknownSync(
  Schema.Struct({
    truncated: Schema.Boolean,
    projects: Schema.Array(
      Schema.Struct({
        threads: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
      }),
    ),
    needsAttention: Schema.Array(Schema.Struct({ threadId: Schema.String })),
    summary: Schema.Struct({
      threadCount: Schema.Number,
      runningCount: Schema.Number,
      needsAttentionCount: Schema.Number,
    }),
  }),
);
const platform = Layer.mergeAll(
  NodeCrypto.layer,
  Reviews.layerMemory,
  Layer.mock(Plugins.Plugins)({ list: () => Effect.succeed([]) }),
  Layer.mock(Projects.ProjectStoreV2)({
    list: () => Effect.succeed([project]),
    get: () => Effect.succeedSome(project),
  }),
  Layer.mock(Providers.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
  Layer.mock(Schedules.ScheduledTaskService)({ list: () => Effect.succeed({ tasks: [] }) }),
  Layer.mock(Git.GitVcsDriver)({}),
);

it.effect(
  "bounds the dashboard, prioritizes waiting work, and does not scan transcripts or Git",
  () => {
    const waiting = thread("waiting", {
      title: "x".repeat(10_000),
      pendingRuntimeRequest: decodePending({ id: "request", kind: "command", createdAt: now }),
    });
    const all = [
      ...Array.from({ length: 310 }, (_, i) => thread(`idle-${i}`)),
      waiting,
      thread("deleted", { deletedAt: now }),
    ];
    return Effect.gen(function* () {
      const service = yield* MissionControl.MissionControl;
      const result = decodeSnapshot(yield* service.request({ action: "snapshot" }));
      assert.isTrue(result.truncated);
      assert.strictEqual(result.projects[0]?.threads.length, 300);
      assert.strictEqual(result.projects[0]?.threads[0]?.id, "waiting");
      assert.strictEqual(result.projects[0]?.threads[0]?.title.length, 300);
      assert.deepStrictEqual(
        result.needsAttention.map((item) => item.threadId),
        ["waiting"],
      );
    }).pipe(
      Effect.provide(
        MissionControl.layer.pipe(
          Layer.provide(
            Layer.merge(
              platform,
              Layer.mock(Threads.ThreadManagementService)({
                getShellSnapshot: () =>
                  Effect.succeed({
                    schemaVersion: 2,
                    snapshotSequence: 0,
                    threads: all,
                    archivedThreads: [],
                  }),
              }),
            ),
          ),
        ),
      ),
    );
  },
);

it.effect(
  "keeps running work visible ahead of a large review backlog and counts all eligible threads",
  () => {
    const all = [
      ...Array.from({ length: 310 }, (_, index) =>
        thread(`review-${index}`, { latestRunId: RunId.make(`run-${index}`), status: "completed" }),
      ),
      thread("running", {
        latestRunId: RunId.make("active"),
        activeRunId: RunId.make("active"),
        status: "running",
      }),
      thread("decision", {
        pendingRuntimeRequest: decodePending({ id: "request", kind: "command", createdAt: now }),
      }),
    ];
    return Effect.gen(function* () {
      const service = yield* MissionControl.MissionControl;
      const result = decodeSnapshot(yield* service.request({ action: "snapshot" }));
      assert.deepStrictEqual(
        result.projects[0]?.threads.slice(0, 2).map((entry) => entry.id),
        ["decision", "running"],
      );
      assert.strictEqual(result.projects[0]?.threads.length, 300);
      assert.deepStrictEqual(result.summary, {
        threadCount: 312,
        runningCount: 1,
        needsAttentionCount: 311,
      });
    }).pipe(
      Effect.provide(
        MissionControl.layer.pipe(
          Layer.provide(
            Layer.merge(
              platform,
              Layer.mock(Threads.ThreadManagementService)({
                getShellSnapshot: () =>
                  Effect.succeed({
                    schemaVersion: 2,
                    snapshotSequence: 0,
                    threads: all,
                    archivedThreads: [],
                  }),
              }),
            ),
          ),
        ),
      ),
    );
  },
);

it.effect("rejects archived targets and empty replies before dispatching any commands", () =>
  Effect.gen(function* () {
    const service = yield* MissionControl.MissionControl;
    for (const action of ["detail", "seen", "openThread"] as const) {
      assert.strictEqual(
        (yield* service
          .request({ action, threadId: ThreadId.make("archived") })
          .pipe(Effect.asVoid, Effect.flip)).reason,
        "not-found",
      );
    }
    assert.strictEqual(
      (yield* service
        .request({ action: "reply", threadId: ThreadId.make("active"), text: "   " })
        .pipe(Effect.asVoid, Effect.flip)).reason,
      "permission-denied",
    );
  }).pipe(
    Effect.provide(
      MissionControl.layer.pipe(
        Layer.provide(
          Layer.merge(
            platform,
            Layer.mock(Threads.ThreadManagementService)({
              getThreadShell: (id) =>
                Effect.succeed(thread(id, id === "archived" ? { archivedAt: now } : {})),
            }),
          ),
        ),
      ),
    ),
  ),
);

it.effect("marks a conversation seen through the normal thread command", () => {
  const commands: OrchestrationV2ServerCommand[] = [];
  return Effect.gen(function* () {
    const service = yield* MissionControl.MissionControl;
    yield* service.request({ action: "seen", threadId: ThreadId.make("active") });
    assert.strictEqual(commands[0]?.type, "thread.visit");
    assert.deepStrictEqual(
      commands.map((command) => (command.type === "thread.visit" ? command.threadId : null)),
      [ThreadId.make("active")],
    );
    assert.strictEqual(project.projectId, ProjectId.make("project"));
  }).pipe(
    Effect.provide(
      MissionControl.layer.pipe(
        Layer.provide(
          Layer.merge(
            platform,
            Layer.mock(Threads.ThreadManagementService)({
              getThreadShell: (id) => Effect.succeed(thread(id)),
              dispatch: (command) =>
                Effect.sync(() => {
                  commands.push(command);
                  return { sequence: 1, storedEvents: [] };
                }),
            }),
          ),
        ),
      ),
    ),
  );
});

const attentionEntry = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  category: Schema.String,
});
const decodeInbox = Schema.decodeUnknownSync(
  Schema.Struct({
    etag: Schema.String,
    needsAttention: Schema.Array(attentionEntry),
    snoozedAttention: Schema.Array(attentionEntry),
    acceptedAttention: Schema.Array(attentionEntry),
    dismissedAttention: Schema.Array(attentionEntry),
  }),
);

it.effect(
  "keeps read completions in review, separates decisions and failures, and exposes reversible snoozes and acceptance",
  () => {
    const completed = {
      latestRunId: RunId.make("run"),
      status: "completed" as const,
      latestRunCompletedAt: now,
    };
    const all = [
      thread("read", { ...completed, lastVisitedAt: now }),
      thread("accepted", { ...completed, settledOverride: "settled", settledAt: now }),
      thread("agent-settled", { ...completed, settledOverride: "settled", settledAt: now }),
      thread("reopened", { ...completed, settledOverride: "active", settledAt: null }),
      thread("resettled", {
        ...completed,
        settledOverride: "settled",
        settledAt: DateTime.add(now, { seconds: 1 }),
      }),
      thread("snoozed", {
        ...completed,
        snoozedAt: now,
        snoozedUntil: DateTime.add(now, { hours: 1 }),
      }),
      thread("failed", { ...completed, status: "failed" }),
      thread("stopped", { ...completed, status: "interrupted" }),
      thread("dismissed", {
        ...completed,
        status: "interrupted",
        settledOverride: "settled",
        settledAt: now,
      }),
      thread("cancelled", {
        ...completed,
        status: "cancelled",
        settledOverride: "settled",
        settledAt: now,
      }),
      thread("stopped-reopened", {
        ...completed,
        status: "interrupted",
        settledOverride: "active",
      }),
      thread("stopped-new-run", {
        ...completed,
        status: "interrupted",
        settledOverride: "settled",
        settledAt: now,
        latestRunCompletedAt: DateTime.add(now, { seconds: 1 }),
      }),
      thread("stopped-question", {
        ...completed,
        status: "interrupted",
        settledOverride: "settled",
        settledAt: now,
        pendingRuntimeRequest: decodePending({ id: "request", kind: "user_input", createdAt: now }),
      }),
      thread("question", {
        pendingRuntimeRequest: decodePending({ id: "request", kind: "user_input", createdAt: now }),
      }),
      thread("waiting", { ...completed, blockedOnThreadWait: true }),
    ];
    return Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(now));
      const service = yield* MissionControl.MissionControl;
      const reviews = yield* Reviews.MissionControlReviews;
      yield* reviews.accept({
        threadId: ThreadId.make("accepted"),
        runId: RunId.make("run"),
        acceptedAt: IsoDateTime.make(DateTime.formatIso(now)),
        settledAt: IsoDateTime.make(DateTime.formatIso(now)),
      });
      for (const id of ["reopened", "resettled"])
        yield* reviews.accept({
          threadId: ThreadId.make(id),
          runId: RunId.make("run"),
          acceptedAt: IsoDateTime.make(DateTime.formatIso(now)),
          settledAt: IsoDateTime.make(DateTime.formatIso(now)),
        });
      const result = decodeInbox(yield* service.request({ action: "snapshot" }));
      assert.deepStrictEqual(
        new Map(result.needsAttention.map((entry) => [entry.threadId, entry.category])),
        new Map([
          ["read", "review"],
          ["failed", "failure"],
          ["stopped", "failure"],
          ["stopped-reopened", "failure"],
          ["stopped-new-run", "failure"],
          ["stopped-question", "decision"],
          ["question", "decision"],
          ["agent-settled", "review"],
          ["reopened", "review"],
          ["resettled", "review"],
        ]),
      );
      assert.deepStrictEqual(
        result.acceptedAttention.map((entry) => entry.threadId),
        ["accepted"],
      );
      assert.deepStrictEqual(
        result.snoozedAttention.map((entry) => entry.threadId),
        ["snoozed"],
      );
      assert.deepStrictEqual(result.dismissedAttention.map((entry) => entry.threadId).sort(), [
        "cancelled",
        "dismissed",
      ]);
      assert.include(result.needsAttention.find((entry) => entry.threadId === "read")?.id, "run");
      yield* TestClock.adjust("1 second");
      const unchanged = decodeUnchanged(
        yield* service.request({ action: "snapshot", etag: result.etag }),
      );
      assert.isTrue(unchanged.unchanged);
      yield* TestClock.adjust("1 hour");
      const awake = decodeInbox(yield* service.request({ action: "snapshot" }));
      assert.isTrue(awake.needsAttention.some((entry) => entry.threadId === "snoozed"));
    }).pipe(
      Effect.provide(
        MissionControl.layer.pipe(
          Layer.provideMerge(
            Layer.merge(
              platform,
              Layer.mock(Threads.ThreadManagementService)({
                getShellSnapshot: () =>
                  Effect.succeed({
                    schemaVersion: 2,
                    snapshotSequence: 0,
                    threads: all,
                    archivedThreads: [],
                  }),
              }),
            ),
          ),
        ),
      ),
    );
  },
);

it.effect(
  "guards triage by run and request identity and never accepts active work or an undecided plan",
  () => {
    const commands: OrchestrationV2ServerCommand[] = [];
    const runId = RunId.make("run");
    const all = new Map(
      [
        thread("ready", { latestRunId: runId, status: "completed" }),
        thread("stopped", { latestRunId: runId, status: "interrupted" }),
        thread("cancelled", { latestRunId: runId, status: "cancelled" }),
        thread("failed", { latestRunId: runId, status: "failed" }),
        thread("stopped-plan", {
          latestRunId: runId,
          status: "interrupted",
          hasActionableProposedPlan: true,
        }),
        thread("stopped-child", {
          latestRunId: runId,
          status: "interrupted",
          blockedOnThreadWait: true,
        }),
        thread("stopped-guest", {
          latestRunId: runId,
          status: "interrupted",
          pendingGuestMessageCount: 1,
        }),
        thread("working", { latestRunId: runId, activeRunId: runId, status: "running" }),
        thread("plan", {
          latestRunId: runId,
          status: "completed",
          hasActionableProposedPlan: true,
        }),
        thread("question", {
          latestRunId: runId,
          pendingRuntimeRequest: decodePending({
            id: "new-request",
            kind: "user_input",
            createdAt: now,
          }),
        }),
      ].map((entry) => [entry.id, entry]),
    );
    return Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(now));
      const service = yield* MissionControl.MissionControl;
      for (const id of ["working", "plan"]) {
        const error = yield* service
          .request({
            action: "triage",
            threadId: ThreadId.make(id),
            disposition: "accept",
            expectedLatestRunId: runId,
          })
          .pipe(Effect.asVoid, Effect.flip);
        assert.strictEqual(error.reason, "permission-denied");
      }
      assert.strictEqual(
        (yield* service
          .request({
            action: "triage",
            threadId: ThreadId.make("ready"),
            disposition: "accept",
            expectedLatestRunId: RunId.make("old"),
          })
          .pipe(Effect.asVoid, Effect.flip)).reason,
        "stale-view",
      );
      assert.strictEqual(
        (yield* service
          .request({
            action: "triage",
            threadId: ThreadId.make("question"),
            disposition: "snooze",
            expectedLatestRunId: runId,
            expectedRequestId: RuntimeRequestId.make("old-request"),
            snoozedUntil: IsoDateTime.make("2026-11-25T13:00:00Z"),
          })
          .pipe(Effect.asVoid, Effect.flip)).reason,
        "stale-view",
      );
      for (const disposition of ["accept", "reopen", "snooze", "unsnooze"] as const) {
        yield* service.request({
          action: "triage",
          threadId: ThreadId.make("ready"),
          disposition,
          expectedLatestRunId: runId,
          snoozedUntil: IsoDateTime.make("2026-11-25T13:00:00Z"),
        });
      }
      assert.deepStrictEqual(
        commands.map((command) => command.type),
        ["thread.settle", "thread.unsettle", "thread.snooze", "thread.unsnooze"],
      );
      for (const id of [
        "working",
        "plan",
        "ready",
        "failed",
        "stopped-plan",
        "stopped-child",
        "stopped-guest",
        "question",
      ]) {
        const error = yield* service
          .request({
            action: "triage",
            threadId: ThreadId.make(id),
            disposition: "dismiss",
            expectedLatestRunId: runId,
            ...(id === "question"
              ? { expectedRequestId: RuntimeRequestId.make("new-request") }
              : {}),
          })
          .pipe(Effect.asVoid, Effect.flip);
        assert.strictEqual(error.reason, "permission-denied");
      }
      const stale = yield* service
        .request({
          action: "triage",
          threadId: ThreadId.make("stopped"),
          disposition: "dismiss",
          expectedLatestRunId: RunId.make("old"),
        })
        .pipe(Effect.asVoid, Effect.flip);
      assert.strictEqual(stale.reason, "stale-view");
      for (const id of ["stopped", "cancelled"]) {
        const accept = yield* service
          .request({
            action: "triage",
            threadId: ThreadId.make(id),
            disposition: "accept",
            expectedLatestRunId: runId,
          })
          .pipe(Effect.asVoid, Effect.flip);
        assert.strictEqual(accept.reason, "permission-denied");
        yield* service.request({
          action: "triage",
          threadId: ThreadId.make(id),
          disposition: "dismiss",
          expectedLatestRunId: runId,
        });
        const dismissed = decodeInbox(yield* service.request({ action: "snapshot" }));
        assert.isTrue(dismissed.dismissedAttention.some((entry) => entry.threadId === id));
        assert.isFalse(dismissed.needsAttention.some((entry) => entry.threadId === id));
        assert.isFalse(dismissed.acceptedAttention.some((entry) => entry.threadId === id));
        yield* service.request({
          action: "triage",
          threadId: ThreadId.make(id),
          disposition: "reopen",
          expectedLatestRunId: runId,
        });
        const reopened = decodeInbox(yield* service.request({ action: "snapshot" }));
        assert.isTrue(reopened.needsAttention.some((entry) => entry.threadId === id));
        assert.isFalse(reopened.dismissedAttention.some((entry) => entry.threadId === id));
      }
      const accepted = commands[0];
      assert.isTrue(accepted?.type === "thread.settle" && accepted.expectedLatestRunId === runId);
    }).pipe(
      Effect.provide(
        MissionControl.layer.pipe(
          Layer.provide(
            Layer.merge(
              platform,
              Layer.mock(Threads.ThreadManagementService)({
                getThreadShell: (id) => Effect.succeed(all.get(id) ?? null),
                getShellSnapshot: () =>
                  Effect.succeed({
                    schemaVersion: 2,
                    snapshotSequence: 0,
                    threads: [...all.values()],
                    archivedThreads: [],
                  }),
                dispatch: (command) =>
                  Effect.sync(() => {
                    commands.push(command);
                    const existing = "threadId" in command ? all.get(command.threadId) : undefined;
                    if (existing && command.type === "thread.settle")
                      all.set(existing.id, {
                        ...existing,
                        settledOverride: "settled",
                        settledAt: now,
                      });
                    if (existing && command.type === "thread.unsettle")
                      all.set(existing.id, {
                        ...existing,
                        settledOverride: "active",
                        settledAt: null,
                      });
                    return { sequence: 1, storedEvents: [] };
                  }),
              }),
            ),
          ),
        ),
      ),
    );
  },
);

function records(shell: OrchestrationV2ThreadShell) {
  return decodeProjection({
    thread: shell,
    runs: shell.latestRunId
      ? [
          {
            id: shell.latestRunId,
            threadId: shell.id,
            ordinal: 1,
            providerInstanceId: "codex",
            modelSelection: project.defaultModelSelection,
            providerThreadId: null,
            userMessageId: "user-message",
            rootNodeId: null,
            activeAttemptId: null,
            status: shell.status,
            requestedAt: now,
            startedAt: now,
            completedAt: shell.activeRunId ? null : now,
            checkpointId: null,
            contextHandoffId: null,
          },
        ]
      : [],
    providerSessions: [
      {
        id: "session",
        driver: "codex",
        providerInstanceId: "codex",
        status: "ready",
        cwd: "/project",
        model: "gpt-5.4",
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: now,
        updatedAt: now,
        lastError: null,
      },
    ],
    attempts: [],
    nodes: [],
    subagents: [],
    providerThreads: [],
    providerTurns: [],
    runtimeRequests: [],
    messages: [],
    plans: [],
    turnItems: [],
    checkpointScopes: [],
    checkpoints: [],
    contextHandoffs: [],
    contextTransfers: [],
    visibleTurnItems: [],
    updatedAt: now,
  });
}
const provider = Schema.decodeSync(ServerProvider)({
  instanceId: "codex",
  driver: "codex",
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: DateTime.formatIso(now),
  models: [],
});
const providerLayer = Layer.mock(Providers.ProviderRegistry)({
  getProviders: Effect.succeed([provider]),
});

it.effect("targets steering and stop at the reviewed run and refuses stale controls", () => {
  const runId = RunId.make("run");
  const shell = thread("working", { latestRunId: runId, activeRunId: runId, status: "running" });
  const commands: OrchestrationV2ServerCommand[] = [];
  const interrupted: RunId[] = [];
  return Effect.gen(function* () {
    const service = yield* MissionControl.MissionControl;
    for (const command of ["stop", "retry", "resume"] as const) {
      assert.strictEqual(
        (yield* service
          .request({
            action: "control",
            threadId: shell.id,
            command,
            expectedRunId: RunId.make("old"),
          })
          .pipe(Effect.asVoid, Effect.flip)).reason,
        "stale-view",
      );
    }
    assert.strictEqual(
      (yield* service
        .request({
          action: "reply",
          threadId: shell.id,
          text: "Stop editing that file",
          mode: "steer",
          expectedActiveRunId: RunId.make("old"),
        })
        .pipe(Effect.asVoid, Effect.flip)).reason,
      "stale-view",
    );
    yield* service.request({
      action: "reply",
      threadId: shell.id,
      text: "Focus on the tests",
      mode: "steer",
      expectedActiveRunId: runId,
    });
    yield* service.request({
      action: "control",
      threadId: shell.id,
      command: "stop",
      expectedRunId: runId,
    });
    assert.strictEqual(commands.length, 1);
    const command = commands[0];
    assert.isTrue(
      command?.type === "message.dispatch" &&
        command.dispatchMode.type === "steer_active" &&
        command.dispatchMode.targetRunId === runId,
    );
    assert.deepStrictEqual(interrupted, [runId]);
  }).pipe(
    Effect.provide(
      MissionControl.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            platform,
            providerLayer,
            Layer.mock(Threads.ThreadManagementService)({
              getThreadShell: () => Effect.succeed(shell),
              getThreadRecords: () => Effect.succeed(records(shell)),
              dispatch: (command) =>
                Effect.sync(() => {
                  commands.push(command);
                  return { sequence: 1, storedEvents: [] };
                }),
              interruptThread: (input) =>
                Effect.sync(() => {
                  if (input.runId) interrupted.push(input.runId);
                  return { type: "no_active_run" as const };
                }),
            }),
          ),
        ),
      ),
    ),
  );
});

function activity(id: string, fields: Record<string, unknown>) {
  return decodeActivity({
    position: 1,
    visibility: "local",
    sourceThreadId: "review",
    sourceItemId: id,
    item: {
      id,
      threadId: "review",
      runId: "run",
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status: "completed",
      title: null,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
      ...fields,
    },
  });
}
const decodeVerification = Schema.decodeUnknownSync(
  Schema.Struct({
    accepted: Schema.Boolean,
    verification: Schema.Struct({
      state: Schema.String,
      freshness: Schema.String,
      truncated: Schema.Boolean,
      commands: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          status: Schema.String,
          output: Schema.String,
          outputTruncated: Schema.Boolean,
        }),
      ),
    }),
  }),
);

it.effect(
  "derives evidence from latest-run exit codes, never prose, and marks edits after commands stale",
  () => {
    const shell = thread("review", { latestRunId: RunId.make("run"), status: "completed" });
    let items = [
      activity("claim", {
        type: "assistant_message",
        messageId: "claim",
        text: "All tests passed!",
        streaming: false,
      }),
    ];
    const gitFailure = new GitCommandError({
      operation: "test",
      command: "git",
      cwd: "/project",
      detail: "unavailable",
    });
    return Effect.gen(function* () {
      const service = yield* MissionControl.MissionControl;
      const claimOnly = decodeVerification(
        yield* service.request({ action: "detail", threadId: shell.id }),
      );
      assert.strictEqual(claimOnly.verification.state, "unknown");
      assert.deepStrictEqual(claimOnly.verification.commands, []);
      items = [
        ...items,
        activity("old-failure", {
          type: "command_execution",
          input: "test",
          exitCode: 1,
          runId: "old",
        }),
        activity("unknown", { type: "command_execution", input: "test" }),
        activity("passed", { type: "command_execution", input: "test", exitCode: 0 }),
        activity("failed", { type: "command_execution", input: "test", exitCode: 2 }),
        activity("edited", {
          type: "file_change",
          fileName: "index.ts",
          updatedAt: DateTime.add(now, { seconds: 1 }),
        }),
      ];
      const result = decodeVerification(
        yield* service.request({ action: "detail", threadId: shell.id }),
      );
      assert.strictEqual(result.verification.state, "failed");
      assert.strictEqual(result.verification.freshness, "stale");
      assert.deepStrictEqual(
        result.verification.commands.map((command) => [command.id, command.status]),
        [
          ["unknown", "unknown"],
          ["passed", "passed"],
          ["failed", "failed"],
        ],
      );
      items = Array.from({ length: 45 }, (_, index) =>
        activity(`command-${index}`, {
          type: "command_execution",
          input: "test",
          exitCode: 0,
          output: "x".repeat(8_192),
        }),
      );
      const bounded = decodeVerification(
        yield* service.request({ action: "detail", threadId: shell.id }),
      );
      assert.isTrue(bounded.verification.truncated);
      assert.strictEqual(bounded.verification.commands.length, 40);
      assert.isTrue(
        bounded.verification.commands.every(
          (command) => command.output.length === 4_096 && command.outputTruncated,
        ),
      );
      assert.strictEqual(bounded.verification.freshness, "unknown");
    }).pipe(
      Effect.provide(
        MissionControl.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              platform,
              providerLayer,
              Layer.mock(Git.GitVcsDriver)({
                execute: () => Effect.fail(gitFailure),
                statusDetailsLocal: () => Effect.fail(gitFailure),
              }),
              Layer.mock(Threads.ThreadManagementService)({
                getThreadShell: () => Effect.succeed(shell),
                getThreadRecords: () => Effect.succeed(records(shell)),
                getTimelinePage: (_, options) =>
                  Effect.sync(() => ({
                    items: options.view === "activity" ? items : [],
                    totalItems: items.length,
                    hasMore: false,
                    hasEarlier: false,
                  })),
                getShellSnapshot: () =>
                  Effect.succeed({
                    schemaVersion: 2,
                    snapshotSequence: 0,
                    threads: [shell],
                    archivedThreads: [],
                  }),
                getCheckpointContext: () =>
                  Effect.succeed({ runs: [], checkpoints: [], checkpointScopes: [] }),
              }),
            ),
          ),
        ),
      ),
    );
  },
);

it.effect("uses native continuation for resume and retries the original failed request", () => {
  const runId = RunId.make("run");
  let shell = thread("resume", { latestRunId: runId, status: "interrupted" });
  const commands: OrchestrationV2ServerCommand[] = [];
  const message = decodeMessage({
    id: "user-message",
    threadId: shell.id,
    runId,
    nodeId: null,
    role: "user",
    text: "Implement a retry policy",
    attachments: [],
    streaming: false,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    creationSource: "web",
  });
  return Effect.gen(function* () {
    const service = yield* MissionControl.MissionControl;
    yield* service.request({
      action: "control",
      threadId: shell.id,
      command: "resume",
      expectedRunId: runId,
    });
    shell = { ...shell, status: "failed" };
    yield* service.request({
      action: "control",
      threadId: shell.id,
      command: "retry",
      expectedRunId: runId,
    });
    const resumed = commands[0];
    const retried = commands[1];
    assert.isTrue(
      resumed?.type === "message.dispatch" &&
        resumed.manualContinuationOfRunId === runId &&
        resumed.text === "",
    );
    assert.isTrue(
      retried?.type === "message.dispatch" &&
        retried.text === message.text &&
        retried.dispatchMode.type === "start_immediately",
    );
  }).pipe(
    Effect.provide(
      MissionControl.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            platform,
            providerLayer,
            Layer.mock(Threads.ThreadManagementService)({
              getThreadShell: () => Effect.sync(() => shell),
              getThreadRecords: () => Effect.sync(() => records(shell)),
              getMessagesById: () =>
                Effect.succeed(new Map([[MessageId.make("user-message"), message]])),
              dispatch: (command) =>
                Effect.sync(() => {
                  commands.push(command);
                  return { sequence: 1, storedEvents: [] };
                }),
            }),
          ),
        ),
      ),
    ),
  );
});

it.effect(
  "does not offer steering or resume when the recorded provider cannot support them",
  () => {
    const runId = RunId.make("run");
    let shell = thread("unsupported", {
      latestRunId: runId,
      activeRunId: runId,
      status: "running",
    });
    return Effect.gen(function* () {
      const service = yield* MissionControl.MissionControl;
      assert.strictEqual(
        (yield* service
          .request({
            action: "reply",
            threadId: shell.id,
            text: "Change direction",
            mode: "steer",
            expectedActiveRunId: runId,
          })
          .pipe(Effect.asVoid, Effect.flip)).reason,
        "permission-denied",
      );
      shell = { ...shell, activeRunId: null, status: "interrupted" };
      assert.strictEqual(
        (yield* service
          .request({
            action: "control",
            threadId: shell.id,
            command: "resume",
            expectedRunId: runId,
          })
          .pipe(Effect.asVoid, Effect.flip)).reason,
        "permission-denied",
      );
    }).pipe(
      Effect.provide(
        MissionControl.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              platform,
              providerLayer,
              Layer.mock(Threads.ThreadManagementService)({
                getThreadShell: () => Effect.sync(() => shell),
                getThreadRecords: () =>
                  Effect.sync(() => {
                    const projection = records(shell);
                    return {
                      ...projection,
                      providerSessions: projection.providerSessions.map((session) => ({
                        ...session,
                        capabilities: {
                          ...session.capabilities,
                          turns: {
                            ...session.capabilities.turns,
                            supportsActiveSteering: false,
                            supportsSteeringByInterruptRestart: false,
                            supportsNativeResume: false,
                          },
                        },
                      })),
                    };
                  }),
              }),
            ),
          ),
        ),
      ),
    );
  },
);

it.effect("queues a reply when the run observed by the composer has already completed", () => {
  const runId = RunId.make("finished-run");
  const shell = thread("follow-up", { latestRunId: runId, activeRunId: null, status: "completed" });
  const projection = records(shell);
  const message = decodeMessage({
    id: "follow-up-message",
    threadId: shell.id,
    runId,
    nodeId: null,
    role: "user",
    text: "Now add coverage",
    attachments: [],
    streaming: false,
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    creationSource: "web",
  });
  const sent: Threads.ThreadManagementSendInput[] = [];
  return Effect.gen(function* () {
    const service = yield* MissionControl.MissionControl;
    for (const mode of ["queue", "auto"] as const) {
      yield* service.request({
        action: "reply",
        threadId: shell.id,
        text: message.text,
        mode,
        expectedActiveRunId: runId,
      });
    }
    assert.deepStrictEqual(
      sent.map((input) => ({ threadId: input.threadId, mode: input.mode, text: input.text })),
      [
        { threadId: shell.id, mode: "queue", text: message.text },
        { threadId: shell.id, mode: "queue", text: message.text },
      ],
    );
    assert.strictEqual(
      (yield* service
        .request({
          action: "reply",
          threadId: shell.id,
          text: message.text,
          mode: "steer",
          expectedActiveRunId: runId,
        })
        .pipe(Effect.asVoid, Effect.flip)).reason,
      "stale-view",
    );
  }).pipe(
    Effect.provide(
      MissionControl.layer.pipe(
        Layer.provide(
          Layer.merge(
            platform,
            Layer.mock(Threads.ThreadManagementService)({
              getThreadShell: () => Effect.succeed(shell),
              sendToThread: (input) =>
                Effect.sync(() => {
                  sent.push(input);
                  return {
                    dispatch: { sequence: 1, storedEvents: [] },
                    projection,
                    message,
                    run: projection.runs[0]!,
                    turnItem: null,
                    delivery: "started" as const,
                  };
                }),
            }),
          ),
        ),
      ),
    ),
  );
});

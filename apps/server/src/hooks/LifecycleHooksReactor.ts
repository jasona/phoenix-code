// @effect-diagnostics nodeBuiltinImport:off -- Non-blocking observe-only hook execution requires direct spawn with stdin EPIPE handling and SIGTERM/SIGKILL timeouts.
import * as ChildProcess from "node:child_process";
import * as Path from "node:path";
import * as fs from "node:fs";
import {
  isListedThreadLineage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  type ThreadId,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { forkParked } from "../serverActivation.ts";
import {
  makeLifecycleHooksConfigLoader,
  matchHooksForEvent,
  type LifecycleHookEventName,
} from "./LifecycleHooksConfig.ts";

const MAX_TRACKED_ENTRIES = 512;
const HARD_KILL_GRACE_MS = 500;

export interface LifecycleHookPayload {
  readonly hook_event_name: LifecycleHookEventName;
  readonly event: LifecycleHookEventName;
  readonly session_id: string;
  readonly threadId: string;
  readonly runId?: string | undefined;
  readonly project: string;
  readonly cwd?: string | undefined;
  readonly title: string;
  readonly driver?: string | undefined;
  readonly model?: string | undefined;
  readonly timestamp: string;
  readonly startedAtMs?: number | undefined;
  readonly runStatus?: string | undefined;
  readonly tool_name?: string | undefined;
  readonly tool_input?: unknown;
  readonly tool_status?: string | undefined;
  readonly requestKind?: string | undefined;
  readonly requestId?: string | undefined;
  readonly requestStatus?: string | undefined;
  readonly notification_type?: string | undefined;
  readonly errorClass?: string | undefined;
  readonly activity?: string | undefined;
  readonly message?: string | undefined;
}

export interface HookCommandInvocation {
  readonly eventName: LifecycleHookEventName;
  readonly threadId: string;
  readonly command: string;
  readonly timeoutMs: number;
  readonly cwd?: string | undefined;
  readonly payload: LifecycleHookPayload;
}

export type HookCommandRunner = (invocation: HookCommandInvocation) => Effect.Effect<void>;

export class LifecycleHooksReactor extends Context.Service<
  LifecycleHooksReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/hooks/LifecycleHooksReactor") {}

function trimSet(set: Set<string>, limit = MAX_TRACKED_ENTRIES): void {
  while (set.size > limit) {
    const oldest = set.values().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

function trimMap<V>(map: Map<string, V>, limit = MAX_TRACKED_ENTRIES): void {
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function deriveProjectName(projectTitle: string | undefined, cwd: string | undefined): string {
  const cleanTitle = projectTitle?.trim();
  if (cleanTitle) return cleanTitle;
  const cleanCwd = cwd?.trim().replace(/[/\\]+$/, "");
  if (cleanCwd) {
    const base = Path.basename(cleanCwd);
    if (base) return base;
  }
  return "general";
}

function resolveSpawnCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  try {
    if (fs.statSync(cwd).isDirectory()) return cwd;
  } catch {
    // Fall back to inherited server cwd when the thread's workspace no longer exists.
  }
  return undefined;
}

interface PendingHookCandidate {
  readonly eventName: LifecycleHookEventName;
  readonly matchTarget?: string | undefined;
  readonly runId?: string | undefined;
  readonly startedAtMs?: number | undefined;
  readonly runStatus?: string | undefined;
  readonly tool_name?: string | undefined;
  readonly tool_input?: unknown;
  readonly tool_status?: string | undefined;
  readonly requestKind?: string | undefined;
  readonly requestId?: string | undefined;
  readonly requestStatus?: string | undefined;
  readonly notification_type?: string | undefined;
  readonly errorClass?: string | undefined;
  readonly activity?: string | undefined;
  readonly message?: string | undefined;
}

function toolMetadataFromTurnItem(
  item: OrchestrationV2TurnItem,
): { readonly toolName: string; readonly toolInput: unknown } | null {
  switch (item.type) {
    case "command_execution":
      return { toolName: "Bash", toolInput: { command: item.input } };
    case "file_change":
      return { toolName: "Edit", toolInput: { file_path: item.fileName } };
    case "file_search":
      return { toolName: "Glob", toolInput: { pattern: item.pattern ?? "" } };
    case "web_search":
      return { toolName: "WebSearch", toolInput: { query: item.patterns?.[0] ?? "" } };
    case "dynamic_tool":
      return { toolName: item.toolName ?? "tool", toolInput: item.input };
    default:
      return null;
  }
}

function candidateEventsForFastPath(
  event: OrchestrationV2DomainEvent,
): ReadonlyArray<LifecycleHookEventName> {
  switch (event.type) {
    case "run.created":
    case "run.updated": {
      switch (event.payload.status) {
        case "preparing":
        case "starting":
        case "running":
          return ["UserPromptSubmit"];
        case "completed":
          return ["Stop"];
        case "failed":
          return ["RunError"];
        case "interrupted":
        case "cancelled":
        case "rolled_back":
          return ["Interrupt"];
        default:
          return [];
      }
    }
    case "turn-item.updated": {
      switch (event.payload.type) {
        case "command_execution":
        case "file_change":
        case "file_search":
        case "web_search":
        case "dynamic_tool": {
          if (
            event.payload.status === "pending" ||
            event.payload.status === "running" ||
            event.payload.status === "waiting"
          ) {
            return ["PreToolUse"];
          }
          if (
            event.payload.status === "completed" ||
            event.payload.status === "failed" ||
            event.payload.status === "cancelled" ||
            event.payload.status === "interrupted"
          ) {
            return ["PostToolUse"];
          }
          return [];
        }
        case "error":
          return ["RunError"];
        case "approval_request":
          return ["PermissionRequest"];
        case "user_input_request":
          return ["Notification"];
        default:
          return [];
      }
    }
    case "runtime-request.updated": {
      if (event.payload.kind === "auth_refresh") return [];
      if (event.payload.status === "pending") {
        return event.payload.kind === "user_input" ? ["Notification"] : ["PermissionRequest"];
      }
      if (
        event.payload.status === "resolved" ||
        event.payload.status === "cancelled" ||
        event.payload.status === "expired"
      ) {
        return ["PostToolUse"];
      }
      return [];
    }
    case "thread.archived":
    case "thread.deleted":
      return ["SessionEnd"];
    default:
      return [];
  }
}

/** Spawns a configured command hook non-blocking, writes JSON to stdin, and swallows any failure. */
export const spawnHookCommand: HookCommandRunner = (invocation) =>
  Effect.promise(
    () =>
      new Promise<{
        readonly outcome: "ok" | "nonzero" | "timeout" | "error";
        readonly detail?: string;
      }>((resolve) => {
        const isWin = process.platform === "win32";
        const shellCmd = isWin ? "cmd.exe" : "/bin/sh";
        const shellArgs = isWin
          ? ["/d", "/s", "/c", invocation.command]
          : ["-c", invocation.command];
        const safeCwd = resolveSpawnCwd(invocation.cwd);

        let child: ChildProcess.ChildProcess;
        try {
          child = ChildProcess.spawn(shellCmd, shellArgs, {
            stdio: ["pipe", "ignore", "pipe"],
            cwd: safeCwd,
            env: {
              ...process.env,
              PHOENIX_HOOK_EVENT: invocation.eventName,
              PHOENIX_THREAD_ID: invocation.threadId,
            },
          });
        } catch (err) {
          resolve({ outcome: "error", detail: err instanceof Error ? err.message : String(err) });
          return;
        }

        let settled = false;
        let timedOut = false;
        let stderrText = "";
        let killTimer: ReturnType<typeof setTimeout> | undefined;

        const finish = (result: {
          readonly outcome: "ok" | "nonzero" | "timeout" | "error";
          readonly detail?: string;
        }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          if (killTimer !== undefined) clearTimeout(killTimer);
          resolve(result);
        };

        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          try {
            child.kill("SIGTERM");
          } catch {
            // Ignore errors killing already-exited child.
          }
          killTimer = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              // Ignore SIGKILL failure.
            }
            finish({ outcome: "timeout", detail: `timed out after ${invocation.timeoutMs}ms` });
          }, HARD_KILL_GRACE_MS);
        }, invocation.timeoutMs);

        child.stderr?.on("data", (chunk: Buffer | string) => {
          if (stderrText.length < 512) {
            stderrText += String(chunk).slice(0, 512 - stderrText.length);
          }
        });

        child.stdin?.on("error", () => {
          // Ignore EPIPE when a hook closes stdin without reading it.
        });

        child.once("error", (err) => {
          finish({ outcome: "error", detail: err.message });
        });

        child.once("close", (code, signal) => {
          if (timedOut) {
            finish({ outcome: "timeout", detail: `timed out after ${invocation.timeoutMs}ms` });
            return;
          }
          if (code === 0) {
            finish({ outcome: "ok" });
            return;
          }
          const reason = signal ? `signal ${signal}` : `exit ${String(code)}`;
          const stderrSuffix = stderrText.trim() ? `: ${stderrText.trim()}` : "";
          finish({ outcome: "nonzero", detail: `${reason}${stderrSuffix}` });
        });

        try {
          child.stdin?.end(`${JSON.stringify(invocation.payload)}\n`);
        } catch {
          // Handled cleanly by close/error handlers.
        }
      }),
  ).pipe(
    Effect.flatMap((result) => {
      if (result.outcome === "ok") return Effect.void;
      return Effect.logDebug("lifecycle hook command finished non-zero", {
        eventName: invocation.eventName,
        threadId: invocation.threadId,
        outcome: result.outcome,
        detail: result.detail,
      });
    }),
    Effect.catchCause((cause) =>
      Effect.logWarning("unexpected failure running lifecycle hook", {
        eventName: invocation.eventName,
        threadId: invocation.threadId,
        cause,
      }),
    ),
  );

export function makeWithRunner(
  runCommand: HookCommandRunner = spawnHookCommand,
  options: { readonly statTtlMs?: number } = {},
) {
  return Effect.gen(function* () {
    const serverConfig = yield* ServerConfig.ServerConfig;
    const engine = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const projectStore = yield* ProjectStore.ProjectStoreV2;

    const loader = makeLifecycleHooksConfigLoader(serverConfig.hooksConfigPath, {
      statTtlMs: options.statTtlMs,
    });

    const startedRuns = new Set<string>();
    const toolItemPhase = new Map<string, "pre" | "post">();
    const pendingRequests = new Set<string>();
    const requestPrompts = new Map<
      string,
      { readonly prompt?: string | undefined; readonly toolName?: string | undefined }
    >();
    const emittedErrorItems = new Set<string>();

    const classifyDomainEvent = (
      event: OrchestrationV2DomainEvent,
    ): PendingHookCandidate | null => {
      switch (event.type) {
        case "run.created":
        case "run.updated": {
          const run = event.payload;
          switch (run.status) {
            case "preparing":
            case "starting":
            case "running": {
              if (startedRuns.has(run.id)) return null;
              startedRuns.add(run.id);
              trimSet(startedRuns);
              return {
                eventName: "UserPromptSubmit",
                runId: run.id,
                runStatus: run.status,
                activity: "Working",
                startedAtMs: DateTime.toEpochMillis(run.startedAt ?? run.requestedAt),
              };
            }
            case "completed":
              startedRuns.delete(run.id);
              return {
                eventName: "Stop",
                runId: run.id,
                runStatus: "completed",
                activity: "Done",
              };
            case "failed":
              startedRuns.delete(run.id);
              return {
                eventName: "RunError",
                runId: run.id,
                runStatus: "failed",
                message: "Run failed",
              };
            case "interrupted":
            case "cancelled":
            case "rolled_back":
              startedRuns.delete(run.id);
              return {
                eventName: "Interrupt",
                runId: run.id,
                runStatus: run.status,
                activity: run.status,
              };
            default:
              return null;
          }
        }
        case "turn-item.updated": {
          const item = event.payload;
          if (item.type === "approval_request") {
            const prompt = (item.prompt ?? item.reason)?.trim();
            const toolName = (item.appName ?? item.requestKind)?.trim();
            requestPrompts.set(item.requestId, { prompt, toolName });
            trimMap(requestPrompts);
            return null;
          }
          if (item.type === "user_input_request") {
            const q = item.questions[0];
            const prompt = (q?.question ?? q?.header)?.trim();
            if (prompt) {
              requestPrompts.set(item.requestId, { prompt });
              trimMap(requestPrompts);
            }
            return null;
          }
          if (item.type === "error") {
            if (emittedErrorItems.has(item.id)) return null;
            emittedErrorItems.add(item.id);
            trimSet(emittedErrorItems);
            return {
              eventName: "RunError",
              runId: item.runId ?? undefined,
              errorClass: item.failure.class,
              message: item.failure.message || "Run failed",
            };
          }

          const tool = toolMetadataFromTurnItem(item);
          if (tool === null) return null;

          const currentPhase = toolItemPhase.get(item.id);
          if (item.status === "pending" || item.status === "running" || item.status === "waiting") {
            if (currentPhase === "pre" || currentPhase === "post") return null;
            toolItemPhase.set(item.id, "pre");
            trimMap(toolItemPhase);
            return {
              eventName: "PreToolUse",
              matchTarget: tool.toolName,
              runId: item.runId ?? undefined,
              tool_name: tool.toolName,
              tool_input: tool.toolInput,
            };
          }
          if (
            item.status === "completed" ||
            item.status === "failed" ||
            item.status === "cancelled" ||
            item.status === "interrupted"
          ) {
            if (currentPhase === "post") return null;
            toolItemPhase.set(item.id, "post");
            trimMap(toolItemPhase);
            return {
              eventName: "PostToolUse",
              matchTarget: tool.toolName,
              runId: item.runId ?? undefined,
              tool_name: tool.toolName,
              tool_input: tool.toolInput,
              tool_status: item.status,
            };
          }
          return null;
        }
        case "runtime-request.updated": {
          const req = event.payload;
          if (req.kind === "auth_refresh") return null;

          if (req.status === "pending") {
            if (pendingRequests.has(req.id)) return null;
            pendingRequests.add(req.id);
            trimSet(pendingRequests);
            const hint = requestPrompts.get(req.id);
            if (req.kind === "user_input") {
              return {
                eventName: "Notification",
                matchTarget: "user_input",
                runId: event.runId,
                notification_type: "user_input",
                requestKind: "user_input",
                requestId: req.id,
                message: hint?.prompt || "Input needed",
              };
            }
            const toolName = hint?.toolName || req.kind;
            return {
              eventName: "PermissionRequest",
              matchTarget: toolName,
              runId: event.runId,
              requestKind: req.kind,
              requestId: req.id,
              tool_name: toolName,
              message: hint?.prompt || "Approval required",
            };
          }

          if (req.status === "resolved" || req.status === "cancelled" || req.status === "expired") {
            if (!pendingRequests.delete(req.id)) return null;
            const hint = requestPrompts.get(req.id);
            requestPrompts.delete(req.id);
            return {
              eventName: "PostToolUse",
              matchTarget: hint?.toolName || req.kind,
              runId: event.runId,
              requestKind: req.kind,
              requestId: req.id,
              requestStatus: req.status,
              activity: "Working",
            };
          }
          return null;
        }
        case "thread.archived":
        case "thread.deleted":
          return {
            eventName: "SessionEnd",
          };
        default:
          return null;
      }
    };

    const handle: LifecycleHooksReactor["Service"]["handle"] = Effect.fnUntraced(
      function* (event) {
        const fastCandidates = candidateEventsForFastPath(event);
        if (fastCandidates.length === 0) return;

        const { config, parseWarning } = loader.load();
        if (parseWarning !== undefined) {
          yield* Effect.logWarning("failed to parse lifecycle hooks config", {
            path: serverConfig.hooksConfigPath,
            warning: parseWarning,
          });
        }

        const hasRegisteredHook = fastCandidates.some(
          (candidateName) => (config[candidateName]?.length ?? 0) > 0,
        );
        if (!hasRegisteredHook) return;

        const candidate = classifyDomainEvent(event);
        if (candidate === null) return;

        const matches = matchHooksForEvent(config, candidate.eventName, candidate.matchTarget);
        if (matches.length === 0) return;

        const threadOpt = yield* projections.getThread(event.threadId).pipe(
          Effect.map(Option.some),
          Effect.catch((cause) =>
            Effect.logDebug("skipping lifecycle hook for missing thread", {
              threadId: event.threadId,
              cause,
            }).pipe(Effect.as(Option.none())),
          ),
        );
        if (Option.isNone(threadOpt)) return;

        const thread = threadOpt.value;
        if (!isListedThreadLineage(thread.lineage)) return;

        const projectOpt = yield* projectStore.get(thread.projectId).pipe(
          Effect.catchCause(() => Effect.succeed(Option.none())),
        );
        const projectRow = Option.isSome(projectOpt) ? projectOpt.value : null;
        const cwd = thread.worktreePath ?? projectRow?.workspaceRoot ?? undefined;
        const project = deriveProjectName(projectRow?.title, cwd);

        const driver =
          event.type === "run.created" || event.type === "run.updated"
            ? event.payload.providerInstanceId
            : thread.modelSelection.instanceId;

        const payload: LifecycleHookPayload = {
          hook_event_name: candidate.eventName,
          event: candidate.eventName,
          session_id: thread.id,
          threadId: thread.id,
          ...(candidate.runId !== undefined ? { runId: candidate.runId } : {}),
          project,
          ...(cwd !== undefined ? { cwd } : {}),
          title: thread.title,
          driver,
          model: thread.modelSelection.model,
          timestamp: DateTime.formatIso(event.occurredAt),
          ...(candidate.startedAtMs !== undefined ? { startedAtMs: candidate.startedAtMs } : {}),
          ...(candidate.runStatus !== undefined ? { runStatus: candidate.runStatus } : {}),
          ...(candidate.tool_name !== undefined ? { tool_name: candidate.tool_name } : {}),
          ...(candidate.tool_input !== undefined ? { tool_input: candidate.tool_input } : {}),
          ...(candidate.tool_status !== undefined ? { tool_status: candidate.tool_status } : {}),
          ...(candidate.requestKind !== undefined ? { requestKind: candidate.requestKind } : {}),
          ...(candidate.requestId !== undefined ? { requestId: candidate.requestId } : {}),
          ...(candidate.requestStatus !== undefined
            ? { requestStatus: candidate.requestStatus }
            : {}),
          ...(candidate.notification_type !== undefined
            ? { notification_type: candidate.notification_type }
            : {}),
          ...(candidate.errorClass !== undefined ? { errorClass: candidate.errorClass } : {}),
          ...(candidate.activity !== undefined ? { activity: candidate.activity } : {}),
          ...(candidate.message !== undefined ? { message: candidate.message } : {}),
        };

        yield* Effect.forEach(
          matches,
          (hook) =>
            runCommand({
              eventName: candidate.eventName,
              threadId: thread.id,
              command: hook.command,
              timeoutMs: hook.timeoutMs,
              cwd,
              payload,
            }),
          { concurrency: "unbounded", discard: true },
        );
      },
      (effect, event) =>
        effect.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("lifecycle hook dispatch failed", {
              threadId: event.threadId,
              eventType: event.type,
              cause,
            }),
          ),
        ),
    );

    const start: LifecycleHooksReactor["Service"]["start"] = Effect.fn(
      "LifecycleHooksReactor.start",
    )(function* () {
      const threadLocks = yield* KeyedLock.makeRunner<ThreadId>();
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          threadLocks.run(event.threadId, handle(event)),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("lifecycle hooks event stream failed", { cause }),
          ),
        ),
      );
    });

    return { start, handle } satisfies LifecycleHooksReactor["Service"];
  });
}

export const layer = Layer.effect(LifecycleHooksReactor, makeWithRunner(spawnHookCommand));

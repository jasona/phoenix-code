import {
  OrchestrationV2ProjectedTurnItem,
  CommandId,
  MessageId,
  ThreadId,
  PluginError,
  type PluginHostInput,
  type PluginCapability,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as Schema from "effect/Schema";
import * as Path from "effect/Path";
import { isProviderSignOutPrompt } from "../orchestration-v2/CommandPolicy.ts";
import * as PluginModelContext from "./PluginModelContext.ts";
import * as MissionControl from "./MissionControl.ts";
import * as Plugins from "./Plugins.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

export class PluginHost extends Context.Service<
  PluginHost,
  {
    readonly watch: (input: {
      pluginId: string;
      instanceId: string;
    }) => Stream.Stream<unknown, PluginError>;
    readonly request: (input: PluginHostInput) => Effect.Effect<unknown, PluginError>;
  }
>()("t3/plugins/PluginHost") {}

const encodeItems = Schema.encodeEffect(
  Schema.toCodecJson(Schema.Array(OrchestrationV2ProjectedTurnItem)),
);
const isPluginError = Schema.is(PluginError);

const make = Effect.gen(function* () {
  const missionControl = yield* MissionControl.MissionControl;
  const modelContext = yield* PluginModelContext.PluginModelContext;
  const plugins = yield* Plugins.Plugins;
  const engine = yield* Orchestrator.OrchestratorV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const request = Effect.fn("PluginHost.request")(function* (input: PluginHostInput) {
    const operation = input.operation;
    const capability: PluginCapability = operation.type === "openFile" ? "files" : operation.type;
    return yield* plugins
      .withView(
        input,
        capability,
        Effect.fn("PluginHost.perform")(function* (scope) {
          if (operation.type === "missionControl")
            return yield* missionControl.request(operation.request);
          if (!scope.projectId) {
            if (operation.type === "context" && input.pluginId === "mission-control")
              return { scope: "environment" };
            return yield* new PluginError({ reason: "stale-view" });
          }
          const project = Option.getOrUndefined(yield* projects.get(scope.projectId));
          if (!project) return yield* new PluginError({ reason: "stale-view" });
          const thread = scope.threadId
            ? (yield* threads.getThreadRecords(scope.threadId, [])).thread
            : undefined;
          if (thread && (thread.projectId !== scope.projectId || thread.deletedAt !== null))
            return yield* new PluginError({ reason: "stale-view" });
          const workspaceRoot = thread?.worktreePath ?? project.workspaceRoot;
          switch (operation.type) {
            case "context":
              return {
                projectId: scope.projectId,
                projectTitle: project.title,
                workspaceRoot,
                ...(thread
                  ? {
                      threadId: thread.id,
                      threadTitle: thread.title,
                      branch: thread.branch,
                      runStatus: (yield* threads.getThreadShell(thread.id))?.status ?? null,
                    }
                  : {}),
              };
            case "transcript": {
              if (!thread) return yield* new PluginError({ reason: "stale-view" });
              const cursor = operation.cursor === undefined ? undefined : Number(operation.cursor);
              if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0))
                return yield* new PluginError({ reason: "request-failed" });
              const page = yield* threads.getTimelinePage(thread.id, {
                view: "messages",
                limit: 20,
                ...(cursor === undefined ? {} : { beforePosition: cursor }),
              });
              const items = yield* encodeItems(page.items);
              return {
                ...page,
                items: (Array.isArray(items) ? items : []).map((item, index) =>
                  new TextEncoder().encode(JSON.stringify(item)).length > 32_768
                    ? { id: page.items[index]?.sourceItemId, truncated: true }
                    : item,
                ),
              };
            }
            case "files":
            case "openFile": {
              const root = yield* fs.realPath(workspaceRoot);
              const target = yield* fs.realPath(path.resolve(root, operation.path));
              const relative = path.relative(root, target);
              if (
                relative === ".." ||
                relative.startsWith(`..${path.sep}`) ||
                path.isAbsolute(relative)
              )
                return yield* new PluginError({ reason: "permission-denied" });
              if (operation.type === "openFile") return { path: target, relativePath: relative };
              return yield* Effect.gen(function* () {
                const file = yield* fs.open(target, { flag: "r" });
                const offset = operation.offset ?? 0;
                yield* file.seek(BigInt(offset), "start");
                const bytes = yield* file.readAlloc(32_768);
                const buffer = Option.getOrElse(bytes, () => new Uint8Array());
                return {
                  path: relative,
                  text: new TextDecoder().decode(buffer),
                  nextOffset: buffer.length === 32_768 ? offset + buffer.length : null,
                };
              }).pipe(Effect.scoped);
            }
            case "attach": {
              if (!thread) return yield* new PluginError({ reason: "stale-view" });
              return { threadId: thread.id, text: operation.text };
            }
            case "message": {
              if (isProviderSignOutPrompt({ text: operation.text, attachments: [] }))
                return yield* new PluginError({ reason: "permission-denied" });
              if (!thread) return yield* new PluginError({ reason: "stale-view" });
              const sent = yield* threads.sendToThread({
                projectId: scope.projectId,
                threadId: thread.id,
                commandId: CommandId.make(yield* randomUuidV4),
                messageId: MessageId.make(yield* randomUuidV4),
                text: operation.text,
                attachments: [],
                mode: "queue",
                createdBy: "user",
                creationSource: "web",
              });
              return { threadId: thread.id, messageId: sent.message.id };
            }
            case "createThread": {
              const modelSelection =
                operation.modelSelection ?? thread?.modelSelection ?? project.defaultModelSelection;
              if (!modelSelection) return yield* new PluginError({ reason: "request-failed" });
              const threadId = ThreadId.make(yield* randomUuidV4);
              yield* threads.dispatch({
                type: "thread.create",
                commandId: CommandId.make(yield* randomUuidV4),
                threadId,
                projectId: scope.projectId,
                title: operation.title,
                modelSelection,
                runtimeMode: "approval-required",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                createdBy: "user",
                creationSource: "web",
              });
              return { threadId };
            }
            case "modelContext": {
              if (!thread || new TextEncoder().encode(operation.text).length > 16_384)
                return yield* new PluginError({ reason: "request-failed" });
              modelContext.set(input.instanceId, input.pluginId, thread.id, operation.text);
              return null;
            }
          }
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          isPluginError(cause) ? cause : new PluginError({ reason: "request-failed", cause }),
        ),
      );
  });
  const watch = (input: { pluginId: string; instanceId: string }) =>
    Stream.unwrap(
      plugins.withView(input, undefined, (scope) =>
        Effect.succeed(
          Stream.merge(
            engine.streamDomainEvents.pipe(
              Stream.filter(
                (event) =>
                  scope.threadId !== undefined &&
                  event.threadId === scope.threadId &&
                  (event.type === "run.updated" || event.type === "thread.metadata-updated"),
              ),
              Stream.map(() => undefined),
            ),
            plugins.changes.pipe(
              Stream.filter((id) => id === input.pluginId),
              Stream.map(() => undefined),
            ),
          ).pipe(
            (stream) => Stream.concat(Stream.succeed(undefined), stream),
            Stream.mapEffect(() =>
              plugins
                .withView(input, undefined, () => Effect.void)
                .pipe(
                  Effect.andThen(
                    request({ ...input, operation: { type: "context" } }).pipe(
                      Effect.catchTags({
                        PluginError: (error) =>
                          error.reason === "permission-denied"
                            ? Effect.succeed({})
                            : Effect.fail(error),
                      }),
                    ),
                  ),
                ),
            ),
            Stream.mapError((cause) =>
              isPluginError(cause) ? cause : new PluginError({ reason: "request-failed", cause }),
            ),
            Stream.ensuring(Effect.sync(() => modelContext.release(input.instanceId))),
          ),
        ),
      ),
    );
  return PluginHost.of({ request, watch });
});
export const layer = Layer.effect(PluginHost, make).pipe(Layer.provide(PluginModelContext.layer));

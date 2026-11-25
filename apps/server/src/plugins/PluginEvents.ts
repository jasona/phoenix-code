import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Plugins from "./Plugins.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const plugins = yield* Plugins.Plugins;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threads = yield* ThreadManagement.ThreadManagementService;
    yield* orchestrator.streamDomainEvents.pipe(
      Stream.filter(
        (event) =>
          event.type === "run.updated" &&
          event.payload.status === "completed" &&
          event.payload.completedAt !== null,
      ),
      Stream.runForEach(
        Effect.fn("PluginEvents.deliver")(function* (event) {
          if (event.type !== "run.updated" || event.payload.completedAt === null) return;
          const { thread } = yield* threads.getThreadRecords(event.threadId, []);
          yield* plugins.notify({
            projectId: thread.projectId,
            threadId: thread.id,
            runId: event.payload.id,
            completedAt: DateTime.formatIso(event.payload.completedAt),
          });
        }, Effect.ignore()),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Plugin event subscription stopped", { cause }),
      ),
      Effect.forkScoped,
    );
  }),
);

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, type PluginScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Plugins from "./Plugins.ts";
import * as MissionControl from "./MissionControl.ts";
import * as PluginHost from "./PluginHost.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";

it.live(
  "bounds file reads to the bound workspace, pages content, and refuses conversation actions without a thread",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const workspace = `${directory}/project`;
      yield* fs.makeDirectory(workspace);
      yield* fs.writeFileString(`${workspace}/large.txt`, "x".repeat(40_000));
      yield* fs.writeFileString(`${directory}/outside.txt`, "outside");
      yield* fs.symlink(`${directory}/outside.txt`, `${workspace}/escape.txt`);
      const projectId = ProjectId.make("project");
      const scope: PluginScope = { projectId };
      const project = ProjectStore.ProjectRow.make({
        projectId,
        title: "Project",
        hasCustomTitle: false,
        workspaceRoot: workspace,
        defaultModelSelection: null,
        defaultThreadEnvMode: null,
        autoPull: false,
        faviconPath: null,
        projectIcon: null,
        scripts: [],
        trackedFolders: [],
        pinnedAt: null,
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      });
      yield* Effect.gen(function* () {
        const host = yield* PluginHost.PluginHost;
        const input = { pluginId: "test", instanceId: "view" };
        const first = yield* host.request({
          ...input,
          operation: { type: "files", path: "large.txt" },
        });
        assert.deepStrictEqual(first, {
          path: "large.txt",
          text: "x".repeat(32_768),
          nextOffset: 32_768,
        });
        assert.deepStrictEqual(
          yield* host.request({
            ...input,
            operation: { type: "files", path: "large.txt", offset: 32_768 },
          }),
          { path: "large.txt", text: "x".repeat(7_232), nextOffset: null },
        );
        for (const path of ["../outside.txt", "escape.txt"]) {
          assert.strictEqual(
            (yield* host.request({ ...input, operation: { type: "files", path } }).pipe(
              Effect.match({
                onFailure: (error) => error,
                onSuccess: () => {
                  throw new Error("Expected refusal");
                },
              }),
            )).reason,
            "permission-denied",
          );
        }
        assert.strictEqual(
          (yield* host.request({ ...input, operation: { type: "attach", text: "task" } }).pipe(
            Effect.match({
              onFailure: (error) => error,
              onSuccess: () => {
                throw new Error("Expected refusal");
              },
            }),
          )).reason,
          "stale-view",
        );
      }).pipe(
        Effect.provide(
          PluginHost.layer.pipe(
            Layer.provide(Layer.mock(MissionControl.MissionControl)({})),
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(Plugins.Plugins)({
                  withView: (_input, _capability, use) => use(scope),
                  changes: Stream.never,
                }),
                Layer.mock(ProjectStore.ProjectStoreV2)({ get: () => Effect.succeedSome(project) }),
                Layer.mock(Threads.ThreadManagementService)({}),
                Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.never }),
              ),
            ),
          ),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

import * as NodeServices from "@effect/platform-node/NodeServices";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- This test runs the standalone plugin build CLI and checks its exit status.
import * as NodeChildProcess from "node:child_process";
import { it, assert } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ServerConfig } from "../config.ts";
import * as Plugins from "./Plugins.ts";
import { bundledMissionControl } from "./BundledPlugins.ts";

const decodeView = Schema.decodeUnknownSync(
  Schema.Struct({ instanceId: Schema.String, html: Schema.String }),
);
const configuration = ServerConfig.layerTest(process.cwd(), { prefix: "phoenix-bundled-" });

it.live(
  "bundles a working environment view, persists disabling, and refuses local replacement",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig;
      const live = Plugins.layer.pipe(Layer.provide(Layer.succeed(ServerConfig, config)));
      const target = yield* Effect.gen(function* () {
        const plugins = yield* Plugins.Plugins;
        const entries = yield* plugins.list();
        assert.strictEqual(entries[0]?.manifest.id, "mission-control");
        assert.strictEqual(entries[0]?.enabled, true);
        assert.strictEqual(entries[0]?.bundled, true);
        const opened = decodeView(
          yield* plugins.request({
            action: "open",
            pluginId: "mission-control",
            viewId: "dashboard",
          }),
        );
        assert.include(opened.html, "Mission Control");
        assert.include(opened.html, "phoenix/request");
        assert.notInclude(opened.html, 'src="http');
        const target = { pluginId: "mission-control", instanceId: opened.instanceId };
        assert.deepStrictEqual(
          yield* plugins.withView(target, "missionControl", Effect.succeed),
          {},
        );
        assert.strictEqual(
          (yield* plugins.withView(target, "files", Effect.succeed).pipe(Effect.flip)).reason,
          "permission-denied",
        );
        const directory = yield* fs.makeTempDirectoryScoped();
        yield* fs.writeFileString(
          `${directory}/phoenix.plugin.json`,
          JSON.stringify(bundledMissionControl.manifest),
        );
        assert.strictEqual(
          (yield* plugins.install({ directory }).pipe(Effect.flip)).reason,
          "permission-denied",
        );
        yield* plugins.request({ action: "enable", pluginId: "mission-control", enabled: false });
        assert.strictEqual(
          (yield* plugins.withView(target, "missionControl", Effect.succeed).pipe(Effect.flip))
            .reason,
          "disabled",
        );
        return target;
      }).pipe(Effect.provide(Layer.fresh(live)), Effect.scoped);
      yield* Effect.gen(function* () {
        const plugins = yield* Plugins.Plugins;
        assert.strictEqual((yield* plugins.list())[0]?.enabled, false);
        yield* plugins.request({ action: "enable", pluginId: "mission-control", enabled: true });
        assert.strictEqual(
          (yield* plugins.withView(target, "missionControl", Effect.succeed).pipe(Effect.flip))
            .reason,
          "stale-view",
        );
        yield* plugins.request({ action: "remove", pluginId: "mission-control" });
        assert.strictEqual((yield* plugins.list())[0]?.enabled, false);
        assert.strictEqual((yield* plugins.list())[0]?.bundled, true);
      }).pipe(
        Effect.provide(Plugins.layer.pipe(Layer.provide(Layer.succeed(ServerConfig, config)))),
        Effect.scoped,
      );
    }).pipe(
      Effect.provide(configuration.pipe(Layer.provideMerge(NodeServices.layer))),
      Effect.scoped,
    ),
);

it("keeps the embedded document synchronized with its plugin sources", () => {
  NodeChildProcess.execFileSync(process.execPath, [
    new URL("../../../../plugins/mission-control/build-client.mjs", import.meta.url).pathname,
    "--check",
  ]);
});

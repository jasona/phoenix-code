import { it, assert } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { ServerConfig } from "../config.ts";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import * as PluginSidecars from "./PluginSidecars.ts";
import * as Plugins from "./Plugins.ts";

const decodeInstance = Schema.decodeUnknownSync(Schema.Struct({ instanceId: Schema.String }));

const result = Schema.decodeUnknownSync(
  Schema.Struct({
    structuredContent: Schema.Struct({
      processId: Schema.Number,
      tasks: Schema.Array(Schema.Struct({ title: Schema.String })),
    }),
  }),
);
const isJson = Schema.is(Schema.Json);
const isView = Schema.is(Schema.Struct({ html: Schema.String }));
const pluginDirectory = new URL("../../../../examples/plugins/project-board", import.meta.url)
  .pathname;

it.live(
  "shares a process, persists plugin data, and rejects calls after disable or uninstall",
  () =>
    Effect.gen(function* () {
      const plugins = yield* Plugins.Plugins;
      const entry = yield* plugins.install({ directory: pluginDirectory });
      assert.strictEqual(entry.enabled, false);
      assert.strictEqual(
        (yield* plugins
          .request({ action: "open", pluginId: "project-board", viewId: "board" })
          .pipe(Effect.asVoid, Effect.flip)).reason,
        "disabled",
      );
      yield* plugins.request({ action: "enable", pluginId: "project-board", enabled: true });
      const [first, second] = yield* Effect.all(
        [
          plugins.request({
            action: "call",
            pluginId: "project-board",
            name: "board",
            arguments: {},
          }),
          plugins.request({
            action: "call",
            pluginId: "project-board",
            name: "board",
            arguments: {},
          }),
        ],
        { concurrency: "unbounded" },
      );
      assert.strictEqual(
        result(first).structuredContent.processId,
        result(second).structuredContent.processId,
      );
      const opened = yield* plugins.request({
        action: "open",
        pluginId: "project-board",
        viewId: "board",
      });
      assert.isTrue(isView(opened));
      assert.isTrue(isJson(opened));
      assert.isTrue(isJson(first));
      yield* plugins.request({
        action: "call",
        pluginId: "project-board",
        name: "add_task",
        arguments: { title: "Persistent task" },
      });
      yield* plugins.request({ action: "enable", pluginId: "project-board", enabled: false });
      assert.strictEqual(
        (yield* plugins
          .request({ action: "call", pluginId: "project-board", name: "board", arguments: {} })
          .pipe(Effect.asVoid, Effect.flip)).reason,
        "disabled",
      );
      yield* plugins.request({ action: "enable", pluginId: "project-board", enabled: true });
      const restarted = result(
        yield* plugins.request({
          action: "call",
          pluginId: "project-board",
          name: "board",
          arguments: {},
        }),
      );
      assert.notStrictEqual(
        restarted.structuredContent.processId,
        result(first).structuredContent.processId,
      );
      assert.strictEqual(restarted.structuredContent.tasks[0]?.title, "Persistent task");
      const projectId = ProjectId.make("project-one");
      const scope = { projectId, threadId: ThreadId.make("thread-one") };
      yield* plugins.request({
        action: "grant",
        pluginId: "project-board",
        grants: { capabilities: ["context", "attach"], projectIds: [projectId] },
      });
      const view = decodeInstance(
        yield* plugins.request({
          action: "open",
          pluginId: "project-board",
          viewId: "board",
          scope,
        }),
      );
      const target = { pluginId: "project-board", instanceId: view.instanceId };
      assert.deepStrictEqual(yield* plugins.withView(target, "attach", Effect.succeed), scope);
      const otherView = decodeInstance(
        yield* plugins.request({
          action: "open",
          pluginId: "project-board",
          viewId: "board",
          scope: {
            projectId: ProjectId.make("project-two"),
            threadId: ThreadId.make("thread-two"),
          },
        }),
      );
      assert.strictEqual(
        (yield* plugins
          .withView({ ...target, instanceId: otherView.instanceId }, "attach", Effect.succeed)
          .pipe(Effect.flip)).reason,
        "permission-denied",
      );
      assert.deepStrictEqual(yield* plugins.withView(target, "attach", Effect.succeed), scope);
      yield* plugins.request({
        action: "grant",
        pluginId: "project-board",
        grants: { capabilities: [], projectIds: [] },
      });
      assert.strictEqual(
        (yield* plugins.withView(target, "attach", Effect.succeed).pipe(Effect.flip)).reason,
        "stale-view",
      );
      yield* plugins.request({ action: "remove", pluginId: "project-board" });
      assert.deepStrictEqual(yield* plugins.list(), []);
      assert.strictEqual(
        (yield* plugins
          .request({
            action: "resource",
            pluginId: "project-board",
            uri: "ui://project-board/board",
          })
          .pipe(Effect.asVoid, Effect.flip)).reason,
        "not-found",
      );
    }).pipe(
      Effect.provide(
        Plugins.layer.pipe(
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "phoenix-plugins-" }).pipe(
              Layer.provideMerge(NodeServices.layer),
            ),
          ),
        ),
      ),
      Effect.scoped,
    ),
);

it.live("rejects malformed manifests without registering executable code", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(
      `${directory}/phoenix.plugin.json`,
      '{"apiVersion":1,"id":"../escape"}',
    );
    const plugins = yield* Plugins.Plugins;
    const error = yield* plugins.install({ directory }).pipe(Effect.asVoid, Effect.flip);
    assert.strictEqual(error.reason, "invalid-manifest");
    assert.deepStrictEqual(yield* plugins.list(), []);
  }).pipe(
    Effect.provide(
      Plugins.layer.pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "phoenix-plugins-invalid-" }).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      ),
    ),
    Effect.scoped,
  ),
);

it.live("delivers only granted background completions to an enabled sidecar without a view", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(
      `${directory}/phoenix.plugin.json`,
      JSON.stringify({
        apiVersion: 1,
        id: "events",
        name: "Events",
        version: "1",
        capabilities: ["context"],
        server: { command: "node", args: [] },
        sidecar: { command: "node", args: ["sidecar.mjs"], restart: "never" },
        views: [],
      }),
    );
    yield* fs.writeFileString(
      `${directory}/sidecar.mjs`,
      'process.stdin.once("data", (data) => { process.stdout.write(data); process.stdin.destroy(); });',
    );
    const plugins = yield* Plugins.Plugins;
    const sidecars = yield* PluginSidecars.PluginSidecars;
    const changes = yield* Stream.toQueue(sidecars.changes, { capacity: 64 });
    yield* plugins.install({ directory });
    const projectId = ProjectId.make("allowed");
    yield* plugins.request({
      action: "grant",
      pluginId: "events",
      grants: { capabilities: ["context"], projectIds: [projectId] },
    });
    yield* plugins.request({ action: "configure", pluginId: "events", scope: { projectId } });
    yield* plugins.request({ action: "enable", pluginId: "events", enabled: true });
    const event = {
      projectId,
      threadId: ThreadId.make("bound"),
      runId: "allowed-run",
      completedAt: "2026-11-25T12:00:00Z",
    };
    yield* plugins.notify({ ...event, projectId: ProjectId.make("other"), runId: "other-run" });
    yield* plugins.notify(event);
    yield* plugins.notify(event);
    while (true) {
      const change = yield* Queue.take(changes);
      if (change.runtime.state === "stopped" && change.runtime.exitCode === 0) break;
    }
    const logs = sidecars.inspect("events").logs;
    assert.include(logs, "allowed-run");
    assert.notInclude(logs, "other-run");
    assert.strictEqual(logs.split("allowed-run").length - 1, 1);
    yield* plugins.request({ action: "configure", pluginId: "events", scope: null });
    assert.isUndefined((yield* plugins.list())[0]?.backgroundScope);
  }).pipe(
    Effect.provide(
      Layer.merge(Plugins.layer, PluginSidecars.layer).pipe(
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "phoenix-plugin-events-" }).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      ),
    ),
    Effect.scoped,
  ),
);

import { PluginManifest, PluginError, PluginId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { pluginHtmlTemplate, pluginServerTemplate } from "./pluginTemplate.ts";

export class PluginAuthoring extends Context.Service<
  PluginAuthoring,
  {
    readonly validate: (directory: string) => Effect.Effect<PluginManifest, PluginError>;
    readonly scaffold: (directory: string, id: string) => Effect.Effect<void, PluginError>;
  }
>()("t3/plugins/PluginAuthoring") {}

const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(PluginManifest));
const decodeId = Schema.decodeEffect(PluginId);
const encodeManifest = Schema.encodeEffect(Schema.fromJsonString(PluginManifest));

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fail = (cause: unknown) => new PluginError({ reason: "invalid-manifest", cause });
  const validate = Effect.fn("PluginAuthoring.validate")(function* (directory: string) {
    const raw = yield* fs.readFileString(path.join(directory, "phoenix.plugin.json"));
    const manifest = yield* decodeManifest(raw);
    if (new Set(manifest.views.map((view) => view.id)).size !== manifest.views.length)
      return yield* new PluginError({ reason: "invalid-manifest" });
    return manifest;
  }, Effect.mapError(fail));
  const scaffold = Effect.fn("PluginAuthoring.scaffold")(function* (directory: string, id: string) {
    yield* decodeId(id);
    if (yield* fs.exists(directory)) return yield* new PluginError({ reason: "invalid-manifest" });
    yield* fs.makeDirectory(directory, { recursive: true });
    const manifest: PluginManifest = {
      apiVersion: 1,
      id,
      name: id,
      version: "0.1.0",
      capabilities: ["context", "attach"],
      server: { command: "node", args: ["server.mjs"] },
      views: [{ id: "board", title: "Board", tool: "board" }],
    };
    yield* fs.writeFileString(
      path.join(directory, "phoenix.plugin.json"),
      yield* encodeManifest(manifest),
    );
    yield* fs.writeFileString(
      path.join(directory, "server.mjs"),
      pluginServerTemplate.replaceAll("project-board", id),
    );
    yield* fs.writeFileString(
      path.join(directory, "board.html"),
      pluginHtmlTemplate.replaceAll("project-board", id),
    );
  }, Effect.mapError(fail));
  return PluginAuthoring.of({ validate, scaffold });
});
export const layer = Layer.effect(PluginAuthoring, make);

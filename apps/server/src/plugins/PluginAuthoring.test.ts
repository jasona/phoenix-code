import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as PluginAuthoring from "./PluginAuthoring.ts";

it.live("scaffolds a valid plugin and refuses to overwrite an existing folder", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = `${yield* fs.makeTempDirectoryScoped()}/my-plugin`;
    const authoring = yield* PluginAuthoring.PluginAuthoring;
    yield* authoring.scaffold(directory, "my-plugin");
    assert.strictEqual((yield* authoring.validate(directory)).id, "my-plugin");
    assert.include(yield* fs.readFileString(`${directory}/server.mjs`), "my-plugin");
    assert.strictEqual(
      (yield* authoring.scaffold(directory, "other").pipe(Effect.flip)).reason,
      "invalid-manifest",
    );
    assert.strictEqual((yield* authoring.validate(directory)).id, "my-plugin");
  }).pipe(
    Effect.provide(PluginAuthoring.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
  ),
);

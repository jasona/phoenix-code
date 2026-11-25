import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";
import { PluginManifest, PluginRequestInput, PluginHostInput } from "@t3tools/contracts";
import * as PluginAuthoring from "../plugins/PluginAuthoring.ts";
import { withThreadTools, reportThreadErrors } from "./thread.ts";

const decodeRequest = Schema.decodeEffect(Schema.fromJsonString(PluginRequestInput));
const decodeHost = Schema.decodeEffect(Schema.fromJsonString(PluginHostInput));
const encodeResult = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const Response = Schema.Struct({ result: Schema.Unknown });
const directory = Argument.String("directory");
const init = Command.make("init", { directory, id: Argument.String("id") }).pipe(
  Command.withHandler(
    Effect.fn("plugin.init")(function* (input) {
      yield* (yield* PluginAuthoring.PluginAuthoring).scaffold(input.directory, input.id);
      yield* Console.log(`Created ${input.directory}. Install it in Settings → Plugins.`);
    }, Effect.provide(PluginAuthoring.layer)),
  ),
);
const validate = Command.make("validate", { directory }).pipe(
  Command.withHandler(
    Effect.fn("plugin.validate")(function* (input) {
      const manifest = yield* (yield* PluginAuthoring.PluginAuthoring).validate(input.directory);
      yield* Console.log(
        `${manifest.id} ${manifest.version}: valid Phoenix API v${manifest.apiVersion} plugin`,
      );
    }, Effect.provide(PluginAuthoring.layer)),
  ),
);
const schema = Command.make("schema").pipe(
  Command.withHandler(() => {
    const document = Schema.toJsonSchemaDocument(PluginManifest);
    return Console.log(
      JSON.stringify(
        {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          ...document.schema,
          $defs: document.definitions,
        },
        null,
        2,
      ),
    );
  }),
);
const reload = Command.make("reload", {
  id: Argument.String("id"),
  baseDir: Flag.String("base-dir").pipe(Flag.optional),
}).pipe(
  Command.withHandler(
    Effect.fn("plugin.reload")(function* (input) {
      yield* withThreadTools(
        { baseDir: input.baseDir, json: false, clientLabel: "Phoenix plugin developer" },
        (tools) =>
          tools.call(
            "plugin_request",
            { request: { action: "reload", pluginId: input.id } },
            Response,
          ),
      );
      yield* Console.log("Reloaded plugin code and manifest. Reopen its views.");
    }, reportThreadErrors),
  ),
);
const request = Command.make("request", {
  json: Argument.String("json"),
  baseDir: Flag.String("base-dir").pipe(Flag.optional),
}).pipe(
  Command.withHandler(
    Effect.fn("plugin.request")(function* (input) {
      const payload = yield* decodeRequest(input.json);
      const result = yield* withThreadTools({ baseDir: input.baseDir, json: true }, (tools) =>
        tools.call("plugin_request", { request: payload }, Response),
      );
      yield* Console.log(yield* encodeResult(result.result));
    }, reportThreadErrors),
  ),
);
const host = Command.make("host", {
  json: Argument.String("json"),
  baseDir: Flag.String("base-dir").pipe(Flag.optional),
}).pipe(
  Command.withHandler(
    Effect.fn("plugin.host")(function* (input) {
      const payload = yield* decodeHost(input.json);
      const result = yield* withThreadTools({ baseDir: input.baseDir, json: true }, (tools) =>
        tools.call("plugin_host", payload, Response),
      );
      yield* Console.log(yield* encodeResult(result.result));
    }, reportThreadErrors),
  ),
);
const install = Command.make("install", {
  directory,
  baseDir: Flag.String("base-dir").pipe(Flag.optional),
}).pipe(
  Command.withHandler(
    Effect.fn("plugin.install")(function* (input) {
      const result = yield* withThreadTools({ baseDir: input.baseDir, json: true }, (tools) =>
        tools.call("plugin_install", { directory: input.directory }, Schema.Unknown),
      );
      yield* Console.log(yield* encodeResult(result));
    }, reportThreadErrors),
  ),
);
export const pluginCommand = Command.make("plugin").pipe(
  Command.withDescription("Build and reload Phoenix plugins."),
  Command.withSubcommands([init, validate, schema, install, reload, request, host]),
);

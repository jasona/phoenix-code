import { OrchestratorMcpFailure, type PluginError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as PluginHost from "../../../plugins/PluginHost.ts";
import * as Plugins from "../../../plugins/Plugins.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { PluginsToolkit } from "./tools.ts";

const failure = (cause: PluginError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: cause.message });
export const layer = McpToolAccess.toLayer(PluginsToolkit, {
  plugin_host: McpToolAccess.writesEnvironment(
    Effect.fn("PluginsToolkit.host")(function* (input) {
      return {
        result: yield* (yield* PluginHost.PluginHost).request(input).pipe(Effect.mapError(failure)),
      };
    }),
  ),
  plugin_list: McpToolAccess.writesEnvironment(
    Effect.fn("PluginsToolkit.list")(function* (input) {
      const plugins = yield* (yield* Plugins.Plugins).list().pipe(Effect.mapError(failure));
      return {
        plugins: input.pluginId
          ? plugins.filter((entry) => entry.manifest.id === input.pluginId)
          : plugins,
      };
    }),
  ),
  plugin_install: McpToolAccess.writesEnvironment(
    Effect.fn("PluginsToolkit.install")(function* (input) {
      return yield* (yield* Plugins.Plugins).install(input).pipe(Effect.mapError(failure));
    }),
  ),
  plugin_request: McpToolAccess.writesEnvironment(
    Effect.fn("PluginsToolkit.request")(function* (input) {
      return {
        result: yield* (yield* Plugins.Plugins)
          .request(input.request)
          .pipe(Effect.mapError(failure)),
      };
    }),
  ),
});

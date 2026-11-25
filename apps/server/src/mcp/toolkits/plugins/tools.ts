import {
  OrchestratorMcpFailure,
  PluginInstallation,
  PluginInstallInput,
  PluginRequestInput,
  PluginHostInput,
  PluginId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as PluginHost from "../../../plugins/PluginHost.ts";
import * as Plugins from "../../../plugins/Plugins.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    Plugins.Plugins,
    PluginHost.PluginHost,
    ThreadManagement.ThreadManagementService,
    McpInvocationContext.McpInvocationContext,
  ],
};
export const PluginsToolkit = Toolkit.make(
  Tool.make("plugin_host", {
    ...shared,
    description:
      "Perform a granted Phoenix host operation for an opened plugin instance. The instance fixes its project and conversation. Use plugin_request open with a scope first. Native plugin automation requires full access; message starts agent work, attach only prepares text.",
    parameters: PluginHostInput,
    success: Schema.Struct({ result: Schema.Unknown }),
  }),
  Tool.make("plugin_list", {
    ...shared,
    description: "List installed Phoenix plugins, views, grants, and background process status.",
    parameters: Schema.Struct({ pluginId: Schema.optional(PluginId) }),
    success: Schema.Struct({ plugins: Schema.Array(PluginInstallation) }),
  }).annotate(Tool.Readonly, true),
  Tool.make("plugin_install", {
    ...shared,
    description:
      "Register a trusted local Phoenix plugin folder, disabled. Enable it explicitly with plugin_request after installation.",
    parameters: PluginInstallInput,
    success: PluginInstallation,
  }),
  Tool.make("plugin_request", {
    ...shared,
    description:
      "Manage or call a Phoenix plugin. launch opens a view for clients displaying the named thread. restart reloads code without deleting saved data. grant replaces allowed capabilities and projects; permissions must be requested in the manifest. Native execution requires full access.",
    parameters: Schema.Struct({ request: PluginRequestInput }),
    success: Schema.Struct({ result: Schema.Unknown }),
  }),
);

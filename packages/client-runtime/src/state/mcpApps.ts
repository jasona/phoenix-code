import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcSubscriptionAtomFamily, createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createMcpAppEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    pluginsWatch: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "plugins:watch", tag: WS_METHODS.pluginsWatch, idleTtlMs: 0,
    }),
    pluginsSubscribe: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "plugins:subscribe", tag: WS_METHODS.pluginsSubscribe, idleTtlMs: 0,
    }),
    pluginsHost: createEnvironmentRpcCommand(runtime, {
      label: "plugins:host", tag: WS_METHODS.pluginsHost,
    }),
    pluginsListQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "plugins:list",
      tag: WS_METHODS.pluginsList,
    }),
    pluginsList: createEnvironmentRpcCommand(runtime, {
      label: "plugins:list",
      tag: WS_METHODS.pluginsList,
    }),
    pluginsInstall: createEnvironmentRpcCommand(runtime, {
      label: "plugins:install",
      tag: WS_METHODS.pluginsInstall,
    }),
    pluginsRequest: createEnvironmentRpcCommand(runtime, {
      label: "plugins:request",
      tag: WS_METHODS.pluginsRequest,
    }),
    callTool: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-apps:call-tool",
      tag: WS_METHODS.mcpAppsCallTool,
    }),
    toolInfo: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-apps:tool-info",
      tag: WS_METHODS.mcpAppsToolInfo,
    }),
    /** The tool definition an app reads from its host context. */
    toolInfoQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:mcp-apps:tool-info",
      tag: WS_METHODS.mcpAppsToolInfo,
    }),
    readResource: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-apps:read-resource",
      tag: WS_METHODS.mcpAppsReadResource,
    }),
    updateModelContext: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-apps:update-model-context",
      tag: WS_METHODS.mcpAppsUpdateModelContext,
    }),
  };
}

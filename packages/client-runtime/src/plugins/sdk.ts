// @effect-diagnostics globalTimers:off -- This SDK runs inside a plugin document, outside Effect.
import type { PluginHostInput } from "@t3tools/contracts";
import type { McpAppHostContext, McpAppCallToolResult } from "../mcpApps/host.ts";

/** @public Phoenix bridge API v1. The host authenticates the document and enforces grants. */
export function createPhoenixPlugin(options: { name: string; version: string }) {
  let sequence = 0;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const contextListeners = new Set<(context: McpAppHostContext) => void>();
  const resultListeners = new Set<(result: McpAppCallToolResult) => void>();
  let context: McpAppHostContext | undefined;
  const request = (method: string, params: unknown): Promise<unknown> => {
    if (pending.size >= 16) return Promise.reject(new Error("Too many pending plugin requests."));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Phoenix request timed out."));
      }, 35_000);
      pending.set(id, { resolve, reject, timer });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  };
  const updateContext = (next: McpAppHostContext) => {
    context = next;
    document.documentElement.style.colorScheme = next.theme;
    for (const [name, value] of Object.entries(next.styles.variables))
      document.documentElement.style.setProperty(name, value);
    for (const listener of contextListeners) listener(next);
  };
  const receive = (event: MessageEvent) => {
    if (event.source !== window.parent || !event.data || event.data.jsonrpc !== "2.0") return;
    const message = event.data;
    const waiting = pending.get(message.id);
    if (waiting) {
      clearTimeout(waiting.timer);
      pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
    }
    if (message.method === "ui/notifications/host-context-changed") updateContext(message.params);
    if (message.method === "ui/notifications/tool-result")
      for (const listener of resultListeners) listener(message.params);
  };
  window.addEventListener("message", receive);
  return {
    initialize: async () => {
      const result = (await request("ui/initialize", {
        protocolVersion: "2026-01-26",
        appInfo: options,
        appCapabilities: {},
      })) as { hostContext: McpAppHostContext };
      updateContext(result.hostContext);
      window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
      return result.hostContext;
    },
    getContext: () => context,
    onContext: (listener: (context: McpAppHostContext) => void) => {
      contextListeners.add(listener);
      return () => {
        contextListeners.delete(listener);
      };
    },
    onResult: (listener: (result: McpAppCallToolResult) => void) => {
      resultListeners.add(listener);
      return () => {
        resultListeners.delete(listener);
      };
    },
    callTool: (name: string, args: Record<string, unknown> = {}) =>
      request("tools/call", { name, arguments: args }) as Promise<McpAppCallToolResult>,
    readResource: (uri: string) => request("resources/read", { uri }),
    host: (operation: PluginHostInput["operation"]) => request("phoenix/request", operation),
    dispose: () => {
      window.removeEventListener("message", receive);
      for (const waiting of pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error("Plugin closed."));
      }
      pending.clear();
      contextListeners.clear();
      resultListeners.clear();
    },
  };
}

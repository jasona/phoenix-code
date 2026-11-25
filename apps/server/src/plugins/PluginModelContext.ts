import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export class PluginModelContext extends Context.Service<
  PluginModelContext,
  {
    readonly set: (instanceId: string, pluginId: string, threadId: ThreadId, text: string) => void;
    readonly release: (instanceId: string) => void;
    readonly revoke: (pluginId: string) => void;
    readonly forThread: (
      threadId: ThreadId,
    ) => ReadonlyArray<{ itemId: string; server: string; tool: string; text: string }>;
  }
>()("t3/plugins/PluginModelContext") {}

export const layer = Layer.sync(PluginModelContext, () => {
  const entries = new Map<string, { pluginId: string; threadId: ThreadId; text: string }>();
  return PluginModelContext.of({
    set: (id, pluginId, threadId, text) => {
      if (!text.trim()) entries.delete(id);
      else entries.set(id, { pluginId, threadId, text });
    },
    release: (id) => {
      entries.delete(id);
    },
    revoke: (pluginId) => {
      for (const [id, entry] of entries) if (entry.pluginId === pluginId) entries.delete(id);
    },
    forThread: (threadId) =>
      [...entries].flatMap(([id, entry]) =>
        entry.threadId === threadId
          ? [{ itemId: `plugin_${id}`, server: entry.pluginId, tool: "plugin", text: entry.text }]
          : [],
      ),
  });
});

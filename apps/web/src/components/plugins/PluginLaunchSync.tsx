import { useEffect, useRef } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEnvironmentQuery } from "~/state/query";
import { useServerConfigs } from "~/state/entities";
import { mcpAppEnvironment } from "~/state/mcpApps";
import { useRightPanelStore } from "~/rightPanelStore";

export function PluginLaunchSync({ threadRef }: { threadRef: ScopedThreadRef }) {
  const supported =
    useServerConfigs().get(threadRef.environmentId)?.environment.capabilities.pluginHostVersion ===
    1;
  const events = useEnvironmentQuery(
    supported
      ? mcpAppEnvironment.pluginsSubscribe({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
  );
  const handled = useRef<string | null>(null);
  const launch = events.data;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Agent requests arrive from the environment subscription and open a tab in the bound conversation.
  useEffect(() => {
    if (!launch || handled.current === launch.id || launch.scope.threadId !== threadRef.threadId)
      return;
    handled.current = launch.id;
    useRightPanelStore
      .getState()
      .openPlugin(threadRef, launch.pluginId, launch.viewId, launch.title);
  }, [launch, threadRef]);
  return null;
}

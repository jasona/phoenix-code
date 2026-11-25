import { useNavigation } from "@react-navigation/native";
import { useEffect, useRef } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../../state/query";
import { useServerConfigs } from "../../state/entities";
import { mcpAppEnvironment } from "../../state/mcpApps";

export function PluginLaunchSync({ threadRef }: { threadRef: ScopedThreadRef }) {
  const navigation = useNavigation();
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Agent requests arrive over the environment subscription and navigate to the bound plugin view.
  useEffect(() => {
    if (!launch || handled.current === launch.id || launch.scope.threadId !== threadRef.threadId)
      return;
    handled.current = launch.id;
    navigation.navigate("ThreadPlugins", {
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
      launch,
    });
  }, [launch, navigation, threadRef]);
  return null;
}

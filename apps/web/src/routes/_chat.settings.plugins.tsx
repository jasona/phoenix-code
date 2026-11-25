import { createFileRoute } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { PluginPanel } from "../components/plugins/PluginPanel";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";

function PluginsSettings() {
  const { connectedEnvironments } = useSettingsScope();
  const gt = useGT();
  return (
    <div className="space-y-6">
      {connectedEnvironments.length === 0 ? (
        <p>{gt("Connect to an environment to manage plugins.")}</p>
      ) : null}
      {connectedEnvironments.map((environment) => (
        <section key={environment.environmentId}>
          <h2 className="px-5 text-sm font-medium">{environment.label}</h2>
          <PluginPanel environmentId={environment.environmentId} />
        </section>
      ))}
    </div>
  );
}
export const Route = createFileRoute("/_chat/settings/plugins")({ component: PluginsSettings });

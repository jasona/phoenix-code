import { PluginManifest, type PluginInstallation } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import manifest from "../../../../plugins/mission-control/phoenix.plugin.json" with { type: "json" };
import document from "../../../../plugins/mission-control/document.json" with { type: "json" };

export const bundledMissionControl: PluginInstallation = {
  manifest: Schema.decodeUnknownSync(PluginManifest)(manifest),
  directory: "phoenix:bundled/mission-control",
  enabled: true,
  bundled: true,
};
export const missionControlDocument = document;
export const missionControlTool = {
  name: "dashboard",
  description: "Open Mission Control",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true },
  _meta: { ui: { resourceUri: "ui://mission-control/dashboard" } },
};
export const missionControlResult = { content: [{ type: "text", text: "Mission Control" }] };

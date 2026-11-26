import { ModelSelection } from "./modelSelection.ts";
import * as Schema from "effect/Schema";
import { OrchestrationV2TurnItemStatus } from "./orchestrationV2.ts";
import { IsoDateTime, ProjectId, RunId, RuntimeRequestId, ThreadId } from "./baseSchemas.ts";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const PluginId = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z0-9][a-z0-9.-]{0,63}$/));
export const PluginCapability = Schema.Literals([
  "missionControl",
  "context",
  "transcript",
  "files",
  "attach",
  "message",
  "createThread",
  "modelContext",
]);
export type PluginCapability = typeof PluginCapability.Type;
export const PluginScope = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  threadId: Schema.optional(ThreadId),
});
export type PluginScope = typeof PluginScope.Type;
export const PluginGrants = Schema.Struct({
  capabilities: Schema.Array(PluginCapability),
  projectIds: Schema.Array(ProjectId),
});
export type PluginGrants = typeof PluginGrants.Type;
export const PluginConfigValue = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
export const PluginConfiguration = Schema.Record(PluginId, PluginConfigValue);
export const PluginProcess = Schema.Struct({
  command: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String),
});
export const PluginRuntime = Schema.Struct({
  state: Schema.Literals(["stopped", "starting", "ready", "backoff", "failed"]),
  restarts: Schema.Int,
  pid: Schema.optional(Schema.Int),
  exitCode: Schema.optional(Schema.Int),
});
export type PluginRuntime = typeof PluginRuntime.Type;
export const PluginDiagnostics = Schema.Struct({
  sidecar: PluginRuntime,
  logs: Schema.String,
});
export const PluginManifest = Schema.Struct({
  apiVersion: Schema.Literal(1),
  id: PluginId,
  name: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  capabilities: Schema.optional(Schema.Array(PluginCapability)),
  configuration: Schema.optional(
    Schema.Record(
      PluginId,
      Schema.Struct({ title: TrimmedNonEmptyString, default: PluginConfigValue }),
    ),
  ),
  server: PluginProcess,
  sidecar: Schema.optional(
    Schema.Struct({
      ...PluginProcess.fields,
      restart: Schema.Literals(["never", "on-failure"]),
    }),
  ),
  views: Schema.Array(
    Schema.Struct({
      id: PluginId,
      title: TrimmedNonEmptyString,
      tool: TrimmedNonEmptyString,
      scope: Schema.optional(Schema.Literals(["thread", "project", "environment"])),
    }),
  ),
});
export type PluginManifest = typeof PluginManifest.Type;
export const PluginInstallation = Schema.Struct({
  manifest: PluginManifest,
  directory: TrimmedNonEmptyString,
  enabled: Schema.Boolean,
  bundled: Schema.optional(Schema.Boolean),
  backgroundScope: Schema.optional(PluginScope),
  configuration: Schema.optional(PluginConfiguration),
  runtime: Schema.optional(PluginRuntime),
  grants: Schema.optional(PluginGrants),
});
export type PluginInstallation = typeof PluginInstallation.Type;
export const PluginInstallInput = Schema.Struct({ directory: TrimmedNonEmptyString });
export const PluginRequestInput = Schema.Union([
  Schema.Struct({ action: Schema.Literal("enable"), pluginId: PluginId, enabled: Schema.Boolean }),
  Schema.Struct({
    action: Schema.Literal("configure"),
    pluginId: PluginId,
    scope: Schema.optional(Schema.NullOr(PluginScope)),
    configuration: Schema.optional(PluginConfiguration),
  }),
  Schema.Struct({ action: Schema.Literal("grant"), pluginId: PluginId, grants: PluginGrants }),
  Schema.Struct({
    action: Schema.Literal("release"),
    pluginId: PluginId,
    instanceId: Schema.String,
  }),
  Schema.Struct({ action: Schema.Literal("remove"), pluginId: PluginId }),
  Schema.Struct({
    action: Schema.Literal("launch"),
    pluginId: PluginId,
    viewId: PluginId,
    scope: PluginScope,
  }),
  Schema.Struct({ action: Schema.Literal("restart"), pluginId: PluginId }),
  Schema.Struct({ action: Schema.Literal("reload"), pluginId: PluginId }),
  Schema.Struct({ action: Schema.Literal("diagnostics"), pluginId: PluginId }),
  Schema.Struct({
    action: Schema.Literal("open"),
    pluginId: PluginId,
    viewId: PluginId,
    scope: Schema.optional(PluginScope),
  }),
  Schema.Struct({
    action: Schema.Literal("call"),
    pluginId: PluginId,
    name: TrimmedNonEmptyString,
    arguments: Schema.Record(Schema.String, Schema.Unknown),
  }),
  Schema.Struct({
    action: Schema.Literal("resource"),
    pluginId: PluginId,
    uri: TrimmedNonEmptyString,
  }),
]);
export type PluginRequestInput = typeof PluginRequestInput.Type;
export const PluginCompletion = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  runId: Schema.String,
  completedAt: Schema.String,
});
export type PluginCompletion = typeof PluginCompletion.Type;
export const PluginLaunch = Schema.Struct({
  id: Schema.String,
  pluginId: PluginId,
  viewId: PluginId,
  title: Schema.String,
  scope: PluginScope,
});
export type PluginLaunch = typeof PluginLaunch.Type;
export const PluginViewInput = Schema.Struct({
  pluginId: PluginId,
  instanceId: TrimmedNonEmptyString,
});
export const MissionControlRequest = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("snapshot"),
    etag: Schema.optional(Schema.String.check(Schema.isMaxLength(64))),
  }),
  Schema.Struct({ action: Schema.Literal("usage") }),
  Schema.Struct({ action: Schema.Literals(["detail", "seen", "openThread"]), threadId: ThreadId }),
  Schema.Struct({
    action: Schema.Literal("reply"),
    threadId: ThreadId,
    text: Schema.String.check(Schema.isMaxLength(16_384)),
    mode: Schema.optional(Schema.Literals(["queue", "steer", "auto"])),
    expectedActiveRunId: Schema.optional(Schema.NullOr(RunId)),
  }),
  Schema.Struct({
    action: Schema.Literal("control"),
    threadId: ThreadId,
    command: Schema.Literals(["stop", "retry", "resume"]),
    expectedRunId: RunId,
  }),
  Schema.Struct({
    action: Schema.Literal("triage"),
    threadId: ThreadId,
    disposition: Schema.Literals(["accept", "dismiss", "reopen", "snooze", "unsnooze"]),
    expectedLatestRunId: Schema.NullOr(RunId),
    expectedRequestId: Schema.optional(Schema.NullOr(RuntimeRequestId)),
    snoozedUntil: Schema.optional(IsoDateTime),
  }),
  Schema.Struct({
    action: Schema.Literal("create"),
    projectId: ProjectId,
    title: Schema.String.check(Schema.isMaxLength(200)),
    text: Schema.String.check(Schema.isMaxLength(16_384)),
    modelSelection: Schema.optional(ModelSelection),
  }),
]);
export type MissionControlRequest = typeof MissionControlRequest.Type;

export const MissionControlActivityOperation = Schema.Struct({
  type: Schema.Literal("missionControlActivity"),
  threadId: Schema.NullOr(ThreadId),
});

export const MissionControlActivitySnapshot = Schema.Struct({
  threadId: ThreadId,
  status: Schema.Literals(["loading", "live", "error"]),
  running: Schema.Boolean,
  entries: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literals([
        "user",
        "assistant",
        "reasoning",
        "tool",
        "plan",
        "request",
        "notice",
      ]),
      label: Schema.String,
      body: Schema.String,
      status: OrchestrationV2TurnItemStatus,
      time: Schema.String,
    }),
  ),
  truncated: Schema.Boolean,
});
export type MissionControlActivitySnapshot = typeof MissionControlActivitySnapshot.Type;

export const PluginHostInput = Schema.Struct({
  ...PluginViewInput.fields,
  operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("missionControl"), request: MissionControlRequest }),
    Schema.Struct({ type: Schema.Literal("context") }),
    Schema.Struct({ type: Schema.Literal("transcript"), cursor: Schema.optional(Schema.String) }),
    Schema.Struct({
      type: Schema.Literals(["files", "openFile"]),
      path: TrimmedNonEmptyString,
      offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    }),
    Schema.Struct({
      type: Schema.Literals(["attach", "message", "modelContext"]),
      text: Schema.String.check(Schema.isMaxLength(16_384)),
    }),
    Schema.Struct({
      type: Schema.Literal("createThread"),
      title: TrimmedNonEmptyString,
      modelSelection: Schema.optional(ModelSelection),
    }),
  ]),
});
export type PluginHostInput = typeof PluginHostInput.Type;
export class PluginError extends Schema.TaggedError<PluginError>()("PluginError", {
  reason: Schema.Literals([
    "invalid-manifest",
    "not-found",
    "disabled",
    "request-failed",
    "permission-denied",
    "stale-view",
  ]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    switch (this.reason) {
      case "permission-denied":
        return "This plugin has not been granted this capability for this project.";
      case "stale-view":
        return "This plugin view has expired. Reopen it to continue.";
      case "invalid-manifest":
        return "Cannot install this plugin. Check phoenix.plugin.json and its directory.";
      case "not-found":
        return "The plugin or view is no longer installed.";
      case "disabled":
        return "Enable this plugin before opening its views.";
      case "request-failed":
        return "The plugin request failed. Disable and enable the plugin to restart it.";
    }
  }
}

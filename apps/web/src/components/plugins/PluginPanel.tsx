import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { isMissionControlDraftOperation } from "@t3tools/client-runtime/plugins/mission-control-drafts";
import { missionControlDrafts } from "~/state/mission-control-drafts";
import { useOpenMissionControl } from "../../hooks/useOpenMissionControl";
import { PluginConfiguration } from "./PluginConfiguration";
import { useAtomValue } from "@effect/atom-react";
import { PluginDiagnostics, PluginHostInput, ThreadId } from "@t3tools/contracts";
import type {
  EnvironmentId,
  PluginRequestInput,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  makeMcpAppHost,
  mcpAppStyleVariables,
  type McpAppCallToolResult,
  type McpAppHost,
} from "@t3tools/client-runtime/mcp-apps";
import { injectMcpAppCsp, injectMcpAppDocumentBootstrap } from "@t3tools/shared/mcpApp";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useGT } from "gt-react";
import * as Schema from "effect/Schema";
import { useEnvironmentQuery } from "~/state/query";
import { observeResize } from "~/lib/observeResize";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";
import { useAtomCommand } from "~/state/use-atom-command";
import { mcpAppEnvironment, pluginViewAtom } from "~/state/mcpApps";
import { useRightPanelStore } from "~/rightPanelStore";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { attachMcpAppDocumentLink } from "../chat/mcpAppDocumentLink";
import { useProjects, useQuietThreadShell, useServerConfigs } from "~/state/entities";
import { useComposerDraftStore } from "~/composerDraftStore";
import { requestConfirmDialog } from "~/confirmDialog";
import { isElectron } from "~/env";

const OpenedView = Schema.Struct({
  instanceId: Schema.optional(Schema.String),
  capabilities: Schema.optional(Schema.Array(Schema.String)),
  html: Schema.String,
  resourceUri: Schema.String,
  tool: Schema.Struct({ name: Schema.String }),
  result: Schema.Unknown,
});
const isOpenedView = Schema.is(OpenedView);

const isDiagnostics = Schema.is(PluginDiagnostics);
const decodeOperation = Schema.decodeUnknownSync(PluginHostInput.fields.operation);
const isFilePage = Schema.is(
  Schema.Struct({
    path: Schema.String,
    text: Schema.String,
    nextOffset: Schema.NullOr(Schema.Number),
  }),
);
const isThreadResult = Schema.is(Schema.Struct({ threadId: ThreadId }));
const isFileResult = Schema.is(Schema.Struct({ relativePath: Schema.String }));
const isHostContext = Schema.is(
  Schema.Struct({
    projectId: Schema.String,
    runStatus: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);
const isTextBlock = Schema.is(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }));

export function PluginPanel({
  environmentId,
  threadRef,
}: {
  environmentId: EnvironmentId;
  threadRef?: ScopedThreadRef;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const openMissionControl = useOpenMissionControl();
  const supported =
    useServerConfigs().get(environmentId)?.environment.capabilities.pluginViews === true;
  const listing = useEnvironmentQuery(
    supported ? mcpAppEnvironment.pluginsListQuery({ environmentId, input: {} }) : null,
  );
  const entries = listing.data ?? [];
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const refresh = listing.refresh;
  const failed = listing.error !== null;
  const install = useAtomCommand(mcpAppEnvironment.pluginsInstall);
  const request = useAtomCommand(mcpAppEnvironment.pluginsRequest);
  const allowed = useAtomValue(mcpAppEnvironment.pluginsInstall.permissionAtom(environmentId));
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ id: string; logs: string } | null>(null);
  const change = async (input: PluginRequestInput) => {
    setBusy(true);
    await request({ environmentId: environmentId, input });
    await refresh();
    setBusy(false);
  };
  if (!supported)
    return <p className="p-5">{gt("Update this environment’s Phoenix server to use plugins.")}</p>;
  return (
    <section className="flex h-full flex-col gap-5 overflow-auto p-5">
      <div>
        <h2 className="text-lg font-semibold">{gt("Plugins")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {gt("Install a plugin folder from this environment to add tools and views to Phoenix.")}
        </p>
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          await install({ environmentId: environmentId, input: { directory } });
          await refresh();
          setBusy(false);
        }}
      >
        <label htmlFor={`plugin-folder-${environmentId}`} className="text-sm font-medium">
          {gt("Plugin folder")}
        </label>
        <Input
          id={`plugin-folder-${environmentId}`}
          value={directory}
          onChange={(event) => setDirectory(event.target.value)}
          placeholder="/path/to/plugin"
          disabled={busy || !allowed || !supported}
        />
        <p className="text-xs text-muted-foreground">
          {gt(
            "Only enable plugins you trust. Their processes run with this server's user permissions.",
          )}
        </p>
        <div>
          <Button type="submit" disabled={busy || !allowed || !supported || !directory.trim()}>
            {gt("Install plugin")}
          </Button>
        </div>
      </form>
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{gt("Installed plugins")}</h3>
        <Button variant="ghost" onClick={() => refresh()} disabled={busy}>
          {gt("Refresh")}
        </Button>
      </div>
      {failed ? (
        <p role="alert">
          {gt(
            "Plugins could not be loaded. Check the connection and server version, then refresh.",
          )}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{gt("No plugins installed yet.")}</p>
      ) : null}
      <div className="divide-y divide-border">
        {entries.map((entry) => (
          <article key={entry.manifest.id} className="space-y-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-medium">{entry.manifest.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {entry.manifest.version} · {entry.enabled ? gt("Enabled") : gt("Disabled")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  disabled={busy || !allowed || !entry.enabled}
                  onClick={() => change({ action: "restart", pluginId: entry.manifest.id })}
                >
                  {gt("Restart")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || !allowed}
                  onClick={async () => {
                    const result = await request({
                      environmentId,
                      input: { action: "diagnostics", pluginId: entry.manifest.id },
                    });
                    if (result._tag === "Success" && isDiagnostics(result.value))
                      setDiagnostics({ id: entry.manifest.id, logs: result.value.logs });
                  }}
                >
                  {gt("View logs")}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !allowed || !supported}
                  onClick={() =>
                    change({
                      action: "enable",
                      pluginId: entry.manifest.id,
                      enabled: !entry.enabled,
                    })
                  }
                >
                  {entry.enabled ? gt("Disable") : gt("Enable")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={entry.bundled || busy || !allowed || !supported}
                  onClick={() => change({ action: "remove", pluginId: entry.manifest.id })}
                >
                  {gt("Uninstall")}
                </Button>
              </div>
            </div>
            {entry.backgroundScope && (
              <Button
                variant="ghost"
                disabled={busy || !allowed}
                onClick={() =>
                  change({ action: "configure", pluginId: entry.manifest.id, scope: null })
                }
              >
                {gt("Stop background events")}
              </Button>
            )}
            <PluginConfiguration
              key={JSON.stringify(entry.configuration)}
              entry={entry}
              disabled={busy || !allowed}
              onSave={change}
            />
            {!entry.bundled && (entry.manifest.capabilities?.length ?? 0) > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer">{gt("Project permissions")}</summary>
                <p className="my-2 text-xs text-muted-foreground">
                  {gt(
                    "Allow this plugin’s requested capabilities for selected projects. Changing permissions requires reopening its views.",
                  )}
                </p>
                <div className="my-2 space-y-2">
                  {entry.manifest.capabilities?.map((capability) => (
                    <label key={capability} className="flex items-center gap-2">
                      <Checkbox
                        checked={entry.grants?.capabilities.includes(capability) ?? false}
                        disabled={busy || !allowed}
                        onCheckedChange={(checked) =>
                          change({
                            action: "grant",
                            pluginId: entry.manifest.id,
                            grants: {
                              projectIds: entry.grants?.projectIds ?? [],
                              capabilities: checked
                                ? [...(entry.grants?.capabilities ?? []), capability]
                                : (entry.grants?.capabilities ?? []).filter(
                                    (value) => value !== capability,
                                  ),
                            },
                          })
                        }
                      />
                      {capability}
                    </label>
                  ))}
                </div>
                {projects.map((project) => (
                  <div key={project.id} className="flex items-center gap-2 py-1">
                    <Checkbox
                      aria-label={project.title}
                      checked={entry.grants?.projectIds.includes(project.id) ?? false}
                      disabled={busy || !allowed}
                      onCheckedChange={(checked) =>
                        change({
                          action: "grant",
                          pluginId: entry.manifest.id,
                          grants: {
                            capabilities:
                              entry.grants?.capabilities ?? entry.manifest.capabilities ?? [],
                            projectIds: checked
                              ? [...(entry.grants?.projectIds ?? []), project.id]
                              : (entry.grants?.projectIds ?? []).filter((id) => id !== project.id),
                          },
                        })
                      }
                    />
                    {project.title}
                    {entry.manifest.sidecar && entry.grants?.projectIds.includes(project.id) && (
                      <Button
                        variant="ghost"
                        disabled={busy || !allowed}
                        onClick={() =>
                          change({
                            action: "configure",
                            pluginId: entry.manifest.id,
                            scope: { projectId: project.id },
                          })
                        }
                      >
                        {entry.backgroundScope?.projectId === project.id
                          ? gt("Background project selected")
                          : gt("Use for background work")}
                      </Button>
                    )}
                  </div>
                ))}
              </details>
            )}
            {entry.manifest.sidecar && (
              <p className="text-xs text-muted-foreground">
                {gt("Background process")}:{" "}
                {entry.runtime?.state === "ready"
                  ? gt("Running")
                  : entry.runtime?.state === "starting"
                    ? gt("Starting…")
                    : entry.runtime?.state === "backoff"
                      ? gt("Restarting…")
                      : entry.runtime?.state === "failed"
                        ? gt("Failed")
                        : gt("Stopped")}
              </p>
            )}
            {diagnostics?.id === entry.manifest.id && (
              <div className="space-y-2">
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">
                  {diagnostics.logs || gt("No logs yet.")}
                </pre>
                <Button variant="ghost" onClick={() => setDiagnostics(null)}>
                  {gt("Close logs")}
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {entry.manifest.views.map((view) => (
                <Button
                  key={view.id}
                  variant="outline"
                  disabled={!entry.enabled || !allowed || !supported}
                  onClick={() => {
                    if (entry.manifest.id === "mission-control" && view.id === "dashboard")
                      void openMissionControl(environmentId);
                    else if (threadRef && (view.scope ?? "thread") === "thread")
                      useRightPanelStore
                        .getState()
                        .openPlugin(threadRef, entry.manifest.id, view.id, view.title);
                    else
                      void navigate({
                        to: "/plugins",
                        search: {
                          environmentId,
                          pluginId: entry.manifest.id,
                          viewId: view.id,
                        },
                      });
                  }}
                >
                  {view.title}
                </Button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PluginView(props: {
  active?: boolean;
  onOpenThread?: () => void;
  onInspectThread?: (threadRef: ScopedThreadRef, instanceId: string) => void;
  threadRef?: ScopedThreadRef;
  projectRef?: ScopedProjectRef;
  environmentId?: EnvironmentId;
  pluginId: string;
  viewId: string;
}) {
  const gt = useGT();
  const request = useAtomCommand(mcpAppEnvironment.pluginsRequest, { reportFailure: false });
  const hostRequest = useAtomCommand(mcpAppEnvironment.pluginsHost, { reportFailure: false });
  const thread = useQuietThreadShell(props.threadRef ?? null);
  const navigate = useNavigate();
  const environmentId =
    props.environmentId ?? props.threadRef?.environmentId ?? props.projectRef!.environmentId;
  const projectId = thread?.projectId ?? props.projectRef?.projectId;
  const view = useEnvironmentQuery(
    pluginViewAtom(
      JSON.stringify([
        environmentId,
        props.pluginId,
        props.viewId,
        projectId
          ? { projectId, ...(props.threadRef ? { threadId: props.threadRef.threadId } : {}) }
          : undefined,
      ]),
    ),
  );
  const opened = isOpenedView(view.data) ? view.data : null;
  const context = useEnvironmentQuery(
    opened?.instanceId
      ? mcpAppEnvironment.pluginsWatch({
          environmentId,
          input: { pluginId: props.pluginId, instanceId: opened.instanceId },
        })
      : null,
  );
  const failed = view.error !== null || context.error !== null;
  const load = view.refresh;
  const theme = useHtmlRenderTheme();
  const surfaces = useRightPanelStore((state) =>
    props.threadRef ? state.byThreadKey[scopedThreadKey(props.threadRef)]?.surfaces : undefined,
  );
  const [filePreview, setFilePreview] = useState<{
    path: string;
    text: string;
    nextOffset: number | null;
  } | null>(null);
  const hostRef = useRef<McpAppHost | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the mounted MCP bridge synchronized with host appearance and bound thread metadata.
  useEffect(() => {
    hostRef.current?.updateHostContext();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The bridge reads these values through its stable live callback.
  }, [theme, thread, context.data, surfaces, props.active]);
  const call = useStableCallback(async (input: PluginRequestInput) => {
    const result = await request({ environmentId: environmentId, input });
    if (result._tag !== "Success")
      throw new Error(gt("The plugin is unavailable. Check that it is enabled and try again."));
    return result.value;
  });
  const readFile = useStableCallback(async (path: string, offset: number = 0) => {
    if (!opened?.instanceId) return;
    const result = await hostRequest({
      environmentId,
      input: {
        pluginId: props.pluginId,
        instanceId: opened.instanceId,
        operation: { type: "files", path, offset },
      },
    });
    if (result._tag === "Success" && isFilePage(result.value)) setFilePreview(result.value);
  });
  const perform = useStableCallback(async (raw: unknown) => {
    if (!opened?.instanceId) throw new Error("Reopen this plugin view to use host actions.");
    const instanceId = opened.instanceId;
    if (isMissionControlDraftOperation(raw)) {
      if (props.pluginId !== "mission-control" || !opened.capabilities?.includes("missionControl"))
        throw new Error("This plugin cannot access Mission Control drafts.");
      return missionControlDrafts.request(environmentId, raw);
    }
    const operation = decodeOperation(raw);
    if (operation.type === "message" || operation.type === "createThread") {
      const approved = await requestConfirmDialog(
        operation.type === "message"
          ? `${gt("Send this plugin message to the bound conversation?")}\n${operation.text}`
          : `${gt("Create a conversation for this plugin?")}\n${"title" in operation ? operation.title : ""}`,
      );
      if (!approved) throw new Error("Declined by the user.");
    }
    const send = async () => {
      const result = await hostRequest({
        environmentId: environmentId,
        input: { pluginId: props.pluginId, instanceId, operation },
      });
      if (result._tag !== "Success")
        throw new Error(
          gt("The plugin action was refused. Check its permissions and reopen the view."),
        );
      return result;
    };
    const result =
      props.pluginId === "mission-control" &&
      opened.capabilities?.includes("missionControl") &&
      operation.type === "missionControl" &&
      operation.request.action === "reply"
        ? await missionControlDrafts.submit(
            environmentId,
            operation.request.threadId,
            operation.request.text,
            send,
          )
        : await send();
    if (operation.type === "attach" && props.threadRef) {
      const drafts = useComposerDraftStore.getState();
      const current = drafts.getComposerDraft(props.threadRef)?.prompt ?? "";
      drafts.setPrompt(props.threadRef, [current, operation.text].filter(Boolean).join("\n\n"));
    }
    if (operation.type === "openFile" && props.threadRef && isFileResult(result.value))
      useRightPanelStore.getState().openFile(props.threadRef, result.value.relativePath);
    if (operation.type === "openFile" && !props.threadRef && isFileResult(result.value))
      await readFile(result.value.relativePath);
    if (
      operation.type === "missionControl" &&
      operation.request.action === "openThread" &&
      isThreadResult(result.value)
    ) {
      if (props.onInspectThread) {
        props.onInspectThread(
          { environmentId, threadId: result.value.threadId },
          opened.instanceId,
        );
        return result.value;
      }
      props.onOpenThread?.();
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.value.threadId },
      });
    }
    return result.value;
  });
  const live = useStableCallback(() => ({
    theme,
    call,
    props,
    opened,
    thread,
    perform,
    context: context.data,
    surfaces,
  }));
  const attach = useStableCallback((frame: HTMLIFrameElement) => {
    const { opened, props } = live();
    const refuse = async () => {
      throw new Error("This capability is not available in plugin views yet.");
    };
    const link = attachMcpAppDocumentLink(frame, (data) => host.receive(data));
    const host = makeMcpAppHost({
      app: {
        attachmentId: props.pluginId,
        server: props.pluginId,
        tool: opened?.tool.name ?? props.viewId,
        resourceUri: opened?.resourceUri ?? `ui://${props.pluginId}/${props.viewId}`,
      },
      hostVersion: "1",
      post: link.post,
      hostActions: [
        ...(opened?.capabilities?.includes("message") ? ["message" as const] : []),
        ...(opened?.capabilities?.includes("modelContext") ? ["updateModelContext" as const] : []),
      ],
      phoenixRequest: (operation) => live().perform(operation),
      hostContext: () => ({
        theme: live().theme.appearance,
        "phoenix/visible": live().props.active !== false,
        styles: { variables: mcpAppStyleVariables(live().theme.variables) },
        displayMode: "fullscreen",
        availableDisplayModes: ["fullscreen"],
        containerDimensions: { width: frame.clientWidth, height: frame.clientHeight },
        platform: isElectron ? "desktop" : "web",
        locale: navigator.language,
        "phoenix/context": {
          environmentId: environmentId,
          ...(props.threadRef ? { threadId: props.threadRef.threadId } : {}),
          ...(projectId ? { projectId } : {}),
          capabilities: live().opened?.capabilities ?? [],
          selectedResources: live().opened?.capabilities?.includes("files")
            ? (live().surfaces ?? [])
                .filter((surface) => surface.kind === "file")
                .slice(-16)
                .map((surface) => ({ path: surface.relativePath }))
            : [],
          ...(isHostContext(live().context)
            ? (live().context as { projectId: string; runStatus?: string | null })
            : {}),
          ...(live().thread && live().opened?.capabilities?.includes("context")
            ? {
                projectId: live().thread!.projectId,
                threadTitle: live().thread!.title,
                branch: live().thread!.branch,
                runStatus: live().thread!.latestRun?.status ?? null,
              }
            : {}),
        },
      }),
      callTool: async ({ name, arguments: args }) =>
        (await live().call({
          action: "call",
          pluginId: props.pluginId,
          name,
          arguments: args,
        })) as McpAppCallToolResult,
      readResource: ({ uri }) => live().call({ action: "resource", pluginId: props.pluginId, uri }),
      openLink: refuse,
      sendMessage: async (text) => {
        await live().perform({ type: "message", text });
      },
      updateModelContext: async (context) => {
        await live().perform({
          type: "modelContext",
          text: [
            ...(context.content ?? []).map((block) => (isTextBlock(block) ? block.text : "")),
            ...(context.structuredContent ? [JSON.stringify(context.structuredContent)] : []),
          ].join("\n"),
        });
      },
      downloadFile: refuse,
      requestDisplayMode: async () => "fullscreen",
      onRequestTeardown: () => {},
      onSizeChanged: () => {},
    });
    hostRef.current = host;
    host.setToolCall({
      arguments: {},
      result: live().opened?.result as McpAppCallToolResult | undefined,
    });
    window.addEventListener("message", link.receive);
    const stopResize = observeResize(frame, () => host.updateHostContext());
    return () => {
      stopResize();
      window.removeEventListener("message", link.receive);
      host.dispose();
      hostRef.current = null;
    };
  });
  if (failed)
    return (
      <div className="space-y-3 p-5">
        <p role="alert">
          {gt("The plugin is unavailable. Check that it is enabled and try again.")}
        </p>
        <Button onClick={() => load()}>{gt("Retry")}</Button>
        <Button
          variant="outline"
          onClick={() => {
            if (props.threadRef) useRightPanelStore.getState().open(props.threadRef, "plugins");
            else
              void navigate({
                to: "/settings/plugins",
                search: { machine: environmentId },
              });
          }}
        >
          {gt("View logs")}
        </Button>
      </div>
    );
  if (!opened) return <p className="p-5 text-sm text-muted-foreground">{gt("Opening plugin…")}</p>;
  return (
    <div className="relative h-full min-h-0">
      {filePreview && (
        <section className="absolute inset-0 z-10 flex flex-col bg-background p-4">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{filePreview.path}</span>
            <Button variant="ghost" onClick={() => setFilePreview(null)}>
              {gt("Close file")}
            </Button>
            {filePreview.nextOffset !== null && (
              <Button
                variant="outline"
                onClick={() => readFile(filePreview.path, filePreview.nextOffset ?? 0)}
              >
                {gt("Next page")}
              </Button>
            )}
          </div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap text-sm">
            {filePreview.text}
          </pre>
        </section>
      )}
      <iframe
        key={view.dataUpdatedAt}
        ref={attach}
        title={props.viewId}
        sandbox="allow-scripts allow-forms"
        className="h-full w-full border-0"
        srcDoc={injectMcpAppDocumentBootstrap(injectMcpAppCsp(opened.html, undefined))}
      />
    </div>
  );
}

import { useAtomValue } from "@effect/atom-react";
import { useNavigation, useIsFocused, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, ThreadId, PluginHostInput, type PluginLaunch } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  makeMcpAppHost,
  mcpAppStyleVariables,
  type McpAppHost,
  type McpAppCallToolResult,
} from "@t3tools/client-runtime/mcp-apps";
import { injectMcpAppCsp, injectMcpAppDocumentBootstrap } from "@t3tools/shared/mcpApp";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react-native";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Platform, View, ScrollView } from "react-native";
import { WebView } from "react-native-webview";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { useThreadShell, useServerConfigs } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { mcpAppEnvironment, pluginViewAtom } from "../../state/mcpApps";
import { mobileHtmlRenderTheme } from "../../lib/htmlRenderTheme";
import { uuidv4 } from "../../lib/uuid";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { getComposerDraftSnapshot, setComposerDraftText } from "../../state/use-composer-drafts";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { outerDocument } from "./mcpAppOuterDocument";

const Opened = Schema.Struct({
  html: Schema.String,
  instanceId: Schema.String,
  resourceUri: Schema.String,
  tool: Schema.Struct({ name: Schema.String }),
  result: Schema.Unknown,
  capabilities: Schema.Array(Schema.String),
});

const isOpened = Schema.is(Opened);
const decodeOperation = Schema.decodeUnknownSync(PluginHostInput.fields.operation);
const isFileResult = Schema.is(Schema.Struct({ relativePath: Schema.String }));
const isEnvelope = Schema.is(Schema.Struct({ secret: Schema.String, message: Schema.Unknown }));
const isNavigated = Schema.is(Schema.Struct({ t3: Schema.Literal("navigated") }));

export function PluginsScreen({
  route,
}: StaticScreenProps<{ environmentId: string; threadId: string; launch?: PluginLaunch }>) {
  const gt = useGT();
  const navigation = useNavigation();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const threadRef = scopeThreadRef(environmentId, ThreadId.make(route.params.threadId));
  const thread = useThreadShell(threadRef);
  const supported =
    useServerConfigs().get(environmentId)?.environment.capabilities.pluginViews === true;
  const listing = useEnvironmentQuery(
    supported ? mcpAppEnvironment.pluginsListQuery({ environmentId, input: {} }) : null,
  );
  const allowed = useAtomValue(mcpAppEnvironment.pluginsRequest.permissionAtom(environmentId));
  const [opened, setOpened] = useState<{ pluginId: string; viewId: string; title: string } | null>(
    route.params.launch ?? null,
  );
  const [previousLaunch, setPreviousLaunch] = useState(route.params.launch?.id);
  if (previousLaunch !== route.params.launch?.id) {
    setPreviousLaunch(route.params.launch?.id);
    setOpened(route.params.launch ?? null);
  }
  const focused = useIsFocused();
  if (!focused && opened !== null) setOpened(null);
  const close = () => {
    if (opened) {
      setOpened(null);
      return;
    }
    navigation.goBack();
  };
  return (
    <View className="flex-1 bg-screen">
      <AppBar title={opened?.title ?? gt("Plugins")} onClose={close} />
      {opened && thread && focused ? (
        <OpenPlugin key={`${opened.pluginId}:${opened.viewId}`} selected={opened} thread={thread} />
      ) : !opened ? (
        <ScrollView contentContainerClassName="gap-4 p-5">
          {!supported ? (
            <Text>{gt("Update this environment’s server to use plugins.")}</Text>
          ) : null}
          {listing.error ? <Text>{listing.error}</Text> : null}
          {listing.data?.length === 0 ? (
            <Text>{gt("Install plugins in Settings on web or desktop to open them here.")}</Text>
          ) : null}
          {listing.data?.map((entry) => (
            <View key={entry.manifest.id} className="gap-2">
              <Text className="text-lg font-semibold">{entry.manifest.name}</Text>
              {entry.manifest.views.map((view) => (
                <Button
                  key={view.id}
                  label={view.title}
                  tone="secondary"
                  disabled={!entry.enabled || !allowed || !thread}
                  onPress={() =>
                    setOpened({ pluginId: entry.manifest.id, viewId: view.id, title: view.title })
                  }
                />
              ))}
            </View>
          ))}
          <Button label={gt("Refresh")} tone="secondary" onPress={() => listing.refresh()} />
        </ScrollView>
      ) : null}
    </View>
  );
}

function OpenPlugin({
  selected,
  thread,
}: {
  selected: { pluginId: string; viewId: string; title: string };
  thread: NonNullable<ReturnType<typeof useThreadShell>>;
}) {
  const gt = useGT();
  const view = useEnvironmentQuery(
    pluginViewAtom(
      JSON.stringify([
        thread.environmentId,
        selected.pluginId,
        selected.viewId,
        { projectId: thread.projectId, threadId: thread.id },
      ]),
    ),
  );
  if (view.error)
    return (
      <View className="gap-3 p-5">
        <Text>{gt("The plugin view stopped. Close it and reopen to retry.")}</Text>
        <Button label={gt("Retry")} onPress={() => view.refresh()} />
      </View>
    );
  if (!isOpened(view.data)) return <Text className="p-5">{gt("Opening plugin…")}</Text>;
  return (
    <PluginDocument
      key={view.data.instanceId}
      opened={{ ...selected, data: view.data }}
      thread={thread}
    />
  );
}

function PluginDocument({
  opened,
  thread,
}: {
  opened: { pluginId: string; title: string; data: typeof Opened.Type };
  thread: NonNullable<ReturnType<typeof useThreadShell>>;
}) {
  const gt = useGT();
  const navigation = useNavigation();
  const request = useAtomCommand(mcpAppEnvironment.pluginsRequest, { reportFailure: false });
  const hostRequest = useAtomCommand(mcpAppEnvironment.pluginsHost, { reportFailure: false });
  const context = useEnvironmentQuery(
    opened.data.instanceId
      ? mcpAppEnvironment.pluginsWatch({
          environmentId: thread.environmentId,
          input: { pluginId: opened.pluginId, instanceId: opened.data.instanceId },
        })
      : null,
  );
  const [secret] = useState(uuidv4);
  const webView = useRef<WebView<object> | null>(null);
  const host = useRef<McpAppHost | null>(null);
  const [failed, setFailed] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const appearance = useAppearancePreferences();
  const theme = mobileHtmlRenderTheme({
    themeId: appearance.themeId,
    appearance: appearance.themeAppearance,
    variables: appearance.themeVariables,
    systemColors: appearance.systemColorsActive,
    platform: Platform.OS,
  });
  const live = useEffectEvent(() => ({ theme, thread, request, hostRequest, dimensions }));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The WebView bridge owns an external document and its server-bound instance.
  useEffect(() => {
    const environmentId = thread.environmentId;
    const call = async (input: Parameters<typeof request>[0]["input"]) => {
      const result = await live().request({ environmentId, input });
      if (result._tag !== "Success") throw new Error("Plugin unavailable. Reopen it to retry.");
      return result.value;
    };
    const perform = async (raw: unknown) => {
      const operation = decodeOperation(raw);
      if (operation.type === "message" || operation.type === "createThread") {
        const approved = await new Promise<boolean>((resolve) =>
          Dialog.alert(
            gt("Allow plugin action?"),
            "text" in operation ? operation.text : operation.title,
            [
              { text: gt("Cancel"), style: "cancel", onPress: () => resolve(false) },
              { text: gt("Allow"), onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          ),
        );
        if (!approved) throw new Error("Declined by the user.");
      }
      const result = await live().hostRequest({
        environmentId,
        input: { pluginId: opened.pluginId, instanceId: opened.data.instanceId, operation },
      });
      if (result._tag !== "Success")
        throw new Error("Plugin permission denied. Check grants and reopen the view.");
      if (operation.type === "attach") {
        const key = scopedThreadKey(environmentId, thread.id);
        setComposerDraftText(
          key,
          [getComposerDraftSnapshot(key).text, operation.text].filter(Boolean).join("\n\n"),
        );
      }
      if (operation.type === "openFile" && isFileResult(result.value)) {
        navigation.navigate("ThreadFile", {
          environmentId,
          threadId: thread.id,
          path: result.value.relativePath.split("/"),
        });
      }
      return result.value;
    };
    const refuse = async () => {
      throw new Error("This capability is unavailable.");
    };
    const bridge = makeMcpAppHost({
      app: {
        attachmentId: opened.pluginId,
        server: opened.pluginId,
        tool: opened.data.tool.name,
        resourceUri: opened.data.resourceUri,
      },
      hostVersion: "1",
      post: (message) =>
        webView.current?.injectJavaScript(
          `window.__t3McpAppReceive(${JSON.stringify(message)});true;`,
        ),
      hostActions: [
        ...(opened.data.capabilities.includes("message") ? ["message" as const] : []),
        ...(opened.data.capabilities.includes("modelContext")
          ? ["updateModelContext" as const]
          : []),
      ],
      phoenixRequest: perform,
      hostContext: () => ({
        theme: live().theme.appearance,
        styles: { variables: mcpAppStyleVariables(live().theme.variables) },
        displayMode: "fullscreen",
        availableDisplayModes: ["fullscreen"],
        platform: "mobile",
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        containerDimensions: live().dimensions,
        "phoenix/context": {
          environmentId,
          projectId: thread.projectId,
          threadId: thread.id,
          ...(opened.data.capabilities.includes("context")
            ? {
                threadTitle: live().thread.title,
                runStatus: live().thread.latestRun?.status ?? null,
              }
            : {}),
          capabilities: opened.data.capabilities,
        },
      }),
      callTool: async ({ name, arguments: args }) =>
        (await call({
          action: "call",
          pluginId: opened.pluginId,
          name,
          arguments: args,
        })) as McpAppCallToolResult,
      readResource: ({ uri }) => call({ action: "resource", pluginId: opened.pluginId, uri }),
      sendMessage: async (text) => {
        await perform({ type: "message", text });
      },
      updateModelContext: async (context) => {
        await perform({ type: "modelContext", text: JSON.stringify(context) });
      },
      openLink: refuse,
      downloadFile: refuse,
      requestDisplayMode: async () => "fullscreen",
      onRequestTeardown: () => {},
      onSizeChanged: () => {},
    });
    host.current = bridge;
    bridge.setToolCall({ arguments: {}, result: opened.data.result as McpAppCallToolResult });
    return () => {
      bridge.dispose();
      host.current = null;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The instance owns the document; mutable thread, theme and command values come from the effect event.
  }, [opened.data.instanceId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Send appearance and bound thread changes to the mounted plugin document.
  useEffect(() => {
    host.current?.updateHostContext();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The bridge reads current appearance, dimensions and thread metadata through its live callback.
  }, [theme, thread, dimensions]);
  if (failed || context.error)
    return (
      <Text className="p-5">{gt("The plugin view stopped. Close it and reopen to retry.")}</Text>
    );
  const html = injectMcpAppDocumentBootstrap(injectMcpAppCsp(opened.data.html, undefined));
  return (
    <View
      className="flex-1"
      onLayout={(event) =>
        setDimensions({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        })
      }
    >
      <WebView<object>
        ref={webView}
        source={{
          html: outerDocument(
            `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
            "",
            secret,
          ),
        }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        originWhitelist={["*"]}
        setSupportMultipleWindows={false}
        onContentProcessDidTerminate={() => setFailed(true)}
        onRenderProcessGone={() => setFailed(true)}
        onMessage={(event) => {
          let envelope: unknown;
          try {
            envelope = JSON.parse(event.nativeEvent.data);
          } catch {
            return;
          }
          if (!isEnvelope(envelope) || envelope.secret !== secret) return;
          if (isNavigated(envelope.message)) {
            host.current?.dispose();
            setFailed(true);
            return;
          }
          host.current?.receive(envelope.message);
        }}
      />
    </View>
  );
}

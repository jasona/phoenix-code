import {
  PluginError,
  PluginInstallation,
  PluginManifest,
  type PluginRequestInput,
  type PluginCapability,
  type PluginScope,
  type PluginLaunch,
  type ThreadId,
  type PluginCompletion,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import { mcpAppToolCallableByApp } from "@t3tools/shared/mcpApp";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as McpClient from "effect/ai/McpClient";
import * as McpSchema from "effect/ai/McpSchema";
import * as McpProtocol from "effect/ai/McpProtocol";
import * as ChildProcess from "effect/process/ChildProcess";
import * as PluginAuthoring from "./PluginAuthoring.ts";
import * as PluginModelContext from "./PluginModelContext.ts";
import * as PluginSidecars from "./PluginSidecars.ts";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { ServerConfig } from "../config.ts";

export class Plugins extends Context.Service<
  Plugins,
  {
    readonly changes: Stream.Stream<string>;
    readonly notify: (event: PluginCompletion) => Effect.Effect<void, PluginError>;
    readonly subscribe: (threadId: ThreadId) => Stream.Stream<PluginLaunch>;
    readonly withView: <A, E, R>(
      input: { pluginId: string; instanceId: string },
      capability: PluginCapability | undefined,
      use: (scope: PluginScope) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | PluginError, R>;
    readonly list: () => Effect.Effect<ReadonlyArray<PluginInstallation>, PluginError>;
    readonly install: (input: {
      readonly directory: string;
    }) => Effect.Effect<PluginInstallation, PluginError>;
    readonly request: (input: PluginRequestInput) => Effect.Effect<unknown, PluginError>;
  }
>()("t3/plugins/Plugins") {}

const encodeConfiguration = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeRegistry = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(PluginInstallation)));
const encodeRegistry = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(PluginInstallation)));
const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(PluginManifest));

const encodeTool = Schema.encodeEffect(Schema.toCodecJson(McpSchema.Tool));
const encodeResult = Schema.encodeEffect(Schema.toCodecJson(McpSchema.CallToolResult));
const encodeResource = Schema.encodeEffect(Schema.toCodecJson(McpSchema.ReadResourceResult));
const readUiMetadata = Schema.decodeUnknownOption(
  Schema.Struct({ ui: Schema.Struct({ resourceUri: Schema.String }) }),
);

const make = Effect.gen(function* () {
  const authoring = yield* PluginAuthoring.PluginAuthoring;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const modelContext = yield* PluginModelContext.PluginModelContext;
  const sidecars = yield* PluginSidecars.PluginSidecars;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const ownerScope = yield* Scope.Scope;
  const lock = yield* Semaphore.make(1);
  const changes = yield* PubSub.sliding<string>(64);
  const launches = yield* PubSub.sliding<PluginLaunch>(64);
  const root = path.join(config.stateDir, "plugins");
  const registryPath = path.join(root, "installed.json");
  const sessions = new Map<string, { scope: Scope.Closeable; client: McpClient.McpClient }>();
  const views = new Map<string, { pluginId: string; scope: PluginScope }>();
  const revokeViews = (id: string) => {
    modelContext.revoke(id);
    for (const [key, view] of views) if (view.pluginId === id) views.delete(key);
  };
  const failure = (cause: unknown) => new PluginError({ reason: "request-failed", cause });
  const readRegistry = Effect.fn("Plugins.readRegistry")(function* () {
    if (!(yield* fs.exists(registryPath))) return [];
    return yield* decodeRegistry(yield* fs.readFileString(registryPath));
  }, Effect.mapError(failure));
  const save = Effect.fn("Plugins.save")(function* (entries: ReadonlyArray<PluginInstallation>) {
    yield* fs.makeDirectory(root, { recursive: true });
    yield* fs.writeFileString(
      `${registryPath}.tmp`,
      yield* encodeRegistry(entries.map(({ runtime: _, ...entry }) => entry)),
    );
    yield* fs.rename(`${registryPath}.tmp`, registryPath);
  }, Effect.mapError(failure));
  const stop = Effect.fn("Plugins.stop")(function* (id: string) {
    const session = sessions.get(id);
    if (session) {
      sessions.delete(id);
      yield* Scope.close(session.scope, Exit.void);
    }
  });
  yield* Effect.addFinalizer(() => Effect.forEach([...sessions.keys()], stop));
  const connect = Effect.fn("Plugins.connect")(function* (entry: PluginInstallation) {
    const existing = sessions.get(entry.manifest.id);
    if (existing) return existing.client;
    const data = path.join(root, "data", entry.manifest.id);
    yield* fs.makeDirectory(data, { recursive: true });
    const scope = yield* Scope.fork(ownerScope, "sequential");
    const layer = McpClient.layerStdio({
      name: "Phoenix",
      version: "1",
      protocol: McpProtocol.v2025_11_25,
      timeout: "15 seconds",
      maxMessageBytes: 2 * 1024 * 1024,
      command: ChildProcess.make(entry.manifest.server.command, [...entry.manifest.server.args], {
        cwd: entry.directory,
        env: {
          PHOENIX_PLUGIN_DATA: data,
          PHOENIX_PLUGIN_ROOT: entry.directory,
          PHOENIX_PLUGIN_CONFIG: yield* encodeConfiguration({
            ...Object.fromEntries(
              Object.entries(entry.manifest.configuration ?? {}).map(([key, field]) => [
                key,
                field.default,
              ]),
            ),
            ...entry.configuration,
          }),
        },
      }),
    });
    const observedSpawner = ChildProcessSpawner.make((command) =>
      spawner.spawn(command).pipe(
        Effect.map((child) => ({
          ...child,
          stderr: child.stderr.pipe(
            Stream.tap((chunk) =>
              Effect.sync(() =>
                sidecars.append(entry.manifest.id, new TextDecoder().decode(chunk)),
              ),
            ),
          ),
        })),
      ),
    );
    const context = yield* Layer.buildWithScope(layer, scope).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, observedSpawner),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    const client = Context.get(context, McpClient.McpClient);
    sessions.set(entry.manifest.id, { scope, client });
    return client;
  }, Effect.mapError(failure));
  const list = Effect.fn("Plugins.list")(function* () {
    return (yield* readRegistry()).map((entry) => ({
      ...entry,
      runtime: sidecars.inspect(entry.manifest.id).sidecar,
    }));
  });
  const install = Effect.fn("Plugins.install")(function* (input: { readonly directory: string }) {
    const directory = yield* fs
      .realPath(input.directory)
      .pipe(Effect.mapError((cause) => new PluginError({ reason: "invalid-manifest", cause })));
    const manifest = yield* fs.readFileString(path.join(directory, "phoenix.plugin.json")).pipe(
      Effect.flatMap(decodeManifest),
      Effect.mapError((cause) => new PluginError({ reason: "invalid-manifest", cause })),
    );
    if (new Set(manifest.views.map((view) => view.id)).size !== manifest.views.length)
      return yield* new PluginError({ reason: "invalid-manifest" });
    const entries = yield* readRegistry();
    const entry = { manifest, directory, enabled: false };
    revokeViews(manifest.id);
    yield* stop(manifest.id);
    yield* sidecars.stop(manifest.id);
    yield* PubSub.publish(changes, manifest.id);
    yield* save([...entries.filter((item) => item.manifest.id !== manifest.id), entry]);
    return entry;
  }, lock.withPermits(1));
  const request = Effect.fn("Plugins.request")(
    function* (input: PluginRequestInput) {
      const entries = yield* readRegistry();
      const entry = entries.find((item) => item.manifest.id === input.pluginId);
      if (!entry) return yield* new PluginError({ reason: "not-found" });
      if (["enable", "remove", "grant", "restart", "reload"].includes(input.action))
        yield* PubSub.publish(changes, input.pluginId);
      if (input.action === "release") {
        if (views.get(input.instanceId)?.pluginId === input.pluginId) {
          views.delete(input.instanceId);
          modelContext.release(input.instanceId);
        }
        return null;
      }
      if (input.action === "configure") {
        if (input.scope && !entry.grants?.projectIds.includes(input.scope.projectId))
          return yield* new PluginError({ reason: "permission-denied" });
        for (const [key, value] of Object.entries(input.configuration ?? {})) {
          const field = entry.manifest.configuration?.[key];
          if (!field || typeof field.default !== typeof value)
            return yield* new PluginError({ reason: "invalid-manifest" });
        }
        const { backgroundScope, ...rest } = entry;
        const scope = input.scope === undefined ? backgroundScope : input.scope;
        const configured = {
          ...rest,
          ...(scope ? { backgroundScope: scope } : {}),
          ...(input.configuration ? { configuration: input.configuration } : {}),
        };
        yield* stop(input.pluginId);
        revokeViews(input.pluginId);
        yield* PubSub.publish(changes, input.pluginId);
        yield* sidecars.stop(input.pluginId);
        yield* save(entries.map((item) => (item === entry ? configured : item)));
        yield* sidecars.start(configured);
        return null;
      }
      if (input.action === "grant") {
        if (
          input.grants.capabilities.some(
            (capability) => !entry.manifest.capabilities?.includes(capability),
          )
        )
          return yield* new PluginError({ reason: "permission-denied" });
        yield* save(
          entries.map((item) => (item === entry ? { ...entry, grants: input.grants } : item)),
        );
        revokeViews(input.pluginId);
        yield* sidecars.stop(input.pluginId);
        yield* sidecars.start({ ...entry, grants: input.grants });
        return null;
      }
      if (input.action === "diagnostics") return sidecars.inspect(input.pluginId);
      if (input.action === "enable" || input.action === "remove") {
        revokeViews(input.pluginId);
        yield* stop(input.pluginId);
        yield* sidecars.stop(input.pluginId);
        yield* save(
          input.action === "remove"
            ? entries.filter((item) => item !== entry)
            : entries.map((item) => (item === entry ? { ...entry, enabled: input.enabled } : item)),
        );
        if (input.action === "enable" && input.enabled)
          yield* sidecars.start({ ...entry, enabled: true });
        return null;
      }
      if (!entry.enabled) return yield* new PluginError({ reason: "disabled" });
      if (input.action === "restart" || input.action === "reload") {
        const manifest =
          input.action === "reload" ? yield* authoring.validate(entry.directory) : entry.manifest;
        if (manifest.id !== entry.manifest.id)
          return yield* new PluginError({ reason: "invalid-manifest" });
        const updated = {
          ...entry,
          manifest,
          ...(entry.grants
            ? {
                grants: {
                  ...entry.grants,
                  capabilities: entry.grants.capabilities.filter((capability) =>
                    manifest.capabilities?.includes(capability),
                  ),
                },
              }
            : {}),
        };
        yield* save(entries.map((item) => (item === entry ? updated : item)));
        revokeViews(input.pluginId);
        yield* stop(input.pluginId);
        yield* sidecars.stop(input.pluginId);
        yield* sidecars.start(updated);
        return null;
      }
      if (input.action === "launch") {
        const view = entry.manifest.views.find((view) => view.id === input.viewId);
        if (!view) return yield* new PluginError({ reason: "not-found" });
        const launch = {
          id: yield* randomUuidV4,
          pluginId: input.pluginId,
          viewId: input.viewId,
          title: view.title,
          scope: input.scope,
        };
        yield* PubSub.publish(launches, launch);
        return launch;
      }
      const client = yield* connect(entry);
      if (input.action === "resource")
        return yield* client
          .readResource({ uri: input.uri }, { timeout: "15 seconds" })
          .pipe(Effect.flatMap(encodeResource), Effect.mapError(failure));
      const tools = yield* client.listTools().pipe(Effect.mapError(failure));
      const view =
        input.action === "open"
          ? entry.manifest.views.find((view) => view.id === input.viewId)
          : undefined;
      const tool = tools.find(
        (tool) => tool.name === (input.action === "open" ? view?.tool : input.name),
      );
      if (!tool || !mcpAppToolCallableByApp(tool._meta))
        return yield* new PluginError({ reason: "not-found" });
      const result = yield* client
        .callTool(
          {
            tool,
            arguments:
              input.action === "call"
                ? input.arguments
                : input.scope
                  ? { _phoenix: input.scope }
                  : {},
          },
          { timeout: "30 seconds" },
        )
        .pipe(Effect.mapError(failure));
      const wireResult = yield* encodeResult(result).pipe(Effect.mapError(failure));
      if (input.action === "call") return wireResult;
      const meta = Option.getOrUndefined(readUiMetadata(tool._meta));
      const uri = meta?.ui.resourceUri;
      if (!uri?.startsWith("ui://")) return yield* new PluginError({ reason: "request-failed" });
      const resource = yield* client
        .readResource({ uri }, { timeout: "15 seconds" })
        .pipe(Effect.mapError(failure));
      const html = resource.contents.find((content) => "text" in content && content.uri === uri);
      if (!html || !("text" in html)) return yield* new PluginError({ reason: "request-failed" });
      let instanceId: string | undefined;
      if (input.action === "open" && input.scope) {
        if ((view?.scope ?? "thread") === "thread" && !input.scope.threadId)
          return yield* new PluginError({ reason: "stale-view" });
        instanceId = `${input.pluginId}:${yield* randomUuidV4}`;
        if (views.size >= 256) {
          const oldest = views.keys().next().value!;
          views.delete(oldest);
          modelContext.release(oldest);
        }
        views.set(instanceId, { pluginId: input.pluginId, scope: input.scope });
      }
      return {
        ...(instanceId ? { instanceId } : {}),
        capabilities:
          input.action === "open" &&
          input.scope &&
          entry.grants?.projectIds.includes(input.scope.projectId)
            ? entry.grants.capabilities
            : [],
        html: html.text,
        resourceUri: uri,
        tool: yield* encodeTool(tool).pipe(Effect.mapError(failure)),
        result: wireResult,
      };
    },
    (effect, input) => lock.withPermits(1)(effect.pipe(Effect.onError(() => stop(input.pluginId)))),
  );
  const withView: Plugins["Service"]["withView"] = Effect.fn("Plugins.withView")(function* (
    input,
    capability,
    use,
  ) {
    const entry = (yield* readRegistry()).find((entry) => entry.manifest.id === input.pluginId);
    if (!entry?.enabled) return yield* new PluginError({ reason: "disabled" });
    const view = views.get(input.instanceId);
    if (!view || view.pluginId !== input.pluginId)
      return yield* new PluginError({ reason: "stale-view" });
    if (
      capability !== undefined &&
      (!entry.grants?.capabilities.includes(capability) ||
        !entry.grants.projectIds.includes(view.scope.projectId))
    )
      return yield* new PluginError({ reason: "permission-denied" });
    return yield* use(view.scope);
  }, lock.withPermits(1));
  const notified = new Set<string>();
  const notify = Effect.fn("Plugins.notify")(function* (event: PluginCompletion) {
    if (notified.has(event.runId)) return;
    notified.add(event.runId);
    if (notified.size > 1024) notified.delete(notified.values().next().value!);
    for (const entry of yield* readRegistry().pipe(Effect.orElseSucceed(() => []))) {
      const scope = entry.backgroundScope;
      if (
        !entry.enabled ||
        !scope ||
        !entry.grants?.capabilities.includes("context") ||
        !entry.grants.projectIds.includes(scope.projectId)
      )
        continue;
      if (
        scope.projectId !== event.projectId ||
        (scope.threadId && scope.threadId !== event.threadId)
      )
        continue;
      yield* sidecars.send(entry.manifest.id, {
        type: "thread.completed",
        projectId: event.projectId,
        threadId: event.threadId,
        runId: event.runId,
        completedAt: event.completedAt,
      });
    }
  }, lock.withPermits(1));
  for (const entry of yield* readRegistry().pipe(Effect.orElseSucceed(() => [])))
    yield* sidecars.start(entry);
  return Plugins.of({
    changes: Stream.fromPubSub(changes),
    list,
    install,
    request,
    withView,
    notify,
    subscribe: (threadId) =>
      Stream.fromPubSub(launches).pipe(Stream.filter((event) => event.scope.threadId === threadId)),
  });
});
export const layer = Layer.effect(Plugins, make).pipe(
  Layer.provide(
    Layer.mergeAll(PluginSidecars.layer, PluginModelContext.layer, PluginAuthoring.layer),
  ),
);

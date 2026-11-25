import { type PluginInstallation, type PluginRuntime } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";
import { ServerConfig } from "../config.ts";

export class PluginSidecars extends Context.Service<
  PluginSidecars,
  {
    readonly send: (id: string, event: Schema.Json) => Effect.Effect<void>;
    readonly start: (entry: PluginInstallation) => Effect.Effect<void>;
    readonly stop: (id: string) => Effect.Effect<void>;
    readonly inspect: (id: string) => { readonly sidecar: PluginRuntime; readonly logs: string };
    readonly append: (id: string, text: string) => void;
    readonly changes: Stream.Stream<{ readonly pluginId: string; readonly runtime: PluginRuntime }>;
  }
>()("t3/plugins/PluginSidecars") {}

const encodeScope = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const encodeEvent = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const owner = yield* Scope.Scope;
  const changes = yield* PubSub.sliding<{ pluginId: string; runtime: PluginRuntime }>(64);
  const inputs = new Map<string, Queue.Queue<string>>();
  const active = new Map<string, Scope.Closeable>();
  const states = new Map<string, PluginRuntime>();
  const logs = new Map<string, string>();
  const append = (id: string, text: string) => {
    logs.set(id, ((logs.get(id) ?? "") + text).slice(-32_768));
  };
  const set = Effect.fn("PluginSidecars.set")(function* (pluginId: string, runtime: PluginRuntime) {
    states.set(pluginId, runtime);
    yield* PubSub.publish(changes, { pluginId, runtime });
  });
  const stop = Effect.fn("PluginSidecars.stop")(function* (id: string) {
    const scope = active.get(id);
    active.delete(id);
    inputs.delete(id);
    if (scope) yield* Scope.close(scope, Exit.void);
    yield* set(id, { state: "stopped", restarts: 0 });
  });
  const start = Effect.fn("PluginSidecars.start")(function* (entry: PluginInstallation) {
    const id = entry.manifest.id;
    const command = entry.manifest.sidecar;
    if (!entry.enabled || !command || active.has(id)) return;
    const scope = yield* Scope.fork(owner, "sequential");
    active.set(id, scope);
    const input = yield* Queue.sliding<string>(64);
    inputs.set(id, input);
    const supervise = Effect.gen(function* () {
      let restarts = 0;
      while (active.get(id) === scope) {
        yield* set(id, { state: "starting", restarts });
        const started = yield* Clock.currentTimeMillis;
        const attempt = yield* Effect.gen(function* () {
          const data = path.join(config.stateDir, "plugins", "data", id);
          yield* fs.makeDirectory(data, { recursive: true });
          const child = yield* spawner.spawn(
            ChildProcess.make(command.command, [...command.args], {
              cwd: entry.directory,
              env: {
                PHOENIX_PLUGIN_DATA: data,
                PHOENIX_PLUGIN_ROOT: entry.directory,
                PHOENIX_PLUGIN_BASE_DIR: config.baseDir,
                PHOENIX_PLUGIN_SCOPE: yield* encodeScope(entry.backgroundScope ?? null),
                PHOENIX_PLUGIN_CONFIG: yield* encodeScope({
                  ...Object.fromEntries(
                    Object.entries(entry.manifest.configuration ?? {}).map(([key, field]) => [
                      key,
                      field.default,
                    ]),
                  ),
                  ...entry.configuration,
                }),
              },
              stdin: { stream: Stream.fromQueue(input).pipe(Stream.encodeText), endOnDone: true },
              stdout: "pipe",
              stderr: "pipe",
            }),
          );
          yield* set(id, { state: "ready", restarts, pid: Number(child.pid) });
          const output = yield* child.all.pipe(
            Stream.decodeText(),
            Stream.runForEach((chunk) => Effect.sync(() => append(id, chunk))),
            Effect.ignore,
            Effect.forkScoped,
          );
          const code = Number(yield* child.exitCode);
          // Drain final output before publishing the terminal state.
          yield* Fiber.join(output);
          return code;
        }).pipe(Effect.scoped, Effect.result);
        const exitCode = attempt._tag === "Success" ? attempt.success : undefined;
        append(
          id,
          exitCode === undefined
            ? "\nSidecar could not start.\n"
            : `\nSidecar exited (${exitCode}).\n`,
        );
        if (exitCode === 0 || command.restart === "never") {
          yield* set(id, {
            state: exitCode === 0 ? "stopped" : "failed",
            restarts,
            ...(exitCode === undefined ? {} : { exitCode }),
          });
          return;
        }
        if ((yield* Clock.currentTimeMillis) - started >= 60_000) restarts = 0;
        if (restarts >= 5) {
          yield* set(id, {
            state: "failed",
            restarts,
            ...(exitCode === undefined ? {} : { exitCode }),
          });
          return;
        }
        yield* set(id, {
          state: "backoff",
          restarts,
          ...(exitCode === undefined ? {} : { exitCode }),
        });
        yield* Effect.sleep(Math.min(1_000 * 2 ** restarts, 30_000));
        restarts += 1;
      }
    });
    yield* Effect.forkIn(supervise, scope);
  });
  return PluginSidecars.of({
    start,
    stop,
    append,
    send: Effect.fn("PluginSidecars.send")(function* (id, event) {
      const input = inputs.get(id);
      if (input) yield* Queue.offer(input, `${yield* encodeEvent(event).pipe(Effect.orDie)}\n`);
    }),
    inspect: (id) => ({
      sidecar: states.get(id) ?? { state: "stopped", restarts: 0 },
      logs: logs.get(id) ?? "",
    }),
    changes: Stream.fromPubSub(changes),
  });
});
export const layer = Layer.effect(PluginSidecars, make);

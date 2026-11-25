import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { PluginInstallation } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";
import { ServerConfig } from "../config.ts";
import * as PluginSidecars from "./PluginSidecars.ts";

const entry: PluginInstallation = {
  directory: "/plugin",
  enabled: true,
  manifest: {
    apiVersion: 1,
    id: "test",
    name: "Test",
    version: "1",
    views: [],
    server: { command: "node", args: [] },
    sidecar: { command: "node", args: [], restart: "on-failure" },
  },
};

it.effect(
  "shares an enabled sidecar, recovers with bounded backoff, and stops during backoff",
  () =>
    Effect.gen(function* () {
      const exits = yield* Queue.unbounded<Deferred.Deferred<ChildProcessSpawner.ExitCode>>();
      let spawned = 0;
      let stopped = 0;
      const spawner = ChildProcessSpawner.make(() =>
        Effect.acquireRelease(
          Effect.gen(function* () {
            const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
            yield* Queue.offer(exits, exit);
            spawned += 1;
            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(spawned),
              exitCode: Deferred.await(exit),
              isRunning: Effect.succeed(true),
              kill: () => Effect.void,
              unref: Effect.succeed(Effect.void),
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.make(new TextEncoder().encode("x".repeat(40_000))),
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
            });
          }),
          () =>
            Effect.sync(() => {
              stopped += 1;
            }),
        ),
      );
      yield* Effect.gen(function* () {
        const runtime = yield* PluginSidecars.PluginSidecars;
        const events = yield* Stream.toQueue(runtime.changes, { capacity: 64 });
        yield* Effect.all([runtime.start(entry), runtime.start(entry)]);
        const exit = yield* Queue.take(exits);
        yield* Deferred.succeed(exit, ChildProcessSpawner.ExitCode(1));
        // Consume state events rather than waiting for wall-clock execution.
        const waitFor = Effect.fn("test.waitFor")(function* (state: string) {
          while (true) {
            const event = yield* Queue.take(events);
            if (event.runtime.state === state) return event.runtime;
          }
        });
        yield* waitFor("backoff");
        assert.strictEqual(spawned, 1);
        assert.strictEqual(stopped, 1);
        assert.isAtMost(runtime.inspect("test").logs.length, 32_768);
        yield* TestClock.adjust("1 second");
        const second = yield* Queue.take(exits);
        yield* waitFor("ready");
        assert.strictEqual(spawned, 2);
        yield* Deferred.succeed(second, ChildProcessSpawner.ExitCode(1));
        yield* waitFor("backoff");
        yield* runtime.stop("test");
        yield* TestClock.adjust("1 minute");
        assert.strictEqual(spawned, 2);
        assert.strictEqual(stopped, 2);
        assert.strictEqual(runtime.inspect("test").sidecar.state, "stopped");
      }).pipe(
        Effect.provide(PluginSidecars.layer),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "phoenix-sidecar-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
      Effect.scoped,
    ),
);

it.effect("stops a crash loop after five retries until explicitly restarted", () =>
  Effect.gen(function* () {
    let spawned = 0;
    const spawner = ChildProcessSpawner.make(() =>
      Effect.sync(() => {
        spawned += 1;
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(spawned),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(2)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        });
      }),
    );
    yield* Effect.gen(function* () {
      const runtime = yield* PluginSidecars.PluginSidecars;
      const events = yield* Stream.toQueue(runtime.changes, { capacity: 64 });
      yield* runtime.start(entry);
      for (let retry = 0; retry < 5; retry += 1) {
        let state: string;
        do {
          state = (yield* Queue.take(events)).runtime.state;
        } while (state !== "backoff");
        yield* TestClock.adjust(1_000 * 2 ** retry);
      }
      let state: string;
      do {
        state = (yield* Queue.take(events)).runtime.state;
      } while (state !== "failed");
      yield* TestClock.adjust("1 hour");
      assert.strictEqual(spawned, 6);
      assert.strictEqual(runtime.inspect("test").sidecar.restarts, 5);
      yield* runtime.stop("test");
    }).pipe(
      Effect.provide(PluginSidecars.layer),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "phoenix-sidecar-loop-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  ),
);

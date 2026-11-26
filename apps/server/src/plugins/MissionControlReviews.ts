import { IsoDateTime, PluginError, RunId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../config.ts";

// Agents can settle threads too. The native settlement timestamp invalidates this human
// review when a thread is reopened elsewhere and later settled again.
const Review = Schema.Struct({
  threadId: ThreadId,
  runId: RunId,
  acceptedAt: IsoDateTime,
  settledAt: IsoDateTime,
});
type Review = typeof Review.Type;
const Reviews = Schema.Array(Review).check(Schema.isMaxLength(4096));
const decodeReviews = Schema.decodeEffect(Schema.fromJsonString(Reviews));
const encodeReviews = Schema.encodeEffect(Schema.fromJsonString(Reviews));

export class MissionControlReviews extends Context.Service<
  MissionControlReviews,
  {
    readonly read: () => Effect.Effect<ReadonlyArray<Review>, PluginError>;
    readonly accept: (review: Review) => Effect.Effect<void, PluginError>;
    readonly reopen: (threadId: ThreadId) => Effect.Effect<void, PluginError>;
  }
>()("t3/plugins/MissionControlReviews") {}

export const make = Effect.gen(function* () {
  const storage = yield* KeyValueStore.KeyValueStore;
  const lock = yield* Semaphore.make(1);
  let cached: ReadonlyArray<Review> | undefined;
  const failure = (cause: unknown) => new PluginError({ reason: "request-failed", cause });
  const read = Effect.fn("MissionControlReviews.load")(function* () {
    if (cached) return cached;
    const saved = yield* storage.get("accepted-runs");
    cached = saved === undefined ? [] : yield* decodeReviews(saved);
    return cached;
  }, Effect.mapError(failure));
  const save = Effect.fn("MissionControlReviews.save")(function* (entries: ReadonlyArray<Review>) {
    const bounded = entries.slice(-4096);
    yield* storage.set("accepted-runs", yield* encodeReviews(bounded));
    cached = bounded;
  }, Effect.mapError(failure));
  const accept = Effect.fn("MissionControlReviews.accept")(function* (review: Review) {
    yield* save([...(yield* read()).filter((entry) => entry.threadId !== review.threadId), review]);
  }, lock.withPermits(1));
  const reopen = Effect.fn("MissionControlReviews.reopen")(function* (threadId: ThreadId) {
    yield* save((yield* read()).filter((entry) => entry.threadId !== threadId));
  }, lock.withPermits(1));
  return MissionControlReviews.of({
    read: Effect.fn("MissionControlReviews.read")(() => lock.withPermits(1)(read())),
    accept,
    reopen,
  });
});

export const layerMemory = Layer.effect(MissionControlReviews, make).pipe(
  Layer.provide(KeyValueStore.layerMemory),
);
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    return Layer.effect(MissionControlReviews, make).pipe(
      Layer.provide(
        KeyValueStore.layerFileSystem(
          path.join(config.stateDir, "plugins", "mission-control-reviews"),
        ),
      ),
    );
  }),
);

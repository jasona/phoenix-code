import { assert, it } from "@effect/vitest";
import { IsoDateTime, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import * as Reviews from "./MissionControlReviews.ts";

const acceptedAt = IsoDateTime.make("2026-11-25T12:00:00.000Z");
const review = {
  threadId: ThreadId.make("thread"),
  runId: RunId.make("run"),
  acceptedAt,
  settledAt: acceptedAt,
};

it.effect("persists human acceptance across service recreation and removes it on reopen", () =>
  Effect.gen(function* () {
    const first = yield* Reviews.make;
    yield* first.accept(review);
    const recreated = yield* Reviews.make;
    assert.deepStrictEqual(yield* recreated.read(), [review]);
    yield* recreated.reopen(review.threadId);
    assert.deepStrictEqual(yield* (yield* Reviews.make).read(), []);
  }).pipe(Effect.provide(KeyValueStore.layerMemory)),
);

it.effect(
  "serializes concurrent reviews and replaces the marker when the accepted run changes",
  () =>
    Effect.gen(function* () {
      const service = yield* Reviews.make;
      yield* Effect.all(
        [service.accept(review), service.accept({ ...review, threadId: ThreadId.make("another") })],
        { concurrency: 2 },
      );
      assert.strictEqual((yield* service.read()).length, 2);
      yield* service.accept({ ...review, runId: RunId.make("new-run") });
      const saved = yield* (yield* Reviews.make).read();
      assert.strictEqual(saved.length, 2);
      assert.strictEqual(
        saved.find((entry) => entry.threadId === review.threadId)?.runId,
        "new-run",
      );
    }).pipe(Effect.provide(KeyValueStore.layerMemory)),
);

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  createMissionControlDraftStorage,
  isMissionControlDraftOperation,
} from "./missionControlDrafts.ts";

function fixture() {
  const records = new Map<string, string>();
  const storage = {
    getAllKeys: () => [...records.keys()],
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
    removeItem: (key: string) => {
      records.delete(key);
    },
  };
  return { storage, records, drafts: createMissionControlDraftStorage(storage) };
}

const environmentA = EnvironmentId.make("environment-a");
const environmentB = EnvironmentId.make("environment-b");
const threadA = ThreadId.make("thread-a");
const threadB = ThreadId.make("thread-b");

describe("Mission Control host drafts", () => {
  it("tracks a send after the original view closes and clears its draft before a reopened view can resend", async () => {
    const { drafts } = fixture();
    const response = Promise.withResolvers<{ accepted: boolean }>();
    const started = Promise.withResolvers<void>();
    await drafts.request(environmentA, {
      type: "missionControlDraft",
      action: "write",
      threadId: threadA,
      text: "  Original reply  ",
    });
    const sending = drafts.submit(environmentA, threadA, "Original reply", () => {
      started.resolve();
      return response.promise;
    });
    await started.promise;
    expect(
      await drafts.request(environmentA, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadA,
      }),
    ).toEqual({ text: "  Original reply  ", sending: true });
    let duplicateSent = false;
    await expect(
      drafts.submit(environmentA, threadA, "Original reply", async () => {
        duplicateSent = true;
      }),
    ).rejects.toThrow("already being sent");
    expect(duplicateSent).toBe(false);
    expect(
      await drafts.request(environmentB, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadA,
      }),
    ).toEqual({ text: "", sending: false });
    response.resolve({ accepted: true });
    expect(await sending).toEqual({ accepted: true });
    expect(
      await drafts.request(environmentA, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadA,
      }),
    ).toEqual({ text: "", sending: false });
  });

  it("keeps the draft and releases a reopened view after a failed host submission", async () => {
    const { drafts } = fixture();
    const response = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    await drafts.request(environmentA, {
      type: "missionControlDraft",
      action: "write",
      threadId: threadA,
      text: "Retry this reply",
    });
    const sending = drafts.submit(environmentA, threadA, "Retry this reply", () => {
      started.resolve();
      return response.promise;
    });
    await started.promise;
    expect(
      await drafts.request(environmentA, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadA,
      }),
    ).toEqual({ text: "Retry this reply", sending: true });
    response.reject(new Error("Disconnected"));
    await expect(sending).rejects.toThrow("Disconnected");
    expect(
      await drafts.request(environmentA, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadA,
      }),
    ).toEqual({ text: "Retry this reply", sending: false });
    await drafts.submit(environmentA, threadA, "Retry this reply", async () => {});
    expect(
      await drafts.request(environmentA, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadA,
      }),
    ).toEqual({ text: "", sending: false });
  });

  it.each(["A newer reply", "Original reply"])(
    "preserves newer typing (%s) from a reopened view during a send",
    async (newText) => {
      const { drafts } = fixture();
      const response = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      await drafts.request(environmentA, {
        type: "missionControlDraft",
        action: "write",
        threadId: threadA,
        text: "Original reply",
      });
      const sending = drafts.submit(environmentA, threadA, "Original reply", () => {
        started.resolve();
        return response.promise;
      });
      await started.promise;
      await drafts.request(environmentA, {
        type: "missionControlDraft",
        action: "write",
        threadId: threadA,
        text: "Intermediate typing",
      });
      await drafts.request(environmentA, {
        type: "missionControlDraft",
        action: "write",
        threadId: threadA,
        text: newText,
      });
      response.resolve();
      await sending;
      expect(
        await drafts.request(environmentA, {
          type: "missionControlDraft",
          action: "read",
          threadId: threadA,
        }),
      ).toEqual({ text: newText, sending: false });
    },
  );

  it("restores drafts after reopening and separates environments and threads", async () => {
    const { drafts, storage } = fixture();
    for (const [environmentId, threadId, text] of [
      [environmentA, threadA, "First environment"],
      [environmentB, threadA, "Second environment"],
      [environmentA, threadB, "Different thread"],
    ] as const) {
      await drafts.request(environmentId, {
        type: "missionControlDraft",
        action: "write",
        threadId,
        text,
      });
    }
    const reopened = createMissionControlDraftStorage(storage);
    expect(
      await reopened.request(environmentA, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadA,
      }),
    ).toMatchObject({ text: "First environment" });
    expect(
      await reopened.request(environmentB, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadA,
      }),
    ).toMatchObject({ text: "Second environment" });
    expect(
      await reopened.request(environmentA, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadB,
      }),
    ).toMatchObject({ text: "Different thread" });
  });

  it("serializes native storage writes and only clears the exact submitted draft", async () => {
    const { storage } = fixture();
    const firstWrite = Promise.withResolvers<void>();
    const firstWriteStarted = Promise.withResolvers<void>();
    const drafts = createMissionControlDraftStorage({
      ...storage,
      async setItem(key, text) {
        if (text === "Sent draft") {
          firstWriteStarted.resolve();
          await firstWrite.promise;
        }
        storage.setItem(key, text);
      },
    });
    const initial = drafts.request(environmentA, {
      type: "missionControlDraft",
      action: "write",
      threadId: threadA,
      text: "Sent draft",
    });
    await firstWriteStarted.promise;
    const edited = drafts.request(environmentA, {
      type: "missionControlDraft",
      action: "write",
      threadId: threadA,
      text: "New typing",
    });
    const cleared = drafts.request(environmentA, {
      type: "missionControlDraft",
      action: "clear",
      threadId: threadA,
      expectedText: "Sent draft",
    });
    firstWrite.resolve();
    await Promise.all([initial, edited]);
    expect(await cleared).toMatchObject({ text: "New typing" });
    expect(
      await drafts.request(environmentA, {
        type: "missionControlDraft",
        action: "clear",
        threadId: threadA,
        expectedText: "New typing",
      }),
    ).toMatchObject({ text: "" });
    expect(
      await drafts.request(environmentA, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadA,
      }),
    ).toMatchObject({ text: "" });
  });

  it("reports a storage failure and lets later writes recover", async () => {
    const { storage } = fixture();
    const drafts = createMissionControlDraftStorage({
      ...storage,
      setItem(key, text) {
        if (text === "Failed draft") throw new Error("Storage unavailable");
        storage.setItem(key, text);
      },
    });
    const failed = drafts.request(environmentA, {
      type: "missionControlDraft",
      action: "write",
      threadId: threadA,
      text: "Failed draft",
    });
    const recovered = drafts.request(environmentA, {
      type: "missionControlDraft",
      action: "write",
      threadId: threadA,
      text: "Recovered draft",
    });
    await expect(failed).rejects.toThrow("Storage unavailable");
    expect(await recovered).toMatchObject({ text: "Recovered draft" });
  });

  it("forgetting an environment clears its drafts after pending saves without clearing other data", async () => {
    const { storage, records } = fixture();
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const drafts = createMissionControlDraftStorage({
      ...storage,
      async setItem(key, text) {
        if (text === "Pending draft") {
          started.resolve();
          await finish.promise;
        }
        storage.setItem(key, text);
      },
    });
    await drafts.request(environmentB, {
      type: "missionControlDraft",
      action: "write",
      threadId: threadA,
      text: "Keep other environment",
    });
    await drafts.request(environmentA, {
      type: "missionControlDraft",
      action: "write",
      threadId: threadB,
      text: "Remove saved draft",
    });
    records.set("normal-workspace-draft", "Keep separate store");
    const saving = drafts.request(environmentA, {
      type: "missionControlDraft",
      action: "write",
      threadId: threadA,
      text: "Pending draft",
    });
    await started.promise;
    const forgetting = drafts.clearEnvironment(environmentA);
    finish.resolve();
    await Promise.all([saving, forgetting]);
    const reopened = createMissionControlDraftStorage(storage);
    expect(
      await reopened.request(environmentA, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadA,
      }),
    ).toMatchObject({ text: "" });
    expect(
      await reopened.request(environmentA, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadB,
      }),
    ).toMatchObject({ text: "" });
    expect(
      await reopened.request(environmentB, {
        type: "missionControlDraft",
        action: "read",
        threadId: threadA,
      }),
    ).toMatchObject({ text: "Keep other environment" });
    expect(records.get("normal-workspace-draft")).toBe("Keep separate store");
  });

  it("rejects malformed or oversized untrusted bridge operations", () => {
    expect(
      isMissionControlDraftOperation({
        type: "missionControlDraft",
        action: "write",
        threadId: threadA,
      }),
    ).toBe(false);
    expect(
      isMissionControlDraftOperation({
        type: "missionControlDraft",
        action: "write",
        threadId: threadA,
        text: "a".repeat(262_145),
      }),
    ).toBe(false);
    expect(
      isMissionControlDraftOperation({
        type: "missionControlDraft",
        action: "clear",
        threadId: threadA,
        expectedText: "Exact text",
      }),
    ).toBe(true);
  });
});

import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { createMissionControlDrafts } from "./ui/drafts.js";

function fixture() {
  const saved = new Map();
  const errors = [];
  const storage = {
    async read(threadId) {
      return { text: saved.get(threadId) ?? "" };
    },
    async write(threadId, text) {
      saved.set(threadId, text);
    },
    async clear(threadId, expectedText) {
      if (saved.get(threadId) === expectedText) saved.delete(threadId);
    },
  };
  return {
    saved,
    errors,
    storage,
    drafts: createMissionControlDrafts(storage, (e) => errors.push(e)),
  };
}

NodeTest.test("drafts survive switching threads and reopening the plugin", async () => {
  const { drafts, storage } = fixture();
  await drafts.set("thread-a", "First reply");
  await drafts.set("thread-b", "Second reply");
  NodeAssert.equal(await drafts.load("thread-a"), "First reply");
  NodeAssert.equal(await drafts.load("thread-b"), "Second reply");
  const reopened = createMissionControlDrafts(storage);
  NodeAssert.equal(await reopened.load("thread-b"), "Second reply");
  NodeAssert.equal(await reopened.load("thread-a"), "First reply");
});

NodeTest.test(
  "a late restored draft cannot replace text typed while storage was loading",
  async () => {
    const restored = Promise.withResolvers();
    const { storage } = fixture();
    const drafts = createMissionControlDrafts({ ...storage, read: () => restored.promise });
    const loading = drafts.load("thread-a");
    await drafts.set("thread-a", "New typing");
    restored.resolve({ text: "Old saved draft" });
    NodeAssert.equal(await loading, "New typing");
  },
);

NodeTest.test(
  "sending captures the destination and keeps edits made before the response",
  async () => {
    const { drafts, storage, saved } = fixture();
    const response = Promise.withResolvers();
    await drafts.set("thread-a", "  Original reply  ");
    const sent = drafts.send("thread-a", async (message) => {
      NodeAssert.equal(message, "Original reply");
      await response.promise;
    });
    NodeAssert.equal(drafts.isSending("thread-a"), true);
    await drafts.set("thread-b", "Unrelated draft");
    await drafts.set("thread-a", "Follow-up typed during send");
    response.resolve();
    await sent;
    NodeAssert.equal(drafts.isSending("thread-a"), false);
    NodeAssert.equal(saved.get("thread-a"), "Follow-up typed during send");
    NodeAssert.equal(saved.get("thread-b"), "Unrelated draft");
    const reopened = createMissionControlDrafts(storage);
    NodeAssert.equal(await reopened.load("thread-a"), "Follow-up typed during send");
  },
);

NodeTest.test("only a successfully sent unchanged local draft is cleared", async () => {
  const { drafts, saved } = fixture();
  await drafts.set("thread-a", "  Keep on failure  ");
  await NodeAssert.rejects(
    drafts.send("thread-a", async () => {
      throw new Error("Disconnected");
    }),
    /Disconnected/,
  );
  NodeAssert.equal(drafts.get("thread-a"), "  Keep on failure  ");
  NodeAssert.equal(saved.get("thread-a"), "  Keep on failure  ");
  await drafts.send("thread-a", async () => {});
  NodeAssert.equal(drafts.get("thread-a"), "");
});

NodeTest.test("a reopened composer stays busy until its host submission settles", async () => {
  const { storage, saved } = fixture();
  let sending = true;
  saved.set("thread-a", "Sent reply");
  const drafts = createMissionControlDrafts({
    ...storage,
    async read(threadId) {
      return { ...(await storage.read(threadId)), sending };
    },
  });
  NodeAssert.equal(await drafts.load("thread-a"), "Sent reply");
  NodeAssert.equal(drafts.isSending("thread-a"), true);
  const duplicate = await drafts.send("thread-a", async () => NodeAssert.fail("Must not resend"));
  NodeAssert.equal(duplicate, false);
  saved.delete("thread-a");
  sending = false;
  NodeAssert.equal(await drafts.load("thread-a"), "");
  NodeAssert.equal(drafts.isSending("thread-a"), false);
});

NodeTest.test("a reopened composer retains new typing as the host send finishes", async () => {
  const { storage, saved } = fixture();
  let sending = true;
  saved.set("thread-a", "Original reply");
  const drafts = createMissionControlDrafts({
    ...storage,
    async read(threadId) {
      return { ...(await storage.read(threadId)), sending };
    },
  });
  await drafts.load("thread-a");
  await drafts.set("thread-a", "Follow-up reply");
  sending = false;
  NodeAssert.equal(await drafts.load("thread-a"), "Follow-up reply");
  NodeAssert.equal(drafts.isSending("thread-a"), false);
});

NodeTest.test("storage errors preserve the in-memory draft and are reported", async () => {
  const { storage } = fixture();
  const errors = [];
  const drafts = createMissionControlDrafts(
    {
      ...storage,
      async write() {
        throw new Error("Storage full");
      },
    },
    (error) => errors.push(error.message),
  );
  await drafts.set("thread-a", "Keep this text");
  NodeAssert.equal(drafts.get("thread-a"), "Keep this text");
  NodeAssert.deepEqual(errors, ["Storage full"]);
});

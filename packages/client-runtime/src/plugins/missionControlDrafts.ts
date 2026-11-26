import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const DraftText = Schema.String.check(Schema.isMaxLength(262_144));
const MissionControlDraftOperation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("missionControlDraft"),
    action: Schema.Literal("read"),
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("missionControlDraft"),
    action: Schema.Literal("write"),
    threadId: ThreadId,
    text: DraftText,
  }),
  Schema.Struct({
    type: Schema.Literal("missionControlDraft"),
    action: Schema.Literal("clear"),
    threadId: ThreadId,
    expectedText: DraftText,
  }),
]);

export const isMissionControlDraftOperation = Schema.is(MissionControlDraftOperation);

const environmentPrefix = (environmentId: EnvironmentId) =>
  `phoenix:mission-control:draft:${JSON.stringify(environmentId)}:`;

export function createMissionControlDraftStorage(storage: {
  getAllKeys: () => ReadonlyArray<string> | Promise<ReadonlyArray<string>>;
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}) {
  const pending = new Map<string, Promise<unknown>>();
  const submissions = new Map<string, Promise<unknown>>();
  const revisions = new Map<string, number>();
  const draftKey = (environmentId: EnvironmentId, threadId: ThreadId) =>
    `${environmentPrefix(environmentId)}${threadId}`;
  const enqueue = <T>(key: string, perform: () => Promise<T>) => {
    // Native storage is asynchronous: an older save must settle before a newer edit or clear.
    const result = (pending.get(key) ?? Promise.resolve()).then(perform, perform);
    pending.set(key, result);
    const release = () => {
      if (pending.get(key) === result) pending.delete(key);
    };
    void result.then(release, release);
    return result;
  };
  return {
    request(environmentId: EnvironmentId, operation: typeof MissionControlDraftOperation.Type) {
      const key = draftKey(environmentId, operation.threadId);
      const perform = async () => {
        if (operation.action === "write") {
          if (operation.text) await storage.setItem(key, operation.text);
          else await storage.removeItem(key);
          if (submissions.has(key)) revisions.set(key, (revisions.get(key) ?? 0) + 1);
          return { text: operation.text };
        }
        const text = (await storage.getItem(key)) ?? "";
        if (operation.action === "clear" && text === operation.expectedText) {
          await storage.removeItem(key);
          return { text: "" };
        }
        return { text };
      };
      return enqueue(key, perform).then((saved) => ({ ...saved, sending: submissions.has(key) }));
    },
    submit<T>(
      environmentId: EnvironmentId,
      threadId: ThreadId,
      text: string,
      send: () => Promise<T>,
    ) {
      const key = draftKey(environmentId, threadId);
      if (submissions.has(key))
        return Promise.reject(new Error("A reply is already being sent to this thread."));
      // The host outlives its iframe, so closing Mission Control cannot abandon this send's draft.
      const result = Promise.resolve().then(async () => {
        const submitted = await enqueue(key, async () => ({
          text: (await storage.getItem(key)) ?? "",
          revision: revisions.get(key) ?? 0,
        }));
        const response = await send();
        if (submitted.text.trim() === text.trim()) {
          await enqueue(key, async () => {
            if (
              (revisions.get(key) ?? 0) === submitted.revision &&
              (await storage.getItem(key)) === submitted.text
            )
              await storage.removeItem(key);
          });
        }
        return response;
      });
      submissions.set(key, result);
      const release = () => {
        if (submissions.get(key) === result) submissions.delete(key);
        if (!submissions.has(key)) revisions.delete(key);
      };
      void result.then(release, release);
      return result;
    },
    async clearEnvironment(environmentId: EnvironmentId) {
      const prefix = environmentPrefix(environmentId);
      await Promise.allSettled(
        [...pending].filter(([key]) => key.startsWith(prefix)).map(([, write]) => write),
      );
      const keys = await storage.getAllKeys();
      await Promise.all(
        keys.filter((key) => key.startsWith(prefix)).map((key) => storage.removeItem(key)),
      );
    },
  };
}

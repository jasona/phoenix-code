export function createMissionControlDrafts(storage, onError = () => {}) {
  const entries = new Map();
  const entryFor = (threadId) => {
    if (!entries.has(threadId))
      entries.set(threadId, {
        text: "",
        version: 0,
        loaded: false,
        loading: null,
        sending: false,
        remoteSending: false,
      });
    return entries.get(threadId);
  };
  return {
    get(threadId) {
      return entryFor(threadId).text;
    },
    isSending(threadId) {
      const entry = entryFor(threadId);
      return entry.sending || entry.remoteSending;
    },
    async load(threadId) {
      const entry = entryFor(threadId);
      if (entry.loaded && !entry.remoteSending) return entry.text;
      if (!entry.loading) {
        const version = entry.version;
        entry.loading = storage
          .read(threadId)
          .then((saved) => {
            if (entry.version === version) entry.text = saved.text;
            entry.remoteSending = saved.sending === true;
            entry.loaded = true;
          }, onError)
          .finally(() => {
            entry.loading = null;
          });
      }
      await entry.loading;
      return entry.text;
    },
    async set(threadId, text) {
      const entry = entryFor(threadId);
      if (entry.loaded && entry.text === text) return;
      entry.text = text;
      entry.version++;
      entry.loaded = true;
      try {
        await storage.write(threadId, text);
      } catch (error) {
        onError(error);
      }
    },
    async send(threadId, submit) {
      const entry = entryFor(threadId);
      if (entry.sending || entry.remoteSending || !entry.text.trim()) return false;
      const text = entry.text;
      const version = entry.version;
      entry.sending = true;
      try {
        await submit(text.trim());
        entry.remoteSending = false;
        if (entry.version === version) {
          entry.text = "";
          entry.version++;
        }
        return true;
      } catch (error) {
        entry.loaded = false;
        throw error;
      } finally {
        entry.sending = false;
      }
    },
  };
}

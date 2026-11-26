(() => {
  let sequence = 0;
  let visible = true;
  const pending = new Map();
  function call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error("Phoenix did not respond. Check the connection and reopen Mission Control."),
        );
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }
  function context(value) {
    if (!value) return;
    const nextVisible =
      typeof value["phoenix/visible"] === "boolean" ? value["phoenix/visible"] : visible;
    if (nextVisible !== visible) {
      visible = nextVisible;
      window.dispatchEvent(new Event("phoenix-visibilitychange"));
    }
    if (value.theme === "light" || value.theme === "dark")
      document.documentElement.dataset.theme = value.theme;
    for (const [key, val] of Object.entries(value.styles?.variables ?? {})) {
      if (key.startsWith("--") && typeof val === "string")
        document.documentElement.style.setProperty(key, val);
    }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.jsonrpc !== "2.0") return;
    const message = event.data;
    if (message.method === "ui/notifications/host-context-changed") context(message.params);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const ready = call("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "mission-control", version: "1.0.0" },
    appCapabilities: {},
  }).then((result) => {
    context(result.hostContext);
    parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, "*");
  });
  async function request(params) {
    await ready;
    return call("phoenix/request", { type: "missionControl", request: params });
  }
  async function draftRequest(action, threadId, extra = {}) {
    await ready;
    return call("phoenix/request", { type: "missionControlDraft", action, threadId, ...extra });
  }
  window.phoenix = {
    get visible() {
      return visible;
    },
    ready,
    drafts: {
      read: (threadId) => draftRequest("read", threadId),
      write: (threadId, text) => draftRequest("write", threadId, { text }),
      clear: (threadId, expectedText) => draftRequest("clear", threadId, { expectedText }),
    },
    ui: {
      toggleConversation: (threadId) =>
        request({ action: "openThread", threadId }).catch((error) =>
          window.dispatchEvent(new CustomEvent("phoenix-error", { detail: error.message })),
        ),
    },
    async fetch(path, options = {}) {
      const url = new URL(path, "https://plugin.invalid");
      const body = options.body ? JSON.parse(options.body) : {};
      let input;
      switch (url.pathname) {
        case "/api/dashboard":
          input = { action: "snapshot", etag: url.searchParams.get("etag") || "" };
          break;
        case "/api/thread":
          input = { action: "detail", threadId: url.searchParams.get("id") };
          break;
        case "/api/usage":
          input = { action: "usage" };
          break;
        case "/api/seen":
          input = { action: "seen", threadId: body.threadId };
          break;
        case "/api/reply":
          input = {
            action: "reply",
            threadId: body.threadId,
            text: body.message,
            mode: body.sendMode || "queue",
            ...(body.expectedActiveRunId !== undefined
              ? { expectedActiveRunId: body.expectedActiveRunId }
              : {}),
          };
          break;
        case "/api/triage":
          input = { ...body, action: "triage" };
          break;
        case "/api/control":
          input = { ...body, action: "control" };
          break;
        case "/api/threads/new":
          input = {
            action: "create",
            projectId: body.projectId,
            title: body.title || "",
            text: body.prompt,
            ...(body.model ? { modelSelection: JSON.parse(body.model) } : {}),
          };
          break;
        default:
          throw new Error("This action is unavailable in Phoenix.");
      }
      const result = await request(input);
      return { ok: true, status: 200, json: async () => result };
    },
  };
})();

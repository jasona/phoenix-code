import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeTest from "node:test";
import * as NodeVM from "node:vm";

NodeTest.test("partial host updates preserve theme and hidden workspace state", async () => {
  const listeners = new Map();
  const parent = { postMessage() {} };
  const document = { documentElement: { dataset: {}, style: { setProperty() {} } } };
  const events = [];
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    dispatchEvent(event) {
      events.push(event);
    },
  };
  NodeVM.runInNewContext(NodeFS.readFileSync(new URL("./ui/phoenix.js", import.meta.url), "utf8"), {
    parent,
    document,
    window,
    Event,
    CustomEvent,
    setTimeout: () => 1,
    clearTimeout() {},
  });
  const receive = (data) =>
    listeners.get("message")({ source: parent, data: { jsonrpc: "2.0", ...data } });
  NodeAssert.equal(window.phoenix.ui.nativeThreadDialog, false);
  NodeAssert.equal(window.phoenix.ui.nativeNewThreadDialog, false);
  receive({
    id: 1,
    result: {
      hostContext: {
        theme: "light",
        "phoenix/visible": true,
        "phoenix/nativeThreadDialog": true,
        "phoenix/nativeNewThreadDialog": true,
      },
    },
  });
  await window.phoenix.ready;
  receive({
    method: "ui/notifications/host-context-changed",
    params: { "phoenix/visible": false },
  });
  NodeAssert.equal(window.phoenix.visible, false);
  NodeAssert.equal(window.phoenix.ui.nativeThreadDialog, true);
  NodeAssert.equal(window.phoenix.ui.nativeNewThreadDialog, true);
  NodeAssert.equal(document.documentElement.dataset.theme, "light");
  receive({
    method: "ui/notifications/host-context-changed",
    params: { containerDimensions: { width: 390, height: 844 } },
  });
  NodeAssert.equal(window.phoenix.visible, false);
  NodeAssert.equal(window.phoenix.ui.nativeThreadDialog, true);
  NodeAssert.equal(window.phoenix.ui.nativeNewThreadDialog, true);
  NodeAssert.equal(document.documentElement.dataset.theme, "light");
  receive({ method: "ui/notifications/host-context-changed", params: { "phoenix/visible": true } });
  NodeAssert.equal(window.phoenix.visible, true);
  receive({
    method: "ui/notifications/host-context-changed",
    params: {
      "phoenix/liveActivity": true,
      "phoenix/activity": { threadId: "selected", entries: [{ id: "streaming", body: "partial" }] },
    },
  });
  NodeAssert.equal(window.phoenix.activity.available, true);
  NodeAssert.equal(events.at(-1).type, "phoenix-activity");
  NodeAssert.equal(events.at(-1).detail.entries[0].body, "partial");
  receive({ method: "ui/notifications/host-context-changed", params: { theme: "light" } });
  NodeAssert.equal(window.phoenix.activity.available, true);
  NodeAssert.equal(document.documentElement.dataset.theme, "light");
  receive({
    method: "ui/notifications/host-context-changed",
    params: { "phoenix/nativeThreadDialog": false, "phoenix/nativeNewThreadDialog": false },
  });
  NodeAssert.equal(window.phoenix.ui.nativeThreadDialog, false);
  NodeAssert.equal(window.phoenix.ui.nativeNewThreadDialog, false);
});

NodeTest.test("native new threads preserve project intent and surface host errors", async () => {
  const listeners = new Map();
  const requests = [];
  const events = [];
  let failure;
  const parent = {
    postMessage(message) {
      if (!message.id) return;
      requests.push(message);
      queueMicrotask(() =>
        listeners.get("message")({
          source: parent,
          data: {
            jsonrpc: "2.0",
            id: message.id,
            ...(failure
              ? { error: { message: failure } }
              : {
                  result: message.method === "ui/initialize" ? { hostContext: {} } : { ok: true },
                }),
          },
        }),
      );
    },
  };
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    dispatchEvent: (event) => events.push(event),
  };
  NodeVM.runInNewContext(NodeFS.readFileSync(new URL("./ui/phoenix.js", import.meta.url), "utf8"), {
    parent,
    window,
    document: { documentElement: { dataset: {}, style: { setProperty() {} } } },
    Event,
    CustomEvent,
    setTimeout: () => 1,
    clearTimeout() {},
  });
  await window.phoenix.ui.openNewThread("chosen-project");
  NodeAssert.equal(requests.at(-1).method, "phoenix/request");
  NodeAssert.equal(requests.at(-1).params.type, "missionControlNewThread");
  NodeAssert.equal(requests.at(-1).params.projectId, "chosen-project");
  await window.phoenix.ui.openNewThread();
  NodeAssert.equal(requests.at(-1).params.type, "missionControlNewThread");
  NodeAssert.equal("projectId" in requests.at(-1).params, false);
  failure = "This project is no longer available.";
  await window.phoenix.ui.openNewThread("removed-project");
  NodeAssert.equal(events.at(-1).type, "phoenix-error");
  NodeAssert.equal(events.at(-1).detail, failure);
});

NodeTest.test("reply and triage forward the reviewed run and request identity", async () => {
  const listeners = new Map();
  const requests = [];
  const parent = {
    postMessage(message) {
      if (!message.id) return;
      requests.push(message);
      queueMicrotask(() =>
        listeners.get("message")({
          source: parent,
          data: {
            jsonrpc: "2.0",
            id: message.id,
            result: message.method === "ui/initialize" ? { hostContext: {} } : { ok: true },
          },
        }),
      );
    },
  };
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    dispatchEvent() {},
  };
  NodeVM.runInNewContext(NodeFS.readFileSync(new URL("./ui/phoenix.js", import.meta.url), "utf8"), {
    parent,
    window,
    document: { documentElement: { dataset: {}, style: { setProperty() {} } } },
    URL,
    Event,
    setTimeout: () => 1,
    clearTimeout() {},
  });
  await window.phoenix.fetch("/api/reply", {
    body: JSON.stringify({
      threadId: "thread",
      message: "Queue this",
      sendMode: "queue",
      expectedActiveRunId: null,
    }),
  });
  NodeAssert.equal(requests.at(-1).params.request.expectedActiveRunId, null);
  await window.phoenix.fetch("/api/triage", {
    body: JSON.stringify({
      threadId: "thread",
      disposition: "accept",
      expectedLatestRunId: "reviewed-run",
      expectedRequestId: "reviewed-request",
    }),
  });
  NodeAssert.equal(requests.at(-1).params.request.expectedLatestRunId, "reviewed-run");
  NodeAssert.equal(requests.at(-1).params.request.expectedRequestId, "reviewed-request");
});

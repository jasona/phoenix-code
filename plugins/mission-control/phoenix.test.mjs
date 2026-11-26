import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeTest from "node:test";
import * as NodeVM from "node:vm";

NodeTest.test("partial host updates preserve theme and hidden workspace state", async () => {
  const listeners = new Map();
  const parent = { postMessage() {} };
  const document = { documentElement: { dataset: {}, style: { setProperty() {} } } };
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    dispatchEvent() {},
  };
  NodeVM.runInNewContext(NodeFS.readFileSync(new URL("./ui/phoenix.js", import.meta.url), "utf8"), {
    parent,
    document,
    window,
    Event,
    setTimeout: () => 1,
    clearTimeout() {},
  });
  const receive = (data) =>
    listeners.get("message")({ source: parent, data: { jsonrpc: "2.0", ...data } });
  receive({ id: 1, result: { hostContext: { theme: "light", "phoenix/visible": true } } });
  await window.phoenix.ready;
  receive({
    method: "ui/notifications/host-context-changed",
    params: { "phoenix/visible": false },
  });
  NodeAssert.equal(window.phoenix.visible, false);
  NodeAssert.equal(document.documentElement.dataset.theme, "light");
  receive({
    method: "ui/notifications/host-context-changed",
    params: { containerDimensions: { width: 390, height: 844 } },
  });
  NodeAssert.equal(window.phoenix.visible, false);
  NodeAssert.equal(document.documentElement.dataset.theme, "light");
  receive({ method: "ui/notifications/host-context-changed", params: { "phoenix/visible": true } });
  NodeAssert.equal(window.phoenix.visible, true);
  NodeAssert.equal(document.documentElement.dataset.theme, "light");
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

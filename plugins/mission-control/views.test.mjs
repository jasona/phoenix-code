import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { renderInspectorContent } from "./ui/views/inspector.js";
import { renderInbox } from "./ui/views/inbox.js";
import { renderVerification } from "./ui/views/verification.js";

NodeTest.test(
  "acceptance targets the displayed run even when newer snapshot data is available",
  () => {
    const detail = {
      id: "thread",
      latestRunId: "reviewed-run",
      pendingRequestId: null,
      agentFinished: true,
    };
    const state = {
      inspectorTab: "activity",
      snap: { needsAttention: [{ threadId: "thread", latestRunId: "newer-run" }] },
    };
    NodeAssert.match(
      renderInspectorContent(detail, state, ""),
      /data-triage-action="accept"[^>]*data-run-id="reviewed-run"/,
    );
    const inbox = renderInbox(
      {
        needsAttention: [
          { threadId: "thread", latestRunId: "newer-run", category: "review", actions: ["accept"] },
        ],
      },
      {},
    );
    NodeAssert.match(inbox, /data-triage-action="accept"[^>]*data-run-id="newer-run"/);
  },
);

NodeTest.test(
  "evidence escapes tool output and keeps unknown verification separate from acceptance",
  () => {
    const html = renderVerification({
      id: "thread",
      agentFinished: true,
      accepted: false,
      verification: {
        freshness: "unknown",
        commands: [
          {
            id: "cmd",
            command: "printf '<script>'",
            output: "<script>alert(1)</script>",
            exitCode: 0,
            status: "passed",
          },
        ],
        counts: { passed: 1, failed: 0, running: 0, unknown: 0 },
      },
    });
    NodeAssert.doesNotMatch(html, /<script>/);
    NodeAssert.match(html, /&lt;script&gt;/);
    NodeAssert.match(html, /Not accepted/);
    NodeAssert.match(html, /Current revision not verified/);
    NodeAssert.match(html, /data-evidence-id="cmd"/);
  },
);

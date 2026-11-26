import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { renderBoard } from "./ui/views/board.js";
import { renderInspectorContent } from "./ui/views/inspector.js";
import { renderInbox } from "./ui/views/inbox.js";
import { renderOverview } from "./ui/views/overview.js";
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

NodeTest.test("live activity preserves multiline output and escapes provider text", async () => {
  const { renderActivityEntry } = await import("./ui/activity.js");
  const entry = {
    id: 'tool-"id',
    kind: "tool",
    label: "Command",
    body: "printf '<script>'\nresult <b>unsafe</b>",
    time: "2026-11-26T12:00:00Z",
    status: "running",
  };
  const running = renderActivityEntry(entry);
  NodeAssert.match(running, /<details open>/);
  NodeAssert.match(running, /is-active/);
  NodeAssert.match(running, /&lt;script&gt;/);
  NodeAssert.match(running, /\nresult &lt;b&gt;unsafe&lt;\/b&gt;/);
  NodeAssert.match(running, /data-activity-id="tool-&quot;id"/);
  NodeAssert.doesNotMatch(running, /<script>|<b>/);
  const completed = renderActivityEntry({ ...entry, status: "completed" });
  NodeAssert.doesNotMatch(completed, /is-active|<details open>/);
  const failed = renderActivityEntry({ ...entry, status: "failed" });
  NodeAssert.match(failed, /is-failed/);
});

NodeTest.test(
  "overview keeps active threads prominent and folds settled and team threads into an expandable shelf",
  () => {
    const snap = {
      mode: "live",
      needsAttention: [],
      projects: [
        {
          id: "proj-active",
          name: "phoenix",
          branch: "main",
          badge: { label: "1 Live", tone: "green" },
          threads: [
            {
              id: "live-1",
              title: "Ship Overview redesign",
              subtitle: "Working on styles.css",
              rightLabel: "Working",
              dotTone: "green",
              running: true,
              needsAttention: false,
            },
            {
              id: "acc-1",
              title: "Audit activity feed",
              subtitle: "3 team threads",
              rightLabel: "Accepted",
              accepted: true,
              hasTeam: true,
              swarmCount: 3,
              latestRunId: "run-1",
            },
            {
              id: "team-1",
              title: "/root/activity_data",
              subtitle: "No messages yet",
              rightLabel: "Idle",
              parentThreadId: "acc-1",
            },
          ],
        },
        {
          id: "proj-quiet",
          name: "busy-bar",
          branch: "main",
          badge: { label: "Idle", tone: "idle" },
          threads: [
            {
              id: "quiet-1",
              title: "Fix BUSY bar label",
              subtitle: "No messages yet",
              rightLabel: "Accepted",
              accepted: true,
            },
          ],
        },
      ],
    };

    const collapsed = renderOverview(snap, {
      filter: "all",
      search: "",
      selectedThreadId: "team-1",
      overviewExpandedProjects: new Set(),
      overviewExpandedQuiet: new Set(),
      overviewSettledTab: new Map(),
      overviewSettledLimit: new Map(),
    });
    NodeAssert.match(collapsed, /Ship Overview redesign/);
    NodeAssert.doesNotMatch(collapsed, /Audit activity feed/);
    NodeAssert.doesNotMatch(collapsed, /\/root\/activity_data/);
    NodeAssert.match(
      collapsed,
      /data-toggle-settled-project="proj-active"[^>]*aria-expanded="false"/,
    );
    NodeAssert.match(collapsed, /1 accepted · 1 team/);
    NodeAssert.match(collapsed, /mc-settled-selected-dot/);
    NodeAssert.match(collapsed, /Fix BUSY bar label/);
    NodeAssert.doesNotMatch(collapsed, /No messages yet/);

    const expanded = renderOverview(snap, {
      filter: "all",
      search: "",
      selectedThreadId: "team-1",
      overviewExpandedProjects: new Set(["proj-active"]),
      overviewExpandedQuiet: new Set(),
      overviewSettledTab: new Map([["proj-active", "conversations"]]),
      overviewSettledLimit: new Map(),
    });
    NodeAssert.match(expanded, /Audit activity feed/);
    NodeAssert.match(expanded, /data-triage-action="reopen"[^>]*data-thread-id="acc-1"/);
    NodeAssert.match(expanded, /data-settled-tab="proj-active:team"/);
    NodeAssert.doesNotMatch(expanded, /\/root\/activity_data/);

    const expandedTeam = renderOverview(snap, {
      filter: "all",
      search: "",
      selectedThreadId: "team-1",
      overviewExpandedProjects: new Set(["proj-active"]),
      overviewExpandedQuiet: new Set(),
      overviewSettledTab: new Map([["proj-active", "team"]]),
      overviewSettledLimit: new Map(),
    });
    NodeAssert.match(expandedTeam, /\/root\/activity_data/);

    const searchReveal = renderOverview(snap, {
      filter: "all",
      search: "activity_data",
      selectedThreadId: "",
      overviewExpandedProjects: new Set(),
      overviewExpandedQuiet: new Set(),
      overviewSettledTab: new Map(),
      overviewSettledLimit: new Map(),
    });
    NodeAssert.match(searchReveal, /\/root\/activity_data/);
    NodeAssert.doesNotMatch(searchReveal, /data-toggle-settled-project/);

    const hiddenSettled = renderOverview(snap, {
      filter: "all",
      search: "",
      selectedThreadId: "",
      overviewHideSettled: true,
      overviewExpandedProjects: new Set(),
      overviewExpandedQuiet: new Set(),
      overviewSettledTab: new Map(),
      overviewSettledLimit: new Map(),
    });
    NodeAssert.match(hiddenSettled, /Quiet projects/);
    NodeAssert.match(hiddenSettled, /data-toggle-quiet-project="proj-quiet"/);
    NodeAssert.doesNotMatch(hiddenSettled, /Fix BUSY bar label/);
  },
);

NodeTest.test("overview paginates large settled lists inside a project card", () => {
  const threads = Array.from({ length: 15 }, (_, idx) => ({
    id: `settled-${idx}`,
    title: `Finished task #${idx + 1}`,
    subtitle: "No messages yet",
    rightLabel: "Accepted",
    accepted: true,
  }));
  const snap = {
    mode: "live",
    needsAttention: [],
    projects: [{ id: "p1", name: "phoenix", threads }],
  };
  const collapsed = renderOverview(snap, {
    filter: "all",
    search: "",
    overviewExpandedProjects: new Set(),
    overviewSettledTab: new Map(),
    overviewSettledLimit: new Map(),
  });
  NodeAssert.match(collapsed, /Finished task #1/);
  NodeAssert.match(collapsed, /Finished task #2/);
  NodeAssert.doesNotMatch(collapsed, /Finished task #3/);
  NodeAssert.match(collapsed, /More settled/);

  const expanded = renderOverview(snap, {
    filter: "all",
    search: "",
    overviewExpandedProjects: new Set(["p1"]),
    overviewSettledTab: new Map(),
    overviewSettledLimit: new Map(),
  });
  NodeAssert.match(expanded, /Finished task #10/);
  NodeAssert.doesNotMatch(expanded, /Finished task #11/);
  NodeAssert.match(expanded, /Showing 8 of 13/);
  NodeAssert.match(expanded, /data-settled-more="p1"/);
});

NodeTest.test(
  "board separates done threads from team runs, suppresses boilerplate subtitles, and supports collapsing and pagination",
  () => {
    const doneConversations = Array.from({ length: 24 }, (_, idx) => ({
      id: `done-${idx + 1}`,
      title: `Completed work #${idx + 1}`,
      subtitle: "No messages yet",
      rightLabel: idx === 0 ? "Dismissed" : "Accepted",
      accepted: idx !== 0,
      dismissed: idx === 0,
      latestRunId: `run-${idx + 1}`,
      updatedAt: "2026-11-26T15:00:00Z",
    }));
    const doneTeamRuns = [
      {
        id: "team-child-1",
        title: "/root/activity_data",
        subtitle: "No messages yet",
        rightLabel: "Idle",
        parentThreadId: "done-2",
        updatedAt: "2026-11-26T14:30:00Z",
      },
      {
        id: "team-child-2",
        title: "/root/mobile_activity",
        subtitle: "No messages yet",
        rightLabel: "Idle",
        parentThreadId: "done-2",
        updatedAt: "2026-11-26T14:20:00Z",
      },
    ];
    const snap = {
      needsAttention: [
        {
          id: "att-1",
          threadId: "att-thread",
          category: "review",
          actions: ["review", "accept"],
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "crowbaros",
          branch: "feat/362-viewer",
          threads: [
            {
              id: "run-1",
              title: "Using the project's process, look at the issues",
              subtitle: "6 team threads",
              rightLabel: "Working",
              dotTone: "green",
              running: true,
              hasTeam: true,
              swarmCount: 6,
              updatedAt: "2026-11-26T15:45:00Z",
            },
            {
              id: "att-thread",
              title: "Ready for final review",
              subtitle: "Finished all checks",
              rightLabel: "Review ready",
              dotTone: "blue",
              needsAttention: true,
              latestRunId: "run-att",
            },
            ...doneConversations,
            ...doneTeamRuns,
          ],
        },
      ],
      timeline: [],
    };

    const defaultHtml = renderBoard(snap, {
      filter: "all",
      search: "",
      selectedThreadId: "team-child-1",
      boardDoneCollapsed: false,
      boardDoneTab: "threads",
      boardDoneLimit: 20,
    });
    NodeAssert.match(defaultHtml, /mc-board-shell/);
    NodeAssert.match(defaultHtml, /data-board-scroll="done"/);
    NodeAssert.match(defaultHtml, /Completed work #1/);
    NodeAssert.match(defaultHtml, /Completed work #20/);
    NodeAssert.doesNotMatch(defaultHtml, /Completed work #21/);
    NodeAssert.doesNotMatch(defaultHtml, /\/root\/activity_data/);
    NodeAssert.doesNotMatch(defaultHtml, /No messages yet/);
    NodeAssert.match(defaultHtml, /Showing 20 of 24/);
    NodeAssert.match(defaultHtml, /data-board-done-more="1"/);
    NodeAssert.match(defaultHtml, /data-board-done-tab="team"/);
    NodeAssert.match(defaultHtml, /data-triage-action="accept"[^>]*data-thread-id="att-thread"/);
    NodeAssert.match(defaultHtml, /data-triage-action="reopen"[^>]*data-thread-id="done-1"/);
    NodeAssert.match(defaultHtml, /6 team/);

    const teamTabHtml = renderBoard(snap, {
      filter: "all",
      search: "",
      selectedThreadId: "team-child-1",
      boardDoneCollapsed: false,
      boardDoneTab: "team",
      boardDoneLimit: 20,
    });
    NodeAssert.match(teamTabHtml, /\/root\/activity_data/);
    NodeAssert.match(teamTabHtml, /\/root\/mobile_activity/);
    NodeAssert.doesNotMatch(teamTabHtml, /Completed work #1/);

    const collapsedHtml = renderBoard(snap, {
      filter: "all",
      search: "",
      selectedThreadId: "team-child-1",
      boardDoneCollapsed: true,
      boardDoneTab: "threads",
      boardDoneLimit: 20,
    });
    NodeAssert.match(collapsedHtml, /is-done-collapsed/);
    NodeAssert.match(collapsedHtml, /data-board-toggle-done="1"[^>]*aria-expanded="false"/);
    NodeAssert.match(collapsedHtml, /mc-settled-selected-dot/);
    NodeAssert.doesNotMatch(collapsedHtml, /Completed work #1/);

    const searchHtml = renderBoard(snap, {
      filter: "all",
      search: "mobile_activity",
      selectedThreadId: "",
      boardDoneCollapsed: true,
      boardDoneTab: "threads",
      boardDoneLimit: 20,
    });
    NodeAssert.match(searchHtml, /\/root\/mobile_activity/);
    NodeAssert.doesNotMatch(searchHtml, /is-done-collapsed/);

    const runningOnlyHtml = renderBoard(snap, {
      filter: "running",
      search: "",
      selectedThreadId: "",
      boardDoneCollapsed: false,
    });
    NodeAssert.match(runningOnlyHtml, /is-single-lane/);
    NodeAssert.match(runningOnlyHtml, /Using the project&#39;s process/);
    NodeAssert.doesNotMatch(runningOnlyHtml, /aria-label="Done &amp; Idle"/);
  },
);

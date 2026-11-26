import { dotHtml, esc, formatShortTime, icon, safeTone } from "../components/icons.js";

const DONE_PAGE_SIZE = 20;

const COLUMNS = [
  {
    key: "attention",
    label: "Needs Attention",
    tone: "amber",
    emptyTitle: "All clear",
    emptySub: "Approvals, failures, and completed runs ready for review land here.",
  },
  {
    key: "running",
    label: "Running",
    tone: "green",
    emptyTitle: "No active runs",
    emptySub: "Live agent turns and team runs appear here while executing.",
  },
  {
    key: "scheduled",
    label: "Scheduled",
    tone: "blue",
    emptyTitle: "No upcoming jobs",
    emptySub: "Enabled scheduled automations appear here before their next run.",
  },
  {
    key: "done",
    label: "Done & Idle",
    tone: "gray",
    emptyTitle: "No settled threads",
    emptySub: "Accepted, dismissed, and resting conversations collect here.",
  },
];

function inferColumn(thread) {
  if (thread.column && COLUMNS.some((c) => c.key === thread.column)) return thread.column;
  if (thread.needsAttention || thread.status === "attention" || thread.status === "error")
    return "attention";
  if (thread.running || thread.status === "live" || thread.status === "running") return "running";
  if (thread.isCron || thread.status === "cron") return "scheduled";
  return "done";
}

function isTeamChildThread(thread) {
  return Boolean(thread?.parentThreadId || thread?.isSubagent);
}

function isBoilerplateSub(subtitle) {
  return (
    String(subtitle || "")
      .trim()
      .toLowerCase() === "no messages yet"
  );
}

function matchesFilter(thread, project, filter, q) {
  if (filter === "attention" && !thread.needsAttention && thread.status !== "attention")
    return false;
  if (
    filter === "running" &&
    !thread.running &&
    thread.status !== "live" &&
    thread.status !== "running"
  ) {
    return false;
  }
  if (!q) return true;
  const fields = [
    project.name,
    project.branch,
    thread.title,
    thread.subtitle,
    thread.status,
    thread.rightLabel,
  ];
  return fields.some((f) =>
    String(f ?? "")
      .toLowerCase()
      .includes(q),
  );
}

function doneStatusGlyph(thread) {
  if (thread.accepted) {
    return `<span class="mc-settled-glyph is-accepted" aria-hidden="true">${icon("check")}</span>`;
  }
  if (thread.dismissed) {
    return `<span class="mc-settled-glyph is-dismissed" aria-hidden="true">${icon("close")}</span>`;
  }
  if (thread.snoozed) {
    return `<span class="mc-settled-glyph" aria-hidden="true">${icon("clock")}</span>`;
  }
  return dotHtml(safeTone(thread.dotTone, "gray"));
}

function doneStatusLabel(thread) {
  if (thread.accepted) return "Accepted";
  if (thread.dismissed) return "Dismissed";
  if (thread.snoozed) return "Snoozed";
  if (isTeamChildThread(thread)) return "Team";
  return thread.rightLabel || "Idle";
}

function renderCardActions(thread, attention, mutationInFlight) {
  if (!attention) return "";
  const disabled = mutationInFlight ? " disabled" : "";
  const common = `data-attention-id="${esc(attention.id)}" data-thread-id="${esc(thread.id)}" data-run-id="${esc(thread.latestRunId || "")}" data-request-id="${esc(thread.pendingRequestId || "")}"`;
  const actions = Array.isArray(attention.actions) ? attention.actions : [];

  if (
    attention.category === "decision" ||
    attention.kind === "approval" ||
    attention.kind === "question"
  ) {
    return `
      <div class="mc-board-card-actions">
        <button type="button" class="mc-btn-subtle is-strong" data-triage-action="review" ${common}${disabled}>Review &amp; respond</button>
        <button type="button" class="mc-btn-subtle" data-attention-action="diff" data-attention-id="${esc(attention.id)}" data-thread-id="${esc(thread.id)}">Diff</button>
      </div>
    `;
  }

  if (attention.category === "review" && actions.includes("accept")) {
    return `
      <div class="mc-board-card-actions">
        <button type="button" class="mc-btn-subtle is-strong" data-triage-action="accept" ${common}${disabled}>Accept</button>
        <button type="button" class="mc-btn-subtle" data-triage-action="review" ${common}${disabled}>Review</button>
      </div>
    `;
  }

  if (attention.category === "failure") {
    return `
      <div class="mc-board-card-actions">
        <button type="button" class="mc-btn-subtle is-strong" data-triage-action="review" ${common}${disabled}>Inspect</button>
        ${
          actions.includes("dismiss")
            ? `<button type="button" class="mc-btn-subtle" data-triage-action="dismiss" ${common}${disabled}>Dismiss</button>`
            : ""
        }
      </div>
    `;
  }

  return "";
}

function renderActiveCard({ project, thread, attention }, col, state) {
  const selected = thread.id && thread.id === state.selectedThreadId ? " selected" : "";
  const dotTone = safeTone(thread.dotTone, col.tone);
  const subTone = safeTone(thread.subtitleTone, "muted");
  const rightTone = safeTone(thread.rightTone, "muted");
  const age = thread.updatedAt ? formatShortTime(thread.updatedAt) : "";
  const rawSub = String(thread.subtitle || "").trim();
  const hasTeamCount = Boolean(thread.hasTeam && Number(thread.swarmCount) > 0);
  const redundantTeamSub = hasTeamCount && /^\d+\s+team\s+threads?$/i.test(rawSub);
  const showSub = Boolean(rawSub) && !isBoilerplateSub(rawSub) && !redundantTeamSub;
  const projectLabel = project.branch ? `${project.name} · ${project.branch}` : project.name || "";
  const actionsHtml = renderCardActions(thread, attention, state.mutationInFlight);

  const metaRight = `
    <span class="mc-board-card-meta-right">
      ${thread.rightLabel ? `<span class="mc-thread-right tone-${rightTone}">${esc(thread.rightLabel)}</span>` : ""}
      ${age ? `<span class="mc-thread-age">${esc(age)}</span>` : ""}
    </span>
  `;

  const cardInner = `
    <div class="mc-board-card-top">
      <span class="mc-board-card-project" title="${esc(projectLabel)}">${esc(projectLabel)}</span>
      ${metaRight}
    </div>
    <div class="mc-board-card-body">
      ${dotHtml(dotTone)}
      <div class="mc-thread-main">
        <div class="mc-board-card-title" title="${esc(thread.title || "Untitled thread")}">${esc(thread.title || "Untitled thread")}</div>
        ${showSub ? `<div class="mc-board-card-sub tone-${subTone}">${esc(rawSub)}</div>` : ""}
        ${
          hasTeamCount
            ? `<div class="mc-board-card-chips"><span class="mc-settled-chip">${esc(String(thread.swarmCount))} team</span></div>`
            : ""
        }
      </div>
    </div>
  `;

  const selectEl = thread.id
    ? `<button type="button" class="mc-board-card-select" data-select-thread="${esc(thread.id)}">${cardInner}</button>`
    : `<div class="mc-board-card-select is-static">${cardInner}</div>`;

  return `
    <article class="mc-board-card${selected}">
      ${selectEl}
      ${actionsHtml}
    </article>
  `;
}

function renderDoneRow({ project, thread }, state) {
  const selected = thread.id && thread.id === state.selectedThreadId ? " selected" : "";
  const statusText = doneStatusLabel(thread);
  const age = thread.updatedAt ? formatShortTime(thread.updatedAt) : "";
  const canReopen = Boolean(thread.accepted || thread.dismissed);
  const projectLabel = project.branch ? `${project.name} · ${project.branch}` : project.name || "";
  const teamChip =
    thread.hasTeam && Number(thread.swarmCount) > 0
      ? `<span class="mc-settled-chip">${esc(String(thread.swarmCount))} team</span>`
      : "";

  return `
    <div class="mc-board-done-row${selected}">
      <button type="button" class="mc-board-done-select${selected}" data-select-thread="${esc(thread.id)}">
        <span class="mc-board-done-glyph">${doneStatusGlyph(thread)}</span>
        <span class="mc-board-done-main">
          <span class="mc-board-done-head">
            <span class="mc-board-done-title" title="${esc(thread.title || "Untitled thread")}">${esc(thread.title || "Untitled thread")}</span>
            ${age ? `<span class="mc-thread-age mc-board-done-age">${esc(age)}</span>` : ""}
          </span>
          <span class="mc-board-done-meta">
            <span class="mc-board-done-project" title="${esc(projectLabel)}">${esc(projectLabel)}</span>
            ${teamChip}
            <span class="mc-settled-state mc-board-done-status${thread.accepted ? " is-accepted" : ""}">${esc(statusText)}</span>
          </span>
        </span>
      </button>
      ${
        canReopen
          ? `<button type="button" class="mc-board-done-reopen" data-triage-action="reopen" data-thread-id="${esc(thread.id)}" data-run-id="${esc(thread.latestRunId || "")}" data-request-id="${esc(thread.pendingRequestId || "")}" title="Reopen in Inbox"${state.mutationInFlight ? " disabled" : ""}>Reopen</button>`
          : ""
      }
    </div>
  `;
}

function renderLaneEmpty(col, hasSearch) {
  if (hasSearch) {
    return `
      <div class="mc-board-empty">
        <p class="mc-board-empty-title">No matches</p>
        <p class="mc-board-empty-sub">Nothing in ${esc(col.label)} matches your search.</p>
      </div>
    `;
  }
  const ctaHtml =
    col.key === "running"
      ? `<button type="button" class="mc-btn-subtle mc-board-empty-cta" data-action="new-thread">+ New thread</button>`
      : "";
  return `
    <div class="mc-board-empty">
      <p class="mc-board-empty-title">${esc(col.emptyTitle)}</p>
      <p class="mc-board-empty-sub">${esc(col.emptySub)}</p>
      ${ctaHtml}
    </div>
  `;
}

function renderDoneColumn(col, entries, state, hasSearch) {
  const collapsed = Boolean(state.boardDoneCollapsed) && !hasSearch;
  const selectedInside = entries.some(({ thread }) => thread.id === state.selectedThreadId);

  if (collapsed) {
    return `
      <section class="mc-board-col is-done is-collapsed${selectedInside ? " has-selected" : ""}" aria-label="${esc(col.label)}">
        <button type="button" class="mc-board-rail-toggle" data-board-toggle-done="1" aria-expanded="false" title="Expand ${esc(col.label)} (${entries.length})" aria-label="Expand ${esc(col.label)} (${entries.length})">
          <span class="mc-board-rail-icon">${icon("panelExpand")}</span>
          <span class="mc-board-count">${entries.length}</span>
          ${selectedInside ? `<span class="mc-settled-selected-dot" title="Contains selected thread" aria-label="Contains selected thread"></span>` : ""}
          <span class="mc-board-rail-label">${esc(col.label)}</span>
        </button>
      </section>
    `;
  }

  const conversations = entries.filter(({ thread }) => !isTeamChildThread(thread));
  const teamRuns = entries.filter(({ thread }) => isTeamChildThread(thread));
  const showTabs = !hasSearch && conversations.length > 0 && teamRuns.length > 0;
  const requestedTab = state.boardDoneTab === "team" ? "team" : "threads";
  const activeTab = showTabs
    ? requestedTab
    : conversations.length > 0 || hasSearch
      ? "threads"
      : "team";
  const activeEntries = hasSearch ? entries : activeTab === "team" ? teamRuns : conversations;
  const teamHasSelected = teamRuns.some(({ thread }) => thread.id === state.selectedThreadId);
  const threadsHasSelected = conversations.some(
    ({ thread }) => thread.id === state.selectedThreadId,
  );
  const limit = Number(state.boardDoneLimit) || DONE_PAGE_SIZE;
  const shown = activeEntries.slice(0, limit);
  const remaining = Math.max(0, activeEntries.length - shown.length);

  const tabsHtml = showTabs
    ? `
      <div class="mc-board-done-tabs" role="tablist" aria-label="Done and idle thread groups">
        <button type="button" role="tab" aria-selected="${activeTab === "threads"}" class="mc-settled-tab${activeTab === "threads" ? " active" : ""}" data-board-done-tab="threads">
          <span>Threads</span>
          <span class="mc-settled-tab-count">${conversations.length}</span>
          ${threadsHasSelected && activeTab !== "threads" ? `<span class="mc-settled-selected-dot" aria-hidden="true"></span>` : ""}
        </button>
        <button type="button" role="tab" aria-selected="${activeTab === "team"}" class="mc-settled-tab${activeTab === "team" ? " active" : ""}" data-board-done-tab="team">
          <span>Team runs</span>
          <span class="mc-settled-tab-count">${teamRuns.length}</span>
          ${teamHasSelected && activeTab !== "team" ? `<span class="mc-settled-selected-dot" aria-hidden="true"></span>` : ""}
        </button>
      </div>
    `
    : "";

  const rowsHtml = shown.length
    ? `<div class="mc-board-done-list">${shown.map((entry) => renderDoneRow(entry, state)).join("")}</div>`
    : renderLaneEmpty(col, hasSearch);

  const moreHtml =
    remaining > 0
      ? `
      <div class="mc-board-done-more">
        <span class="mc-settled-more-meta">Showing ${shown.length} of ${activeEntries.length}</span>
        <div class="mc-settled-more-actions">
          <button type="button" class="mc-settled-link" data-board-done-more="1">Show ${Math.min(20, remaining)} more</button>
          ${
            remaining > 20
              ? `<button type="button" class="mc-settled-link" data-board-done-all="1" data-board-done-total="${activeEntries.length}">Show all</button>`
              : ""
          }
        </div>
      </div>
    `
      : "";

  return `
    <section class="mc-board-col is-done" aria-label="${esc(col.label)}">
      <header class="mc-board-col-head">
        <div class="mc-board-col-title">
          ${dotHtml(col.tone)}
          <span>${esc(col.label)}</span>
        </div>
        <div class="mc-board-col-head-right">
          <span class="mc-board-count">${entries.length}</span>
          ${
            !hasSearch
              ? `<button type="button" class="mc-icon-btn mc-board-collapse-btn" data-board-toggle-done="1" aria-expanded="true" title="Collapse ${esc(col.label)}" aria-label="Collapse ${esc(col.label)}">${icon("panelCollapse")}</button>`
              : ""
          }
        </div>
      </header>
      ${tabsHtml}
      <div class="mc-board-col-body is-done-body" data-board-scroll="done">
        ${rowsHtml}
        ${moreHtml}
      </div>
    </section>
  `;
}

export function renderBoard(snap, state) {
  const projects = Array.isArray(snap?.projects) ? snap.projects : [];
  const attentionByThread = new Map();
  for (const item of snap?.needsAttention || []) {
    attentionByThread.set(item.threadId, item);
  }

  const q = String(state.search || "")
    .trim()
    .toLowerCase();
  const hasSearch = Boolean(q);
  const filter = state.filter || "all";

  const buckets = new Map(COLUMNS.map((c) => [c.key, []]));
  for (const project of projects) {
    for (const thread of project.threads || []) {
      if (!matchesFilter(thread, project, filter, q)) continue;
      const col = inferColumn(thread);
      buckets.get(col).push({ project, thread, attention: attentionByThread.get(thread.id) });
    }
  }

  if (filter === "all") {
    for (const task of snap?.timeline ?? []) {
      if (
        task.bucket !== "upcoming" ||
        (q &&
          ![task.title, task.projectName].some((text) => String(text).toLowerCase().includes(q)))
      )
        continue;
      buckets.get("scheduled").push({
        project: { name: task.projectName },
        thread: {
          id: task.threadId,
          title: task.title,
          subtitle: task.summary,
          rightLabel: task.timestamp ? formatShortTime(task.timestamp) : "Scheduled",
          dotTone: "blue",
        },
      });
    }
  }

  const visibleColumns =
    filter === "attention"
      ? COLUMNS.filter((c) => c.key === "attention")
      : filter === "running"
        ? COLUMNS.filter((c) => c.key === "running")
        : COLUMNS;

  const isSingleLane = visibleColumns.length === 1;
  const doneCollapsed = !isSingleLane && Boolean(state.boardDoneCollapsed) && !hasSearch;

  const colsHtml = visibleColumns
    .map((col) => {
      const entries = buckets.get(col.key) || [];
      if (col.key === "done") {
        return renderDoneColumn(col, entries, state, hasSearch);
      }

      const bodyContent = entries.length
        ? `<div class="mc-board-card-stack${isSingleLane ? " is-grid" : ""}">${entries.map((entry) => renderActiveCard(entry, col, state)).join("")}</div>`
        : renderLaneEmpty(col, hasSearch);

      return `
        <section class="mc-board-col tone-${col.tone}${entries.length > 0 ? " has-items" : " is-empty"}" aria-label="${esc(col.label)}">
          <header class="mc-board-col-head">
            <div class="mc-board-col-title">
              ${dotHtml(col.tone)}
              <span>${esc(col.label)}</span>
            </div>
            <span class="mc-board-count${entries.length > 0 ? ` tone-${col.tone}` : ""}">${entries.length}</span>
          </header>
          <div class="mc-board-col-body" data-board-scroll="${esc(col.key)}">
            ${bodyContent}
          </div>
        </section>
      `;
    })
    .join("");

  const gridClasses = [
    "mc-board-grid",
    isSingleLane ? "is-single-lane" : "",
    doneCollapsed ? "is-done-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<div class="mc-board-shell"><div class="${gridClasses}">${colsHtml}</div></div>`;
}

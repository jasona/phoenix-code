import { dotHtml, esc, formatShortTime, icon, safeTone } from "../components/icons.js";

const QUIET_PREVIEW_LIMIT = 2;
const QUIET_INLINE_MAX = 3;
const SETTLED_PAGE_SIZE = 8;

function matchesQuery(q, ...fields) {
  if (!q) return true;
  return fields.some((f) =>
    String(f ?? "")
      .toLowerCase()
      .includes(q),
  );
}

function threadMatchesFilter(thread, filter) {
  if (filter === "attention")
    return Boolean(thread.needsAttention || thread.status === "attention");
  if (filter === "running") {
    return Boolean(thread.running || thread.status === "live" || thread.status === "running");
  }
  return true;
}

function isLiveThread(thread) {
  if (!thread) return false;
  if (
    thread.needsAttention ||
    thread.running ||
    thread.status === "attention" ||
    thread.status === "error" ||
    thread.status === "live" ||
    thread.status === "running"
  ) {
    return true;
  }
  if (thread.snoozed && !thread.accepted && !thread.dismissed) {
    return true;
  }
  return false;
}

function isTeamChildThread(thread) {
  return Boolean(thread?.parentThreadId || thread?.isSubagent);
}

function formatDiffCount(val, prefix) {
  const n = Math.max(0, Number(val) || 0);
  if (prefix === "-" && n > 0 && n < 10) return `-0${n}`;
  return `${prefix}${n}`;
}

function actionLabel(action) {
  switch (action) {
    case "review":
      return "Review & respond";
    case "accept":
      return "Accept work";
    case "snooze":
      return "Snooze 1 hour";
    case "diff":
      return "Diff";
    case "reply":
      return "Reply";
    case "open":
      return "Open";
    case "dismiss":
      return "Dismiss";
    default:
      return action ? action.charAt(0).toUpperCase() + action.slice(1) : "Open";
  }
}

function renderAttentionCard(item) {
  const kind = String(item.kind || "question").toLowerCase();
  const safeKind = ["approval", "question", "error", "quota", "stuck", "done"].includes(kind)
    ? kind
    : "question";
  const actions =
    Array.isArray(item.actions) && item.actions.length
      ? item.actions
      : safeKind === "approval" || safeKind === "question"
        ? ["open", "diff"]
        : ["reply", "open"];
  const isStacked = safeKind === "approval" || safeKind === "question";

  const buttonsHtml = actions
    .map((act, idx) => {
      const strong = idx === 0 && isStacked ? " is-strong" : "";
      return `<button type="button" class="mc-btn-subtle${strong}" data-triage-action="${esc(act)}" data-attention-id="${esc(item.id)}" data-thread-id="${esc(item.threadId)}" data-run-id="${esc(item.latestRunId || "")}" data-request-id="${esc(item.pendingRequestId || "")}">${esc(act === "open" && isStacked ? "Review & respond" : actionLabel(act))}</button>`;
    })
    .join("");

  return `
    <article class="mc-attention-card kind-${esc(safeKind)}" data-thread-id="${esc(item.threadId)}">
      <div class="mc-attention-main" data-select-thread="${esc(item.threadId)}" style="cursor:pointer;">
        <div class="mc-attention-meta">
          <span class="mc-attention-badge">${esc(item.badgeLabel || actionLabel(safeKind))}</span>
          <span class="mc-attention-project">${esc(item.projectName || "")}</span>
        </div>
        <div class="mc-attention-title" role="button" tabindex="0" data-select-thread="${esc(item.threadId)}">${esc(item.threadTitle || "Untitled thread")}</div>
        <div class="mc-attention-summary">${esc(item.summary || "")}</div>
      </div>
      <div class="mc-attention-actions${isStacked ? "" : " is-bottom-row"}">
        ${buttonsHtml}
      </div>
    </article>
  `;
}

function renderSettledGlyph(thread) {
  if (thread.accepted) {
    return `<span class="mc-settled-glyph is-accepted" aria-hidden="true">${icon("check")}</span>`;
  }
  if (thread.dismissed) {
    return `<span class="mc-settled-glyph is-dismissed" aria-hidden="true">${icon("close")}</span>`;
  }
  return dotHtml(safeTone(thread.dotTone, "gray"));
}

function settledStatusText(thread) {
  if (thread.accepted) return "Accepted";
  if (thread.dismissed) return "Dismissed";
  if (thread.snoozed) return "Snoozed";
  if (isTeamChildThread(thread)) return "Team";
  return thread.rightLabel || "Idle";
}

function summarizeSettledBreakdown(threads) {
  let accepted = 0;
  let dismissed = 0;
  let team = 0;
  let idle = 0;
  for (const t of threads) {
    if (isTeamChildThread(t)) {
      team += 1;
    } else if (t.accepted) {
      accepted += 1;
    } else if (t.dismissed) {
      dismissed += 1;
    } else {
      idle += 1;
    }
  }
  const parts = [];
  if (accepted > 0) parts.push(`${accepted} accepted`);
  if (dismissed > 0) parts.push(`${dismissed} dismissed`);
  if (idle > 0) parts.push(`${idle} idle`);
  if (team > 0) parts.push(`${team} team`);
  return parts.slice(0, 3).join(" · ");
}

function renderThreadRow(t, selectedThreadId, options = {}) {
  const settled = Boolean(options.settled);
  const selected = t.id === selectedThreadId ? " selected" : "";
  const subTone = safeTone(t.subtitleTone, "muted");
  const rightTone = safeTone(t.rightTone, "muted");
  const dotTone = safeTone(t.dotTone, "gray");
  const rawSub = String(t.subtitle || "").trim();
  const hideBoilerplateSub = settled && rawSub.toLowerCase() === "no messages yet";
  const showSub = Boolean(rawSub) && !hideBoilerplateSub;
  const age = t.updatedAt ? formatShortTime(t.updatedAt) : "";
  const rightText = t.snoozed && !t.accepted && !t.dismissed ? "Snoozed" : t.rightLabel || "";

  return `
    <button type="button" class="mc-thread-row${settled ? " is-settled" : ""}${selected}" data-select-thread="${esc(t.id)}">
      ${settled ? renderSettledGlyph(t) : dotHtml(dotTone)}
      <div class="mc-thread-main">
        <div class="mc-thread-title">${esc(t.title || "Untitled thread")}</div>
        ${showSub ? `<div class="mc-thread-sub tone-${subTone}">${esc(rawSub)}</div>` : ""}
      </div>
      <div class="mc-thread-right tone-${rightTone}">
        <span>${esc(rightText)}</span>
        ${settled && age ? `<span class="mc-thread-age">${esc(age)}</span>` : ""}
      </div>
    </button>
  `;
}

function renderCompactSettledRow(t, selectedThreadId, mutationInFlight) {
  const selected = t.id === selectedThreadId ? " selected" : "";
  const statusText = settledStatusText(t);
  const age = t.updatedAt ? formatShortTime(t.updatedAt) : "";
  const canReopen = Boolean(t.accepted || t.dismissed);
  const teamChip =
    t.hasTeam && Number(t.swarmCount) > 0
      ? `<span class="mc-settled-chip">${esc(String(t.swarmCount))} team</span>`
      : "";

  return `
    <div class="mc-settled-item${selected}">
      <button type="button" class="mc-thread-row is-compact is-settled${selected}" data-select-thread="${esc(t.id)}">
        ${renderSettledGlyph(t)}
        <span class="mc-thread-title">${esc(t.title || "Untitled thread")}</span>
        ${teamChip}
        <span class="mc-settled-row-meta">
          <span class="mc-settled-state${t.accepted ? " is-accepted" : ""}">${esc(statusText)}</span>
          ${age ? `<span class="mc-thread-age">${esc(age)}</span>` : ""}
        </span>
      </button>
      ${
        canReopen
          ? `<button type="button" class="mc-settled-reopen" data-triage-action="reopen" data-thread-id="${esc(t.id)}" data-run-id="${esc(t.latestRunId || "")}" data-request-id="${esc(t.pendingRequestId || "")}" title="Reopen in Inbox"${mutationInFlight ? " disabled" : ""}>Reopen</button>`
          : ""
      }
    </div>
  `;
}

function renderSettledShelf(project, foldedThreads, state, hasVisibleThreads) {
  if (foldedThreads.length === 0) return "";

  const expandedSet = state.overviewExpandedProjects;
  const isExpanded = Boolean(expandedSet?.has?.(project.id));
  const selectedInside = foldedThreads.some((t) => t.id === state.selectedThreadId);
  const conversations = foldedThreads.filter((t) => !isTeamChildThread(t));
  const teamRuns = foldedThreads.filter((t) => isTeamChildThread(t));
  const hasTabs = conversations.length > 0 && teamRuns.length > 0;
  const requestedTab = state.overviewSettledTab?.get?.(project.id);
  const activeTab = hasTabs
    ? requestedTab === "team"
      ? "team"
      : "conversations"
    : conversations.length > 0
      ? "conversations"
      : "team";
  const activeList = activeTab === "team" ? teamRuns : conversations;
  const limit = Number(state.overviewSettledLimit?.get?.(project.id)) || SETTLED_PAGE_SIZE;
  const shown = activeList.slice(0, limit);
  const remaining = Math.max(0, activeList.length - shown.length);
  const breakdown = summarizeSettledBreakdown(foldedThreads);
  const label = hasVisibleThreads ? "More settled" : "Settled";
  const panelId = `mc-settled-panel-${project.id}`;

  const tabsHtml = hasTabs
    ? `
      <div class="mc-settled-tabs" role="tablist" aria-label="Settled thread groups for ${esc(project.name)}">
        <button type="button" role="tab" aria-selected="${activeTab === "conversations"}" class="mc-settled-tab${activeTab === "conversations" ? " active" : ""}" data-settled-tab="${esc(project.id)}:conversations">
          <span>Conversations</span>
          <span class="mc-settled-tab-count">${conversations.length}</span>
        </button>
        <button type="button" role="tab" aria-selected="${activeTab === "team"}" class="mc-settled-tab${activeTab === "team" ? " active" : ""}" data-settled-tab="${esc(project.id)}:team">
          <span>Team runs</span>
          <span class="mc-settled-tab-count">${teamRuns.length}</span>
        </button>
      </div>
    `
    : "";

  const rowsHtml = isExpanded
    ? shown
        .map((t) => renderCompactSettledRow(t, state.selectedThreadId, state.mutationInFlight))
        .join("")
    : "";

  const paginationHtml =
    isExpanded && remaining > 0
      ? `
      <div class="mc-settled-more-bar">
        <span class="mc-settled-more-meta">Showing ${shown.length} of ${activeList.length}</span>
        <div class="mc-settled-more-actions">
          <button type="button" class="mc-settled-link" data-settled-more="${esc(project.id)}">Show ${Math.min(12, remaining)} more</button>
          ${
            remaining > 12
              ? `<button type="button" class="mc-settled-link" data-settled-all="${esc(project.id)}" data-settled-total="${activeList.length}">Show all</button>`
              : ""
          }
        </div>
      </div>
    `
      : "";

  return `
    <div class="mc-settled-shelf${isExpanded ? " is-open" : ""}${selectedInside && !isExpanded ? " has-selected" : ""}">
      <button type="button" class="mc-settled-trigger" data-toggle-settled-project="${esc(project.id)}" aria-expanded="${isExpanded}" aria-controls="${esc(panelId)}">
        <span class="mc-settled-trigger-left">
          <span class="mc-settled-trigger-icon">${icon("checkCircle")}</span>
          <span class="mc-settled-trigger-label">${esc(label)}</span>
          <span class="mc-settled-count">${foldedThreads.length}</span>
          ${breakdown ? `<span class="mc-settled-breakdown">${esc(breakdown)}</span>` : ""}
          ${selectedInside && !isExpanded ? `<span class="mc-settled-selected-dot" title="Contains selected thread" aria-label="Contains selected thread"></span>` : ""}
        </span>
        <span class="mc-settled-chevron">${icon("chevronDown")}</span>
      </button>
      ${
        isExpanded
          ? `
        <div id="${esc(panelId)}" class="mc-settled-panel">
          ${tabsHtml}
          <div class="mc-settled-list">${rowsHtml}</div>
          ${paginationHtml}
        </div>
      `
          : ""
      }
    </div>
  `;
}

function renderBranchPill(project) {
  if (!project.branch) return "";
  const diff = project.diff || {};
  const added = Number(diff.added) || 0;
  const removed = Number(diff.removed) || 0;
  const hasDiff = added > 0 || removed > 0;
  const diffHtml = hasDiff
    ? `<span class="mc-diff-mini"><span class="mc-diff-add">${esc(formatDiffCount(added, "+"))}</span><span class="mc-diff-del">${esc(formatDiffCount(removed, "-"))}</span></span>`
    : "";

  return `
    <span class="mc-branch-pill" title="Git branch">
      ${icon("branch")}
      <span>${esc(project.branch)}</span>
      ${diffHtml}
    </span>
  `;
}

function renderQuietProjectStrip(project, settledThreads, state) {
  const isSelectedInside = settledThreads.some((t) => t.id === state.selectedThreadId);
  const count = settledThreads.length;
  const countLabel = count > 0 ? `${count} settled` : "No threads";

  return `
    <section class="mc-quiet-card${isSelectedInside ? " is-active" : ""}" data-project-id="${esc(project.id)}">
      <div class="mc-quiet-card-main">
        <span class="mc-project-folder">${icon("folder")}</span>
        <span class="mc-project-name" title="${esc(project.path || project.name)}">${esc(project.name)}</span>
        ${renderBranchPill(project)}
      </div>
      <div class="mc-quiet-card-actions">
        <button type="button" class="mc-quiet-expand-btn" data-toggle-quiet-project="${esc(project.id)}" aria-expanded="false">
          ${isSelectedInside ? `<span class="mc-settled-selected-dot" aria-hidden="true"></span>` : ""}
          <span>${esc(countLabel)}</span>
          <span class="mc-settled-chevron">${icon("chevronDown")}</span>
        </button>
        <button type="button" class="mc-icon-btn" data-new-thread-project="${esc(project.id)}" title="New thread in ${esc(project.name)}" aria-label="New thread in ${esc(project.name)}">
          ${icon("plus")}
        </button>
      </div>
    </section>
  `;
}

function renderProjectCard(project, threads, state, options = {}) {
  const { showInlineLauncher = false, searchActive = false, quietExpanded = false } = options;
  const isActiveProject = threads.some((t) => t.id === state.selectedThreadId);
  const badge = project.badge || { label: "Idle", tone: "idle" };
  const badgeTone = safeTone(badge.tone, "idle");
  const showBadgeDot = badgeTone === "green";

  let bodyHtml = "";
  let shelfHtml = "";

  if (searchActive || (state.filter && state.filter !== "all")) {
    bodyHtml =
      threads
        .map((t) => renderThreadRow(t, state.selectedThreadId, { settled: !isLiveThread(t) }))
        .join("") ||
      '<div class="mc-thread-sub" style="padding:6px 8px;">No matching threads.</div>';
  } else {
    const liveThreads = threads.filter(isLiveThread);
    const settledThreads = threads.filter((t) => !isLiveThread(t));
    const settledConversations = settledThreads.filter((t) => !isTeamChildThread(t));
    const settledTeamRuns = settledThreads.filter((t) => isTeamChildThread(t));

    if (liveThreads.length > 0) {
      bodyHtml = liveThreads
        .map((t) => renderThreadRow(t, state.selectedThreadId, { settled: false }))
        .join("");
      shelfHtml = renderSettledShelf(project, settledThreads, state, false);
    } else if (settledThreads.length === 0) {
      bodyHtml = '<div class="mc-thread-sub mc-project-empty-note">No threads yet.</div>';
    } else if (settledTeamRuns.length === 0 && settledConversations.length <= QUIET_INLINE_MAX) {
      bodyHtml = settledConversations
        .map((t) => renderThreadRow(t, state.selectedThreadId, { settled: true }))
        .join("");
    } else {
      const preview = settledConversations.slice(0, QUIET_PREVIEW_LIMIT);
      const previewIds = new Set(preview.map((t) => t.id));
      const folded = settledThreads.filter((t) => !previewIds.has(t.id));
      bodyHtml = preview
        .map((t) => renderThreadRow(t, state.selectedThreadId, { settled: true }))
        .join("");
      shelfHtml = renderSettledShelf(project, folded, state, preview.length > 0);
    }
  }

  const launcherHtml = showInlineLauncher
    ? `<button type="button" class="mc-inline-launch" data-new-thread-project="${esc(project.id)}">
         <span>+ Start a new thread in ${esc(project.name)}…</span>
       </button>`
    : "";

  const collapseQuietBtn = quietExpanded
    ? `<button type="button" class="mc-icon-btn" data-toggle-quiet-project="${esc(project.id)}" title="Collapse quiet project" aria-label="Collapse ${esc(project.name)}">
         ${icon("close")}
       </button>`
    : "";

  const footText =
    project.footerText ||
    (Array.isArray(project.footerParts) ? project.footerParts.join(" · ") : "");

  return `
    <section class="mc-project-card${isActiveProject ? " is-active" : ""}" data-project-id="${esc(project.id)}">
      <header class="mc-project-head">
        <div class="mc-project-ident">
          <span class="mc-project-folder">${icon("folder")}</span>
          <span class="mc-project-name" title="${esc(project.path || project.name)}">${esc(project.name)}</span>
        </div>
        ${renderBranchPill(project)}
        <span class="mc-head-spacer"></span>
        <span class="mc-status-badge tone-${badgeTone}">
          ${showBadgeDot ? dotHtml("green") : ""}
          <span>${esc(badge.label || "Idle")}</span>
        </span>
        ${collapseQuietBtn}
        <button type="button" class="mc-icon-btn" data-new-thread-project="${esc(project.id)}" title="New thread in ${esc(project.name)}" aria-label="New thread in ${esc(project.name)}">
          ${icon("plus")}
        </button>
      </header>

      <div class="mc-project-body">
        ${bodyHtml}
        ${launcherHtml}
      </div>
      ${shelfHtml}
      <footer class="mc-project-foot">${esc(footText || "Clean tree · 0 running")}</footer>
    </section>
  `;
}

export function renderOverview(snap, state) {
  const projects = Array.isArray(snap?.projects) ? snap.projects : [];
  const attention = Array.isArray(snap?.needsAttention) ? snap.needsAttention : [];
  const q = String(state.search || "")
    .trim()
    .toLowerCase();
  const filter = state.filter || "all";
  const hideSettled = Boolean(state.overviewHideSettled) && filter === "all" && !q;
  const expandedQuiet = state.overviewExpandedQuiet;

  if (snap?.mode === "live" && projects.length === 0) {
    return `<div class="mc-empty"><h2 class="mc-empty-title">No Phoenix projects yet</h2><p class="mc-empty-sub">Add a project in Phoenix to see its conversations and scheduled work here.</p></div>`;
  }

  const visibleAttention =
    filter === "running"
      ? []
      : attention.filter((item) =>
          matchesQuery(q, item.projectName, item.threadTitle, item.summary, item.badgeLabel),
        );

  let totalSettledCount = 0;
  const primaryCards = [];
  const quietStrips = [];

  for (const project of projects) {
    const projectMatches = matchesQuery(q, project.name, project.branch, project.footerText);
    const allThreads = Array.isArray(project.threads) ? project.threads : [];
    const matchingThreads = allThreads.filter((t) => {
      if (!threadMatchesFilter(t, filter)) return false;
      if (!q || projectMatches) return true;
      return matchesQuery(q, t.title, t.subtitle, t.status, t.rightLabel);
    });

    if ((q || filter !== "all") && matchingThreads.length === 0 && !projectMatches) {
      continue;
    }
    if (filter !== "all" && matchingThreads.length === 0) {
      continue;
    }

    const liveThreads = matchingThreads.filter(isLiveThread);
    const settledThreads = matchingThreads.filter((t) => !isLiveThread(t));
    totalSettledCount += settledThreads.length;

    const isQuietProject = liveThreads.length === 0;
    const isQuietExpanded = Boolean(expandedQuiet?.has?.(project.id));

    if (hideSettled && isQuietProject && !isQuietExpanded) {
      quietStrips.push(renderQuietProjectStrip(project, settledThreads, state));
      continue;
    }

    const showLauncher = filter === "all" && !q && allThreads.length <= 1;
    primaryCards.push(
      renderProjectCard(project, matchingThreads, state, {
        showInlineLauncher: showLauncher,
        searchActive: Boolean(q),
        quietExpanded: hideSettled && isQuietProject && isQuietExpanded,
      }),
    );
  }

  const attentionSection =
    visibleAttention.length > 0
      ? `
      <section class="mc-section" aria-label="Needs Attention">
        <h2 class="mc-section-title">Needs Attention</h2>
        <div class="mc-attention-grid">
          ${visibleAttention.map(renderAttentionCard).join("")}
        </div>
      </section>
    `
      : "";

  const settledToggleHtml =
    filter === "all" && !q && totalSettledCount > 0
      ? `
      <button type="button" class="mc-settled-mode-btn${hideSettled ? " active" : ""}" data-action="toggle-overview-settled" aria-pressed="${hideSettled}">
        <span class="mc-settled-mode-icon">${icon("checkCircle")}</span>
        <span>${hideSettled ? "Settled hidden" : "Hide settled"}</span>
        <span class="mc-settled-count">${totalSettledCount}</span>
      </button>
    `
      : "";

  const caughtUpBanner =
    hideSettled && primaryCards.length === 0 && quietStrips.length > 0
      ? `
      <div class="mc-caught-up-bar">
        <div class="mc-caught-up-copy">
          <span class="mc-settled-glyph is-accepted" aria-hidden="true">${icon("checkCircle")}</span>
          <span>All workspaces are settled — nothing running or awaiting review.</span>
        </div>
        <button type="button" class="mc-btn-subtle" data-action="toggle-overview-settled">Show recent settled</button>
      </div>
    `
      : "";

  const quietSection =
    quietStrips.length > 0
      ? `
      <div class="mc-quiet-section">
        <div class="mc-quiet-head">
          <span class="mc-quiet-title">Quiet projects</span>
          <span class="mc-settled-count">${quietStrips.length}</span>
        </div>
        <div class="mc-quiet-grid">${quietStrips.join("")}</div>
      </div>
    `
      : "";

  const hasAnyProjects = primaryCards.length > 0 || quietStrips.length > 0;

  const projectsSection = `
    <section class="mc-section" aria-label="Projects Grid">
      <div class="mc-section-head">
        <h2 class="mc-section-title">Projects Grid</h2>
        ${settledToggleHtml}
      </div>
      ${
        hasAnyProjects
          ? `${caughtUpBanner}${primaryCards.length > 0 ? `<div class="mc-projects-grid">${primaryCards.join("")}</div>` : ""}${quietSection}`
          : `<div class="mc-empty">
             <p class="mc-empty-title">No matching projects or threads</p>
             <p class="mc-empty-sub">Clear your search query or switch filters to see all workspaces.</p>
             <button type="button" class="mc-btn-subtle" data-action="clear-filters">Reset Filters</button>
           </div>`
      }
    </section>
  `;

  return `${attentionSection}${projectsSection}`;
}

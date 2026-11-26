import { dotHtml, esc, icon, safeTone } from "../components/icons.js";

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

function renderProjectCard(project, threads, selectedThreadId, showInlineLauncher) {
  const isActiveProject = threads.some((t) => t.id === selectedThreadId);
  const diff = project.diff || {};
  const added = Number(diff.added) || 0;
  const removed = Number(diff.removed) || 0;
  const hasDiff = added > 0 || removed > 0;
  const diffHtml = hasDiff
    ? `<span class="mc-diff-mini"><span class="mc-diff-add">${esc(formatDiffCount(added, "+"))}</span><span class="mc-diff-del">${esc(formatDiffCount(removed, "-"))}</span></span>`
    : "";

  const badge = project.badge || { label: "Idle", tone: "idle" };
  const badgeTone = safeTone(badge.tone, "idle");
  const showBadgeDot = badgeTone === "green";

  const threadsHtml = threads
    .map((t) => {
      const selected = t.id === selectedThreadId ? " selected" : "";
      const subTone = safeTone(t.subtitleTone, "muted");
      const rightTone = safeTone(t.rightTone, "muted");
      const dotTone = safeTone(t.dotTone, "gray");
      return `
        <button type="button" class="mc-thread-row${selected}" data-select-thread="${esc(t.id)}">
          ${dotHtml(dotTone)}
          <div class="mc-thread-main">
            <div class="mc-thread-title">${esc(t.title || "Untitled thread")}</div>
            <div class="mc-thread-sub tone-${subTone}">${esc(t.subtitle || "")}</div>
          </div>
          <div class="mc-thread-right tone-${rightTone}">${esc(t.rightLabel || "")}</div>
        </button>
      `;
    })
    .join("");

  const launcherHtml = showInlineLauncher
    ? `<button type="button" class="mc-inline-launch" data-new-thread-project="${esc(project.id)}">
         <span>+ Start a new thread in ${esc(project.name)}…</span>
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
        ${
          project.branch
            ? `
          <span class="mc-branch-pill" title="Git branch">
            ${icon("branch")}
            <span>${esc(project.branch)}</span>
            ${diffHtml}
          </span>
        `
            : ""
        }
        <span class="mc-head-spacer"></span>
        <span class="mc-status-badge tone-${badgeTone}">
          ${showBadgeDot ? dotHtml("green") : ""}
          <span>${esc(badge.label || "Idle")}</span>
        </span>
        <button type="button" class="mc-icon-btn" data-new-thread-project="${esc(project.id)}" title="New thread in ${esc(project.name)}" aria-label="New thread in ${esc(project.name)}">
          ${icon("plus")}
        </button>
      </header>

      <div class="mc-project-body">
        ${threadsHtml || '<div class="mc-thread-sub" style="padding:6px 8px;">No matching threads.</div>'}
        ${launcherHtml}
      </div>

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

  if (snap?.mode === "live" && projects.length === 0) {
    return `<div class="mc-empty"><h2 class="mc-empty-title">No Phoenix projects yet</h2><p class="mc-empty-sub">Add a project in Phoenix to see its conversations and scheduled work here.</p></div>`;
  }

  const visibleAttention =
    filter === "running"
      ? []
      : attention.filter((item) =>
          matchesQuery(q, item.projectName, item.threadTitle, item.summary, item.badgeLabel),
        );

  const projectCards = [];
  for (const project of projects) {
    const projectMatches = matchesQuery(q, project.name, project.branch, project.footerText);
    const allThreads = Array.isArray(project.threads) ? project.threads : [];
    const matchingThreads = allThreads.filter((t) => {
      if (!threadMatchesFilter(t, filter)) return false;
      if (!q || projectMatches) return true;
      return matchesQuery(q, t.title, t.subtitle, t.status);
    });

    if ((q || filter !== "all") && matchingThreads.length === 0 && !projectMatches) {
      continue;
    }
    if (filter !== "all" && matchingThreads.length === 0) {
      continue;
    }

    const showLauncher = filter === "all" && !q && allThreads.length <= 1;
    projectCards.push(
      renderProjectCard(project, matchingThreads, state.selectedThreadId, showLauncher),
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

  const projectsSection = `
    <section class="mc-section" aria-label="Projects Grid">
      <h2 class="mc-section-title">Projects Grid</h2>
      ${
        projectCards.length > 0
          ? `<div class="mc-projects-grid">${projectCards.join("")}</div>`
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

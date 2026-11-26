import { dotHtml, esc, highlightMentions, icon, safeTone } from "../components/icons.js";
import { renderVerification } from "./verification.js";

function handleOf(name, handle) {
  if (handle) return handle.startsWith("@") ? handle : `@${handle}`;
  const raw = String(name || "").trim();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function renderActivityTab(detail) {
  const roster =
    detail.swarm?.exists && Array.isArray(detail.swarm.roster) ? detail.swarm.roster : [];
  const rosterHtml =
    roster.length > 0
      ? `
      <div class="mc-roster-strip" role="list" aria-label="Team roster">
        ${roster
          .slice(0, 3)
          .map(
            (m) => `
          <div class="mc-roster-chip" role="listitem">
            <div class="mc-roster-name">
              ${dotHtml(m.tone || "gray")}
              <span>${esc(handleOf(m.name, m.handle))}</span>
            </div>
            <div class="mc-roster-state">${esc(m.stateLabel || m.status || "Active")}</div>
          </div>
        `,
          )
          .join("")}
      </div>
    `
      : "";

  const activities = Array.isArray(detail.activity) ? detail.activity : [];
  const cardsHtml =
    activities.length > 0
      ? activities
          .map((act) => {
            const fromStr = act.from ? handleOf(act.from) : "@agent";
            const toStr = act.to ? handleOf(act.to) : "";
            const badgeTone = safeTone(act.badge?.tone, "green");
            const hasFoot = Boolean(act.badge || act.filePill || act.stateText);

            return `
          <article class="mc-activity-card">
            <div class="mc-activity-head">
              <div class="mc-activity-actors">
                <span class="mc-agent-avatar">${icon("swarm")}</span>
                <span>${esc(fromStr)}</span>
                ${toStr ? `<span class="mc-activity-arrow" aria-hidden="true">→</span><span>${esc(toStr)}</span>` : ""}
              </div>
              <span class="mc-activity-time">${esc(act.time || "")}</span>
            </div>
            <div class="mc-activity-text">${highlightMentions(act.body || "")}</div>
            ${
              hasFoot
                ? `
              <div class="mc-activity-foot">
                ${
                  act.badge
                    ? `
                  <span class="mc-check-pill tone-${badgeTone}">
                    ${icon(act.badge.icon === "alert" ? "alert" : "checkCircle")}
                    <span>${esc(act.badge.text || "")}</span>
                  </span>
                `
                    : ""
                }
                ${act.filePill ? `<span class="mc-code-pill">${esc(act.filePill)}</span>` : ""}
                ${act.stateText ? `<span class="mc-state-text">${esc(act.stateText)}</span>` : ""}
              </div>
            `
                : ""
            }
          </article>
        `;
          })
          .join("")
      : '<div class="mc-empty" style="padding:20px 14px;"><p class="mc-empty-sub">No activity entries recorded for this thread yet.</p></div>';

  return `${detail.pendingRequest ? `<div class="mc-activity-card"><p>A request needs your response.</p><button class="mc-btn-primary" data-action="open-full" data-thread-id="${esc(detail.id)}">Review &amp; respond</button></div>` : ""}${rosterHtml}${cardsHtml}${detail.historyTruncated ? '<p class="mc-thread-sub">Showing recent messages. Open the review desk for the full history.</p>' : ""}`;
}

function renderTeamTab(detail) {
  const swarm = detail.swarm || {};
  const roster = Array.isArray(swarm.roster) ? swarm.roster : [];
  const messages = Array.isArray(swarm.messages) ? swarm.messages : [];

  if (!swarm.exists && roster.length === 0 && messages.length === 0) {
    return `
      <div class="mc-empty" style="padding:22px 14px;">
        <p class="mc-empty-title">Single-agent thread</p>
        <p class="mc-empty-sub">Delegated conversations will appear here when this thread starts a team.</p>
      </div>
    `;
  }

  const canOpenConv = Boolean(window.phoenix?.ui?.toggleConversation);

  const rosterHtml =
    roster.length > 0
      ? `
      <div class="mc-swarm-list">
        ${roster
          .map(
            (m) => `
          <div class="mc-swarm-member-row">
            <div class="mc-swarm-member-info">
              ${dotHtml(m.tone || "gray")}
              <div>
                <div style="font-size:12px;font-weight:500;">${esc(handleOf(m.name, m.handle))}</div>
                ${m.role ? `<div class="mc-swarm-member-role">${esc(m.role)}</div>` : ""}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="mc-status-badge tone-${safeTone(m.tone, "muted")}">${esc(m.stateLabel || m.status || "Waiting")}</span>
              ${canOpenConv && m.conversationId ? `<button type="button" class="mc-btn-subtle" data-open-conv="${esc(m.conversationId)}" style="padding:2px 7px;font-size:11px;">Chat</button>` : ""}
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
    `
      : "";

  const messagesHtml =
    messages.length > 0
      ? messages
          .map(
            (msg) => `
        <article class="mc-activity-card">
          <div class="mc-activity-head">
            <div class="mc-activity-actors">
              <span class="mc-code-pill" style="padding:1px 5px;font-size:10px;">#${esc(msg.seq ?? "")}</span>
              <span>${esc(handleOf(msg.agent))}</span>
              ${msg.to ? `<span class="mc-activity-arrow">→</span><span>${esc(handleOf(msg.to))}</span>` : ""}
            </div>
            <span class="mc-activity-time">${esc(msg.time || "")}</span>
          </div>
          <div class="mc-activity-text">${highlightMentions(msg.text || "")}</div>
          ${
            msg.statusPill
              ? `
            <div class="mc-activity-foot">
              <span class="mc-check-pill tone-green">${icon("checkCircle")}<span>${esc(msg.statusPill)}</span></span>
            </div>
          `
              : ""
          }
        </article>
      `,
          )
          .join("")
      : "";

  return `${rosterHtml}${messagesHtml}`;
}

function renderFilesTab(detail, projectPath) {
  const files = Array.isArray(detail.files) ? detail.files : [];
  if (files.length === 0) {
    return `
      <div class="mc-empty" style="padding:22px 14px;">
        <p class="mc-empty-sub">No modified files detected for this thread.</p>
      </div>
    `;
  }

  const canOpenFile = Boolean(window.phoenix?.ui?.toggleAuxPane) && Boolean(projectPath);

  return `
    <div class="mc-files-list">
      ${files
        .map((f) => {
          const st = String(f.status || "M")
            .toUpperCase()
            .slice(0, 1);
          const safeSt = ["A", "D", "M", "R"].includes(st) ? st : "M";
          return `
          <div class="mc-file-row" role="button" tabindex="0" data-jump-diff="${esc(f.path)}">
            <span class="mc-file-status status-${safeSt}">${esc(safeSt)}</span>
            <span class="mc-file-path" title="${esc(f.path)}">${esc(f.path)}</span>
            <span class="mc-file-stats">
              <span class="mc-diff-add">+${Number(f.added) || 0}</span>
              <span class="mc-diff-del">-${Number(f.removed) || 0}</span>
            </span>
            ${
              canOpenFile
                ? `
              <button type="button" class="mc-icon-btn" data-open-file="${esc(f.path)}" title="Open in editor" aria-label="Open ${esc(f.path)} in editor">
                ${icon("arrowUpRight")}
              </button>
            `
                : ""
            }
          </div>
        `;
        })
        .join("")}
    </div>
  `;
}

function renderDiffTab(detail, state) {
  const diffs = Array.isArray(detail.diff) ? detail.diff : [];
  if (diffs.length === 0) {
    return `
      <div class="mc-empty" style="padding:22px 14px;">
        <p class="mc-empty-sub">No unified diff available for this thread.</p>
      </div>
    `;
  }

  const selectedFile = state.inspectorDiffFile || "all";
  const chipsHtml = `
    <div class="mc-diff-chips">
      <button type="button" class="mc-diff-chip${selectedFile === "all" ? " active" : ""}" data-diff-file="all">All (${diffs.length})</button>
      ${diffs
        .map((d) => {
          const name =
            String(d.path || "")
              .split("/")
              .pop() || d.path;
          return `<button type="button" class="mc-diff-chip${selectedFile === d.path ? " active" : ""}" data-diff-file="${esc(d.path)}" title="${esc(d.path)}">${esc(name)}</button>`;
        })
        .join("")}
    </div>
  `;

  const visibleDiffs =
    selectedFile === "all" ? diffs : diffs.filter((d) => d.path === selectedFile);

  const blocksHtml = visibleDiffs
    .map((d) => {
      const lines = String(d.patch || "").split("\n");
      const linesHtml = lines
        .map((line) => {
          let cls = "is-ctx";
          if (line.startsWith("@@")) cls = "is-hunk";
          else if (line.startsWith("+") && !line.startsWith("+++")) cls = "is-add";
          else if (line.startsWith("-") && !line.startsWith("---")) cls = "is-del";
          return `<span class="mc-diff-line ${cls}">${esc(line || " ")}</span>`;
        })
        .join("");

      return `
      <div class="mc-diff-block">
        <div class="mc-diff-file-head">
          <span>${esc(d.path || "")}</span>
          <span class="mc-file-stats">
            <span class="mc-diff-add">+${Number(d.added) || 0}</span>
            <span class="mc-diff-del">-${Number(d.removed) || 0}</span>
          </span>
        </div>
        <pre class="mc-diff-pre"><code>${linesHtml}</code></pre>
      </div>
    `;
    })
    .join("");

  return `<p class="mc-thread-sub">Working-tree changes against HEAD. Use the review desk to compare branches or run checkpoints.</p><button class="mc-btn-subtle" data-action="open-full" data-thread-id="${esc(detail.id)}">Open review desk</button>${chipsHtml}${detail.diffTruncated ? '<div class="mc-thread-sub" style="padding:2px 2px 4px;">Diff output capped at 192 KB.</div>' : ""}${blocksHtml}`;
}

export function renderInspectorContent(detail, state, projectPath) {
  if (!detail) {
    return `
      <div class="mc-empty" style="margin:24px 16px;">
        <p class="mc-empty-title">Select a thread</p>
        <p class="mc-empty-sub">Click any thread card or Needs Attention item to inspect its activity, Team roster, changed files, and unified diff.</p>
      </div>
    `;
  }

  const tab = state.inspectorTab || "activity";
  const swarmCount = Number(detail.swarm?.count ?? detail.swarm?.roster?.length ?? 0) || 0;
  const filesCount = Array.isArray(detail.files) ? detail.files.length : 0;
  const statusTone = safeTone(detail.statusTone, detail.status === "live" ? "green" : "muted");

  let bodyHtml = "";
  if (tab === "swarm") bodyHtml = renderTeamTab(detail);
  else if (tab === "files") bodyHtml = renderFilesTab(detail, projectPath);
  else if (tab === "diff") bodyHtml = renderDiffTab(detail, state);
  else if (tab === "verification") bodyHtml = renderVerification(detail);
  else bodyHtml = renderActivityTab(detail);

  return `
    <header class="mc-insp-head">
      <div class="mc-insp-top">
        <div class="mc-insp-crumb-wrap">
          <button type="button" class="mc-insp-back" data-action="close-inspector" aria-label="Back to inbox">
            ${icon("arrowLeft")}
            <span>Back</span>
          </button>
          <span class="mc-insp-crumb">${esc(detail.projectName || "workspace")} /</span>
        </div>
        <span class="mc-insp-status tone-${statusTone}">
          ${dotHtml(statusTone)}
          <span>${esc(detail.statusLabel || detail.status || "Idle")}</span>
        </span>
      </div>

      <div class="mc-insp-title-row">
        <h2 class="mc-insp-title">${esc(detail.title || "Untitled thread")}</h2>
        <button type="button" class="mc-btn-open-full" data-action="open-full" data-thread-id="${esc(detail.id)}">
          <span>Review work</span>
          ${icon("arrowUpRight")}
        </button>
      </div>
      <div class="mc-intervention-actions" aria-label="Run actions">
        ${detail.intervention?.canStop ? `<button class="mc-btn-subtle" data-control="stop" data-thread-id="${esc(detail.id)}"${state.mutationInFlight ? " disabled" : ""}>Stop run</button>` : ""}
        ${detail.intervention?.canRetry ? `<button class="mc-btn-subtle" data-control="retry" data-thread-id="${esc(detail.id)}"${state.mutationInFlight ? " disabled" : ""}>Retry failed run</button>` : ""}
        ${detail.intervention?.canResume ? `<button class="mc-btn-subtle" data-control="resume" data-thread-id="${esc(detail.id)}"${state.mutationInFlight ? " disabled" : ""}>Resume run</button>` : ""}
        ${detail.accepted || detail.dismissed ? `<button class="mc-btn-subtle" data-triage-action="reopen" data-thread-id="${esc(detail.id)}" data-run-id="${esc(detail.latestRunId || "")}" data-request-id="${esc(detail.pendingRequestId || "")}">${detail.dismissed ? "Reopen" : "Reopen review"}</button>` : detail.canDismiss ? `<button class="mc-btn-subtle" data-triage-action="dismiss" data-thread-id="${esc(detail.id)}" data-run-id="${esc(detail.latestRunId || "")}" data-request-id="${esc(detail.pendingRequestId || "")}">Dismiss</button>` : detail.agentFinished && !detail.activeRunId ? `<button class="mc-btn-subtle" data-triage-action="accept" data-thread-id="${esc(detail.id)}" data-run-id="${esc(detail.latestRunId || "")}" data-request-id="${esc(detail.pendingRequestId || "")}">Accept work</button>` : ""}
      </div>
    </header>

    <nav class="mc-insp-tabs" role="tablist" aria-label="Thread inspector sections">
      <button type="button" role="tab" class="mc-insp-tab${tab === "activity" ? " active" : ""}" data-insp-tab="activity" aria-selected="${tab === "activity"}">
        <span>Activity</span>
      </button>
      <button type="button" role="tab" class="mc-insp-tab${tab === "verification" ? " active" : ""}" data-insp-tab="verification" aria-selected="${tab === "verification"}">
        <span>Evidence</span>
      </button>
      <button type="button" role="tab" class="mc-insp-tab${tab === "swarm" ? " active" : ""}" data-insp-tab="swarm" aria-selected="${tab === "swarm"}">
        <span>Team</span>
        ${swarmCount > 0 ? `<span class="mc-tab-badge">${swarmCount}</span>` : ""}
      </button>
      <button type="button" role="tab" class="mc-insp-tab${tab === "files" ? " active" : ""}" data-insp-tab="files" aria-selected="${tab === "files"}">
        <span>Files</span>
        ${filesCount > 0 ? `<span class="mc-tab-badge">${filesCount}</span>` : ""}
      </button>
      <button type="button" role="tab" class="mc-insp-tab${tab === "diff" ? " active" : ""}" data-insp-tab="diff" aria-selected="${tab === "diff"}">
        <span>Diff</span>
      </button>
    </nav>

    ${state.detailError ? `<p class="mc-freshness" role="status">${esc(state.detailError)}</p>` : ""}
    <div class="mc-insp-body" id="mc-insp-scroll">
      ${bodyHtml}
    </div>
  `;
}

function normalizeModelOption(m) {
  if (m && typeof m === "object") {
    const id = String(m.id ?? m.label ?? "");
    const label = String(m.label ?? m.id ?? "");
    return { id, label };
  }
  const s = String(m ?? "");
  return { id: s, label: s };
}

export function renderInspectorComposer(detail, state) {
  if (!detail) return "";
  const rawModels =
    Array.isArray(detail.models) && detail.models.length
      ? detail.models
      : [{ id: "default", label: "Conversation model" }];
  const models = rawModels.map(normalizeModelOption);
  const modes = Array.isArray(detail.modes) && detail.modes.length ? detail.modes : ["default"];

  const modelIds = models.map((m) => m.id);
  const selectedModel =
    state.composerModel && modelIds.includes(state.composerModel)
      ? state.composerModel
      : detail.defaultModel && modelIds.includes(detail.defaultModel)
        ? detail.defaultModel
        : models[0].id;
  const selectedMode =
    state.composerMode && modes.includes(state.composerMode) ? state.composerMode : modes[0];
  const placeholder = detail.composerPlaceholder || "Steer @coordinator or reply to thread...";
  const canSteer = detail.intervention?.canSteer === true;
  const sendMode = canSteer && state.composerSendMode === "steer" ? "steer" : "queue";

  return `
    <div class="mc-composer-wrap">
      <form class="mc-composer" id="mc-composer-form">
        <textarea
          id="mc-composer-input"
          class="mc-composer-input"
          rows="2"
          placeholder="${esc(placeholder)}"
          aria-label="Reply or steer thread"
        >${esc(state.composerDraft || "")}</textarea>
        <div class="mc-composer-bar">
          <div class="mc-composer-left">
            <span style="color:var(--mc-fg-muted);display:inline-flex;">${icon("sliders")}</span>
            <select id="mc-composer-model" disabled class="mc-select-inline" aria-label="Model">
              ${models.map((m) => `<option value="${esc(m.id)}"${m.id === selectedModel ? " selected" : ""}>${esc(m.label)}</option>`).join("")}
            </select>
          </div>
          <div class="mc-composer-right">
            ${
              canSteer
                ? `<select id="mc-composer-send-mode" class="mc-select-inline" aria-label="How to send reply">
              <option value="queue"${sendMode === "queue" ? " selected" : ""}>Queue reply</option>
              <option value="steer"${sendMode === "steer" ? " selected" : ""}>Steer current run</option>
            </select>`
                : ""
            }
            <select id="mc-composer-mode" disabled class="mc-select-inline" aria-label="Execution mode">
              ${modes.map((m) => `<option value="${esc(m)}"${m === selectedMode ? " selected" : ""}>${esc(m)}</option>`).join("")}
            </select>
            <button type="submit" id="mc-composer-send" class="mc-send-btn" title="Send reply (Enter)" aria-label="Send reply"${state.sendingReply ? " disabled" : ""}>
              ${icon("send")}
            </button>
          </div>
        </div>
      </form>
    </div>
  `;
}

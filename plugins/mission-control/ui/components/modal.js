import { dotHtml, esc, icon } from "./icons.js";

export function renderNewThreadModal(snap, options = {}) {
  const projects = Array.isArray(snap?.projects) ? snap.projects : [];
  const models = snap?.models ?? [];
  const selectedProjId = options.projectId || projects[0]?.id || "";

  const projOptions = projects.length
    ? projects
        .map(
          (p) =>
            `<option value="${esc(p.id)}"${p.id === selectedProjId ? " selected" : ""}>${esc(p.name)} (${esc(p.branch || "main")})</option>`,
        )
        .join("")
    : '<option value="default">Current Workspace</option>';

  return `
    <div id="mc-new-thread-modal" class="mc-modal mc-modal-floating" role="document">
      <header class="mc-modal-head" data-modal-drag-handle title="Drag to move · Double-click to reset">
        <div class="mc-modal-head-title">
          <span class="mc-modal-drag-grip" aria-hidden="true">⋮⋮</span>
          <h2 class="mc-modal-title">New Thread</h2>
        </div>
        <button type="button" class="mc-icon-btn" data-close-modal aria-label="Close modal">${icon("close")}</button>
      </header>
      <form id="mc-new-thread-form">
        <div class="mc-modal-body">
          <div class="mc-field">
            <label class="mc-label" for="mc-nt-project">Project</label>
            <select id="mc-nt-project" name="projectId" class="mc-select">${projOptions}</select>
          </div>
          <div class="mc-field">
            <label class="mc-label" for="mc-nt-title">Title (optional)</label>
            <input id="mc-nt-title" name="title" type="text" class="mc-input" placeholder="e.g. Add webhook retry queue">
          </div>
          <div class="mc-field mc-field-grow">
            <label class="mc-label" for="mc-nt-prompt">Prompt</label>
            <textarea id="mc-nt-prompt" name="prompt" class="mc-textarea" required placeholder="Describe what the agent or Team should build, fix, or investigate..."></textarea>
          </div>
          <div class="mc-field"><label class="mc-label" for="mc-nt-model">Model</label><select id="mc-nt-model" name="model" class="mc-select"><option value="">Project default</option>${models.map((model) => `<option value="${esc(model.id)}">${esc(model.label)}</option>`).join("")}</select></div>
          <p class="mc-thread-sub">Starts with approval required. Choose a model if the project has no default.</p>
        </div>
        <footer class="mc-modal-foot">
          <button type="button" class="mc-btn-subtle" data-close-modal>Cancel</button>
          <button type="submit" class="mc-btn-primary" id="mc-nt-submit">Start Thread</button>
        </footer>
      </form>
      <div class="mc-resize-handle mc-resize-n" data-modal-resize="n" aria-hidden="true"></div>
      <div class="mc-resize-handle mc-resize-s" data-modal-resize="s" aria-hidden="true"></div>
      <div class="mc-resize-handle mc-resize-e" data-modal-resize="e" aria-hidden="true"></div>
      <div class="mc-resize-handle mc-resize-w" data-modal-resize="w" aria-hidden="true"></div>
      <div class="mc-resize-handle mc-resize-ne" data-modal-resize="ne" aria-hidden="true"></div>
      <div class="mc-resize-handle mc-resize-nw" data-modal-resize="nw" aria-hidden="true"></div>
      <div class="mc-resize-handle mc-resize-se" data-modal-resize="se" aria-hidden="true" title="Drag to resize"></div>
      <div class="mc-resize-handle mc-resize-sw" data-modal-resize="sw" aria-hidden="true"></div>
    </div>
  `;
}

export function buildPaletteItems(snap, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const items = [
    {
      id: "view-inbox",
      label: "Go to Inbox",
      meta: "View",
      action: { type: "view", view: "inbox" },
    },
    { id: "act-new", label: "Start New Thread", meta: "Action", action: { type: "new-thread" } },
    {
      id: "act-plugins",
      label: "Open Plugins & Sidecars",
      meta: "Drawer",
      action: { type: "open-plugins" },
    },
    {
      id: "view-overview",
      label: "Go to Overview",
      meta: "View",
      action: { type: "view", view: "overview" },
    },
    {
      id: "view-board",
      label: "Go to Board",
      meta: "View",
      action: { type: "view", view: "board" },
    },
    {
      id: "view-timeline",
      label: "Go to Timeline",
      meta: "View",
      action: { type: "view", view: "timeline" },
    },
    {
      id: "view-graph",
      label: "Go to Graph",
      meta: "View",
      action: { type: "view", view: "graph" },
    },
    {
      id: "view-usage",
      label: "Go to Usage & Quotas",
      meta: "View",
      action: { type: "view", view: "usage" },
    },
  ];

  for (const att of snap?.needsAttention || []) {
    items.push({
      id: `att-${att.id}`,
      label: `${att.badgeLabel || "Attention"}: ${att.threadTitle}`,
      meta: att.projectName || "Triage",
      tone: "amber",
      action: { type: "thread", threadId: att.threadId },
    });
  }

  for (const p of snap?.projects || []) {
    items.push({
      id: `proj-${p.id}`,
      label: `New thread in ${p.name}`,
      meta: p.branch || "Project",
      action: { type: "new-thread", projectId: p.id },
    });
    for (const t of p.threads || []) {
      items.push({
        id: `thr-${t.id}`,
        label: t.title || "Untitled thread",
        meta: `${p.name} · ${t.rightLabel || t.status || ""}`,
        tone: t.dotTone || "gray",
        action: { type: "thread", threadId: t.id },
      });
    }
  }

  if (!q) return items.slice(0, 14);
  return items
    .filter((it) => it.label.toLowerCase().includes(q) || it.meta.toLowerCase().includes(q))
    .slice(0, 18);
}

export function renderCommandPalette(items, query, activeIndex = 0) {
  const rows = items.length
    ? items
        .map(
          (it, idx) => `
        <button type="button" class="mc-palette-item${idx === activeIndex ? " active" : ""}" data-palette-idx="${idx}">
          <span style="display:flex;align-items:center;gap:8px;min-width:0;">
            ${it.tone ? dotHtml(it.tone) : ""}
            <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(it.label)}</span>
          </span>
          <span class="mc-palette-kind">${esc(it.meta)}</span>
        </button>
      `,
        )
        .join("")
    : '<div class="mc-thread-sub" style="padding:14px;text-align:center;">No matching commands or threads</div>';

  return `
    <div class="mc-modal" role="document">
      <div class="mc-palette-input-wrap">
        ${icon("search")}
        <input id="mc-palette-input" type="search" class="mc-palette-input" value="${esc(query)}" placeholder="Jump to project, thread, view, or action…" autocomplete="off">
        <span class="mc-kbd">Esc</span>
      </div>
      <div class="mc-palette-list" id="mc-palette-list">${rows}</div>
    </div>
  `;
}

export function renderPluginsDrawer(snap) {
  const plugins = Array.isArray(snap?.plugins) ? snap.plugins : [];

  const listHtml = plugins.length
    ? plugins
        .map((pl) => {
          const sidecars = Array.isArray(pl.sidecars) ? pl.sidecars : [];
          return `
          <article class="mc-activity-card">
            <div class="mc-activity-head">
              <div class="mc-activity-actors">
                ${dotHtml(pl.enabled !== false ? "green" : "gray")}
                <strong>${esc(pl.displayName || pl.name || pl.id)}</strong>
              </div>
              <span class="mc-code-pill">${esc(pl.version || "0.1.0")}</span>
            </div>
            ${pl.description ? `<div class="mc-activity-text">${esc(pl.description)}</div>` : ""}
            <div class="mc-activity-foot">
              <span class="mc-status-badge tone-${pl.builtin ? "blue" : "muted"}">${pl.builtin ? "Built-in" : "User Plugin"}</span>
              ${sidecars.map((sc) => `<span class="mc-code-pill">${esc(sc.displayName || sc.id)}${sc.hasWebUi ? " · Web UI" : ""}</span>`).join("")}
            </div>
          </article>
        `;
        })
        .join("")
    : '<div class="mc-empty"><p class="mc-empty-sub">No installed Phoenix plugins found.</p></div>';

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <h2 class="mc-modal-title">Plugins &amp; Sidecars</h2>
        <div class="mc-thread-sub">${plugins.length} discovered</div>
      </div>
      <button type="button" class="mc-icon-btn" data-action="close-plugins" aria-label="Close drawer">${icon("close")}</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${listHtml}
    </div>
  `;
}

export function renderSettingsPopover(state) {
  const theme = document.documentElement.dataset.theme === "light" ? "Light" : "Dark";
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <strong style="font-size:13px;">Settings</strong>
      <button type="button" class="mc-icon-btn" data-action="close-settings" aria-label="Close settings">${icon("close")}</button>
    </div>

    <div class="mc-setting-row">
      <label for="mc-poll-select" style="font-size:12.5px;font-weight:500;">Refresh Interval</label>
      <select id="mc-poll-select" class="mc-select" style="width:auto;padding:4px 8px;">
        <option value="1500"${state.pollMs === 1500 ? " selected" : ""}>1.5s</option>
        <option value="2000"${state.pollMs === 2000 ? " selected" : ""}>2s</option>
        <option value="5000"${state.pollMs === 5000 ? " selected" : ""}>5s</option>
        <option value="0"${state.pollMs === 0 ? " selected" : ""}>Paused</option>
      </select>
    </div>

    <div class="mc-setting-row">
      <span style="font-size:12px;color:var(--mc-fg-muted);">Host Theme</span>
      <span class="mc-code-pill">${esc(theme)}</span>
    </div>
  `;
}

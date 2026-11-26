import { esc, icon } from "./components/icons.js";
import { createMissionControlDrafts } from "./drafts.js";
import {
  buildPaletteItems,
  renderCommandPalette,
  renderNewThreadModal,
  renderPluginsDrawer,
  renderSettingsPopover,
} from "./components/modal.js";
import { renderBoard } from "./views/board.js";
import { renderGraph } from "./views/graph.js";
import { renderInspectorComposer, renderInspectorContent } from "./views/inspector.js";
import { renderInbox } from "./views/inbox.js";
import { renderOverview } from "./views/overview.js";
import { renderTimeline } from "./views/timeline.js";
import { renderUsage } from "./views/usage.js";

const params = new URLSearchParams(location.search);
const VALID_VIEWS = new Set(["inbox", "overview", "board", "timeline", "graph", "usage"]);
const initialViewParam = String(params.get("view") || "").toLowerCase();
const initialView = VALID_VIEWS.has(initialViewParam) ? initialViewParam : "inbox";

async function apiFetch(url, opts = {}) {
  await window.phoenix.ready;
  return window.phoenix.fetch(url, opts);
}

const state = {
  view: initialView, // overview | board | timeline | graph | usage
  inboxScope: "active",
  triageUndo: null,
  mutationInFlight: false,
  lastRefreshedAt: null,
  filter: "all", // all | attention | running
  search: "",
  usage: null,
  usageLoading: false,
  usageFetchedAt: 0,
  usageFilter: "all", // all | gemini | claude | gpt | low
  usageMode: "families", // families | variants
  etag: "",
  snap: null,
  selectedThreadId: "",
  detail: null,
  detailError: null,
  detailKey: "",
  composerKey: "",
  inspectorTab: "activity", // activity | swarm | files | diff
  inspectorDiffFile: "all",
  inspectorOpen: false, // mobile / <1100px slide-over drawer
  composerDraft: "",
  composerModel: "",
  composerMode: "",
  composerSendMode: "queue",
  sendingReply: false,
  pollMs: 5000,
  pluginsOpen: false,
  settingsOpen: false,
  modal: null, // null | { type: 'new-thread', projectId } | { type: 'palette', query, index }
  newThreadModalRect: null, // remembered { left, top, width, height } for draggable/resizable modal
};

let draftStorageWarningShown = false;
const drafts = createMissionControlDrafts(window.phoenix.drafts, () => {
  if (!draftStorageWarningShown) {
    draftStorageWarningShown = true;
    showToast(
      "Could not save your draft on this device. Keep Mission Control open and copy your reply.",
      "red",
    );
  }
});

async function restoreComposerDraft(threadId) {
  const text = await drafts.load(threadId);
  if (
    state.selectedThreadId === threadId &&
    (state.composerDraft !== text || state.sendingReply !== drafts.isSending(threadId))
  ) {
    state.composerDraft = text;
    renderInspector(true);
  }
}

let modalBackdropPointerDown = false;

const $ = (id) => document.getElementById(id);

function withQuery(path, extra = {}) {
  const qs = new URLSearchParams();
  const convId = window.phoenix?.conversationId || params.get("conversationId") || "";
  if (convId) qs.set("conversationId", convId);
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const qStr = qs.toString();
  return qStr ? `${path}?${qStr}` : path;
}

function plural(n, word) {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

function findProjectForThread(threadId) {
  for (const p of state.snap?.projects || []) {
    if ((p.threads || []).some((t) => t.id === threadId)) return p;
  }
  return null;
}

function showToast(message, tone = "neutral") {
  const root = $("mc-toast-root");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `mc-toast tone-${tone}`;
  el.textContent = String(message || "");
  root.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3200);
}

let pollTimer = null;
let fetchInFlight = false;

async function fetchJson(url, opts) {
  const res = await apiFetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function loadThreadDetail(threadId, force = false) {
  if (!threadId) {
    state.detail = null;
    renderInspector();
    return;
  }
  void restoreComposerDraft(threadId);
  try {
    const detail = await fetchJson(withQuery("/api/thread", { id: threadId }));
    if (state.selectedThreadId !== threadId) return;
    if (state.detail?.activeRunId !== detail.activeRunId) state.composerSendMode = "queue";
    state.detailError = null;
    state.detail = detail;
    renderInspector(force);
  } catch (err) {
    if (state.selectedThreadId !== threadId) return;
    if (!state.detail || state.detail.id !== threadId) {
      state.detail = null;
      renderInspector(true);
    }
    state.detailError = "Unable to refresh this thread. Showing its last loaded details.";
    renderInspector();
    if (force) showToast(err.message, "red");
  }
}

let usageInFlight = false;
const USAGE_POLL_MS = 30000;

async function loadUsage(force = false) {
  if (usageInFlight) return;
  usageInFlight = true;
  state.usageLoading = true;
  if (state.view === "usage" && (!state.usage || force)) {
    renderActiveView();
  }
  try {
    const data = await fetchJson(withQuery("/api/usage", force ? { refresh: "1" } : {}), {
      method: "GET",
    });
    state.usage = data;
    state.usageFetchedAt = Date.now();
  } catch (err) {
    if (!state.usage) {
      state.usage = {
        available: false,
        error: err?.message || "Unable to query Phoenix usage meters",
      };
    } else if (force) {
      showToast(err?.message || "Failed to refresh usage meters", "red");
    }
  } finally {
    state.usageLoading = false;
    usageInFlight = false;
    if (state.view === "usage") {
      renderActiveView();
    }
  }
}

function renderFatalError(title, detail) {
  const subtitle = $("mc-subtitle");
  if (subtitle && (!state.snap || subtitle.textContent.startsWith("Loading"))) {
    subtitle.textContent = "Unable to load workspaces";
  }
  const view = $("mc-view");
  if (view) {
    view.innerHTML = `
      <div class="mc-empty">
        <p class="mc-empty-title">${esc(title || "Unable to load Mission Control")}</p>
        <p class="mc-empty-sub">${esc(detail || "Unexpected error")}</p>
        <button type="button" class="mc-btn-subtle" data-action="retry-poll">Retry</button>
      </div>
    `;
  }
}

async function pollDashboard(force = false) {
  if (fetchInFlight || document.hidden || window.phoenix.visible === false) return;
  fetchInFlight = true;
  try {
    const url = withQuery("/api/dashboard", { etag: force ? "" : state.etag });
    const data = await fetchJson(url, { method: "GET" });
    state.lastRefreshedAt = new Date().toLocaleTimeString();
    $("mc-freshness")?.classList.add("hidden");
    if (!data.unchanged) {
      state.snap = data;
      state.etag = data.etag || "";
      if (!state.selectedThreadId) {
        state.selectedThreadId =
          data.defaultThreadId ||
          data.projects?.find((p) => p.threads?.length)?.threads?.[0]?.id ||
          "";
      }
      renderShell();
    }
    if (
      state.selectedThreadId &&
      state.view !== "usage" &&
      (window.innerWidth >= 1100 || state.inspectorOpen)
    ) {
      await loadThreadDetail(state.selectedThreadId, force);
    }
    if (
      state.view === "usage" &&
      (!state.usage || Date.now() - state.usageFetchedAt >= USAGE_POLL_MS)
    ) {
      loadUsage(false);
    }
  } catch (err) {
    if (!state.snap || $("mc-subtitle")?.textContent?.startsWith("Loading")) {
      renderFatalError("Unable to reach Mission Control API", err?.message || String(err));
    } else {
      const notice = $("mc-freshness");
      if (notice) {
        notice.textContent = `Updates unavailable. Displaying cached work from ${state.lastRefreshedAt || "an earlier connection"}. Actions will be validated against current server state.`;
        notice.classList.remove("hidden");
      }
    }
  } finally {
    fetchInFlight = false;
  }
}

function resetPollTimer() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (state.pollMs > 0 && !document.hidden && window.phoenix.visible !== false) {
    pollTimer = setInterval(() => {
      pollDashboard(false);
    }, state.pollMs);
  }
}

function syncVisibility() {
  if (document.hidden || window.phoenix.visible === false) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  } else {
    pollDashboard(false);
    resetPollTimer();
  }
}
document.addEventListener("visibilitychange", syncVisibility);
window.addEventListener("phoenix-visibilitychange", syncVisibility);

function renderRail() {
  const rail = $("mc-rail");
  const overviewActive = state.view === "inbox" && !state.pluginsOpen && !state.settingsOpen;
  const timelineActive = state.view === "timeline" && !state.pluginsOpen && !state.settingsOpen;
  const usageActive = state.view === "usage" && !state.pluginsOpen && !state.settingsOpen;

  rail.innerHTML = `
    <button type="button" class="mc-rail-btn${overviewActive ? " active" : ""}" data-rail-view="inbox" title="Mission Control Inbox">
      ${icon("grid")}
    </button>
    <button type="button" class="mc-rail-btn" data-action="new-thread" title="New Thread" aria-label="New Thread">
      ${icon("plus")}
    </button>
    <button type="button" class="mc-rail-btn${timelineActive ? " active" : ""}" data-rail-view="timeline" title="Timeline" aria-label="Timeline">
      ${icon("clock")}
    </button>
    <button type="button" class="mc-rail-btn${usageActive ? " active" : ""}" data-rail-view="usage" title="Usage & Quota Meters" aria-label="Usage and Quota Meters">
      ${icon("gauge")}
    </button>
    <button type="button" class="mc-rail-btn${state.pluginsOpen ? " active" : ""}" data-action="toggle-plugins" title="Plugins & Sidecars" aria-label="Plugins and Sidecars">
      ${icon("puzzle")}
    </button>
    <div class="mc-rail-spacer"></div>
    <button type="button" class="mc-rail-btn${state.settingsOpen ? " active" : ""}" data-action="toggle-settings" title="Settings" aria-label="Settings">
      ${icon("gear")}
    </button>
  `;
}

function renderHeader() {
  const summary = state.snap?.summary || {};
  const pCount = summary.projectCount ?? (state.snap?.projects?.length || 0);
  const tCount = summary.threadCount ?? 0;
  const sCount = summary.liveTeamCount ?? 0;
  const aCount = summary.needsAttentionCount ?? (state.snap?.needsAttention?.length || 0);
  const rCount = summary.runningCount ?? 0;
  const isUsage = state.view === "usage";

  if (state.snap) {
    $("mc-subtitle").textContent =
      `${plural(pCount, "Project")} · ${plural(tCount, "Thread")} · ${plural(sCount, "Team")}${state.snap.truncated ? " · Showing recent threads" : ""}`;
  }
  $("mc-count-attention").textContent = String(aCount);
  $("mc-count-running").textContent = String(rCount);

  $("mc-app")?.classList.toggle("is-full-width", isUsage);
  $("mc-filters")?.classList.toggle("hidden", isUsage || state.view === "inbox");
  const searchInput = $("mc-search");
  if (searchInput) {
    searchInput.placeholder = isUsage ? "Search models & pools..." : "Search projects & threads...";
    searchInput.setAttribute(
      "aria-label",
      isUsage ? "Search models and quota pools" : "Search projects and threads",
    );
  }

  document.querySelectorAll("#mc-view-tabs .mc-seg-btn").forEach((btn) => {
    const active = btn.dataset.view === state.view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });

  document.querySelectorAll("#mc-filters .mc-filter-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.filter === state.filter);
  });
}

function renderActiveView() {
  const container = $("mc-view");
  if (state.view === "usage") {
    container.innerHTML = renderUsage(state.usage, state);
    return;
  }

  if (!state.snap) {
    container.innerHTML =
      '<div class="mc-empty"><p class="mc-empty-sub">Scanning projects, Git worktrees, Teams, and scheduled jobs…</p></div>';
    return;
  }

  if (state.view === "inbox") {
    container.innerHTML = renderInbox(state.snap, state);
  } else if (state.view === "board") {
    container.innerHTML = renderBoard(state.snap, state);
  } else if (state.view === "timeline") {
    container.innerHTML = renderTimeline(state.snap, state);
  } else if (state.view === "graph") {
    container.innerHTML = renderGraph(state.snap, state);
    wireGraphHover();
  } else {
    container.innerHTML = renderOverview(state.snap, state);
  }
}

function wireGraphHover() {
  const svg = document.querySelector(".mc-graph-svg");
  if (!svg) return;
  const edges = [...svg.querySelectorAll(".mc-graph-edge")];
  svg.addEventListener("mouseover", (e) => {
    const node = e.target.closest("[data-graph-node]");
    if (!node) return;
    const id = node.dataset.graphNode;
    for (const edge of edges) {
      const hit = edge.dataset.edgeFrom === id || edge.dataset.edgeTo === id;
      edge.classList.toggle("is-highlight", hit);
    }
  });
  svg.addEventListener("mouseout", (e) => {
    if (!e.target.closest("[data-graph-node]")) return;
    for (const edge of edges) edge.classList.remove("is-highlight");
  });
}

function ensureInspectorContainers() {
  const insp = $("mc-inspector");
  let main = $("mc-insp-main");
  let foot = $("mc-insp-foot");
  if (!main || !foot) {
    insp.innerHTML =
      '<div id="mc-insp-main" style="display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden;"></div><div id="mc-insp-foot"></div>';
    main = $("mc-insp-main");
    foot = $("mc-insp-foot");
  }
  return { insp, main, foot };
}

function renderInspector(force = false) {
  state.composerDraft = drafts.get(state.selectedThreadId);
  state.sendingReply = drafts.isSending(state.selectedThreadId);
  const { insp, main, foot } = ensureInspectorContainers();
  insp.classList.toggle("is-open", state.inspectorOpen);
  syncBackdrop();

  const project = state.detail ? findProjectForThread(state.detail.id) : null;
  const nextDetailKey = JSON.stringify(
    {
      detail: state.detail,
      tab: state.inspectorTab,
      diffFile: state.inspectorDiffFile,
      projectPath: project?.path || "",
      error: state.detailError,
    },
    (key, value) => (key === "capturedAt" ? undefined : value),
  );

  if (force || nextDetailKey !== state.detailKey) {
    const prevScroll = $("mc-insp-scroll")?.scrollTop || 0;
    const expandedEvidence = [...main.querySelectorAll("details[data-evidence-id][open]")].map(
      (node) => node.dataset.evidenceId,
    );
    main.innerHTML = renderInspectorContent(state.detail, state, project?.path || "");
    for (const node of main.querySelectorAll("details[data-evidence-id]")) {
      if (expandedEvidence.includes(node.dataset.evidenceId)) node.open = true;
    }
    state.detailKey = nextDetailKey;
    const nextScroll = $("mc-insp-scroll");
    if (nextScroll && prevScroll > 0) nextScroll.scrollTop = prevScroll;
  }

  const composerDetail = state.detail?.id === state.selectedThreadId ? state.detail : null;
  const nextComposerKey = JSON.stringify({
    id: composerDetail?.id || "",
    models: composerDetail?.models || null,
    modes: composerDetail?.modes || null,
    placeholder: composerDetail?.composerPlaceholder || "",
    intervention: composerDetail?.intervention || null,
    sending: state.sendingReply,
  });

  if (force || nextComposerKey !== state.composerKey) {
    const activeEl = document.activeElement;
    const wasFocused = activeEl && activeEl.id === "mc-composer-input";
    const selStart = wasFocused ? activeEl.selectionStart : null;
    const selEnd = wasFocused ? activeEl.selectionEnd : null;

    foot.innerHTML = renderInspectorComposer(composerDetail, state);
    state.composerKey = nextComposerKey;

    const input = $("mc-composer-input");
    if (input) {
      autoResizeTextarea(input);
      if (wasFocused) {
        input.focus();
        if (selStart !== null && selEnd !== null) input.setSelectionRange(selStart, selEnd);
      }
    }
  }
}

function renderShell() {
  renderRail();
  renderHeader();
  renderActiveView();
  renderInspector(false);
  if (state.pluginsOpen) {
    $("mc-plugins-drawer").innerHTML = renderPluginsDrawer(state.snap);
  }
  if (state.settingsOpen) {
    $("mc-settings-popover").innerHTML = renderSettingsPopover(state);
  }
}

function syncBackdrop() {
  const show =
    state.pluginsOpen ||
    (state.view !== "usage" && state.inspectorOpen && window.innerWidth < 1100);
  $("mc-backdrop").classList.toggle("hidden", !show);
}

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(120, Math.max(36, el.scrollHeight))}px`;
}

function openPluginsDrawer() {
  state.settingsOpen = false;
  $("mc-settings-popover").classList.add("hidden");
  state.pluginsOpen = true;
  const drawer = $("mc-plugins-drawer");
  drawer.innerHTML = renderPluginsDrawer(state.snap);
  drawer.classList.remove("hidden");
  syncBackdrop();
  renderRail();
}

function closePluginsDrawer() {
  state.pluginsOpen = false;
  $("mc-plugins-drawer").classList.add("hidden");
  syncBackdrop();
  renderRail();
}

function toggleSettingsPopover() {
  closePluginsDrawer();
  state.settingsOpen = !state.settingsOpen;
  const pop = $("mc-settings-popover");
  if (state.settingsOpen) {
    pop.innerHTML = renderSettingsPopover(state);
    pop.classList.remove("hidden");
  } else {
    pop.classList.add("hidden");
  }
  renderRail();
}

function closeSettingsPopover() {
  state.settingsOpen = false;
  $("mc-settings-popover").classList.add("hidden");
  renderRail();
}

const FLOATING_MODAL_MIN_W = 360;
const FLOATING_MODAL_MIN_H = 360;
const FLOATING_MODAL_PAD = 12;

function getDefaultNewThreadRect(modalEl) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(540, Math.max(FLOATING_MODAL_MIN_W, vw - 32));
  const naturalH = modalEl ? Math.ceil(modalEl.getBoundingClientRect().height) : 480;
  const height = Math.min(Math.max(naturalH, 440), Math.max(FLOATING_MODAL_MIN_H, vh - 96));
  const left = Math.max(FLOATING_MODAL_PAD, Math.round((vw - width) / 2));
  const top = Math.max(FLOATING_MODAL_PAD, Math.min(68, Math.round((vh - height) / 2)));
  return { left, top, width, height };
}

function clampFloatingModalRect(rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.max(FLOATING_MODAL_MIN_W, vw - FLOATING_MODAL_PAD * 2);
  const maxH = Math.max(FLOATING_MODAL_MIN_H, vh - FLOATING_MODAL_PAD * 2);
  const width = Math.round(Math.min(maxW, Math.max(FLOATING_MODAL_MIN_W, rect.width)));
  const height = Math.round(Math.min(maxH, Math.max(FLOATING_MODAL_MIN_H, rect.height)));
  const minVisibleX = Math.min(80, width);
  const left = Math.round(Math.min(vw - minVisibleX, Math.max(minVisibleX - width, rect.left)));
  const top = Math.round(Math.min(vh - 48, Math.max(FLOATING_MODAL_PAD, rect.top)));
  return { left, top, width, height };
}

function applyFloatingModalRect(modalEl, rect) {
  if (!modalEl || !rect) return;
  const clamped = clampFloatingModalRect(rect);
  modalEl.style.left = `${clamped.left}px`;
  modalEl.style.top = `${clamped.top}px`;
  modalEl.style.width = `${clamped.width}px`;
  modalEl.style.height = `${clamped.height}px`;
  state.newThreadModalRect = clamped;
}

function initFloatingModal(modalEl) {
  if (!modalEl) return;
  const initial = state.newThreadModalRect
    ? clampFloatingModalRect(state.newThreadModalRect)
    : getDefaultNewThreadRect(modalEl);
  applyFloatingModalRect(modalEl, initial);

  const dragHandle = modalEl.querySelector("[data-modal-drag-handle]");
  if (dragHandle) {
    dragHandle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button, input, select, textarea, a")) return;
      e.preventDefault();
      modalBackdropPointerDown = false;
      const startX = e.clientX;
      const startY = e.clientY;
      const startRect = state.newThreadModalRect || getDefaultNewThreadRect(modalEl);
      modalEl.classList.add("is-dragging");
      dragHandle.setPointerCapture?.(e.pointerId);

      const onMove = (ev) => {
        applyFloatingModalRect(modalEl, {
          left: startRect.left + (ev.clientX - startX),
          top: startRect.top + (ev.clientY - startY),
          width: startRect.width,
          height: startRect.height,
        });
      };

      const onUp = (ev) => {
        modalEl.classList.remove("is-dragging");
        if (dragHandle.hasPointerCapture?.(ev.pointerId)) {
          dragHandle.releasePointerCapture(ev.pointerId);
        }
        dragHandle.removeEventListener("pointermove", onMove);
        dragHandle.removeEventListener("pointerup", onUp);
        dragHandle.removeEventListener("pointercancel", onUp);
      };

      dragHandle.addEventListener("pointermove", onMove);
      dragHandle.addEventListener("pointerup", onUp);
      dragHandle.addEventListener("pointercancel", onUp);
    });

    dragHandle.addEventListener("dblclick", (e) => {
      if (e.target.closest("button, input, select, textarea, a")) return;
      state.newThreadModalRect = null;
      modalEl.style.height = "";
      applyFloatingModalRect(modalEl, getDefaultNewThreadRect(modalEl));
    });
  }

  for (const handle of modalEl.querySelectorAll("[data-modal-resize]")) {
    const dir = handle.dataset.modalResize || "";
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      modalBackdropPointerDown = false;
      const startX = e.clientX;
      const startY = e.clientY;
      const startRect = state.newThreadModalRect || getDefaultNewThreadRect(modalEl);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      modalEl.classList.add("is-resizing");
      handle.setPointerCapture?.(e.pointerId);

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let { left, top, width, height } = startRect;

        if (dir.includes("e")) {
          width = Math.min(
            vw - FLOATING_MODAL_PAD - left,
            Math.max(FLOATING_MODAL_MIN_W, startRect.width + dx),
          );
        }
        if (dir.includes("s")) {
          height = Math.min(
            vh - FLOATING_MODAL_PAD - top,
            Math.max(FLOATING_MODAL_MIN_H, startRect.height + dy),
          );
        }
        if (dir.includes("w")) {
          const right = startRect.left + startRect.width;
          const nextLeft = Math.max(
            FLOATING_MODAL_PAD,
            Math.min(right - FLOATING_MODAL_MIN_W, startRect.left + dx),
          );
          left = nextLeft;
          width = right - nextLeft;
        }
        if (dir.includes("n")) {
          const bottom = startRect.top + startRect.height;
          const nextTop = Math.max(
            FLOATING_MODAL_PAD,
            Math.min(bottom - FLOATING_MODAL_MIN_H, startRect.top + dy),
          );
          top = nextTop;
          height = bottom - nextTop;
        }

        applyFloatingModalRect(modalEl, { left, top, width, height });
      };

      const onUp = (ev) => {
        modalEl.classList.remove("is-resizing");
        if (handle.hasPointerCapture?.(ev.pointerId)) {
          handle.releasePointerCapture(ev.pointerId);
        }
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }
}

function openNewThreadModal(projectId = "") {
  if (!state.snap?.projects?.length) {
    showToast(
      state.snap ? "Add a project in Phoenix first." : "Projects are still loading.",
      "amber",
    );
    return;
  }
  closeSettingsPopover();
  state.modal = { type: "new-thread", projectId };
  const root = $("mc-modal-root");
  root.innerHTML = renderNewThreadModal(state.snap, { projectId });
  root.classList.remove("hidden");
  initFloatingModal($("mc-new-thread-modal"));
  $("mc-nt-prompt")?.focus();
}

function openPaletteModal() {
  closeSettingsPopover();
  const query = "";
  const items = buildPaletteItems(state.snap, query);
  state.modal = { type: "palette", query, index: 0, items };
  const root = $("mc-modal-root");
  root.innerHTML = renderCommandPalette(items, query, 0);
  root.classList.remove("hidden");
  $("mc-palette-input")?.focus();
}

function updatePalette(query) {
  if (state.modal?.type !== "palette") return;
  const items = buildPaletteItems(state.snap, query);
  state.modal.query = query;
  state.modal.items = items;
  state.modal.index = Math.min(state.modal.index, Math.max(0, items.length - 1));
  const list = $("mc-palette-list");
  if (!list) return;
  const temp = document.createElement("div");
  temp.innerHTML = renderCommandPalette(items, query, state.modal.index);
  const nextList = temp.querySelector("#mc-palette-list");
  if (nextList) list.innerHTML = nextList.innerHTML;
}

function closeModal() {
  state.modal = null;
  $("mc-modal-root").classList.add("hidden");
  $("mc-modal-root").innerHTML = "";
}

function runPaletteItem(item) {
  if (!item?.action) return;
  closeModal();
  const act = item.action;
  if (act.type === "new-thread") openNewThreadModal(act.projectId || "");
  else if (act.type === "open-plugins") openPluginsDrawer();
  else if (act.type === "view") setView(act.view);
  else if (act.type === "thread") selectThread(act.threadId);
}

function setView(view) {
  state.view = VALID_VIEWS.has(view) ? view : "inbox";
  renderRail();
  renderHeader();
  syncBackdrop();
  renderActiveView();
  if (
    state.view === "usage" &&
    (!state.usage || Date.now() - state.usageFetchedAt >= USAGE_POLL_MS)
  ) {
    loadUsage(false);
  }
}

function setFilter(filter) {
  state.filter = filter;
  renderHeader();
  renderActiveView();
}

function attentionItem(threadId) {
  return [
    ...(state.snap?.needsAttention ?? []),
    ...(state.snap?.snoozedAttention ?? []),
    ...(state.snap?.acceptedAttention ?? []),
    ...(state.snap?.dismissedAttention ?? []),
  ].find((item) => item.threadId === threadId);
}

async function triageThread(threadId, disposition, undoing = false, expected = null) {
  if (disposition === "review") {
    handleOpenFull(threadId);
    return;
  }
  if (state.mutationInFlight) return;
  const item = attentionItem(threadId);
  const card = findProjectForThread(threadId)?.threads?.find((thread) => thread.id === threadId);
  if (!item && !card) {
    showToast("Refresh the inbox before changing this item.", "amber");
    return;
  }
  const expectedLatestRunId = expected
    ? expected.latestRunId
    : (item?.latestRunId ?? card?.latestRunId ?? null);
  const expectedRequestId = expected
    ? expected.requestId
    : (item?.pendingRequestId ?? card?.pendingRequestId ?? null);
  state.mutationInFlight = true;
  renderActiveView();
  renderInspector(true);
  try {
    await fetchJson("/api/triage", {
      method: "POST",
      body: JSON.stringify({
        threadId,
        disposition,
        expectedLatestRunId,
        expectedRequestId,
        ...(disposition === "snooze"
          ? { snoozedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString() }
          : {}),
      }),
    });
    const reverse = {
      accept: "reopen",
      dismiss: "reopen",
      reopen: item?.dismissed || card?.dismissed ? "dismiss" : "accept",
      snooze: "unsnooze",
      unsnooze: "snooze",
    }[disposition];
    state.triageUndo = undoing
      ? null
      : {
          threadId,
          disposition: reverse,
          expectedLatestRunId,
          expectedRequestId,
        };
    state.etag = "";
    await pollDashboard(true);
    renderTriageUndo();
  } catch (error) {
    showToast(error.message || "This item changed. Refresh and try again.", "red");
    await pollDashboard(true);
  } finally {
    state.mutationInFlight = false;
    renderActiveView();
    renderInspector(true);
  }
}

function renderTriageUndo() {
  const root = $("mc-undo");
  if (!root) return;
  root.classList.toggle("hidden", !state.triageUndo);
}

async function undoTriage() {
  const last = state.triageUndo;
  if (!last) return;
  const current =
    attentionItem(last.threadId) ??
    findProjectForThread(last.threadId)?.threads?.find((thread) => thread.id === last.threadId);
  if (
    !current ||
    (current.latestRunId ?? null) !== last.expectedLatestRunId ||
    (current.pendingRequestId ?? null) !== last.expectedRequestId
  ) {
    state.triageUndo = null;
    renderTriageUndo();
    showToast("New work arrived. Review the current item before changing it.", "amber");
    return;
  }
  await triageThread(last.threadId, last.disposition, true, {
    latestRunId: last.expectedLatestRunId,
    requestId: last.expectedRequestId,
  });
}

function nextAttention() {
  const items = state.snap?.needsAttention ?? [];
  if (!items.length) return;
  const index = items.findIndex((item) => item.threadId === state.selectedThreadId);
  const next = items[(index + 1) % items.length];
  state.inboxScope = "active";
  if (next) selectThread(next.threadId, { tab: "activity", openDrawer: true });
}

async function controlThread(threadId, command) {
  if (state.mutationInFlight || state.detail?.id !== threadId) return;
  const expectedRunId = state.detail.activeRunId ?? state.detail.latestRunId;
  if (!expectedRunId) return;
  state.mutationInFlight = true;
  renderInspector(true);
  try {
    await fetchJson("/api/control", {
      method: "POST",
      body: JSON.stringify({ threadId, command, expectedRunId }),
    });
    state.etag = "";
    await pollDashboard(true);
  } catch (error) {
    showToast(error.message || "The run changed. Refresh before retrying.", "red");
  } finally {
    state.mutationInFlight = false;
    renderInspector(true);
  }
}

async function selectThread(threadId, opts = {}) {
  if (!threadId) return;
  if (state.view === "usage") {
    state.view = "inbox";
    renderRail();
    renderHeader();
  }
  const changed = state.selectedThreadId !== threadId;
  state.selectedThreadId = threadId;
  if (changed) {
    state.detail = null;
    state.detailError = null;
    state.composerDraft = drafts.get(threadId);
    state.composerModel = "";
    state.composerMode = "";
    state.composerSendMode = "queue";
    state.inspectorDiffFile = "all";
  }
  if (opts.tab) state.inspectorTab = opts.tab;
  if (window.innerWidth < 1100) state.inspectorOpen = true;

  renderActiveView();
  renderInspector(true);
  await loadThreadDetail(threadId, true);
  if (opts.focusComposer && state.selectedThreadId === threadId) {
    setTimeout(() => $("mc-composer-input")?.focus(), 40);
  }
}

async function handleSendReply() {
  const threadId = state.selectedThreadId;
  if (!threadId || drafts.isSending(threadId) || state.detail?.id !== threadId) return;
  const input = $("mc-composer-input");
  const text = input?.value ?? state.composerDraft;
  if (!text.trim()) return;
  void drafts.set(threadId, text);
  const sendMode = $("mc-composer-send-mode")?.value || "queue";
  const expectedActiveRunId = state.detail.intervention?.expectedActiveRunId;

  try {
    const sending = drafts.send(threadId, (message) =>
      fetchJson("/api/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message, sendMode, expectedActiveRunId }),
      }),
    );
    renderInspector(true);
    await sending;
    if (state.selectedThreadId === threadId) renderInspector(true);
    state.etag = "";
    showToast(
      sendMode === "steer" ? "Steering sent" : expectedActiveRunId ? "Reply queued" : "Reply sent",
      "green",
    );
    await pollDashboard(true);
  } catch (err) {
    if (state.selectedThreadId === threadId) renderInspector(true);
    showToast(err.message || "Failed to send reply", "red");
  }
}

async function handleCreateThread(form) {
  const fd = new FormData(form);
  const projectId = String(fd.get("projectId") || "").trim();
  const title = String(fd.get("title") || "").trim();
  const prompt = String(fd.get("prompt") || "").trim();

  if (!projectId || !prompt) {
    showToast("Project and prompt are required", "red");
    return;
  }

  const submitBtn = $("mc-nt-submit");
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetchJson("/api/threads/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        title: title || undefined,
        prompt,
        model: String(fd.get("model") || ""),
      }),
    });
    closeModal();
    showToast("Thread launched", "green");
    state.etag = "";
    if (res.threadId) {
      await selectThread(res.threadId, { tab: "activity" });
    }
    await pollDashboard(true);
  } catch (err) {
    if (submitBtn) submitBtn.disabled = false;
    showToast(err.message || "Failed to start thread", "red");
  }
}

function handleOpenFull(threadId) {
  if (!threadId) return;
  if (window.phoenix?.ui?.toggleConversation) {
    window.phoenix.ui.toggleConversation(threadId);
    return;
  }
  if (window.innerWidth < 1100) state.inspectorOpen = true;
  state.inspectorTab = "activity";
  renderInspector(true);
  showToast("Opened full thread inspector");
}

function handleOpenFile(relPath) {
  const proj = state.detail ? findProjectForThread(state.detail.id) : null;
  if (window.phoenix?.ui?.toggleAuxPane && proj?.path) {
    const cleanBase = proj.path.replace(/\/+$/, "");
    const cleanRel = String(relPath || "").replace(/^\/+/, "");
    window.phoenix.ui.toggleAuxPane({
      tabType: "fileView",
      uri: `file://${cleanBase}/${cleanRel}`,
    });
    return;
  }
  state.inspectorTab = "diff";
  state.inspectorDiffFile = relPath;
  renderInspector(true);
}

document.addEventListener("pointerdown", (e) => {
  modalBackdropPointerDown = e.target === $("mc-modal-root");
});

document.addEventListener("click", (e) => {
  const railView = e.target.closest("[data-rail-view]");
  if (railView) {
    closePluginsDrawer();
    closeSettingsPopover();
    setView(railView.dataset.railView);
    return;
  }

  const segBtn = e.target.closest("#mc-view-tabs .mc-seg-btn");
  if (segBtn) {
    setView(segBtn.dataset.view);
    return;
  }

  const filterPill = e.target.closest("#mc-filters .mc-filter-pill");
  if (filterPill) {
    setFilter(filterPill.dataset.filter);
    return;
  }

  const usageFilterBtn = e.target.closest("[data-usage-filter]");
  if (usageFilterBtn) {
    state.usageFilter = usageFilterBtn.dataset.usageFilter || "all";
    renderActiveView();
    return;
  }

  const usageModeBtn = e.target.closest("[data-usage-mode]");
  if (usageModeBtn) {
    state.usageMode = usageModeBtn.dataset.usageMode === "variants" ? "variants" : "families";
    renderActiveView();
    return;
  }

  const triage = e.target.closest("[data-triage-action]");
  if (triage) {
    e.stopPropagation();
    void triageThread(triage.dataset.threadId, triage.dataset.triageAction, false, {
      latestRunId: triage.dataset.runId || null,
      requestId: triage.dataset.requestId || null,
    });
    return;
  }
  const control = e.target.closest("[data-control-thread]");
  if (control) {
    void controlThread(control.dataset.controlThread, control.dataset.controlAction);
    return;
  }
  const inboxScope = e.target.closest("[data-inbox-scope]");
  if (inboxScope) {
    state.inboxScope = inboxScope.dataset.inboxScope;
    renderActiveView();
    return;
  }
  const attAction = e.target.closest("[data-attention-action]");
  if (attAction) {
    e.stopPropagation();
    const act = attAction.dataset.attentionAction;
    const threadId = attAction.dataset.threadId;
    if (act === "dismiss") void triageThread(threadId, "dismiss");
    else if (act === "diff") selectThread(threadId, { tab: "diff", openDrawer: true });
    else if (act === "reply")
      selectThread(threadId, { tab: "activity", openDrawer: true, focusComposer: true });
    else if (act === "open") {
      selectThread(threadId, { tab: "activity", openDrawer: true });
      handleOpenFull(threadId);
    } else selectThread(threadId, { tab: "activity", openDrawer: true });
    return;
  }

  const openFileBtn = e.target.closest("[data-open-file]");
  if (openFileBtn) {
    e.stopPropagation();
    handleOpenFile(openFileBtn.dataset.openFile);
    return;
  }

  const jumpDiff = e.target.closest("[data-jump-diff]");
  if (jumpDiff) {
    state.inspectorTab = "diff";
    state.inspectorDiffFile = jumpDiff.dataset.jumpDiff;
    renderInspector(true);
    return;
  }

  const diffChip = e.target.closest("[data-diff-file]");
  if (diffChip) {
    state.inspectorDiffFile = diffChip.dataset.diffFile;
    renderInspector(true);
    return;
  }

  const inspTab = e.target.closest("[data-insp-tab]");
  if (inspTab) {
    state.inspectorTab = inspTab.dataset.inspTab;
    renderInspector(true);
    return;
  }

  const openConv = e.target.closest("[data-open-conv]");
  if (openConv) {
    window.phoenix?.ui?.toggleConversation?.(openConv.dataset.openConv);
    return;
  }

  const newProjBtn = e.target.closest("[data-new-thread-project]");
  if (newProjBtn) {
    e.stopPropagation();
    openNewThreadModal(newProjBtn.dataset.newThreadProject);
    return;
  }

  const selThread = e.target.closest("[data-select-thread]");
  if (selThread) {
    selectThread(selThread.dataset.selectThread, { openDrawer: true });
    return;
  }

  const paletteBtn = e.target.closest("[data-palette-idx]");
  if (paletteBtn && state.modal?.type === "palette") {
    const item = state.modal.items?.[Number(paletteBtn.dataset.paletteIdx)];
    runPaletteItem(item);
    return;
  }

  if (
    e.target.closest("[data-close-modal]") ||
    (e.target === $("mc-modal-root") && modalBackdropPointerDown)
  ) {
    modalBackdropPointerDown = false;
    closeModal();
    return;
  }

  const actionEl = e.target.closest("[data-action]");
  if (actionEl) {
    const action = actionEl.dataset.action;
    if (action === "next-attention") nextAttention();
    else if (action === "undo-triage") void undoTriage();
    else if (action === "new-thread") openNewThreadModal("");
    else if (action === "toggle-plugins") {
      if (state.pluginsOpen) closePluginsDrawer();
      else openPluginsDrawer();
    } else if (action === "close-plugins") closePluginsDrawer();
    else if (action === "toggle-settings") toggleSettingsPopover();
    else if (action === "close-settings") closeSettingsPopover();
    else if (action === "refresh-usage") loadUsage(true);
    else if (action === "clear-filters") {
      state.filter = "all";
      state.search = "";
      if ($("mc-search")) $("mc-search").value = "";
      renderHeader();
      renderActiveView();
    } else if (action === "retry-poll") {
      pollDashboard(true);
    } else if (action === "close-inspector") {
      state.inspectorOpen = false;
      renderInspector(false);
    } else if (action === "open-full") {
      handleOpenFull(actionEl.dataset.threadId);
    }
    return;
  }

  if (e.target === $("mc-backdrop")) {
    closePluginsDrawer();
    state.inspectorOpen = false;
    renderInspector(false);
    return;
  }

  if (
    state.settingsOpen &&
    !e.target.closest("#mc-settings-popover") &&
    !e.target.closest('[data-action="toggle-settings"]')
  ) {
    closeSettingsPopover();
  }
});

$("mc-new-thread-btn")?.addEventListener("click", () => openNewThreadModal(""));
$("mc-cmdk-trigger")?.addEventListener("click", openPaletteModal);

$("mc-search")?.addEventListener("input", (e) => {
  state.search = e.target.value;
  renderActiveView();
});

document.addEventListener("input", (e) => {
  if (e.target.id === "mc-composer-input") {
    state.composerDraft = e.target.value;
    if (state.detail?.id === state.selectedThreadId)
      void drafts.set(state.selectedThreadId, e.target.value);
    autoResizeTextarea(e.target);
  } else if (e.target.id === "mc-palette-input") {
    updatePalette(e.target.value);
  }
});

document.addEventListener("change", (e) => {
  if (e.target.id === "mc-composer-model") {
    state.composerModel = e.target.value;
  } else if (e.target.id === "mc-composer-mode") {
    state.composerMode = e.target.value;
  } else if (e.target.id === "mc-composer-send-mode") {
    state.composerSendMode = e.target.value;
  } else if (e.target.id === "mc-poll-select") {
    state.pollMs = Number(e.target.value) || 0;
    resetPollTimer();
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.id === "mc-composer-form") {
    e.preventDefault();
    handleSendReply();
  } else if (e.target.id === "mc-new-thread-form") {
    e.preventDefault();
    handleCreateThread(e.target);
  }
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (state.modal?.type === "palette") closeModal();
    else openPaletteModal();
    return;
  }

  if (e.key === "Escape") {
    if (state.modal) {
      e.preventDefault();
      closeModal();
    } else if (state.settingsOpen) {
      e.preventDefault();
      closeSettingsPopover();
    } else if (state.pluginsOpen) {
      e.preventDefault();
      closePluginsDrawer();
    } else if (state.inspectorOpen) {
      e.preventDefault();
      state.inspectorOpen = false;
      renderInspector(false);
    }
    return;
  }

  if (state.modal?.type === "palette") {
    const items = state.modal.items || [];
    if (e.key === "ArrowDown" && items.length > 0) {
      e.preventDefault();
      state.modal.index = (state.modal.index + 1) % items.length;
      updatePalette(state.modal.query);
    } else if (e.key === "ArrowUp" && items.length > 0) {
      e.preventDefault();
      state.modal.index = (state.modal.index - 1 + items.length) % items.length;
      updatePalette(state.modal.query);
    } else if (e.key === "Enter" && items.length > 0) {
      e.preventDefault();
      runPaletteItem(items[state.modal.index]);
    }
    return;
  }

  if (e.target?.id === "mc-composer-input" && e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSendReply();
    return;
  }

  if (e.key === "Enter" && e.target?.matches("[data-select-thread], [data-jump-diff]")) {
    e.preventDefault();
    e.target.click();
  }
});

window.addEventListener("resize", () => {
  if (window.innerWidth >= 1100 && state.inspectorOpen) {
    state.inspectorOpen = false;
  }
  if (state.modal?.type === "new-thread" && state.newThreadModalRect) {
    applyFloatingModalRect($("mc-new-thread-modal"), state.newThreadModalRect);
  }
  syncBackdrop();
});

window.addEventListener("error", (e) => {
  if (!state.snap || $("mc-subtitle")?.textContent?.startsWith("Loading")) {
    renderFatalError("Mission Control failed to initialize", e?.message || "Script error");
  }
});

window.addEventListener("unhandledrejection", (e) => {
  if (!state.snap || $("mc-subtitle")?.textContent?.startsWith("Loading")) {
    const msg = e?.reason?.message || String(e?.reason || "Unhandled promise rejection");
    renderFatalError("Mission Control failed to initialize", msg);
  }
});

try {
  renderRail();
  renderHeader();
  if (state.view === "usage") {
    renderActiveView();
    loadUsage(false);
  }
  pollDashboard(true);
  resetPollTimer();
} catch (err) {
  renderFatalError("Mission Control failed to start", err?.message || String(err));
}

window.addEventListener("phoenix-error", (event) => showToast(event.detail, "red"));

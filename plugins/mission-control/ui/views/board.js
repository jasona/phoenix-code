import { dotHtml, esc, safeTone } from "../components/icons.js";

const COLUMNS = [
  { key: "attention", label: "Needs Attention", tone: "amber" },
  { key: "running", label: "Running", tone: "green" },
  { key: "scheduled", label: "Scheduled", tone: "blue" },
  { key: "done", label: "Done & Idle", tone: "gray" },
];

function inferColumn(thread) {
  if (thread.column && COLUMNS.some((c) => c.key === thread.column)) return thread.column;
  if (thread.needsAttention || thread.status === "attention" || thread.status === "error")
    return "attention";
  if (thread.running || thread.status === "live" || thread.status === "running") return "running";
  if (thread.isCron || thread.status === "cron") return "scheduled";
  return "done";
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
  const fields = [project.name, project.branch, thread.title, thread.subtitle, thread.status];
  return fields.some((f) =>
    String(f ?? "")
      .toLowerCase()
      .includes(q),
  );
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
          rightLabel: task.timestamp ? new Date(task.timestamp).toLocaleString() : "Scheduled",
          dotTone: "blue",
        },
      });
    }
  }

  const colsHtml = COLUMNS.map((col) => {
    const entries = buckets.get(col.key) || [];
    const cardsHtml = entries.length
      ? entries
          .map(({ project, thread, attention }) => {
            const selected = thread.id && thread.id === state.selectedThreadId ? " selected" : "";
            const dotTone = safeTone(thread.dotTone, col.tone);
            const subTone = safeTone(thread.subtitleTone, "muted");
            const rightTone = safeTone(thread.rightTone, "muted");
            return `
              <div class="mc-board-card${selected}" ${thread.id ? `role="button" tabindex="0" data-select-thread="${esc(thread.id)}"` : ""}>
                <div class="mc-board-card-top">
                  <span>${esc(project.name)}${project.branch ? ` · ${esc(project.branch)}` : ""}</span>
                  <span class="mc-thread-right tone-${rightTone}">${esc(thread.rightLabel || "")}</span>
                </div>
                <div style="display:flex;align-items:flex-start;gap:7px;">
                  ${dotHtml(dotTone)}
                  <div class="mc-thread-main">
                    <div class="mc-thread-title" style="white-space:normal;">${esc(thread.title || "Untitled thread")}</div>
                    <div class="mc-thread-sub tone-${subTone}">${esc(thread.subtitle || "")}</div>
                  </div>
                </div>
                ${
                  attention?.kind === "approval" || attention?.kind === "question"
                    ? `
                  <div style="display:flex;gap:6px;margin-top:4px;justify-content:flex-end;">
                    <button type="button" class="mc-btn-subtle is-strong" data-triage-action="review" data-attention-id="${esc(attention.id)}" data-thread-id="${esc(thread.id)}" data-run-id="${esc(thread.latestRunId || "")}" data-request-id="${esc(thread.pendingRequestId || "")}">Review & respond</button>
                    <button type="button" class="mc-btn-subtle" data-attention-action="diff" data-attention-id="${esc(attention.id)}" data-thread-id="${esc(thread.id)}">Diff</button>
                  </div>
                `
                    : ""
                }
              </div>
            `;
          })
          .join("")
      : '<div class="mc-thread-sub" style="padding:10px 4px;text-align:center;">No threads</div>';

    return `
      <section class="mc-board-col" aria-label="${esc(col.label)}">
        <header class="mc-board-col-head">
          <div class="mc-board-col-title">
            ${dotHtml(col.tone)}
            <span>${esc(col.label)}</span>
          </div>
          <span class="mc-tab-badge">${entries.length}</span>
        </header>
        ${cardsHtml}
      </section>
    `;
  }).join("");

  return `<div class="mc-board-grid">${colsHtml}</div>`;
}

import { esc, formatShortTime, safeTone } from "../components/icons.js";

const BUCKETS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "today", label: "Today" },
  { key: "earlier", label: "Earlier" },
];

function normalizeBucket(raw) {
  const b = String(raw || "").toLowerCase();
  if (b.includes("upcom") || b.includes("sched") || b.includes("next")) return "upcoming";
  if (b.includes("earl") || b.includes("past") || b.includes("older")) return "earlier";
  return "today";
}

function deriveFallbackTimeline(snap) {
  const items = [];
  for (const att of snap?.needsAttention || []) {
    items.push({
      id: `tl-${att.id}`,
      bucket: "today",
      timeLabel: att.ageLabel || "now",
      kind: att.badgeLabel || att.kind || "Attention",
      tone: "amber",
      projectName: att.projectName,
      threadId: att.threadId,
      title: att.threadTitle,
      summary: att.summary,
      needsAttention: true,
    });
  }
  for (const project of snap?.projects || []) {
    for (const thread of project.threads || []) {
      const isCron = Boolean(thread.isCron || thread.status === "cron");
      const isRunning = Boolean(
        thread.running || thread.status === "live" || thread.status === "running",
      );
      items.push({
        id: `tl-${thread.id}`,
        bucket: isCron ? "upcoming" : isRunning || thread.needsAttention ? "today" : "earlier",
        timeLabel: thread.rightLabel || formatShortTime(thread.updatedAt),
        kind: isCron ? "Cron" : thread.hasTeam ? "Team" : isRunning ? "Running" : "Thread",
        tone: isCron
          ? "blue"
          : thread.hasTeam || thread.needsAttention
            ? "amber"
            : isRunning
              ? "green"
              : "muted",
        projectName: project.name,
        threadId: thread.id,
        title: thread.title,
        summary: thread.subtitle,
        needsAttention: thread.needsAttention,
        running: isRunning,
      });
    }
  }
  return items;
}

function kindTone(item) {
  if (item.tone) return safeTone(item.tone);
  const k = String(item.kind || "").toLowerCase();
  if (k.includes("cron") || k.includes("sched")) return "blue";
  if (k.includes("approv") || k.includes("quest") || k.includes("swarm") || k.includes("wait"))
    return "amber";
  if (k.includes("run") || k.includes("live") || k.includes("pass")) return "green";
  return "muted";
}

export function renderTimeline(snap, state) {
  const rawEvents =
    Array.isArray(snap?.timeline) && snap.timeline.length > 0
      ? snap.timeline
      : deriveFallbackTimeline(snap);

  const q = String(state.search || "")
    .trim()
    .toLowerCase();
  const filter = state.filter || "all";

  const grouped = new Map(BUCKETS.map((b) => [b.key, []]));

  for (const ev of rawEvents) {
    const kLower = String(ev.kind || "").toLowerCase();
    const isAtt = Boolean(
      ev.needsAttention ||
      kLower.includes("approv") ||
      kLower.includes("quest") ||
      kLower.includes("error"),
    );
    const isRun = Boolean(
      ev.running || kLower.includes("run") || kLower.includes("live") || kLower.includes("swarm"),
    );

    if (filter === "attention" && !isAtt) continue;
    if (filter === "running" && !isRun) continue;
    if (q) {
      const hay = [
        ev.projectName,
        ev.title,
        ev.subtitle,
        ev.summary,
        ev.kind,
        ev.timeLabel,
        ev.statusLabel,
      ];
      if (
        !hay.some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(q),
        )
      )
        continue;
    }

    const bucket = normalizeBucket(ev.bucket || ev.group);
    grouped.get(bucket).push(ev);
  }

  const sections = BUCKETS.map((bucket) => {
    const list = grouped.get(bucket.key) || [];
    if (list.length === 0) return "";

    const rowsHtml = list
      .map((ev) => {
        const selected = ev.threadId && ev.threadId === state.selectedThreadId ? " selected" : "";
        const tone = kindTone(ev);
        const timeStr = ev.timeLabel || formatShortTime(ev.timestamp || ev.updatedAt);
        const subText = ev.subtitle || ev.summary || "";
        const attr = ev.threadId ? `data-select-thread="${esc(ev.threadId)}"` : "";
        return `
          <button type="button" class="mc-tl-row${selected}" ${attr}>
            <span class="mc-tl-time">${esc(timeStr || "—")}</span>
            <span class="mc-tl-kind tone-${tone}">${esc(ev.kind || "Event")}</span>
            <span class="mc-tl-main">
              <div class="mc-tl-title">${esc(ev.title || subText || "Workspace event")}</div>
              ${subText && subText !== ev.title ? `<div class="mc-tl-sub">${esc(subText)}</div>` : ""}
            </span>
            <span class="mc-tl-proj">${esc(ev.projectName || "")}${ev.statusLabel ? ` · ${esc(ev.statusLabel)}` : ""}</span>
          </button>
        `;
      })
      .join("");

    return `
      <section class="mc-tl-bucket" aria-label="${esc(bucket.label)}">
        <h3 class="mc-tl-bucket-title">${esc(bucket.label)}</h3>
        <div class="mc-tl-list">${rowsHtml}</div>
      </section>
    `;
  }).filter(Boolean);

  if (sections.length === 0) {
    return `
      <div class="mc-empty">
        <p class="mc-empty-title">No timeline events match</p>
        <p class="mc-empty-sub">Adjust your filter or search query to inspect scheduled jobs, swarm handoffs, and thread activity.</p>
      </div>
    `;
  }

  return `<div class="mc-timeline">${sections.join("")}</div>`;
}

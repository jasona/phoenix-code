import { esc, dotHtml, safeTone } from "../components/icons.js";

const GROUPS = [
  {
    category: "decision",
    title: "Needs your decision",
    description: "Your response is blocking progress.",
    tone: "amber",
  },
  {
    category: "failure",
    title: "Failed or blocked",
    description: "Inspect the cause before retrying or resuming.",
    tone: "red",
  },
  {
    category: "review",
    title: "Ready for review",
    description: "The run ended. Review the changes and evidence before accepting.",
    tone: "blue",
  },
];

function renderItem(item, state) {
  const actions = item.actions ?? ["review", "snooze"];
  const labels = {
    review: actions.includes("dismiss") || item.dismissed ? "Review details" : "Review & respond",
    dismiss: "Dismiss",
    accept: "Accept work",
    reopen: "Reopen",
    snooze: "Snooze 1 hour",
    unsnooze: "Unsnooze",
  };
  return `<article class="mc-inbox-item${item.threadId === state.selectedThreadId ? " selected" : ""}">
    <button type="button" class="mc-inbox-select" data-select-thread="${esc(item.threadId)}">
      <span class="mc-inbox-meta">${dotHtml(safeTone(item.category === "failure" ? "red" : item.category === "decision" ? "amber" : "blue"))}${esc(item.projectName)} · ${esc(item.badgeLabel || item.category)}</span>
      <span class="mc-inbox-title">${esc(item.threadTitle)}</span>
      <span class="mc-thread-sub">${esc(item.summary)}</span>
    </button>
    <div class="mc-inbox-actions">${actions.map((action) => `<button type="button" class="mc-btn-subtle${action === "review" ? " is-strong" : ""}" data-triage-action="${esc(action)}" data-thread-id="${esc(item.threadId)}" data-run-id="${esc(item.latestRunId || "")}" data-request-id="${esc(item.pendingRequestId || "")}"${state.mutationInFlight ? " disabled" : ""}>${esc(labels[action] || action)}</button>`).join("")}</div>
  </article>`;
}

export function renderInbox(snap, state) {
  const query = String(state.search || "")
    .trim()
    .toLowerCase();
  const scope = state.inboxScope || "active";
  const items =
    scope === "snoozed"
      ? (snap.snoozedAttention ?? [])
      : scope === "accepted"
        ? (snap.acceptedAttention ?? [])
        : scope === "dismissed"
          ? (snap.dismissedAttention ?? [])
          : (snap.needsAttention ?? []);
  const visible = items.filter(
    (item) =>
      !query ||
      [item.threadTitle, item.projectName, item.summary].some((part) =>
        String(part || "")
          .toLowerCase()
          .includes(query),
      ),
  );
  const tabs = `<div class="mc-inbox-toolbar"><div class="mc-filter-group" role="group" aria-label="Inbox scope">${[
    ["active", "Actionable"],
    ["snoozed", "Snoozed"],
    ["accepted", "Accepted"],
    ["dismissed", "Dismissed"],
  ]
    .map(
      ([key, label]) =>
        `<button type="button" data-inbox-scope="${key}" aria-pressed="${scope === key}" class="mc-filter-pill${scope === key ? " active" : ""}">${label}</button>`,
    )
    .join(
      "",
    )}</div><button type="button" class="mc-btn-subtle" data-action="next-attention" ${(snap.needsAttention ?? []).length ? "" : "disabled"}>Next actionable item</button></div>`;
  if (!visible.length)
    return `${tabs}<div class="mc-empty"><h2 class="mc-empty-title">${query ? "No matching items" : scope === "active" ? "Nothing needs your attention" : scope === "snoozed" ? "No snoozed work" : scope === "dismissed" ? "No dismissed runs" : "No accepted work"}</h2><p class="mc-empty-sub">${scope === "active" ? "New decisions, failures, and results ready for review appear here. Browse all projects in Overview." : "Work you explicitly move here remains available to restore."}</p></div>`;
  if (scope !== "active")
    return `${tabs}<section class="mc-section"><h2 class="mc-section-title">${scope === "snoozed" ? "Snoozed work" : scope === "dismissed" ? "Dismissed runs" : "Accepted work"}</h2><div class="mc-inbox-list">${visible.map((item) => renderItem(item, state)).join("")}</div></section>`;
  return (
    tabs +
    GROUPS.map((group) => {
      const grouped = visible.filter((item) => item.category === group.category);
      if (!grouped.length) return "";
      return `<section class="mc-section" aria-label="${group.title}"><div class="mc-inbox-group-heading"><h2 class="mc-section-title">${dotHtml(group.tone)} ${group.title} <span class="mc-tab-badge">${grouped.length}</span></h2><p class="mc-thread-sub">${group.description}</p></div><div class="mc-inbox-list">${grouped.map((item) => renderItem(item, state)).join("")}</div></section>`;
    }).join("")
  );
}

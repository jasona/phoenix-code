import { esc, formatClock, icon } from "./components/icons.js";

const activeStatuses = new Set(["running", "pending", "waiting"]);
const kinds = new Set(["user", "assistant", "reasoning", "tool", "plan", "request", "notice"]);

export function renderActivityEntry(entry) {
  const kind = kinds.has(entry.kind) ? entry.kind : "notice";
  const active = activeStatuses.has(entry.status);
  const failed = entry.status === "failed";
  const status = active ? entry.status : failed ? "failed" : "";
  const symbol = failed
    ? "alert"
    : kind === "tool"
      ? "code"
      : kind === "reasoning"
        ? "agent"
        : kind === "user"
          ? "arrowRight"
          : "agent";
  const heading = `<span class="mc-live-icon">${icon(symbol)}</span><span class="mc-live-label">${esc(entry.label)}</span>${status ? `<span class="mc-live-entry-status">${esc(status)}</span>` : ""}<time class="mc-activity-time" datetime="${esc(entry.time)}" title="${esc(entry.time)}">${esc(formatClock(entry.time))}</time>`;
  const body = `<div class="mc-live-text">${esc(entry.body)}</div>`;
  const foldable = kind === "reasoning" || kind === "tool";
  return `<article class="mc-live-entry mc-live-${kind}${active ? " is-active" : ""}${failed ? " is-failed" : ""}" data-activity-id="${esc(entry.id)}">${
    foldable
      ? `<details${active ? " open" : ""}><summary class="mc-live-entry-head">${heading}</summary>${body}</details>`
      : `<div class="mc-live-entry-head">${heading}</div>${body}`
  }</article>`;
}

export function isActivityAtBottom(scroll) {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48;
}

export function updateActivityFeed(main, snapshot, { follow = false } = {}) {
  const feed = main.querySelector(".mc-live-feed");
  const scroll = main.querySelector("#mc-insp-scroll");
  if (!feed || !scroll) return;
  feed.dataset.threadId = snapshot.threadId;
  const atBottom = follow || isActivityAtBottom(scroll);
  const anchor = [...feed.children].find(
    (node) => node.getBoundingClientRect().bottom > scroll.getBoundingClientRect().top,
  );
  const anchorOffset = anchor?.getBoundingClientRect().top;
  const previousTop = scroll.scrollTop;
  const existing = new Map([...feed.children].map((node) => [node.dataset.activityId, node]));
  const ids = new Set(snapshot.entries.map((entry) => entry.id));
  for (const [id, node] of existing) if (!ids.has(id)) node.remove();
  let cursor = feed.firstElementChild;
  for (const entry of snapshot.entries) {
    let node = existing.get(entry.id);
    const key = JSON.stringify(entry);
    if (!node || node.dataset.content !== key) {
      const template = document.createElement("template");
      template.innerHTML = renderActivityEntry(entry);
      const replacement = template.content.firstElementChild;
      replacement.dataset.content = key;
      const restoreFocus = node?.contains(document.activeElement);
      const oldDetails = node?.querySelector("details");
      if (oldDetails) replacement.querySelector("details").open = oldDetails.open;
      if (node) {
        if (cursor === node) cursor = replacement;
        node.replaceWith(replacement);
      }
      node = replacement;
      if (restoreFocus) node.querySelector("summary")?.focus({ preventScroll: true });
    }
    if (node !== cursor) feed.insertBefore(node, cursor);
    cursor = node.nextElementSibling;
  }
  const status = main.querySelector(".mc-live-status");
  const label =
    snapshot.status === "error"
      ? "Live updates unavailable. Reopen Activity to retry."
      : snapshot.status === "loading"
        ? "Connecting to thread…"
        : snapshot.status === "snapshot"
          ? "Recent messages · refreshes with dashboard"
          : snapshot.running
            ? "Live · Following thread"
            : "Up to date";
  status.dataset.running = String(snapshot.running);
  status.dataset.status = snapshot.status;
  status.classList.toggle("is-live", snapshot.status === "live" && snapshot.running);
  status.textContent =
    !snapshot.entries.length && snapshot.status === "live" && !snapshot.running
      ? "No activity yet. Send a message to start this thread."
      : label;
  main.querySelector(".mc-live-history").hidden = !snapshot.truncated;
  if (atBottom) scroll.scrollTop = scroll.scrollHeight;
  else {
    const nextAnchor = [...feed.children].find(
      (node) => node.dataset.activityId === anchor?.dataset.activityId,
    );
    scroll.scrollTop =
      nextAnchor && anchorOffset !== undefined
        ? previousTop + nextAnchor.getBoundingClientRect().top - anchorOffset
        : previousTop;
  }
  main.querySelector(".mc-live-jump").hidden = atBottom;
}

/**
 * Shared SVG icons, HTML escaping, and safe formatting helpers.
 */

const ESC_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
}

const ALLOWED_TONES = new Set([
  "green",
  "amber",
  "blue",
  "gray",
  "red",
  "idle",
  "muted",
  "error",
  "success",
  "warning",
  "info",
]);

export function safeTone(tone, fallback = "muted") {
  const t = String(tone ?? "").toLowerCase();
  return ALLOWED_TONES.has(t) ? t : fallback;
}

export function highlightMentions(text) {
  return esc(text).replace(
    /(^|[\s(>])(@[a-zA-Z0-9][a-zA-Z0-9_-]*)/g,
    '$1<span class="mc-mention">$2</span>',
  );
}

export function formatShortTime(ts) {
  if (!ts) return "";
  if (typeof ts === "string" && !/^\d{4}-\d{2}-\d{2}/.test(ts) && !/^\d+$/.test(ts)) {
    return ts;
  }
  const ms = typeof ts === "number" ? ts : Date.parse(String(ts));
  if (!Number.isFinite(ms)) return String(ts);
  const diffSec = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return diffSec > 10 ? `in ${abs}s` : "now";
  if (abs < 3600) {
    const m = Math.round(abs / 60);
    return diffSec > 0 ? `Next ${m}m` : `${m}m`;
  }
  if (abs < 86400) {
    const h = Math.round(abs / 3600);
    return diffSec > 0 ? `Next ${h}h` : `${h}h`;
  }
  const d = Math.round(abs / 86400);
  return diffSec > 0 ? `Next ${d}d` : `${d}d`;
}

export function formatClock(ts) {
  if (!ts) return "";
  const ms = typeof ts === "number" ? ts : Date.parse(String(ts));
  if (!Number.isFinite(ms)) return String(ts);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(ms),
  );
}

export function formatCountdown(ts, nowMs = Date.now()) {
  if (!ts) return "";
  const ms = typeof ts === "number" ? ts : Date.parse(String(ts));
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const diffMs = ms - nowMs;
  if (diffMs <= 0) return "Resetting";
  if (diffMs < 60 * 1000) return "< 1m";
  const totalMins = Math.round(diffMs / 60000);
  if (totalMins < 60) return `${totalMins}m`;
  const totalHours = Math.floor(totalMins / 60);
  const remMins = totalMins % 60;
  if (totalHours < 24) {
    return remMins > 0 ? `${totalHours}h ${remMins}m` : `${totalHours}h`;
  }
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function formatResetClock(ts, nowMs = Date.now()) {
  if (!ts) return "";
  const ms = typeof ts === "number" ? ts : Date.parse(String(ts));
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const target = new Date(ms);
  const base = new Date(nowMs);
  const startOfBase = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
  const startOfTarget = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  ).getTime();
  const dayDiff = Math.round((startOfTarget - startOfBase) / 86400000);
  const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    target,
  );
  if (dayDiff === 0) return clock;
  if (dayDiff === 1) return `Tomorrow ${clock}`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(target);
}

const ICONS = {
  grid: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
  plus: '<path d="M8 3.25v9.5M3.25 8h9.5"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.75V8l2.25 1.5"/>',
  gauge:
    '<path d="M3 11.25a5.5 5.5 0 1 1 10 0"/><path d="M8 9.25 10.75 6.25"/><circle cx="8" cy="9.5" r="1" class="fill"/>',
  refresh:
    '<path d="M13 6.25A5.25 5.25 0 0 0 3.6 4.9M3 9.75A5.25 5.25 0 0 0 12.4 11.1"/><path d="M13.25 3.5v2.75H10.5M2.75 12.5V9.75H5.5"/>',
  puzzle:
    '<path d="M6.25 3a1.5 1.5 0 0 1 3 0v.75H11a1.25 1.25 0 0 1 1.25 1.25v1.75H13a1.5 1.5 0 0 1 0 3h-.75V11.5A1.25 1.25 0 0 1 11 12.75H5A1.25 1.25 0 0 1 3.75 11.5V9.75H4.5a1.5 1.5 0 0 0 0-3h-.75V5A1.25 1.25 0 0 1 5 3.75h1.25z"/>',
  gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 2.25v1.2M8 12.55v1.2M3.93 3.93l.85.85M11.22 11.22l.85.85M2.25 8h1.2M12.55 8h1.2M3.93 12.07l.85-.85M11.22 4.78l.85-.85"/>',
  folder:
    '<path d="M2.25 4.5a1.25 1.25 0 0 1 1.25-1.25h2.7l1.2 1.5h5.1a1.25 1.25 0 0 1 1.25 1.25v5.5a1.25 1.25 0 0 1-1.25 1.25h-9a1.25 1.25 0 0 1-1.25-1.25z"/>',
  branch:
    '<circle cx="5" cy="4" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="11.25" cy="6.25" r="1.5"/><path d="M5 5.5v5M5 10.5c0-2.25 6.25-1 6.25-2.75"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.25 3.25"/>',
  arrowUpRight: '<path d="M5 11 11.5 4.5M6.25 4.5h5.25v5.25"/>',
  arrowLeft: '<path d="M12.5 8H3.5M7 4.5 3.5 8 7 11.5"/>',
  arrowRight: '<path d="M3.5 8h9M9 4.5 12.5 8 9 11.5"/>',
  send: '<path d="M13.5 2.75 7.25 9M13.5 2.75l-4 10.75-2.25-4.5-4.5-2.25z"/>',
  sliders:
    '<path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h9"/><circle cx="6" cy="4.5" r="1.1" class="fill"/><circle cx="10.2" cy="8" r="1.1" class="fill"/><circle cx="7" cy="11.5" r="1.1" class="fill"/>',
  check: '<path d="m4.5 8.25 2.25 2.25L11.5 5.5"/>',
  checkCircle: '<circle cx="8" cy="8" r="5.5"/><path d="m5.5 8.2 1.7 1.7 3.4-3.6"/>',
  agent:
    '<circle cx="8" cy="8" r="5.25"/><path d="M5.75 9.25c.65.85 1.4 1.25 2.25 1.25s1.6-.4 2.25-1.25M6.25 6.75h.05M9.75 6.75h.05"/>',
  swarm:
    '<circle cx="8" cy="4.25" r="1.5"/><circle cx="4.25" cy="11.25" r="1.5"/><circle cx="11.75" cy="11.25" r="1.5"/><path d="M7.1 5.5 5.1 9.9M8.9 5.5l2 4.4M5.75 11.25h4.5"/>',
  chevronDown: '<path d="m4.5 6.25 3.5 3.5 3.5-3.5"/>',
  close: '<path d="m4.25 4.25 7.5 7.5m0-7.5-7.5 7.5"/>',
  file: '<path d="M4.25 2.5h4.75l3 3v8a1 1 0 0 1-1 1h-6.75a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"/><path d="M8.75 2.5v3.25H12"/>',
  code: '<path d="m5.75 5-3 3 3 3M10.25 5l3 3-3 3"/>',
  alert: '<path d="M8 2.75 13.75 13H2.25z"/><path d="M8 6.5v3M8 11.25h.02"/>',
};

export function icon(name, className = "") {
  const body = ICONS[name] || ICONS.grid;
  const cls = className ? `mc-icon ${className}` : "mc-icon";
  return `<svg class="${esc(cls)}" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
}

export function dotHtml(tone, className = "") {
  const cls = className
    ? `mc-dot tone-${safeTone(tone)} ${esc(className)}`
    : `mc-dot tone-${safeTone(tone)}`;
  return `<span class="${cls}" aria-hidden="true"></span>`;
}

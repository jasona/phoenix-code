import { esc } from "../components/icons.js";

export function renderUsage(data, state) {
  if (state.usageLoading && !data) return '<div class="mc-empty">Loading provider usage…</div>';
  if (data?.error)
    return `<div class="mc-empty" role="alert">${esc(data.error)}<button class="mc-btn-subtle" data-action="refresh-usage">Retry</button></div>`;
  const accounts = data?.accounts ?? [];
  return `<section class="mc-section"><h2 class="mc-section-title">Provider usage limits</h2><p class="mc-thread-sub">Latest readings from Phoenix. Providers without quota reporting remain visible.</p><div class="mc-projects-grid">${
    accounts
      .map(
        (account) => `
    <article class="mc-project-card"><header class="mc-project-head"><strong>${esc(account.label)}</strong></header><div style="padding:16px;display:grid;gap:12px">
      ${account.unavailable ? `<p class="mc-thread-sub">${esc(account.unavailable)}</p>` : ""}
      ${account.windows
        .map(
          (
            window,
          ) => `<label style="display:grid;gap:6px">${esc(window.label)} · ${Math.round(window.usedPercent)}% used
        <meter min="0" max="100" value="${Math.max(0, Math.min(100, window.usedPercent))}" style="width:100%;accent-color:var(--mc-accent)"></meter>
        ${window.resetsAt ? `<span class="mc-thread-sub">Resets ${esc(new Date(window.resetsAt).toLocaleString())}</span>` : ""}</label>`,
        )
        .join("")}
      ${account.checkedAt ? `<p class="mc-thread-sub">Updated ${esc(new Date(account.checkedAt).toLocaleString())}</p>` : ""}
    </div></article>`,
      )
      .join("") ||
    '<div class="mc-empty">Configure a provider in Phoenix to see usage limits.</div>'
  }</div></section>`;
}

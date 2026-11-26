import { esc } from "../components/icons.js";

export function renderVerification(detail) {
  const evidence = detail.verification;
  const commands = evidence?.commands ?? [];
  const counts = evidence?.counts ?? { passed: 0, failed: 0, running: 0, unknown: 0 };
  const phase = detail.agentFinished ? "Finished" : detail.latestRunStatus || "No completed run";
  const commandSummary = commands.length
    ? `${counts.passed} passed · ${counts.failed} failed · ${counts.running} running · ${counts.unknown} unknown`
    : "No command results recorded";
  return `<section class="mc-verification" aria-label="Completion evidence">
    <dl class="mc-verification-stages">
      <div><dt>Agent run</dt><dd>${esc(phase)}</dd></div>
      <div><dt>Recorded commands</dt><dd>${esc(commandSummary)}</dd></div>
      <div><dt>Your review</dt><dd>${detail.accepted ? "Accepted" : "Not accepted"}</dd></div>
      <div><dt>Shipped</dt><dd>${detail.shipped === true ? "Verified" : "Not verified"}</dd></div>
    </dl>
    <p class="mc-thread-sub">${esc(detail.shippedReason || "No verified shipping evidence is recorded for this run.")}</p>
    <div class="mc-evidence-notice"><strong>${evidence?.freshness === "stale" ? "Evidence is stale" : "Current revision not verified"}</strong><p>${esc(evidence?.reason || "A finished run does not establish that checks passed. Review recorded results and the current changes.")}</p></div>
    ${evidence?.capturedAt ? `<p class="mc-thread-sub">Evidence captured ${esc(new Date(evidence.capturedAt).toLocaleString())}</p>` : ""}
    <h3 class="mc-evidence-heading">Command results</h3>
    <p class="mc-thread-sub">These are tool results, not an inferred test suite. A successful command may not be a test.</p>
    ${commands.length ? commands.map((command) => `<details class="mc-evidence-command" data-evidence-id="${esc(command.id)}"><summary><span class="mc-evidence-status" data-status="${esc(command.status)}">${esc(command.status)}</span><code>${esc(command.command)}</code></summary><div class="mc-evidence-command-body"><dl><div><dt>Exit code</dt><dd>${command.exitCode == null ? "Unknown" : esc(command.exitCode)}</dd></div><div><dt>Finished</dt><dd>${command.completedAt ? esc(new Date(command.completedAt).toLocaleString()) : "Not recorded"}</dd></div></dl><pre>${esc(command.output || "No output recorded.")}</pre>${command.outputTruncated ? '<p class="mc-thread-sub">Output shortened. Open the review desk for the full tool history.</p>' : ""}</div></details>`).join("") : '<p class="mc-empty-sub">No structured command outcomes are available for this run.</p>'}
    ${evidence?.truncated ? '<p class="mc-thread-sub">Showing a bounded sample. Review the full tool history before accepting.</p>' : ""}
    ${evidence?.revisions?.length ? `<h3 class="mc-evidence-heading">Run checkpoints</h3><p class="mc-thread-sub">Checkpoint references do not prove that commands tested the current files.</p><ul class="mc-evidence-revisions">${evidence.revisions.map((revision) => `<li><code>${esc(revision.ref || revision.scopeId)}</code><span>${esc(revision.status)}</span></li>`).join("")}</ul>` : ""}
    <button type="button" class="mc-btn-subtle" data-action="open-full" data-thread-id="${esc(detail.id)}">Review changes &amp; full history</button>
  </section>`;
}

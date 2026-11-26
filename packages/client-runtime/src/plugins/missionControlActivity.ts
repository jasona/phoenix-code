import {
  MissionControlActivityOperation,
  type MissionControlActivitySnapshot,
  type OrchestrationV2TurnItem,
  type ThreadId,
} from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";
import { dynamicToolTitle } from "@t3tools/shared/toolActivityCopy";
import { commandIndicatesFailure } from "@t3tools/shared/toolOutput";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { EnvironmentThreadState } from "../state/threadState.ts";

export type { MissionControlActivitySnapshot } from "@t3tools/contracts";
export const isMissionControlActivityOperation = Schema.is(MissionControlActivityOperation);

type Entry = MissionControlActivitySnapshot["entries"][number];
const ACTIVE_RUN_STATUSES = new Set(["preparing", "starting", "running", "waiting"]);
const MAX_ENTRIES = 80;
const MAX_BODY_LENGTH = 2_048;
const MAX_TEXT_LENGTH = 32_768;

function toolText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  let remaining = MAX_BODY_LENGTH;
  const visit = (input: unknown, depth: number): unknown => {
    if (remaining <= 0 || depth > 4) return "…";
    if (typeof input === "string") {
      const text = input.slice(0, remaining);
      remaining -= text.length;
      return text.length < input.length ? `${text}…` : text;
    }
    if (input === null || typeof input !== "object") return input;
    remaining -= 20;
    if (Array.isArray(input)) return input.slice(0, 8).map((item) => visit(item, depth + 1));
    return Object.fromEntries(
      Object.entries(input)
        .slice(0, 8)
        .map(([key, item]) => [key.slice(0, 100), visit(item, depth + 1)]),
    );
  };
  return JSON.stringify(visit(value, 0)) ?? "";
}

function summarize(
  item: OrchestrationV2TurnItem,
  resolve: MFunctionType,
): (Pick<Entry, "kind" | "label" | "body"> & { truncated?: boolean }) | null {
  switch (item.type) {
    case "user_message":
      return { kind: "user", label: resolve(msg("You")), body: item.text };
    case "assistant_message":
      return { kind: "assistant", label: resolve(msg("Assistant")), body: item.text };
    case "reasoning":
      return { kind: "reasoning", label: resolve(msg("Thinking")), body: item.text };
    case "command_execution":
      return {
        kind: "tool",
        label: item.title || resolve(msg("Command")),
        body: [item.input.slice(0, 1_024), item.output?.slice(-1_024)].filter(Boolean).join("\n\n"),
        truncated:
          item.outputOmitted === true ||
          item.input.length > 1_024 ||
          (item.output?.length ?? 0) > 1_024,
      };
    case "dynamic_tool":
      return {
        kind: "tool",
        label:
          dynamicToolTitle(item.toolName, item.input, item.title, resolve) ??
          item.toolName ??
          resolve(msg("Tool")),
        body: [toolText(item.input).slice(0, 1_024), toolText(item.output).slice(-1_024)]
          .filter(Boolean)
          .join("\n\n"),
        truncated:
          typeof item.input === "object" ||
          typeof item.output === "object" ||
          (typeof item.input === "string" && item.input.length > 1_024) ||
          (typeof item.output === "string" && item.output.length > 1_024),
      };
    case "file_change":
      return {
        kind: "tool",
        label: item.title || resolve(msg("File change")),
        body:
          item.fileName +
          (item.additions !== undefined || item.deletions !== undefined
            ? `\n+${item.additions ?? 0} −${item.deletions ?? 0}`
            : ""),
      };
    case "file_search":
      return {
        kind: "tool",
        label: item.title || resolve(msg("File search")),
        body: item.pattern ?? "",
      };
    case "web_search":
      return {
        kind: "tool",
        label: item.title || resolve(msg("Web search")),
        body: item.patterns?.join("\n") ?? "",
      };
    case "subagent":
      return {
        kind: "tool",
        label: item.title || resolve(msg("Subagent")),
        body: item.progress || item.result || item.prompt,
      };
    case "proposed_plan":
      return { kind: "plan", label: item.title || resolve(msg("Plan")), body: item.markdown };
    case "todo_list":
      return {
        kind: "plan",
        label: item.title || resolve(msg("Plan")),
        body: item.steps.map((step) => `${step.status}: ${step.text}`).join("\n"),
      };
    case "approval_request":
      return {
        kind: "request",
        label: resolve(msg("Approval requested")),
        body: item.prompt || item.reason || "",
      };
    case "user_input_request":
      return {
        kind: "request",
        label: resolve(msg("Input requested")),
        body: item.questions.map((question) => question.question).join("\n"),
      };
    case "secret_request":
      return { kind: "request", label: item.label, body: item.reason };
    case "link_request":
      return { kind: "request", label: resolve(msg("Connect environment")), body: item.reason };
    case "error":
      return {
        kind: "notice",
        label: item.title || resolve(msg("Error")),
        body: item.failure.message,
      };
    case "system_notice":
    case "run_interrupt_request":
    case "run_interrupt_result":
      return { kind: "notice", label: item.title || resolve(msg("Status")), body: item.message };
    case "notification":
      return { kind: "notice", label: item.summary, body: item.detail ?? "" };
    case "compaction":
      return {
        kind: "notice",
        label: resolve(msg("Compacting context")),
        body: item.summary ?? "",
      };
    case "handoff":
      return { kind: "notice", label: resolve(msg("Context handoff")), body: item.summary ?? "" };
    case "checkpoint":
    case "fork":
    case "thread_created":
      return null;
  }
}

export function projectMissionControlActivity(
  threadId: ThreadId,
  state: EnvironmentThreadState,
  resolve: MFunctionType = mFallback,
): MissionControlActivitySnapshot {
  const projection = Option.getOrNull(state.data);
  const latestRun = projection?.runs.findLast(
    (run) => run.status !== "queued" && run.status !== "rolled_back",
  );
  const runs = new Map(projection?.runs.map((run) => [run.id, run.status]));
  const entries: Entry[] = [];
  let remaining = MAX_TEXT_LENGTH;
  let truncated = state.history.hasMoreHistory;
  const rows = projection?.visibleTurnItems ?? [];
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!;
    const summary = summarize(row.item, resolve);
    if (summary === null) continue;
    if (entries.length >= MAX_ENTRIES || remaining <= 0) {
      truncated = true;
      break;
    }
    const label = summary.label.slice(0, 200);
    const body = summary.body.slice(-Math.min(MAX_BODY_LENGTH, remaining));
    truncated ||=
      summary.truncated === true ||
      body.length < summary.body.length ||
      row.item.deferredWork !== undefined;
    remaining -= body.length + label.length;
    const runStatus = row.item.runId === null ? undefined : runs.get(row.item.runId);
    const unfinished =
      row.item.status === "running" ||
      row.item.status === "pending" ||
      row.item.status === "waiting";
    const endedStatus =
      runStatus === "completed" ||
      runStatus === "failed" ||
      runStatus === "interrupted" ||
      runStatus === "cancelled"
        ? runStatus
        : null;
    entries.push({
      kind: summary.kind,
      label,
      body,
      id: `${row.sourceThreadId}:${row.sourceItemId}`,
      status:
        row.item.type === "command_execution" && commandIndicatesFailure(row.item)
          ? "failed"
          : unfinished && endedStatus !== null
            ? endedStatus
            : row.item.status,
      time: DateTime.formatIso(row.item.startedAt ?? row.item.updatedAt),
    });
  }
  return {
    threadId,
    status:
      state.status === "deleted" || Option.isSome(state.error)
        ? "error"
        : state.status === "live"
          ? "live"
          : "loading",
    running:
      state.status === "live" &&
      Option.isNone(state.error) &&
      latestRun !== undefined &&
      ACTIVE_RUN_STATUSES.has(latestRun.status),
    entries: entries.reverse(),
    truncated,
  };
}

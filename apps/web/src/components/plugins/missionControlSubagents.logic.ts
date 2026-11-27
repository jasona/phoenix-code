import type {
  ModelSelection,
  NodeId,
  OrchestrationV2RemoteTaskChild,
  OrchestrationV2RunStatus,
  OrchestrationV2Subagent,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type {
  ThreadStructure,
  ThreadStructureTurnItem,
} from "@t3tools/client-runtime/state/models";
import {
  formatSubagentDisplayTitle,
  subagentCardDetail,
} from "@t3tools/client-runtime/state/subagent-display";
import {
  isActiveSubagentStatus,
  isTerminalSubagentStatus,
  promptTitle,
} from "@t3tools/client-runtime/state/subagentRuntime";
import * as DateTime from "effect/DateTime";

export type MissionControlSubagentPhase = "running" | "completed" | "failed" | "stopped" | "idle";

export interface MissionControlSubagentEntry {
  readonly id: NodeId;
  readonly runId: RunId | null;
  readonly origin: OrchestrationV2Subagent["origin"];
  readonly driver: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  /** Formatted display title, or null when the caller should render a localized fallback. */
  readonly title: string | null;
  readonly model: string | null;
  readonly modelSelection: ModelSelection | undefined;
  readonly status: OrchestrationV2Subagent["status"];
  readonly isActive: boolean;
  readonly isCompleted: boolean;
  readonly isFailed: boolean;
  readonly isStopped: boolean;
  readonly detail: string | null;
  readonly workflowAgentCount: number | null;
  readonly workflowActiveCount: number;
  readonly childThreadId: ThreadId | null;
  readonly remoteChild: OrchestrationV2RemoteTaskChild | undefined;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly updatedAt: string;
  readonly durationMs: number | null;
}

export interface MissionControlSubagentsSummary {
  readonly phase: MissionControlSubagentPhase;
  readonly runActive: boolean;
  readonly subagents: ReadonlyArray<MissionControlSubagentEntry>;
  readonly total: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly stopped: number;
  readonly idle: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export const MISSION_CONTROL_SUBAGENTS_RECENT_LIMIT = 4;
const MISSION_CONTROL_SUBAGENTS_FILTER_MIN_TOTAL = 7;
const SMALL_IDLE_THREAD_LIMIT = 5;
const SMALL_SETTLED_WITH_ACTIVE_LIMIT = 2;

export interface MissionControlSubagentsPartition {
  readonly query: string;
  readonly isFiltering: boolean;
  readonly filteredEntries: ReadonlyArray<MissionControlSubagentEntry>;
  readonly activeEntries: ReadonlyArray<MissionControlSubagentEntry>;
  readonly issueEntries: ReadonlyArray<MissionControlSubagentEntry>;
  readonly recentSettledEntries: ReadonlyArray<MissionControlSubagentEntry>;
  readonly archivedSettledEntries: ReadonlyArray<MissionControlSubagentEntry>;
  readonly showFilter: boolean;
}

function matchesSubagentQuery(entry: MissionControlSubagentEntry, needle: string): boolean {
  if (entry.title?.toLowerCase().includes(needle)) return true;
  if (entry.detail?.toLowerCase().includes(needle)) return true;
  if (entry.model?.toLowerCase().includes(needle)) return true;
  if (entry.status.toLowerCase().includes(needle)) return true;
  if (entry.remoteChild?.label.toLowerCase().includes(needle)) return true;
  return false;
}

export function partitionMissionControlSubagents(
  summary: MissionControlSubagentsSummary,
  rawQuery = "",
): MissionControlSubagentsPartition {
  const query = rawQuery.trim();
  const showFilter = summary.total >= MISSION_CONTROL_SUBAGENTS_FILTER_MIN_TOTAL;

  if (query.length > 0) {
    const needle = query.toLowerCase();
    const filteredEntries = summary.subagents.filter((entry) =>
      matchesSubagentQuery(entry, needle),
    );
    return {
      query,
      isFiltering: true,
      filteredEntries,
      activeEntries: [],
      issueEntries: [],
      recentSettledEntries: [],
      archivedSettledEntries: [],
      showFilter,
    };
  }

  const activeEntries: MissionControlSubagentEntry[] = [];
  const issueEntries: MissionControlSubagentEntry[] = [];
  const settledEntries: MissionControlSubagentEntry[] = [];

  for (const entry of summary.subagents) {
    if (entry.isActive) activeEntries.push(entry);
    else if (entry.isFailed || entry.isStopped) issueEntries.push(entry);
    else settledEntries.push(entry);
  }

  let recentSettledEntries: ReadonlyArray<MissionControlSubagentEntry>;
  let archivedSettledEntries: ReadonlyArray<MissionControlSubagentEntry>;

  if (activeEntries.length > 0) {
    if (settledEntries.length <= SMALL_SETTLED_WITH_ACTIVE_LIMIT) {
      recentSettledEntries = settledEntries;
      archivedSettledEntries = [];
    } else {
      recentSettledEntries = [];
      archivedSettledEntries = settledEntries;
    }
  } else if (settledEntries.length <= SMALL_IDLE_THREAD_LIMIT) {
    recentSettledEntries = settledEntries;
    archivedSettledEntries = [];
  } else {
    recentSettledEntries = settledEntries.slice(0, MISSION_CONTROL_SUBAGENTS_RECENT_LIMIT);
    archivedSettledEntries = settledEntries.slice(MISSION_CONTROL_SUBAGENTS_RECENT_LIMIT);
  }

  return {
    query: "",
    isFiltering: false,
    filteredEntries: [],
    activeEntries,
    issueEntries,
    recentSettledEntries,
    archivedSettledEntries,
    showFilter,
  };
}

const ACTIVE_RUN_STATUSES = new Set<OrchestrationV2RunStatus>([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

type SubagentTurnItem = Extract<ThreadStructureTurnItem, { readonly type: "subagent" }>;

function formatOptionalDateTime(value: DateTime.Utc | null | undefined): string | null {
  return value == null ? null : DateTime.formatIso(value);
}

function parseTimestamp(iso: string | null | undefined): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeDurationMs(
  startedAt: string | null,
  completedAt: string | null,
  settled: boolean,
): number | null {
  if (!settled || startedAt === null || completedAt === null) return null;
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(completedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  return endMs - startMs;
}

function resolveDisplayTitle(title: string | null | undefined, prompt: string): string | null {
  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    const formatted = formatSubagentDisplayTitle(trimmedTitle).trim();
    if (formatted) return formatted;
  }
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt) return promptTitle(trimmedPrompt);
  return null;
}

function resolveDetail(input: {
  readonly status: OrchestrationV2Subagent["status"];
  readonly progress: string | undefined;
  readonly result: string | null;
}): string | null {
  const settled = isTerminalSubagentStatus(input.status);
  const progress = input.progress?.trim();
  const result = input.result?.trim();
  const rawDetail = settled ? result || progress : progress || result;
  return subagentCardDetail(rawDetail);
}

function collectFallbackSubagentItems(
  projection: Pick<ThreadStructure, "turnItems" | "visibleTurnItems">,
): ReadonlyMap<NodeId, SubagentTurnItem> {
  const bySubagentId = new Map<NodeId, SubagentTurnItem>();
  const record = (item: ThreadStructureTurnItem) => {
    if (item.type !== "subagent") return;
    const existing = bySubagentId.get(item.subagentId);
    if (existing === undefined || item.ordinal >= existing.ordinal) {
      bySubagentId.set(item.subagentId, item);
    }
  };
  for (const item of projection.turnItems) record(item);
  for (const row of projection.visibleTurnItems) record(row.item);
  return bySubagentId;
}

function statusSortGroup(status: OrchestrationV2Subagent["status"]): number {
  if (isActiveSubagentStatus(status)) return 0;
  if (status === "idle") return 1;
  return 2;
}

function compareEntries(left: MissionControlSubagentEntry, right: MissionControlSubagentEntry) {
  const leftGroup = statusSortGroup(left.status);
  const rightGroup = statusSortGroup(right.status);
  if (leftGroup !== rightGroup) return leftGroup - rightGroup;

  if (leftGroup === 0) {
    // Keep live subagents in stable launch order so rows do not jump while progress updates.
    const startDiff =
      parseTimestamp(left.startedAt ?? left.updatedAt) -
      parseTimestamp(right.startedAt ?? right.updatedAt);
    return startDiff || left.id.localeCompare(right.id);
  }

  // Show the most recently finished or updated subagents closest to the live ones.
  const settledDiff =
    parseTimestamp(right.completedAt ?? right.updatedAt) -
    parseTimestamp(left.completedAt ?? left.updatedAt);
  return settledDiff || left.id.localeCompare(right.id);
}

export function deriveMissionControlSubagents(
  projection: Pick<ThreadStructure, "subagents" | "runs" | "turnItems" | "visibleTurnItems"> | null,
  shell?: { readonly source: { readonly activeRunId: RunId | null } } | null,
): MissionControlSubagentsSummary | null {
  if (projection === null) return null;

  const rolledBackRunIds = new Set(
    projection.runs.filter((run) => run.status === "rolled_back").map((run) => run.id),
  );
  const seenIds = new Set<NodeId>();
  const entries: MissionControlSubagentEntry[] = [];

  for (const subagent of projection.subagents) {
    if (subagent.runId !== null && rolledBackRunIds.has(subagent.runId)) continue;
    seenIds.add(subagent.id);
    const startedAt = formatOptionalDateTime(subagent.startedAt);
    const completedAt = formatOptionalDateTime(subagent.completedAt);
    const updatedAt = DateTime.formatIso(subagent.updatedAt);
    const settled = isTerminalSubagentStatus(subagent.status);
    const workflowAgents = subagent.workflow?.agents;
    const workflowAgentCount =
      workflowAgents !== undefined && workflowAgents.length > 0 ? workflowAgents.length : null;
    const workflowActiveCount =
      workflowAgents?.filter((agent) => agent.state === "queued" || agent.state === "running")
        .length ?? 0;

    entries.push({
      id: subagent.id,
      runId: subagent.runId,
      origin: subagent.origin,
      driver: subagent.driver,
      providerInstanceId: subagent.providerInstanceId,
      title: resolveDisplayTitle(subagent.title, subagent.prompt),
      model: subagent.model,
      modelSelection: subagent.modelSelection,
      status: subagent.status,
      isActive: isActiveSubagentStatus(subagent.status),
      isCompleted: subagent.status === "completed",
      isFailed: subagent.status === "failed",
      isStopped: subagent.status === "cancelled" || subagent.status === "interrupted",
      detail: resolveDetail({
        status: subagent.status,
        progress: subagent.progress,
        result: subagent.result,
      }),
      workflowAgentCount,
      workflowActiveCount,
      childThreadId: subagent.childThreadId,
      remoteChild: subagent.remoteChild,
      startedAt,
      completedAt,
      updatedAt,
      durationMs: computeDurationMs(startedAt, completedAt, settled),
    });
  }

  const fallbackItems = collectFallbackSubagentItems(projection);
  for (const item of fallbackItems.values()) {
    if (seenIds.has(item.subagentId)) continue;
    if (item.runId !== null && rolledBackRunIds.has(item.runId)) continue;
    seenIds.add(item.subagentId);
    const startedAt = formatOptionalDateTime(item.startedAt);
    const completedAt = formatOptionalDateTime(item.completedAt);
    const updatedAt = DateTime.formatIso(item.updatedAt);
    const settled = isTerminalSubagentStatus(item.status);
    entries.push({
      id: item.subagentId,
      runId: item.runId,
      origin: item.origin,
      driver: item.driver,
      providerInstanceId: item.providerInstanceId,
      title: resolveDisplayTitle(item.title, item.prompt),
      model: null,
      modelSelection: undefined,
      status: item.status,
      isActive: isActiveSubagentStatus(item.status),
      isCompleted: item.status === "completed",
      isFailed: item.status === "failed",
      isStopped: item.status === "cancelled" || item.status === "interrupted",
      detail: resolveDetail({
        status: item.status,
        progress: item.progress,
        result: item.result,
      }),
      workflowAgentCount: null,
      workflowActiveCount: 0,
      childThreadId: item.childThreadId,
      remoteChild: item.remoteChild,
      startedAt,
      completedAt,
      updatedAt,
      durationMs: computeDurationMs(startedAt, completedAt, settled),
    });
  }

  if (entries.length === 0) return null;

  entries.sort(compareEntries);

  let active = 0;
  let completed = 0;
  let failed = 0;
  let stopped = 0;
  let idle = 0;

  for (const entry of entries) {
    if (entry.isActive) active += 1;
    else if (entry.isCompleted) completed += 1;
    else if (entry.isFailed) failed += 1;
    else if (entry.isStopped) stopped += 1;
    else idle += 1;
  }

  const phase: MissionControlSubagentPhase =
    active > 0
      ? "running"
      : failed > 0
        ? "failed"
        : stopped > 0
          ? "stopped"
          : idle > 0
            ? "idle"
            : "completed";

  const runActive =
    projection.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status)) ||
    shell?.source.activeRunId != null;

  const timingPool = active > 0 ? entries.filter((entry) => entry.isActive) : entries;
  let startedAt: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;
  for (const entry of timingPool) {
    const candidate = entry.startedAt ?? entry.updatedAt;
    const ms = parseTimestamp(candidate);
    if (ms > 0 && ms < earliestMs) {
      earliestMs = ms;
      startedAt = candidate;
    }
  }

  let completedAt: string | null = null;
  if (active === 0) {
    let latestMs = 0;
    for (const entry of entries) {
      if (!entry.completedAt) continue;
      const ms = parseTimestamp(entry.completedAt);
      if (ms > latestMs) {
        latestMs = ms;
        completedAt = entry.completedAt;
      }
    }
  }

  return {
    phase,
    runActive,
    subagents: entries,
    total: entries.length,
    active,
    completed,
    failed,
    stopped,
    idle,
    startedAt,
    completedAt,
  };
}

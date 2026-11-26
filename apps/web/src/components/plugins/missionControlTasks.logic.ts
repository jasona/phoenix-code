import type {
  OrchestrationV2PlanArtifact,
  OrchestrationV2PlanStep,
  OrchestrationV2RunStatus,
  RunId,
} from "@t3tools/contracts";
import type {
  ThreadStructure,
  ThreadStructureTurnItem,
} from "@t3tools/client-runtime/state/models";
import * as DateTime from "effect/DateTime";

export type MissionControlTaskStepStatus = "completed" | "running" | "pending" | "interrupted";

export interface MissionControlTaskStep {
  readonly id: string;
  readonly index: number;
  readonly text: string;
  readonly status: OrchestrationV2PlanStep["status"];
  readonly displayStatus: MissionControlTaskStepStatus;
  readonly durationMs: number | null;
  readonly durationAnchorAt: string | null;
}

export type MissionControlTaskPhase = "running" | "completed" | "failed" | "stopped" | "incomplete";

export interface MissionControlTaskSummary {
  readonly planId: string;
  readonly runId: RunId | null;
  readonly phase: MissionControlTaskPhase;
  readonly runActive: boolean;
  readonly steps: ReadonlyArray<MissionControlTaskStep>;
  readonly total: number;
  readonly completed: number;
  readonly running: number;
  readonly pending: number;
  readonly interrupted: number;
  readonly remaining: number;
  readonly percent: number;
  readonly activeStep: MissionControlTaskStep | null;
  readonly explanation: string | null;
  readonly trackedDurationMs: number | null;
  readonly startedAt: string | null;
  readonly updatedAt: string | null;
  readonly completedAt: string | null;
}

const ACTIVE_RUN_STATUSES = new Set<OrchestrationV2RunStatus>([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

type TodoListPlan = Extract<OrchestrationV2PlanArtifact, { readonly kind: "todo_list" }>;
type TodoListTurnItem = Extract<ThreadStructureTurnItem, { readonly type: "todo_list" }>;

interface Candidate {
  readonly planId: string;
  readonly runId: RunId | null;
  readonly steps: ReadonlyArray<OrchestrationV2PlanStep>;
  readonly explanation: string | null;
  readonly runOrdinal: number;
  readonly itemOrdinal: number;
  readonly orderIndex: number;
  readonly startedAt: string | null;
  readonly updatedAt: string | null;
  readonly completedAt: string | null;
}

function formatOptionalDateTime(value: DateTime.Utc | null | undefined): string | null {
  return value == null ? null : DateTime.formatIso(value);
}

function collectTodoItemsByPlanId(
  projection: Pick<ThreadStructure, "visibleTurnItems" | "turnItems">,
): ReadonlyMap<string, TodoListTurnItem> {
  const byPlanId = new Map<string, TodoListTurnItem>();
  const record = (item: ThreadStructureTurnItem) => {
    if (item.type !== "todo_list") return;
    const existing = byPlanId.get(item.planId);
    if (existing === undefined || item.ordinal >= existing.ordinal) {
      byPlanId.set(item.planId, item);
    }
  };
  for (const item of projection.turnItems) record(item);
  for (const row of projection.visibleTurnItems) record(row.item);
  return byPlanId;
}

function isNewerCandidate(candidate: Candidate, current: Candidate): boolean {
  if (candidate.runOrdinal !== current.runOrdinal) {
    return candidate.runOrdinal > current.runOrdinal;
  }
  if (candidate.itemOrdinal !== current.itemOrdinal) {
    return candidate.itemOrdinal > current.itemOrdinal;
  }
  return candidate.orderIndex > current.orderIndex;
}

function computeTrackedDurationMs(
  steps: ReadonlyArray<MissionControlTaskStep>,
  startedAt: string | null,
  completedAt: string | null,
  runActive: boolean,
): number | null {
  let completedDurationMs = 0;
  let hasStepDuration = false;
  for (const step of steps) {
    if (step.status === "completed" && step.durationMs !== null && step.durationMs > 0) {
      completedDurationMs += step.durationMs;
      hasStepDuration = true;
    }
  }
  if (hasStepDuration) return completedDurationMs;
  if (!runActive && startedAt !== null && completedAt !== null) {
    const startMs = Date.parse(startedAt);
    const endMs = Date.parse(completedAt);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      return endMs - startMs;
    }
  }
  return null;
}

export function deriveMissionControlTasks(
  projection: Pick<ThreadStructure, "plans" | "runs" | "turnItems" | "visibleTurnItems"> | null,
  shell?: { readonly source: { readonly activeRunId: RunId | null } } | null,
): MissionControlTaskSummary | null {
  if (projection === null) return null;

  const runById = new Map(projection.runs.map((run) => [run.id, run] as const));
  const todoItemByPlanId = collectTodoItemsByPlanId(projection);
  const knownPlanIds = new Set<string>();
  let winner: Candidate | null = null;

  const consider = (candidate: Candidate) => {
    if (winner === null || isNewerCandidate(candidate, winner)) {
      winner = candidate;
    }
  };

  for (let index = 0; index < projection.plans.length; index++) {
    const plan = projection.plans[index];
    if (!plan || plan.kind !== "todo_list") continue;
    knownPlanIds.add(plan.id);
    if (plan.status === "superseded" || plan.steps.length === 0) continue;
    const todoPlan: TodoListPlan = plan;
    const item = todoItemByPlanId.get(todoPlan.id);
    const run = todoPlan.runId === null ? undefined : runById.get(todoPlan.runId);
    const explanation = todoPlan.explanation?.trim() || item?.explanation?.trim() || null;
    consider({
      planId: todoPlan.id,
      runId: todoPlan.runId,
      steps: todoPlan.steps,
      explanation,
      runOrdinal: run?.ordinal ?? -1,
      itemOrdinal: item?.ordinal ?? -1,
      orderIndex: index,
      startedAt: formatOptionalDateTime(item?.startedAt ?? run?.startedAt),
      updatedAt: formatOptionalDateTime(item?.updatedAt),
      completedAt: formatOptionalDateTime(item?.completedAt ?? run?.completedAt),
    });
  }

  let fallbackIndex = projection.plans.length;
  for (const item of todoItemByPlanId.values()) {
    if (knownPlanIds.has(item.planId) || item.steps.length === 0) continue;
    const run = item.runId === null ? undefined : runById.get(item.runId);
    consider({
      planId: item.planId,
      runId: item.runId,
      steps: item.steps,
      explanation: item.explanation?.trim() || null,
      runOrdinal: run?.ordinal ?? -1,
      itemOrdinal: item.ordinal,
      orderIndex: fallbackIndex++,
      startedAt: formatOptionalDateTime(item.startedAt ?? run?.startedAt),
      updatedAt: formatOptionalDateTime(item.updatedAt),
      completedAt: formatOptionalDateTime(item.completedAt ?? run?.completedAt),
    });
  }

  if (winner === null) return null;
  const chosen: Candidate = winner;
  const owningRun = chosen.runId === null ? undefined : runById.get(chosen.runId);
  const runActive =
    owningRun !== undefined
      ? ACTIVE_RUN_STATUSES.has(owningRun.status)
      : shell?.source.activeRunId != null &&
        (chosen.runId === null || shell.source.activeRunId === chosen.runId);

  const steps: MissionControlTaskStep[] = chosen.steps.map((step, index) => {
    const displayStatus: MissionControlTaskStepStatus =
      step.status === "completed"
        ? "completed"
        : step.status === "running"
          ? runActive
            ? "running"
            : "interrupted"
          : "pending";
    return {
      id: step.id,
      index: index + 1,
      text: step.text,
      status: step.status,
      displayStatus,
      durationMs:
        step.status === "completed" && step.durationMs !== undefined && step.durationMs > 0
          ? step.durationMs
          : null,
      durationAnchorAt:
        displayStatus === "running" && step.durationAnchorAt !== undefined
          ? step.durationAnchorAt
          : null,
    };
  });

  const total = steps.length;
  const completed = steps.filter((step) => step.displayStatus === "completed").length;
  const running = steps.filter((step) => step.displayStatus === "running").length;
  const pending = steps.filter((step) => step.displayStatus === "pending").length;
  const interrupted = steps.filter((step) => step.displayStatus === "interrupted").length;
  const remaining = total - completed;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  const phase: MissionControlTaskPhase =
    completed === total
      ? "completed"
      : runActive
        ? "running"
        : owningRun?.status === "failed"
          ? "failed"
          : owningRun?.status === "interrupted" || owningRun?.status === "cancelled"
            ? "stopped"
            : "incomplete";

  const activeStep = runActive
    ? (steps.find((step) => step.displayStatus === "running") ??
      steps.find((step) => step.displayStatus === "pending") ??
      null)
    : null;

  const startedAt = chosen.startedAt ?? formatOptionalDateTime(owningRun?.startedAt);
  const completedAt =
    phase === "completed"
      ? (chosen.completedAt ?? formatOptionalDateTime(owningRun?.completedAt))
      : formatOptionalDateTime(owningRun?.completedAt);

  return {
    planId: chosen.planId,
    runId: chosen.runId,
    phase,
    runActive,
    steps,
    total,
    completed,
    running,
    pending,
    interrupted,
    remaining,
    percent,
    activeStep,
    explanation: chosen.explanation,
    trackedDurationMs: computeTrackedDurationMs(steps, startedAt, completedAt, runActive),
    startedAt,
    updatedAt: chosen.updatedAt,
    completedAt,
  };
}

export const MISSION_CONTROL_WIDE_SPLIT_WITH_TASKS_MIN_WIDTH = 1200;

export function resolveMissionControlTasksPanelOpen(input: {
  readonly hasTasks: boolean;
  readonly canDock: boolean;
  readonly savedOpen: boolean | undefined;
}): boolean {
  if (!input.hasTasks) return false;
  if (typeof input.savedOpen === "boolean") return input.savedOpen;
  return input.canDock;
}

import {
  NodeId,
  PlanId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2PlanStep,
  type OrchestrationV2Run,
  type OrchestrationV2RunStatus,
} from "@t3tools/contracts";
import type {
  ThreadStructure,
  ThreadStructureTurnItem,
  ThreadStructureVisibleTurnItem,
} from "@t3tools/client-runtime/state/models";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveMissionControlTasks,
  resolveMissionControlTasksPanelOpen,
} from "./missionControlTasks.logic";

const threadId = ThreadId.make("thread-1");
const providerThreadId = ProviderThreadId.make("provider-thread-1");
const nodeId = NodeId.make("node-1");

function makeRun(
  id: string,
  ordinal: number,
  status: OrchestrationV2RunStatus,
  times?: { startedAt?: string; completedAt?: string | null },
): OrchestrationV2Run {
  const startedAt = DateTime.makeUnsafe(times?.startedAt ?? "2026-11-26T18:40:00.000Z");
  const completedAt =
    times?.completedAt === undefined
      ? status === "running"
        ? null
        : DateTime.makeUnsafe("2026-11-26T18:45:00.000Z")
      : times.completedAt === null
        ? null
        : DateTime.makeUnsafe(times.completedAt);
  return {
    id: RunId.make(id),
    threadId,
    ordinal,
    status,
    interactionMode: "default",
    runtimeMode: "full-access",
    modelSelection: null,
    providerThreadId,
    rootNodeId: nodeId,
    requestedAt: startedAt,
    startedAt,
    completedAt,
    failure: null,
  } as unknown as OrchestrationV2Run;
}

function makeTodoPlan(
  id: string,
  runId: string | null,
  status: OrchestrationV2PlanArtifact["status"],
  steps: ReadonlyArray<OrchestrationV2PlanStep>,
  explanation?: string,
): OrchestrationV2PlanArtifact {
  return {
    id: PlanId.make(id),
    threadId,
    runId: runId === null ? null : RunId.make(runId),
    nodeId,
    kind: "todo_list",
    status,
    steps: [...steps],
    ...(explanation === undefined ? {} : { explanation }),
  };
}

function makeTodoItem(
  id: string,
  planId: string,
  runId: string | null,
  ordinal: number,
  steps: ReadonlyArray<OrchestrationV2PlanStep>,
  times?: { startedAt?: string; updatedAt?: string; completedAt?: string | null },
): ThreadStructureVisibleTurnItem {
  const startedAt = DateTime.makeUnsafe(times?.startedAt ?? "2026-11-26T18:41:00.000Z");
  const updatedAt = DateTime.makeUnsafe(times?.updatedAt ?? "2026-11-26T18:44:00.000Z");
  const completedAt =
    times?.completedAt === undefined || times.completedAt === null
      ? null
      : DateTime.makeUnsafe(times.completedAt);
  const item: ThreadStructureTurnItem = {
    id: TurnItemId.make(id),
    threadId,
    runId: runId === null ? null : RunId.make(runId),
    nodeId,
    providerThreadId,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: completedAt === null ? "running" : "completed",
    title: null,
    startedAt,
    completedAt,
    updatedAt,
    type: "todo_list",
    planId: PlanId.make(planId),
    steps: [...steps],
  };
  return {
    position: ordinal,
    visibility: "local",
    sourceThreadId: threadId,
    sourceItemId: item.id,
    item,
  };
}

function makeProjection(
  overrides: Partial<Pick<ThreadStructure, "plans" | "runs" | "turnItems" | "visibleTurnItems">>,
): Pick<ThreadStructure, "plans" | "runs" | "turnItems" | "visibleTurnItems"> {
  const visibleTurnItems = overrides.visibleTurnItems ?? [];
  return {
    plans: overrides.plans ?? [],
    runs: overrides.runs ?? [],
    turnItems: overrides.turnItems ?? visibleTurnItems.map((row) => row.item),
    visibleTurnItems,
  };
}

describe("deriveMissionControlTasks", () => {
  it("returns null when a thread has no todo_list plans or items", () => {
    expect(deriveMissionControlTasks(null)).toBeNull();
    expect(
      deriveMissionControlTasks(
        makeProjection({
          plans: [
            {
              id: PlanId.make("proposed-1"),
              threadId,
              runId: RunId.make("run-1"),
              nodeId,
              kind: "proposed_plan",
              status: "active",
              markdown: "# Plan",
            },
          ],
          runs: [makeRun("run-1", 1, "running")],
        }),
      ),
    ).toBeNull();
  });

  it("accounts for running, completed, and pending tasks in real time with step timings", () => {
    const steps: ReadonlyArray<OrchestrationV2PlanStep> = [
      { id: "1", text: "Expose settled metadata", status: "completed", durationMs: 12_000 },
      { id: "2", text: "Redesign Overview view", status: "completed", durationMs: 28_000 },
      {
        id: "3",
        text: "Add unit tests and verify visually",
        status: "running",
        durationAnchorAt: "2026-11-26T18:44:00.000Z",
      },
      { id: "4", text: "Run repo checks", status: "pending" },
    ];
    const summary = deriveMissionControlTasks(
      makeProjection({
        runs: [makeRun("run-1", 1, "running")],
        plans: [makeTodoPlan("plan-1", "run-1", "active", steps, "Working through polish tasks")],
        visibleTurnItems: [makeTodoItem("item-1", "plan-1", "run-1", 10, steps)],
      }),
    );

    expect(summary).toMatchObject({
      planId: "plan-1",
      runId: "run-1",
      phase: "running",
      runActive: true,
      total: 4,
      completed: 2,
      running: 1,
      pending: 1,
      interrupted: 0,
      remaining: 2,
      percent: 50,
      explanation: "Working through polish tasks",
      trackedDurationMs: 40_000,
    });
    expect(summary?.activeStep).toMatchObject({
      id: "3",
      index: 3,
      text: "Add unit tests and verify visually",
      displayStatus: "running",
      durationAnchorAt: "2026-11-26T18:44:00.000Z",
    });
    expect(summary?.steps.map((step) => step.displayStatus)).toEqual([
      "completed",
      "completed",
      "running",
      "pending",
    ]);
  });

  it("reports completed accounting when all tasks finish, even after history paging removes turn items", () => {
    const steps: ReadonlyArray<OrchestrationV2PlanStep> = [
      { id: "1", text: "Read codebase", status: "completed", durationMs: 5_000 },
      { id: "2", text: "Ship fix", status: "completed", durationMs: 15_000 },
    ];
    const summary = deriveMissionControlTasks(
      makeProjection({
        runs: [makeRun("run-1", 1, "completed")],
        plans: [makeTodoPlan("plan-1", "run-1", "completed", steps)],
        visibleTurnItems: [],
      }),
    );

    expect(summary).toMatchObject({
      phase: "completed",
      runActive: false,
      total: 2,
      completed: 2,
      running: 0,
      pending: 0,
      interrupted: 0,
      remaining: 0,
      percent: 100,
      activeStep: null,
      trackedDurationMs: 20_000,
    });
  });

  it("normalizes stale running steps when the owning run ends in failure, stop, or incomplete state", () => {
    const steps: ReadonlyArray<OrchestrationV2PlanStep> = [
      { id: "1", text: "Step one", status: "completed", durationMs: 4_000 },
      {
        id: "2",
        text: "Step two",
        status: "running",
        durationAnchorAt: "2026-11-26T18:42:00.000Z",
      },
      { id: "3", text: "Step three", status: "pending" },
    ];

    const failed = deriveMissionControlTasks(
      makeProjection({
        runs: [makeRun("run-1", 1, "failed")],
        plans: [makeTodoPlan("plan-1", "run-1", "active", steps)],
      }),
    );
    expect(failed).toMatchObject({
      phase: "failed",
      runActive: false,
      completed: 1,
      running: 0,
      interrupted: 1,
      pending: 1,
      remaining: 2,
      activeStep: null,
    });
    expect(failed?.steps[1]).toMatchObject({
      displayStatus: "interrupted",
      durationAnchorAt: null,
    });

    const interrupted = deriveMissionControlTasks(
      makeProjection({
        runs: [makeRun("run-1", 1, "interrupted")],
        plans: [makeTodoPlan("plan-1", "run-1", "active", steps)],
      }),
    );
    expect(interrupted?.phase).toBe("stopped");

    const incomplete = deriveMissionControlTasks(
      makeProjection({
        runs: [makeRun("run-1", 1, "completed")],
        plans: [makeTodoPlan("plan-1", "run-1", "active", steps)],
      }),
    );
    expect(incomplete?.phase).toBe("incomplete");
  });

  it("ignores superseded plans and picks the latest replacement by run ordinal then item ordinal", () => {
    const oldSteps: ReadonlyArray<OrchestrationV2PlanStep> = [
      { id: "1", text: "Old step", status: "running" },
    ];
    const runOneReplacement: ReadonlyArray<OrchestrationV2PlanStep> = [
      { id: "1", text: "Replaced step", status: "completed" },
    ];
    const runTwoSteps: ReadonlyArray<OrchestrationV2PlanStep> = [
      { id: "1", text: "Run two step", status: "running" },
    ];

    const sameRunWinner = deriveMissionControlTasks(
      makeProjection({
        runs: [makeRun("run-1", 1, "running")],
        plans: [
          makeTodoPlan("plan-superseded", "run-1", "superseded", oldSteps),
          makeTodoPlan("plan-z", "run-1", "active", oldSteps),
          makeTodoPlan("plan-a", "run-1", "active", runOneReplacement),
        ],
        visibleTurnItems: [
          makeTodoItem("item-1", "plan-z", "run-1", 5, oldSteps),
          makeTodoItem("item-2", "plan-a", "run-1", 12, runOneReplacement),
        ],
      }),
    );
    expect(sameRunWinner?.planId).toBe("plan-a");

    const newerRunWinner = deriveMissionControlTasks(
      makeProjection({
        runs: [makeRun("run-1", 1, "completed"), makeRun("run-2", 2, "running")],
        plans: [
          makeTodoPlan("plan-1", "run-1", "completed", runOneReplacement),
          makeTodoPlan("plan-2", "run-2", "active", runTwoSteps),
        ],
      }),
    );
    expect(newerRunWinner?.planId).toBe("plan-2");
    expect(newerRunWinner?.phase).toBe("running");
  });

  it("falls back to todo_list turn items when no plan artifact exists, without resurrecting superseded plans", () => {
    const fallbackSteps: ReadonlyArray<OrchestrationV2PlanStep> = [
      { id: "1", text: "Turn item only task", status: "pending" },
    ];
    const fromTurnItem = deriveMissionControlTasks(
      makeProjection({
        runs: [makeRun("run-1", 1, "running")],
        plans: [],
        visibleTurnItems: [makeTodoItem("item-1", "plan-item-only", "run-1", 4, fallbackSteps)],
      }),
    );
    expect(fromTurnItem?.planId).toBe("plan-item-only");

    const suppressed = deriveMissionControlTasks(
      makeProjection({
        runs: [makeRun("run-1", 1, "running")],
        plans: [makeTodoPlan("plan-superseded", "run-1", "superseded", fallbackSteps)],
        visibleTurnItems: [makeTodoItem("item-1", "plan-superseded", "run-1", 4, fallbackSteps)],
      }),
    );
    expect(suppressed).toBeNull();
  });
});

describe("resolveMissionControlTasksPanelOpen", () => {
  it("auto-opens on dockable windows when tasks are available and respects user overrides", () => {
    expect(
      resolveMissionControlTasksPanelOpen({
        hasTasks: false,
        canDock: true,
        savedOpen: undefined,
      }),
    ).toBe(false);
    expect(
      resolveMissionControlTasksPanelOpen({
        hasTasks: false,
        canDock: true,
        savedOpen: true,
      }),
    ).toBe(false);
    expect(
      resolveMissionControlTasksPanelOpen({
        hasTasks: true,
        canDock: true,
        savedOpen: undefined,
      }),
    ).toBe(true);
    expect(
      resolveMissionControlTasksPanelOpen({
        hasTasks: true,
        canDock: true,
        savedOpen: false,
      }),
    ).toBe(false);
    expect(
      resolveMissionControlTasksPanelOpen({
        hasTasks: true,
        canDock: false,
        savedOpen: undefined,
      }),
    ).toBe(false);
    expect(
      resolveMissionControlTasksPanelOpen({
        hasTasks: true,
        canDock: false,
        savedOpen: true,
      }),
    ).toBe(true);
  });
});

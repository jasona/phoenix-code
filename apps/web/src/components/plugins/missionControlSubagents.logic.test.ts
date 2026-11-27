import {
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts";
import type { ThreadStructure } from "@t3tools/client-runtime/state/models";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveMissionControlSubagents,
  MISSION_CONTROL_SUBAGENTS_RECENT_LIMIT,
  partitionMissionControlSubagents,
} from "./missionControlSubagents.logic";

type ProjectionInput = Pick<
  ThreadStructure,
  "subagents" | "runs" | "turnItems" | "visibleTurnItems"
>;

function makeRun(id: string, ordinal: number, status: ProjectionInput["runs"][number]["status"]) {
  return {
    id: RunId.make(id),
    ordinal,
    status,
    startedAt: DateTime.makeUnsafe("2026-11-26T18:40:00.000Z"),
    completedAt: status === "running" ? null : DateTime.makeUnsafe("2026-11-26T18:45:00.000Z"),
  } as unknown as ProjectionInput["runs"][number];
}

function makeSubagent(
  overrides: Omit<Partial<OrchestrationV2Subagent>, "id"> & { id: string },
): OrchestrationV2Subagent {
  const { id, ...rest } = overrides;
  return {
    id: NodeId.make(id),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    parentNodeId: NodeId.make("node-root"),
    origin: "app_owned",
    createdBy: "agent",
    driver: ProviderDriverKind.make("codex"),
    providerInstanceId: ProviderInstanceId.make("codex-default"),
    providerThreadId: null,
    childThreadId: ThreadId.make(`child-${id}`),
    nativeTaskRef: null,
    prompt: "Investigate implementation details",
    title: "Investigator",
    model: "gpt-5.4",
    status: "running",
    result: null,
    startedAt: DateTime.makeUnsafe("2026-11-26T18:41:00.000Z"),
    completedAt: null,
    updatedAt: DateTime.makeUnsafe("2026-11-26T18:41:30.000Z"),
    promptOmitted: undefined,
    resultOmitted: undefined,
    ...rest,
  } as OrchestrationV2Subagent;
}

function makeProjection(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    runs: [makeRun("run-1", 1, "running")],
    subagents: [],
    turnItems: [],
    visibleTurnItems: [],
    ...overrides,
  };
}

describe("deriveMissionControlSubagents", () => {
  it("returns null when projection is null or contains no subagents", () => {
    expect(deriveMissionControlSubagents(null)).toBeNull();
    expect(deriveMissionControlSubagents(makeProjection())).toBeNull();
  });

  it("excludes rolled-back runs and sorts active subagents before settled ones", () => {
    const projection = makeProjection({
      runs: [makeRun("run-rolled-back", 1, "rolled_back"), makeRun("run-active", 2, "running")],
      subagents: [
        makeSubagent({
          id: "sub-rolled",
          runId: RunId.make("run-rolled-back"),
          title: "Rolled back worker",
          status: "completed",
        }),
        makeSubagent({
          id: "sub-done-old",
          runId: RunId.make("run-active"),
          title: "Subagent: Safe image loading",
          status: "completed",
          result: "Implemented safe decoder",
          startedAt: DateTime.makeUnsafe("2026-11-26T18:40:00.000Z"),
          completedAt: DateTime.makeUnsafe("2026-11-26T18:40:12.000Z"),
          updatedAt: DateTime.makeUnsafe("2026-11-26T18:40:12.000Z"),
        }),
        makeSubagent({
          id: "sub-running-b",
          runId: RunId.make("run-active"),
          title: "PDF handling",
          status: "running",
          progress: "Scanning `pdfium` bindings",
          startedAt: DateTime.makeUnsafe("2026-11-26T18:41:10.000Z"),
          updatedAt: DateTime.makeUnsafe("2026-11-26T18:41:25.000Z"),
        }),
        makeSubagent({
          id: "sub-running-a",
          runId: RunId.make("run-active"),
          title: null,
          prompt: "Audit Base/CI integration across targets",
          status: "pending",
          startedAt: DateTime.makeUnsafe("2026-11-26T18:41:00.000Z"),
          updatedAt: DateTime.makeUnsafe("2026-11-26T18:41:05.000Z"),
        }),
        makeSubagent({
          id: "sub-done-new",
          runId: RunId.make("run-active"),
          title: "Window chrome",
          status: "completed",
          result: "Child task ended with status completed",
          startedAt: DateTime.makeUnsafe("2026-11-26T18:40:15.000Z"),
          completedAt: DateTime.makeUnsafe("2026-11-26T18:40:45.000Z"),
          updatedAt: DateTime.makeUnsafe("2026-11-26T18:40:45.000Z"),
        }),
      ],
    });

    const summary = deriveMissionControlSubagents(projection);
    expect(summary).not.toBeNull();
    expect(summary?.phase).toBe("running");
    expect(summary?.total).toBe(4);
    expect(summary?.active).toBe(2);
    expect(summary?.completed).toBe(2);
    expect(summary?.failed).toBe(0);
    expect(summary?.startedAt).toBe("2026-11-26T18:41:00.000Z");
    expect(summary?.completedAt).toBeNull();

    expect(summary?.subagents.map((entry) => entry.id)).toEqual([
      NodeId.make("sub-running-a"),
      NodeId.make("sub-running-b"),
      NodeId.make("sub-done-new"),
      NodeId.make("sub-done-old"),
    ]);
    expect(summary?.subagents[0]?.title).toBe("Audit Base/CI integration across targets");
    expect(summary?.subagents[1]?.detail).toBe("Scanning pdfium bindings");
    expect(summary?.subagents[2]?.detail).toBeNull();
    expect(summary?.subagents[2]?.durationMs).toBe(30_000);
    expect(summary?.subagents[3]?.title).toBe("Safe image loading");
    expect(summary?.subagents[3]?.detail).toBe("Implemented safe decoder");
    expect(summary?.subagents[3]?.durationMs).toBe(12_000);
  });

  it("falls back to subagent turn items when projection.subagents is missing an entry", () => {
    const projection = makeProjection({
      runs: [makeRun("run-1", 1, "completed")],
      turnItems: [
        {
          id: TurnItemId.make("item-1"),
          threadId: ThreadId.make("thread-1"),
          runId: RunId.make("run-1"),
          ordinal: 1,
          status: "failed",
          title: "Fallback worker",
          type: "subagent",
          subagentId: NodeId.make("sub-fallback"),
          origin: "provider_native",
          driver: ProviderDriverKind.make("claudeAgent"),
          providerInstanceId: ProviderInstanceId.make("claude-default"),
          childThreadId: null,
          prompt: "Check failing tests",
          result: "Timed out waiting for fixtures",
          startedAt: DateTime.makeUnsafe("2026-11-26T18:41:00.000Z"),
          completedAt: DateTime.makeUnsafe("2026-11-26T18:41:20.000Z"),
          updatedAt: DateTime.makeUnsafe("2026-11-26T18:41:20.000Z"),
        } as unknown as ProjectionInput["turnItems"][number],
      ],
    });

    const summary = deriveMissionControlSubagents(projection);
    expect(summary?.phase).toBe("failed");
    expect(summary?.failed).toBe(1);
    expect(summary?.subagents[0]).toMatchObject({
      id: NodeId.make("sub-fallback"),
      title: "Fallback worker",
      detail: "Timed out waiting for fixtures",
      childThreadId: null,
      durationMs: 20_000,
    });
  });

  it("derives stopped, idle, and completed phases and workflow counts", () => {
    const stoppedSummary = deriveMissionControlSubagents(
      makeProjection({
        runs: [makeRun("run-1", 1, "interrupted")],
        subagents: [
          makeSubagent({
            id: "sub-stopped",
            status: "cancelled",
            completedAt: DateTime.makeUnsafe("2026-11-26T18:42:00.000Z"),
          }),
        ],
      }),
    );
    expect(stoppedSummary?.phase).toBe("stopped");
    expect(stoppedSummary?.stopped).toBe(1);

    const idleSummary = deriveMissionControlSubagents(
      makeProjection({
        runs: [makeRun("run-1", 1, "completed")],
        subagents: [
          makeSubagent({
            id: "sub-idle",
            status: "idle",
            workflow: {
              name: "Review swarm",
              phases: [],
              agents: [
                { index: 0, label: "A", state: "completed" },
                { index: 1, label: "B", state: "running" },
              ],
            } as OrchestrationV2Subagent["workflow"],
          }),
        ],
      }),
    );
    expect(idleSummary?.phase).toBe("idle");
    expect(idleSummary?.subagents[0]?.workflowAgentCount).toBe(2);
    expect(idleSummary?.subagents[0]?.workflowActiveCount).toBe(1);

    const completedSummary = deriveMissionControlSubagents(
      makeProjection({
        runs: [makeRun("run-1", 1, "completed")],
        subagents: [
          makeSubagent({
            id: "sub-ok",
            status: "completed",
            completedAt: DateTime.makeUnsafe("2026-11-26T18:42:00.000Z"),
          }),
        ],
      }),
    );
    expect(completedSummary?.phase).toBe("completed");
    expect(completedSummary?.completedAt).toBe("2026-11-26T18:42:00.000Z");
  });
});

describe("partitionMissionControlSubagents", () => {
  it("collapses older idle subagents after the recent preview and enables filtering for long histories", () => {
    const subagents = Array.from({ length: 33 }, (_, index) =>
      makeSubagent({
        id: `idle-${index + 1}`,
        title: index === 25 ? "Blackjack Dealer Portrait" : `Slot Generator ${index + 1}`,
        status: "idle",
        startedAt: DateTime.makeUnsafe(
          `2026-11-26T18:${String(index % 60).padStart(2, "0")}:00.000Z`,
        ),
        updatedAt: DateTime.makeUnsafe(
          `2026-11-26T18:${String(index % 60).padStart(2, "0")}:30.000Z`,
        ),
      }),
    );

    const summary = deriveMissionControlSubagents(
      makeProjection({
        runs: [makeRun("run-1", 1, "completed")],
        subagents,
      }),
    )!;

    const partition = partitionMissionControlSubagents(summary);
    expect(partition.showFilter).toBe(true);
    expect(partition.activeEntries).toHaveLength(0);
    expect(partition.issueEntries).toHaveLength(0);
    expect(partition.recentSettledEntries).toHaveLength(MISSION_CONTROL_SUBAGENTS_RECENT_LIMIT);
    expect(partition.archivedSettledEntries).toHaveLength(
      33 - MISSION_CONTROL_SUBAGENTS_RECENT_LIMIT,
    );

    const filtered = partitionMissionControlSubagents(summary, "blackjack");
    expect(filtered.isFiltering).toBe(true);
    expect(filtered.filteredEntries.map((entry) => entry.title)).toEqual([
      "Blackjack Dealer Portrait",
    ]);
  });

  it("keeps live and failed subagents visible while archiving large settled histories", () => {
    const subagents = [
      makeSubagent({ id: "live-1", title: "Live worker", status: "running" }),
      makeSubagent({ id: "fail-1", title: "Failed worker", status: "failed" }),
      ...Array.from({ length: 8 }, (_, index) =>
        makeSubagent({
          id: `idle-${index + 1}`,
          title: `Idle worker ${index + 1}`,
          status: "idle",
        }),
      ),
    ];

    const summary = deriveMissionControlSubagents(makeProjection({ subagents }))!;
    const partition = partitionMissionControlSubagents(summary);

    expect(partition.activeEntries.map((entry) => entry.id)).toEqual([NodeId.make("live-1")]);
    expect(partition.issueEntries.map((entry) => entry.id)).toEqual([NodeId.make("fail-1")]);
    expect(partition.recentSettledEntries).toHaveLength(0);
    expect(partition.archivedSettledEntries).toHaveLength(8);
  });

  it("keeps small settled histories uncollapsed without showing a filter box", () => {
    const subagents = Array.from({ length: 4 }, (_, index) =>
      makeSubagent({ id: `idle-${index + 1}`, title: `Idle ${index + 1}`, status: "idle" }),
    );
    const summary = deriveMissionControlSubagents(
      makeProjection({ runs: [makeRun("run-1", 1, "completed")], subagents }),
    )!;

    const partition = partitionMissionControlSubagents(summary);
    expect(partition.showFilter).toBe(false);
    expect(partition.recentSettledEntries).toHaveLength(4);
    expect(partition.archivedSettledEntries).toHaveLength(0);
  });
});

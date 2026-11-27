import {
  EnvironmentId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { render } from "../../../test/render";
import type { MissionControlSubagentsSummary } from "./missionControlSubagents.logic";
import { MissionControlWorkSidebar } from "./MissionControlSubagentsSidebar";
import type { MissionControlTaskSummary } from "./missionControlTasks.logic";

const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("thread-parent"));

function makeSubagentsSummary(
  overrides: Partial<MissionControlSubagentsSummary> = {},
): MissionControlSubagentsSummary {
  return {
    phase: "running",
    runActive: true,
    subagents: [
      {
        id: NodeId.make("sub-1"),
        runId: RunId.make("run-1"),
        origin: "app_owned",
        driver: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex-default"),
        title: "Safe image loading",
        model: "gpt-5.4",
        modelSelection: undefined,
        status: "running",
        isActive: true,
        isCompleted: false,
        isFailed: false,
        isStopped: false,
        detail: "Implementing EXIF orientation guards",
        workflowAgentCount: null,
        workflowActiveCount: 0,
        childThreadId: ThreadId.make("child-image-loader"),
        remoteChild: undefined,
        startedAt: "2026-11-26T18:44:00.000Z",
        completedAt: null,
        updatedAt: "2026-11-26T18:44:10.000Z",
        durationMs: null,
      },
      {
        id: NodeId.make("sub-2"),
        runId: RunId.make("run-1"),
        origin: "provider_native",
        driver: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId: ProviderInstanceId.make("claude-default"),
        title: "PDF handling",
        model: "claude-sonnet-4-6",
        modelSelection: undefined,
        status: "completed",
        isActive: false,
        isCompleted: true,
        isFailed: false,
        isStopped: false,
        detail: "Verified page rasterizer",
        workflowAgentCount: null,
        workflowActiveCount: 0,
        childThreadId: null,
        remoteChild: undefined,
        startedAt: "2026-11-26T18:43:30.000Z",
        completedAt: "2026-11-26T18:44:02.000Z",
        updatedAt: "2026-11-26T18:44:02.000Z",
        durationMs: 32_000,
      },
    ],
    total: 2,
    active: 1,
    completed: 1,
    failed: 0,
    stopped: 0,
    idle: 0,
    startedAt: "2026-11-26T18:44:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function makeTaskSummary(
  overrides: Partial<MissionControlTaskSummary> = {},
): MissionControlTaskSummary {
  return {
    planId: "plan-1",
    runId: RunId.make("run-1"),
    phase: "running",
    runActive: true,
    steps: [
      {
        id: "1",
        index: 1,
        text: "Claim the next unblocked issue",
        status: "completed",
        displayStatus: "completed",
        durationMs: 12_000,
        durationAnchorAt: null,
      },
      {
        id: "2",
        index: 2,
        text: "Build Viewer's document engine",
        status: "running",
        displayStatus: "running",
        durationMs: null,
        durationAnchorAt: "2026-11-26T18:44:00.000Z",
      },
    ],
    total: 2,
    completed: 1,
    running: 1,
    pending: 0,
    interrupted: 0,
    remaining: 1,
    percent: 50,
    activeStep: null,
    explanation: null,
    trackedDurationMs: 12_000,
    startedAt: "2026-11-26T18:43:00.000Z",
    updatedAt: "2026-11-26T18:44:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("MissionControlWorkSidebar", () => {
  it("renders subagents above tasks, opens child subagent threads on click, and hides sections independently", async () => {
    const onCloseSubagents = vi.fn();
    const onCloseTasks = vi.fn();
    const onCloseAll = vi.fn();
    const onInspectSubagent = vi.fn();
    using _now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-26T18:44:19.000Z"));

    await using screen = await render(
      <AppAtomRegistryProvider>
        <div className="flex h-[620px] w-[960px] bg-background">
          <div className="flex-1" />
          <MissionControlWorkSidebar
            threadRef={threadRef}
            subagentsPanelId="subagents-panel"
            tasksPanelId="tasks-panel"
            subagentSummary={makeSubagentsSummary()}
            taskSummary={makeTaskSummary()}
            subagentsVisible
            tasksVisible
            mode="docked"
            wide={false}
            onCloseSubagents={onCloseSubagents}
            onCloseTasks={onCloseTasks}
            onCloseAll={onCloseAll}
            onInspectSubagent={onInspectSubagent}
          />
        </div>
      </AppAtomRegistryProvider>,
      { router: false },
    );

    const subagentsSection = screen.getByTestId("mission-control-subagents-section");
    const tasksSection = screen.getByTestId("mission-control-tasks-section");
    await expect.element(subagentsSection).toBeVisible();
    await expect.element(tasksSection).toBeVisible();

    const subagentsRect = subagentsSection.element().getBoundingClientRect();
    const tasksRect = tasksSection.element().getBoundingClientRect();
    expect(subagentsRect.top).toBeLessThan(tasksRect.top);
    expect(subagentsRect.bottom).toBeLessThanOrEqual(tasksRect.top + 1);

    await expect
      .element(screen.getByTestId("mission-control-subagents-count"))
      .toHaveTextContent("2 subagents");
    await expect
      .element(screen.getByTestId("mission-control-subagents-status"))
      .toHaveTextContent("1 working · 1 done");

    const openableButton = screen.getByRole("button", { name: "Open Safe image loading" });
    await expect.element(openableButton).toBeVisible();
    await expect.element(screen.getByText("Implementing EXIF orientation guards")).toBeVisible();
    await expect.element(screen.getByText("PDF handling")).toBeVisible();
    await expect.element(screen.getByText("Verified page rasterizer")).toBeVisible();

    await userEvent.click(openableButton);
    expect(onInspectSubagent).toHaveBeenCalledWith(ThreadId.make("child-image-loader"));

    await userEvent.click(screen.getByRole("button", { name: "Hide subagents sidebar" }));
    expect(onCloseSubagents).toHaveBeenCalledTimes(1);
    expect(onCloseTasks).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Hide tasks sidebar" }));
    expect(onCloseTasks).toHaveBeenCalledTimes(1);
  });

  it("renders standalone subagents panel with footer when there are no tasks and closes overlay on Escape", async () => {
    const onCloseAll = vi.fn();
    const onWindowKeyDown = vi.fn();
    using _now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-26T18:44:19.000Z"));

    await using screen = await render(
      <AppAtomRegistryProvider>
        <div className="relative h-[560px] w-[390px] bg-background" onKeyDown={onWindowKeyDown}>
          <MissionControlWorkSidebar
            threadRef={threadRef}
            subagentsPanelId="subagents-panel"
            tasksPanelId="tasks-panel"
            subagentSummary={makeSubagentsSummary()}
            taskSummary={null}
            subagentsVisible
            tasksVisible={false}
            mode="overlay"
            wide={false}
            onCloseSubagents={vi.fn()}
            onCloseTasks={vi.fn()}
            onCloseAll={onCloseAll}
          />
        </div>
      </AppAtomRegistryProvider>,
      { router: false },
    );

    await expect.element(screen.getByTestId("mission-control-subagents-section")).toBeVisible();
    await expect.element(screen.getByText("Updating live")).toBeVisible();

    const hideButton = screen.getByRole("button", { name: "Hide subagents sidebar" });
    (hideButton.element() as HTMLElement).focus();
    await userEvent.keyboard("{Escape}");

    expect(onCloseAll).toHaveBeenCalledTimes(1);
    expect(onWindowKeyDown).not.toHaveBeenCalled();
  });

  it("caps subagents list height with internal scroll so tasks stay visible when many subagents run", async () => {
    const manySubagents = Array.from({ length: 10 }, (_, index) => ({
      id: NodeId.make(`sub-${index + 1}`),
      runId: RunId.make("run-1"),
      origin: "app_owned" as const,
      driver: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex-default"),
      title: `Worker ${index + 1}`,
      model: "gpt-5.4",
      modelSelection: undefined,
      status: "running" as const,
      isActive: true,
      isCompleted: false,
      isFailed: false,
      isStopped: false,
      detail: `Processing shard ${index + 1}`,
      workflowAgentCount: null,
      workflowActiveCount: 0,
      childThreadId: ThreadId.make(`child-${index + 1}`),
      remoteChild: undefined,
      startedAt: "2026-11-26T18:44:00.000Z",
      completedAt: null,
      updatedAt: "2026-11-26T18:44:10.000Z",
      durationMs: null,
    }));

    await using screen = await render(
      <AppAtomRegistryProvider>
        <div className="flex h-[620px] w-[960px] bg-background">
          <div className="flex-1" />
          <MissionControlWorkSidebar
            threadRef={threadRef}
            subagentsPanelId="subagents-panel"
            tasksPanelId="tasks-panel"
            subagentSummary={makeSubagentsSummary({
              subagents: manySubagents,
              total: manySubagents.length,
              active: manySubagents.length,
              completed: 0,
            })}
            taskSummary={makeTaskSummary()}
            subagentsVisible
            tasksVisible
            mode="docked"
            wide={false}
            onCloseSubagents={vi.fn()}
            onCloseTasks={vi.fn()}
            onCloseAll={vi.fn()}
          />
        </div>
      </AppAtomRegistryProvider>,
      { router: false },
    );

    const subagentsSection = screen.getByTestId("mission-control-subagents-section").element();
    const tasksSection = screen.getByTestId("mission-control-tasks-section").element();
    const subagentsScroll = screen.getByTestId("mission-control-subagents-scroll").element();

    expect(subagentsSection.getBoundingClientRect().height).toBeLessThanOrEqual(620 * 0.45 + 2);
    expect(subagentsScroll.scrollHeight).toBeGreaterThan(subagentsScroll.clientHeight);
    expect(tasksSection.getBoundingClientRect().height).toBeGreaterThanOrEqual(620 * 0.54);
  });

  it("compacts and collapses long idle subagent histories with expand and instant search", async () => {
    const idleSubagents = Array.from({ length: 33 }, (_, index) => ({
      id: NodeId.make(`idle-${index + 1}`),
      runId: RunId.make("run-1"),
      origin: "app_owned" as const,
      driver: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex-default"),
      title: index === 18 ? "Blackjack Dealer Portrait" : `Asset Generator ${index + 1}`,
      model: "gpt-5.4",
      modelSelection: undefined,
      status: "idle" as const,
      isActive: false,
      isCompleted: false,
      isFailed: false,
      isStopped: false,
      detail: null,
      workflowAgentCount: null,
      workflowActiveCount: 0,
      childThreadId: ThreadId.make(`child-idle-${index + 1}`),
      remoteChild: undefined,
      startedAt: "2026-11-26T18:20:00.000Z",
      completedAt: null,
      updatedAt: "2026-11-26T18:25:00.000Z",
      durationMs: null,
    }));

    await using screen = await render(
      <AppAtomRegistryProvider>
        <div className="flex h-[620px] w-[960px] bg-background">
          <div className="flex-1" />
          <MissionControlWorkSidebar
            threadRef={threadRef}
            subagentsPanelId="subagents-panel"
            tasksPanelId="tasks-panel"
            subagentSummary={makeSubagentsSummary({
              phase: "idle",
              runActive: false,
              subagents: idleSubagents,
              total: idleSubagents.length,
              active: 0,
              completed: 0,
              idle: idleSubagents.length,
            })}
            taskSummary={null}
            subagentsVisible
            tasksVisible={false}
            mode="docked"
            wide
            onCloseSubagents={vi.fn()}
            onCloseTasks={vi.fn()}
            onCloseAll={vi.fn()}
            onInspectSubagent={vi.fn()}
          />
        </div>
      </AppAtomRegistryProvider>,
      { router: false },
    );

    const renderedItemsBefore = screen
      .getByTestId("mission-control-subagents-section")
      .element()
      .querySelectorAll('[data-testid="mission-control-subagent-item"]');
    expect(renderedItemsBefore.length).toBe(4);

    const historyToggle = screen.getByTestId("mission-control-subagents-history-toggle");
    await expect.element(historyToggle).toBeVisible();
    await expect
      .element(screen.getByTestId("mission-control-subagents-history-count"))
      .toHaveTextContent("29 idle");

    // Filtering reaches collapsed subagents immediately.
    const filterInput = screen.getByTestId("mission-control-subagents-filter");
    await userEvent.type(filterInput, "Blackjack");
    await expect.element(screen.getByText("Blackjack Dealer Portrait")).toBeVisible();
    await expect
      .element(screen.getByTestId("mission-control-subagents-count"))
      .toHaveTextContent("1 of 33 subagents");

    await userEvent.click(screen.getByRole("button", { name: "Clear subagent filter" }));
    await expect
      .element(screen.getByTestId("mission-control-subagents-count"))
      .toHaveTextContent("33 subagents");

    // Expanding Earlier reveals the full archived list.
    await userEvent.click(historyToggle);
    await expect
      .element(screen.getByTestId("mission-control-subagents-history-list"))
      .toBeVisible();
    const renderedItemsAfter = screen
      .getByTestId("mission-control-subagents-section")
      .element()
      .querySelectorAll('[data-testid="mission-control-subagent-item"]');
    expect(renderedItemsAfter.length).toBe(33);
  });
});

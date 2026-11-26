import { RunId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { MissionControlTasksSidebar } from "./MissionControlTasksSidebar";
import type { MissionControlTaskSummary } from "./missionControlTasks.logic";

function makeSummary(
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
        text: "Expose settled metadata",
        status: "completed",
        displayStatus: "completed",
        durationMs: 12_000,
        durationAnchorAt: null,
      },
      {
        id: "2",
        index: 2,
        text: "Add unit tests and verify visually",
        status: "running",
        displayStatus: "running",
        durationMs: null,
        durationAnchorAt: "2026-11-26T18:44:00.000Z",
      },
      {
        id: "3",
        index: 3,
        text: "Run repo checks",
        status: "pending",
        displayStatus: "pending",
        durationMs: null,
        durationAnchorAt: null,
      },
    ],
    total: 3,
    completed: 1,
    running: 1,
    pending: 1,
    interrupted: 0,
    remaining: 2,
    percent: 33,
    activeStep: {
      id: "2",
      index: 2,
      text: "Add unit tests and verify visually",
      status: "running",
      displayStatus: "running",
      durationMs: null,
      durationAnchorAt: "2026-11-26T18:44:00.000Z",
    },
    explanation: null,
    trackedDurationMs: 12_000,
    startedAt: "2026-11-26T18:43:00.000Z",
    updatedAt: "2026-11-26T18:44:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("MissionControlTasksSidebar", () => {
  it("updates task accounting in real time from running through completion and supports hiding", async () => {
    const onClose = vi.fn();
    using _now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-26T18:44:15.000Z"));
    await using screen = await render(
      <div className="flex h-[560px] w-[900px]">
        <div className="flex-1" />
        <MissionControlTasksSidebar
          id="tasks-sidebar"
          summary={makeSummary()}
          mode="docked"
          wide={false}
          onClose={onClose}
        />
      </div>,
      // Standalone sidebar unit-in-browser test does not read router state.
      { router: false },
    );

    const sidebar = screen.getByTestId("mission-control-tasks-sidebar");
    await expect.element(sidebar).toHaveAttribute("data-tasks-phase", "running");
    await expect
      .element(screen.getByTestId("mission-control-tasks-ratio"))
      .toHaveTextContent("1/3");
    await expect
      .element(screen.getByTestId("mission-control-tasks-done-count"))
      .toHaveTextContent("1");
    await expect
      .element(screen.getByTestId("mission-control-tasks-active-count"))
      .toHaveTextContent("1");
    await expect
      .element(screen.getByTestId("mission-control-tasks-queued-count"))
      .toHaveTextContent("1");
    await expect
      .element(screen.getByRole("progressbar", { name: "Task completion progress" }))
      .toHaveAttribute("aria-valuenow", "33");
    await expect.element(screen.getByText("Updating live")).toBeVisible();
    await expect.element(screen.getByText("15s")).toBeVisible();
    await expect.element(screen.getByText("1m 15s")).toBeVisible();

    const completedSummary = makeSummary({
      phase: "completed",
      runActive: false,
      completed: 3,
      running: 0,
      pending: 0,
      remaining: 0,
      percent: 100,
      activeStep: null,
      trackedDurationMs: 42_000,
      completedAt: "2026-11-26T18:45:00.000Z",
      steps: [
        {
          id: "1",
          index: 1,
          text: "Expose settled metadata",
          status: "completed",
          displayStatus: "completed",
          durationMs: 12_000,
          durationAnchorAt: null,
        },
        {
          id: "2",
          index: 2,
          text: "Add unit tests and verify visually",
          status: "completed",
          displayStatus: "completed",
          durationMs: 20_000,
          durationAnchorAt: null,
        },
        {
          id: "3",
          index: 3,
          text: "Run repo checks",
          status: "completed",
          displayStatus: "completed",
          durationMs: 10_000,
          durationAnchorAt: null,
        },
      ],
    });

    await screen.rerender(
      <div className="flex h-[560px] w-[900px]">
        <div className="flex-1" />
        <MissionControlTasksSidebar
          id="tasks-sidebar"
          summary={completedSummary}
          mode="docked"
          wide={false}
          onClose={onClose}
        />
      </div>,
    );

    await expect.element(sidebar).toHaveAttribute("data-tasks-phase", "completed");
    await expect
      .element(screen.getByTestId("mission-control-tasks-ratio"))
      .toHaveTextContent("3/3");
    await expect
      .element(screen.getByRole("progressbar", { name: "Task completion progress" }))
      .toHaveAttribute("aria-valuenow", "100");
    await expect.element(screen.getByText("All tasks completed")).toBeVisible();
    await expect.element(screen.getByText("Finished")).toBeVisible();
    await expect.element(screen.getByText("42s")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Hide tasks sidebar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes narrow overlay mode on Escape without bubbling to the parent window", async () => {
    const onClose = vi.fn();
    const onWindowKeyDown = vi.fn();
    await using screen = await render(
      <div className="relative h-[560px] w-[390px]" onKeyDown={onWindowKeyDown}>
        <MissionControlTasksSidebar
          id="tasks-sidebar"
          summary={makeSummary()}
          mode="overlay"
          wide={false}
          onClose={onClose}
        />
      </div>,
      // Standalone sidebar unit-in-browser test does not read router state.
      { router: false },
    );

    const hideButton = screen.getByRole("button", { name: "Hide tasks sidebar" });
    (hideButton.element() as HTMLElement).focus();
    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onWindowKeyDown).not.toHaveBeenCalled();
  });
});

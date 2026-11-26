import { expect } from "e2e";

import { T3_HOME } from "../e2e.config.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

test(
  "Mission Control workspace modal auto-opens a live right-hand tasks sidebar when tasks exist",
  WEB,
  async ({ t3, app, browser }) => {
    await browser.setViewport({ width: 1600, height: 1000 });
    const project = await t3.project("mission-tasks", {
      "package.json": '{"name":"mission-tasks"}\n',
      "tsconfig.json": '{"compilerOptions":{}}\n',
    });
    const plain = await t3.thread({
      project,
      title: "Thread without tasks",
      messages: ["Just a quick reply"],
    });
    const tracked = await t3.thread({
      project,
      title: "Thread with tracked tasks",
      messages: ["Track three steps"],
      model: "todo-list",
    });

    await t3.open(tracked);
    await browser
      .locator('[data-slot="sidebar-footer"] button[aria-label="Mission Control"]')
      .tap();
    const dashboard = browser.frameLocator('iframe[title="dashboard"]');

    // A thread without tasks should not show a tasks sidebar or toggle.
    await dashboard.locator(`.mc-inbox-select[data-select-thread="${plain.threadId}"]`).tap();
    const plainSelector = `[data-testid="mission-control-thread-window"][data-thread-key$=":${plain.threadId}"]`;
    const plainWindow = browser.locator(plainSelector);
    await expect(plainWindow).toBeVisible();
    await expect(
      browser.locator(`${plainSelector} [data-testid="mission-control-tasks-sidebar"]`),
    ).not.toBeVisible();
    await expect(
      browser.locator(`${plainSelector} [data-testid="mission-control-tasks-toggle"]`),
    ).not.toBeVisible();
    await plainWindow.getByRole("button", "Close thread window", { exact: true }).tap();

    // A thread with tasks auto-opens the right-hand sidebar with completed accounting.
    await dashboard.locator(`.mc-inbox-select[data-select-thread="${tracked.threadId}"]`).tap();
    const trackedSelector = `[data-testid="mission-control-thread-window"][data-thread-key$=":${tracked.threadId}"]`;
    const trackedWindow = browser.locator(trackedSelector);
    const sidebar = browser.locator(
      `${trackedSelector} [data-testid="mission-control-tasks-sidebar"]`,
    );
    const ratio = browser.locator(`${trackedSelector} [data-testid="mission-control-tasks-ratio"]`);
    const toggle = browser.locator(
      `${trackedSelector} [data-testid="mission-control-tasks-toggle"]`,
    );
    await expect(trackedWindow).toBeVisible();
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveAttribute("data-tasks-phase", "completed");
    await expect(ratio).toContainText("3/3");
    await expect(sidebar).toContainText("Inspect package.json");
    await expect(sidebar).toContainText("Inspect tsconfig.json");
    await expect(sidebar).toContainText("Report completion");
    await expect(sidebar).toContainText("All tasks completed");
    await app.screenshot("mission-control-tasks-completed");

    // Start a live turn while the modal is open and verify real-time updates through completion.
    await runPromise(
      makeState(T3_HOME).cli(["thread", "send", tracked.threadId, "Run tasks again"]),
    );
    await expect(sidebar).toHaveAttribute("data-tasks-phase", "running");
    await expect(sidebar).toContainText("Updating live");
    await app.screenshot("mission-control-tasks-running");

    await expect(sidebar).toHaveAttribute("data-tasks-phase", "completed");
    await expect(ratio).toContainText("3/3");
    await expect(sidebar).toContainText("Finished");

    // User can hide and reopen the sidebar cleanly.
    await sidebar.getByRole("button", "Hide tasks sidebar", { exact: true }).tap();
    await expect(sidebar).not.toBeVisible();
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("3/3");
    await toggle.tap();
    await expect(sidebar).toBeVisible();

    await trackedWindow.getByRole("button", "Close thread window", { exact: true }).tap();
  },
);

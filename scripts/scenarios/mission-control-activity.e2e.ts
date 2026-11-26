import { expect } from "e2e";

import { T3_HOME } from "../e2e.config.ts";
import { makeState, runPromise, test, WEB } from "./t3.ts";

test(
  "Mission Control streams the selected thread and preserves its reading position",
  WEB,
  async ({ t3, app, browser }) => {
    await browser.setViewport({ width: 1600, height: 1000 });
    const project = await t3.project("mission-activity", {
      "src/math.ts": "export const sum = 1 + 1;\n",
    });
    const firstPrompt = [
      "Activity reading anchor: give me a tour.",
      ...Array.from({ length: 24 }, (_, index) => `Check ${index + 1}: explain the workspace.`),
    ].join("\n");
    const first = await t3.thread({
      project,
      title: "Watch the live workspace",
      messages: [firstPrompt],
      model: "showcase",
    });
    const second = await t3.thread({
      project,
      title: "A separate workspace",
      messages: ["Only the second thread contains this request."],
    });
    await t3.open(first);
    await browser
      .locator('[data-slot="sidebar-footer"] button[aria-label="Mission Control"]')
      .tap();
    const dashboard = browser.frameLocator('iframe[title="dashboard"]');
    const selectInspector = async (threadId: string) => {
      await dashboard.locator(`.mc-inbox-select[data-select-thread="${threadId}"]`).tap();
      await browser
        .locator(`[data-testid="mission-control-thread-window"][data-thread-key$=":${threadId}"]`)
        .getByRole("button", "Close thread window", { exact: true })
        .tap();
    };
    await selectInspector(first.threadId);
    const feed = dashboard.locator(".mc-live-feed");
    await expect(dashboard.locator(".mc-live-reasoning").first()).toBeVisible();
    await expect(dashboard.locator(".mc-live-tool").first()).toBeVisible();
    await expect(feed).toContainText("This turn is a replay.");
    const earlierReasoning = dashboard.locator(".mc-live-reasoning").first();
    await dashboard.locator(".mc-live-reasoning summary").first().tap();
    await expect(earlierReasoning).toContainText("The user wants a short tour.");
    const earlierCommand = dashboard.locator(".mc-live-tool").last();
    await dashboard.locator(".mc-live-tool summary").last().tap();
    await expect(earlierCommand).toContainText("vp test run");
    const initialToolCount = await dashboard.locator(".mc-live-tool").count();
    const initialReasoningCount = await dashboard.locator(".mc-live-reasoning").count();

    await dashboard.getByRole("button", "Settings", { exact: true }).tap();
    await dashboard
      .getByRole("combobox", "Refresh Interval", { exact: true })
      .selectOption({ label: "Paused" });
    await dashboard.getByRole("button", "Close settings", { exact: true }).tap();

    const scroller = dashboard.locator("#mc-insp-scroll");
    const bounds = await scroller.boundingBox();
    if (!bounds) throw new Error("The activity feed has no visible bounds.");
    await browser.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await browser.mouse.wheel(0, -10000);
    const latest = dashboard.locator('[data-action="activity-latest"]');
    await expect(latest).toBeVisible();
    const anchor = dashboard.getByText("Activity reading anchor:", { exact: false }).first();
    const before = await anchor.boundingBox();
    if (!before) throw new Error("The earlier activity is missing.");

    // An external send cannot refresh the inspector through its reply handler or dashboard poll.
    const livePrompt = "Live activity arrives while dashboard refresh is paused.";
    await runPromise(makeState(T3_HOME).cli(["thread", "send", first.threadId, livePrompt]));
    await expect(feed).toContainText(livePrompt);
    await expect(dashboard.locator(".mc-live-status")).toHaveAttribute("data-running", "true");
    await expect
      .poll(() => dashboard.locator(".mc-live-reasoning").count())
      .toBeGreaterThan(initialReasoningCount);
    const after = await anchor.boundingBox();
    if (!after) throw new Error("Streaming replaced the activity being read.");
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
    await app.screenshot("mission-control-activity-preserves-reading");

    await latest.tap();
    await expect(latest).not.toBeVisible();
    await expect(dashboard.locator(".mc-live-status")).toHaveAttribute("data-running", "false");
    await expect
      .poll(() => dashboard.locator(".mc-live-tool").count())
      .toBeGreaterThan(initialToolCount);
    await expect
      .poll(() => dashboard.locator(".mc-live-reasoning").count())
      .toBeGreaterThan(initialReasoningCount);
    await expect(dashboard.locator(".mc-live-assistant").last()).toContainText(
      "This turn is a replay.",
    );
    await app.screenshot("mission-control-activity-live-tail");

    await selectInspector(second.threadId);
    await expect(feed).toContainText("Only the second thread contains this request.");
    await expect(feed).not.toContainText(livePrompt);
    await expect(feed).not.toContainText("The user wants a short tour.");
    await app.screenshot("mission-control-activity-selected-thread");
  },
);

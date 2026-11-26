/// <reference lib="dom" />
import { expect } from "e2e";
import { test, WEB } from "./t3.ts";

test(
  "Mission Control creates threads in a native window without losing the project or draft",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await browser.setViewport({ width: 1600, height: 1000 });
    const workspace = await t3.project("mission-create-workspace");
    const source = await t3.thread({
      project: workspace,
      title: "Keep the workspace here",
      messages: ["Existing work"],
    });
    await t3.project("mission-create-target");
    await t3.open(source);
    const route = await browser.url();
    await browser
      .locator('[data-slot="sidebar-footer"] button[aria-label="Mission Control"]')
      .tap();
    const dashboard = browser.frameLocator('iframe[title="dashboard"]');
    await dashboard.getByRole("tab", "Overview", { exact: true }).tap();
    const create = dashboard.getByRole("button", "New thread in mission-create-target", {
      exact: true,
    });
    await create.tap();

    const window = browser.locator('[data-testid="mission-control-thread-window"]');
    const composer = browser
      .locator('[data-testid="mission-control-thread-window"] [contenteditable="true"]')
      .first();
    const model = browser
      .locator('[data-testid="mission-control-thread-window"] [data-chat-provider-model-picker]')
      .first();
    await expect(window).toBeVisible();
    await expect(dashboard.locator("#mc-new-thread-modal")).not.toBeVisible();
    await expect(window).toContainText("mission-create-target");
    await expect(window.getByRole("button", "Attach files", { exact: true })).toBeVisible();
    await expect(window.getByRole("combobox", "Workspace", { exact: true })).toBeVisible();
    await expect(model).toBeVisible();
    await expect(composer).toBeFocused();
    await expect(screen.getByRole("tab", "Mission Control", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await browser.url()).toBe(route);

    const prompt = "Build the next task in the selected project without leaving Mission Control.";
    await composer.fill(prompt);
    await window.getByRole("button", "Close thread window", { exact: true }).tap();
    await expect(window).not.toBeVisible();
    await create.tap();
    await expect(composer).toContainText(prompt);
    await expect(window).toContainText("mission-create-target");
    await window.getByRole("button", "Minimize thread window", { exact: true }).tap();
    await expect(window).not.toBeVisible();
    await browser.locator('[aria-label="Open thread windows"]').getByRole("button").first().tap();
    await expect(composer).toContainText(prompt);

    await model.tap();
    await browser.keyboard.type("Multi turn");
    await screen.getByRole("option", /Multi turn/).tap();
    await browser.keyboard.press("Escape");
    await composer.tap();
    await expect(model).toContainText("Multi turn");
    await app.screenshot("mission-control-native-new-thread");
    await browser.setViewport({ width: 390, height: 844 });
    await expect.poll(async () => (await window.boundingBox())?.x).toBe(0);
    await expect.poll(async () => (await window.boundingBox())?.width).toBe(390);
    await app.screenshot("mission-control-native-new-thread-narrow");
    await browser.setViewport({ width: 1600, height: 1000 });

    await browser.evaluate(() => {
      document
        .querySelector('[data-testid="mission-control-thread-window"]')
        ?.setAttribute("data-create-window-probe", "mounted");
      return null;
    });
    await window.getByRole("button", "Submit message", { exact: true }).tap();
    await expect(window.getByRole("tab", "Conversation", { exact: true })).toBeVisible();
    await expect(window.getByRole("tab", "Changes", { exact: true })).toBeVisible();
    await expect(window).toHaveAttribute("data-create-window-probe", "mounted");
    await expect(window.getByText(prompt, { exact: true })).toBeVisible();
    await expect(window.getByText("first fixture turn complete", { exact: false })).toBeVisible();
    await expect(screen.getByRole("tab", "Mission Control", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await browser.url()).toBe(route);
    await app.screenshot("mission-control-created-thread-window");

    await window.getByRole("button", "Close thread window", { exact: true }).tap();
    await dashboard.locator("#mc-new-thread-btn").tap();
    await browser
      .locator('[data-testid="mission-control-thread-window"] [data-draft-project-trigger]')
      .tap();
    await screen.getByRole("option", /mission-create-workspace/).tap();
    await expect(
      window.getByRole("heading", "New thread · mission-create-workspace", { exact: true }),
    ).toBeVisible();
    await browser
      .locator('[data-testid="mission-control-thread-window"] [data-draft-project-trigger]')
      .tap();
    await screen.getByRole("option", /mission-create-target/).tap();
    await expect(
      window.getByRole("heading", "New thread · mission-create-target", { exact: true }),
    ).toBeVisible();
    await expect(composer).toHaveText("");
    await composer.fill("Preserve this new draft across a reload.");
    await browser.reload();
    await browser
      .locator('[data-slot="sidebar-footer"] button[aria-label="Mission Control"]')
      .tap();
    await dashboard.getByRole("tab", "Overview", { exact: true }).tap();
    await create.tap();
    await expect(composer).toContainText("Preserve this new draft across a reload.");
    await expect(screen.getByRole("tab", "Mission Control", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  },
);

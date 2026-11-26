import { expect } from "e2e";
import { test, WEB } from "./t3.ts";

test(
  "Mission Control is a global workspace that preserves the conversation and panel",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const project = await t3.project("workspace-alpha");
    const thread = await t3.thread({ project, title: "Keep this conversation", messages: [] });
    const otherProject = await t3.project("workspace-beta");
    await t3.thread({ project: otherProject, title: "Another project conversation", messages: [] });
    await t3.open(thread);
    const composer = browser.locator('[contenteditable="true"]').first();
    await composer.fill("Keep my unsent draft");
    await browser.evaluate(() => {
      document
        .querySelector('[contenteditable="true"]')
        ?.setAttribute("data-workspace-probe", "mounted");
      return null;
    });
    await screen.getByRole("button", "Toggle right panel", { exact: true }).tap();
    await screen.getByRole("button", "Plugins", { exact: true }).tap();
    const toggle = browser.locator(
      '[data-slot="sidebar-footer"] button[aria-label="Mission Control"]',
    );
    await app.screenshot("mission-control-before-opening");
    await toggle.tap();
    await expect(screen.getByRole("tab", "Mission Control", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const dashboard = browser.frameLocator('iframe[title="dashboard"]');
    await expect(dashboard.getByRole("tab", "Inbox", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await dashboard.getByRole("tab", "Overview", { exact: true }).tap();
    await expect(dashboard.getByText("workspace-alpha", { exact: true }).first()).toBeVisible();
    await expect(dashboard.getByText("workspace-beta", { exact: true }).first()).toBeVisible();
    await app.screenshot("mission-control-global-workspace");
    await dashboard.getByRole("tab", "Board", { exact: true }).tap();
    await screen.getByRole("tab", "Workspace", { exact: true }).tap();
    await expect(composer).toContainText("Keep my unsent draft");
    await expect(composer).toHaveAttribute("data-workspace-probe", "mounted");
    await expect(screen.getByRole("heading", "Installed plugins", { exact: true })).toBeVisible();
    await app.screenshot("mission-control-preserved-conversation");
    await screen.getByRole("tab", "Workspace", { exact: true }).press("ArrowRight");
    await expect(screen.getByRole("tab", "Mission Control", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dashboard.getByRole("tab", "Board", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await browser
      .locator('[data-testid="sidebar-row-card"]')
      .getByText("Keep this conversation", { exact: true })
      .tap();
    await expect(screen.getByRole("tab", "Workspace", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(composer).toContainText("Keep my unsent draft");
    await screen.getByRole("tab", "Mission Control", { exact: true }).tap();
    await toggle.tap();
    await expect(screen.getByRole("tab", "Workspace", { exact: true })).not.toBeVisible();
    await expect(composer).toContainText("Keep my unsent draft");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.tap();
    await browser.setViewport({ width: 390, height: 844 });
    await expect(screen.getByRole("tab", "Mission Control", { exact: true })).toBeVisible();
    await expect(dashboard.getByRole("heading", "Mission Control", { exact: true })).toBeVisible();
    await app.screenshot("mission-control-narrow-workspace");
    await screen.getByRole("button", "Close Mission Control", { exact: true }).tap();
    await expect(screen.getByRole("tab", "Workspace", { exact: true })).not.toBeVisible();
  },
);

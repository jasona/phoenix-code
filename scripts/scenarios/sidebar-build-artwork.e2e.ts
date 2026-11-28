/// <reference lib="dom" />
import { expect } from "e2e";
import { test, WEB } from "./t3.ts";

test(
  "Sidebar artwork follows the build and respects explicit choices",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("Phoenix");
    const openAppearance = async () => {
      await t3.open("/settings/appearance");
      await screen.getByRole("button", "Advanced", { exact: true }).first().tap();
    };
    await openAppearance();
    const mode = screen.getByRole("combobox", "Environment identification");
    const artwork = () =>
      browser.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>(".sidebar-stage-backdrop img");
        return img?.naturalWidth ? new URL(img.currentSrc).pathname : null;
      });
    const captureHeader = async (name: string) => {
      await t3.open("/");
      await expect.poll(artwork).toContain(".webp");
      await expect(screen.getByRole("link", "Phoenix home")).toBeVisible();
      await app.screenshot(name);
      await openAppearance();
    };
    await expect(mode).toHaveText("Follow build");
    await expect.poll(artwork).toContain(".webp");
    const automatic = await artwork();
    await captureHeader("follow-build");
    for (const [label, file] of [
      ["Dev artwork", "dev"],
      ["Nightly artwork", "nightly"],
    ] as const) {
      await mode.tap();
      await screen.getByRole("option", label, { exact: true }).tap();
      await expect.poll(artwork).toContain(file + ".webp");
      await captureHeader(file);
    }
    await mode.tap();
    await screen.getByRole("option", "None", { exact: true }).tap();
    await expect.poll(artwork).toBe(null);
    await mode.tap();
    await screen.getByRole("option", "Follow build", { exact: true }).tap();
    await expect.poll(artwork).toBe(automatic);
  },
);

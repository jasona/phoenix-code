import { expect } from "e2e";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { T3_HOME } from "../e2e.config.ts";
import { runPromise, test, WEB } from "./t3.ts";

test(
  "Mission Control preserves drafts and keeps review acceptance explicit",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await browser.setViewport({ width: 1600, height: 1000 });
    const project = await t3.project("mission-review", {
      "review.ts": "export const checked = false;\n",
    });
    const first = await t3.thread({
      project,
      title: "Review command evidence",
      messages: ["Run the check"],
      model: "command-output",
    });
    const second = await t3.thread({
      project,
      title: "Review another result",
      messages: ["Make a change"],
    });
    await runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(`${project}/review.ts`, "export const checked = true;\n");
        yield* fs.writeFileString(`${project}/notes.txt`, "Additional review context.\n");
      }),
    );
    await t3.open(first);
    const toggle = browser.locator(
      '[data-slot="sidebar-footer"] button[aria-label="Mission Control"]',
    );
    await toggle.tap();
    const dashboard = browser.frameLocator('iframe[title="dashboard"]');
    const firstItem = dashboard.locator(
      `.mc-inbox-item:has([data-select-thread="${first.threadId}"])`,
    );
    const selectInspector = async (threadId: string) => {
      await dashboard.locator(`.mc-inbox-select[data-select-thread="${threadId}"]`).tap();
      await browser
        .locator(`[data-testid="mission-control-thread-window"][data-thread-key$=":${threadId}"]`)
        .getByRole("button", "Close thread window", { exact: true })
        .tap();
    };
    await expect(dashboard.getByRole("tab", "Inbox", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await selectInspector(first.threadId);
    const reply = dashboard.getByRole("textbox", "Reply or steer thread", { exact: true });
    await reply.fill("Keep this review draft");
    await selectInspector(second.threadId);
    await reply.fill("A different thread draft");
    await selectInspector(first.threadId);
    await expect(reply).toHaveValue("Keep this review draft");
    await expect(firstItem).toBeVisible();
    await dashboard.getByRole("tab", "Evidence", { exact: true }).tap();
    await expect(dashboard.locator("#mc-insp-scroll")).toContainText("Not accepted");
    await expect(dashboard.locator("#mc-insp-scroll")).toContainText(
      "Current revision not verified",
    );
    await expect(dashboard.locator(".mc-evidence-command").first()).toBeVisible();
    await dashboard.locator(".mc-evidence-command summary").first().tap();
    await app.screenshot("mission-control-inbox-evidence");
    await firstItem.getByRole("button", "Snooze 1 hour", { exact: true }).tap();
    await expect(firstItem).not.toBeVisible();
    await dashboard.getByRole("button", "Undo", { exact: true }).tap();
    await expect(dashboard.locator(".mc-evidence-command[open]").first()).toBeVisible();
    await expect(firstItem).toBeVisible();
    await firstItem.getByRole("button", "Review & respond", { exact: true }).tap();
    const desk = browser.locator('[data-testid="mission-control-review-desk"]');
    await expect(desk).toBeVisible();
    await expect(screen.getByRole("tab", "Mission Control", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await desk.getByRole("tab", "Changes", { exact: true }).tap();
    await desk.getByRole("button", "Expand all files", { exact: true }).tap();
    await expect(desk.getByRole("button", "Collapse review.ts", { exact: true })).toBeVisible();
    await expect(desk.getByRole("button", "Collapse notes.txt", { exact: true })).toBeVisible();
    await app.screenshot("mission-control-native-review-desk");
    await desk.getByText("review.ts", { exact: true }).first().tap();
    await expect(desk.getByRole("tab", "File", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await desk.getByRole("tab", "Changes", { exact: true }).tap();
    await desk.getByRole("button", "Accept review", { exact: true }).tap();
    await expect(desk.getByRole("button", "Reopen review", { exact: true })).toBeVisible();
    await desk.getByRole("button", "Reopen review", { exact: true }).tap();
    await expect(desk.getByRole("button", "Accept review", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Close thread window", { exact: true }).tap();
    await expect(reply).toHaveValue("Keep this review draft");
    await expect(firstItem).toBeVisible();
    await firstItem.getByRole("button", "Accept work", { exact: true }).tap();
    await expect(firstItem).not.toBeVisible();
    await dashboard.getByRole("button", "Accepted", { exact: true }).tap();
    await expect(firstItem).toBeVisible();
    await firstItem.getByRole("button", "Reopen", { exact: true }).tap();
    await dashboard.getByRole("button", "Actionable", { exact: true }).tap();
    await expect(firstItem).toBeVisible();
    await toggle.tap();
    await toggle.tap();
    await selectInspector(first.threadId);
    await expect(reply).toHaveValue("Keep this review draft");
    await t3.open(first);
    await toggle.tap();
    await selectInspector(first.threadId);
    await expect(reply).toHaveValue("Keep this review draft");
    await selectInspector(second.threadId);
    await expect(reply).toHaveValue("A different thread draft");
    await browser.setViewport({ width: 390, height: 844 });
    await app.screenshot("mission-control-review-mobile-width");
    await dashboard.locator(`.mc-inbox-select[data-select-thread="${second.threadId}"]`).tap();
    const narrowWindow = browser.locator('[data-testid="mission-control-thread-window"]');
    await expect(narrowWindow).toBeVisible();
    await expect.poll(async () => (await narrowWindow.boundingBox())?.x).toBe(0);
    await app.screenshot("mission-control-review-mobile-window");
  },
);

test(
  "Mission Control answers real approvals without switching to Workspace",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const settings = await runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = (yield* Path.Path).join(T3_HOME, "userdata/settings.json");
        const original = yield* fs.readFileString(path);
        const json = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
        const parsed = yield* Schema.decodeEffect(json)(original);
        yield* fs.writeFileString(
          path,
          yield* Schema.encodeEffect(json)({ ...parsed, defaultRuntimeMode: "approval-required" }),
        );
        return fs.writeFileString(path, original);
      }),
    );
    try {
      const project = await t3.project("mission-approval");
      const thread = await t3.thread({
        project,
        title: "Review a real approval",
        messages: ["Check permission"],
        model: "approval",
      });
      await t3.open(thread);
      await browser
        .locator('[data-slot="sidebar-footer"] button[aria-label="Mission Control"]')
        .tap();
      const dashboard = browser.frameLocator('iframe[title="dashboard"]');
      const item = dashboard.locator(
        `.mc-inbox-item:has([data-select-thread="${thread.threadId}"])`,
      );
      await expect(
        dashboard.getByRole("region", "Needs your decision", { exact: true }),
      ).toBeVisible();
      await item.getByRole("button", "Review & respond", { exact: true }).tap();
      const desk = browser.locator('[data-testid="mission-control-review-desk"]');
      await expect(desk.getByRole("button", "Approve", { exact: true })).toBeVisible();
      await app.screenshot("mission-control-inline-approval");
      await desk.getByRole("button", "Approve", { exact: true }).tap();
      await expect(desk.getByRole("button", "Approve", { exact: true })).not.toBeVisible();
      await expect(screen.getByRole("tab", "Mission Control", { exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await screen.getByRole("button", "Close thread window", { exact: true }).tap();
      await expect(item).toContainText("Review ready");
    } finally {
      await runPromise(settings);
    }
  },
);

test(
  "Mission Control keeps movable thread windows and their state across reopening",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await browser.setViewport({ width: 1600, height: 1000 });
    const project = await t3.project("mission-windows");
    const first = await t3.thread({ project, title: "Window one", messages: ["First task"] });
    const second = await t3.thread({ project, title: "Window two", messages: ["Second task"] });
    await t3.open(first);
    const route = await browser.url();
    const toggle = browser.locator(
      '[data-slot="sidebar-footer"] button[aria-label="Mission Control"]',
    );
    await toggle.tap();
    const dashboard = browser.frameLocator('iframe[title="dashboard"]');
    const firstWindow = browser.locator(
      `[data-testid="mission-control-thread-window"][data-thread-key$=":${first.threadId}"]`,
    );
    const secondWindow = browser.locator(
      `[data-testid="mission-control-thread-window"][data-thread-key$=":${second.threadId}"]`,
    );
    const taskbar = browser.locator('[aria-label="Open thread windows"]');
    await dashboard.locator(`.mc-inbox-select[data-select-thread="${first.threadId}"]`).tap();
    await expect(firstWindow).toBeVisible();
    const draft = browser
      .locator(
        `[data-testid="mission-control-thread-window"][data-thread-key$=":${first.threadId}"] [contenteditable="true"]`,
      )
      .first();
    await draft.fill("Keep this window draft");
    const initial = await firstWindow.boundingBox();
    if (!initial) throw new Error("The thread window has no visible bounds.");
    const move = firstWindow.getByRole("button", "Move thread window", { exact: true });
    const titleBounds = await move.boundingBox();
    if (!titleBounds) throw new Error("The thread window title is not visible.");
    await browser.mouse.move(titleBounds.x + 80, titleBounds.y + titleBounds.height / 2);
    await browser.mouse.down();
    await browser.mouse.move(titleBounds.x + 110, titleBounds.y + titleBounds.height / 2 + 15);
    await browser.mouse.up();
    await expect.poll(async () => (await firstWindow.boundingBox())?.x).toBe(initial.x + 30);
    const resize = await browser
      .locator(
        `[data-testid="mission-control-thread-window"][data-thread-key$=":${first.threadId}"] .cursor-se-resize`,
      )
      .boundingBox();
    if (!resize) throw new Error("The thread window resize handle is not visible.");
    await browser.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
    await browser.mouse.down();
    await browser.mouse.move(resize.x + resize.width / 2 + 40, resize.y + resize.height / 2 + 30);
    await browser.mouse.up();
    await expect
      .poll(async () => (await firstWindow.boundingBox())?.width)
      .toBe(initial.width + 40);
    const pointerBounds = await firstWindow.boundingBox();
    if (!pointerBounds) throw new Error("The resized thread window is not visible.");
    await move.press("ArrowRight");
    await move.press("ArrowDown");
    await move.press("Shift+ArrowLeft");
    await move.press("Shift+ArrowUp");
    await expect.poll(async () => (await firstWindow.boundingBox())?.x).toBe(pointerBounds.x + 20);
    await expect
      .poll(async () => (await firstWindow.boundingBox())?.width)
      .toBe(pointerBounds.width - 20);
    const remembered = await firstWindow.boundingBox();
    await firstWindow.getByRole("tab", "Changes", { exact: true }).tap();
    await firstWindow.getByRole("button", "Maximize thread window", { exact: true }).tap();
    await expect
      .poll(async () => (await firstWindow.boundingBox())?.width)
      .toBeGreaterThan(initial.width);
    await firstWindow.getByRole("button", "Restore thread window", { exact: true }).tap();
    await expect.poll(() => firstWindow.boundingBox()).toEqual(remembered);
    await app.screenshot("mission-control-thread-window");
    await firstWindow.getByRole("button", "Close thread window", { exact: true }).tap();
    await expect(firstWindow).not.toBeVisible();
    await dashboard.locator(`.mc-inbox-select[data-select-thread="${first.threadId}"]`).tap();
    await expect(firstWindow.getByRole("tab", "Changes", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect.poll(() => firstWindow.boundingBox()).toEqual(remembered);
    await firstWindow.getByRole("button", "Minimize thread window", { exact: true }).tap();
    await expect(firstWindow).not.toBeVisible();
    await dashboard.locator(`.mc-inbox-select[data-select-thread="${second.threadId}"]`).tap();
    await expect(secondWindow).toBeVisible();
    await taskbar.getByRole("button", "Window one", { exact: true }).tap();
    await expect(firstWindow).toBeVisible();
    await expect(secondWindow).toBeVisible();
    await expect.poll(() => firstWindow.boundingBox()).toEqual(remembered);
    await app.screenshot("mission-control-multiple-thread-windows");
    await taskbar.getByRole("button", "Window two", { exact: true }).tap();
    await secondWindow.getByRole("button", "Close thread window", { exact: true }).tap();
    await expect(secondWindow).not.toBeVisible();
    await expect(firstWindow).toBeVisible();
    await expect(screen.getByRole("tab", "Mission Control", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await browser.url()).toBe(route);

    await t3.open(first);
    await toggle.tap();
    await dashboard.locator(`.mc-inbox-select[data-select-thread="${first.threadId}"]`).tap();
    await expect(firstWindow.getByRole("tab", "Changes", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect.poll(() => firstWindow.boundingBox()).toEqual(remembered);
    await firstWindow.getByRole("tab", "Conversation", { exact: true }).tap();
    await expect(draft).toContainText("Keep this window draft");
    await browser.setViewport({ width: 390, height: 844 });
    await expect.poll(async () => (await firstWindow.boundingBox())?.x).toBe(0);
    await expect.poll(async () => (await firstWindow.boundingBox())?.width).toBe(390);
    await app.screenshot("mission-control-thread-window-narrow");
    await browser.setViewport({ width: 1600, height: 1000 });
    await expect.poll(() => firstWindow.boundingBox()).toEqual(remembered);
    await firstWindow.getByRole("button", "Close thread window", { exact: true }).tap();
    await expect(dashboard.getByRole("tab", "Inbox", { exact: true })).toBeVisible();
    expect(await browser.url()).toBe(route);
  },
);

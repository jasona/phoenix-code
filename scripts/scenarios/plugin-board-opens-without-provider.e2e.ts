import { ThreadId } from "@t3tools/contracts";
import { expect } from "e2e";
import * as Effect from "effect/Effect";
import { APP_DIR, T3_HOME } from "../e2e.config.ts";
import { environmentId, rpcClient, runPromise, test, WEB } from "./t3.ts";

test(
  "An installed plugin opens a persistent board without a running provider",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const origin = app.baseUrl ?? "";
    const environment = await runPromise(environmentId(origin));
    const project = await t3.project("plugin-demo");
    const thread = await t3.thread({ project, title: "Plugin workspace", messages: [] });
    await t3.open(`/settings/plugins?machine=${encodeURIComponent(environment)}`);
    await screen
      .getByRole("textbox", "Plugin folder")
      .fill(`${APP_DIR}/examples/plugins/project-board`);
    await screen.getByRole("button", "Install plugin", { exact: true }).tap();
    await screen.getByRole("button", "Enable", { exact: true }).tap();
    await expect(screen.getByText("Enabled", { exact: false })).toBeVisible();
    await screen.getByText("Project permissions", { exact: true }).tap();
    await screen.getByRole("checkbox", "plugin-demo", { exact: true }).tap();
    await t3.open(thread);
    await screen.getByRole("button", "Toggle right panel", { exact: true }).tap();
    await screen.getByRole("button", "Plugins", { exact: true }).tap();
    await screen.getByRole("button", "Project Board", { exact: true }).tap();
    const board = browser.frameLocator('iframe[title="board"]');
    await expect(board.locator("#context")).toContainText(thread.threadId);
    await board.getByRole("textbox", "Task title").fill("Persist without an agent");
    await board.getByRole("button", "Add task", { exact: true }).tap();
    await expect(
      board.getByRole("button", "Persist without an agent", { exact: true }),
    ).toBeVisible();
    await board.getByRole("button", "Attach to conversation", { exact: true }).tap();
    await expect(browser.locator('[contenteditable="true"]')).toContainText(
      "Persist without an agent",
    );
    await app.screenshot("plugin-board-context-and-task");
    const projectId = await runPromise(
      Effect.gen(function* () {
        const client = yield* rpcClient(T3_HOME, origin);
        const projection = yield* client["orchestration.getThreadProjection"]({
          threadId: ThreadId.make(thread.threadId),
        });
        yield* client["plugins.request"]({ action: "restart", pluginId: "project-board" });
        return projection.thread.projectId;
      }).pipe(Effect.scoped),
    );
    await expect(screen.getByRole("button", "Retry", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Retry", { exact: true }).tap();
    await expect(
      board.getByRole("button", "Persist without an agent", { exact: true }),
    ).toBeVisible();
    await t3.open(
      `/plugins?environmentId=${encodeURIComponent(environment)}&pluginId=project-board&viewId=project&projectId=${encodeURIComponent(projectId)}`,
    );
    const projectBoard = browser.frameLocator('iframe[title="project"]');
    await expect(projectBoard.locator("#context")).toContainText(projectId);
    await expect(
      projectBoard.getByRole("button", "Persist without an agent", { exact: true }),
    ).toBeVisible();
    await app.screenshot("plugin-project-full-page");
    await t3.open(thread);
    await expect(
      board.getByRole("button", "Persist without an agent", { exact: true }),
    ).toBeVisible();
    await screen.getByRole("button", "Close Project Board", { exact: true }).tap();
    await runPromise(
      Effect.gen(function* () {
        const client = yield* rpcClient(T3_HOME, origin);
        yield* client["plugins.request"]({
          action: "launch",
          pluginId: "project-board",
          viewId: "board",
          scope: { projectId, threadId: ThreadId.make(thread.threadId) },
        });
      }).pipe(Effect.scoped),
    );
    await expect(
      board.getByRole("button", "Persist without an agent", { exact: true }),
    ).toBeVisible();
    await runPromise(
      Effect.gen(function* () {
        const client = yield* rpcClient(T3_HOME, origin);
        yield* client["plugins.request"]({
          action: "enable",
          pluginId: "project-board",
          enabled: false,
        });
      }).pipe(Effect.scoped),
    );
    await expect(
      screen.getByText("The plugin is unavailable. Check that it is enabled and try again.", {
        exact: true,
      }),
    ).toBeVisible();
  },
);

import * as Schema from "effect/Schema";
import { ThreadId } from "@t3tools/contracts";
import { expect } from "e2e";
import * as Effect from "effect/Effect";
import { T3_HOME } from "../e2e.config.ts";
import { environmentId, rpcClient, runPromise, test, WEB } from "./t3.ts";

const decodeView = Schema.decodeUnknownSync(Schema.Struct({ instanceId: Schema.String }));

test(
  "Bundled Mission Control opens across projects and keeps its disabled state",
  WEB,
  async ({ t3, app, browser, screen }) => {
    const origin = app.baseUrl ?? "";
    const environment = await runPromise(environmentId(origin));
    const project = await t3.project("mission-control-demo");
    const thread = await t3.thread({ project, title: "Inspect Phoenix plugin", messages: [] });
    await t3.project("mission-control-second-project");
    await t3.open(`/settings/plugins?machine=${encodeURIComponent(environment)}`);
    await browser.evaluate(() => {
      document.documentElement.dataset.pluginNavigationProbe = "mounted";
      return null;
    });
    await screen.getByRole("button", "Mission Control", { exact: true }).last().tap();
    const dashboard = browser.frameLocator('iframe[title="dashboard"]');
    await expect(dashboard.getByRole("heading", "Mission Control", { exact: true })).toBeVisible();
    expect(
      await browser.evaluate(
        () => document.documentElement.dataset.pluginNavigationProbe ?? "reloaded",
      ),
    ).toBe("mounted");
    await dashboard.getByRole("tab", "Overview", { exact: true }).tap();
    await expect(
      dashboard.getByText("mission-control-demo", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      dashboard.getByText("mission-control-second-project", { exact: true }).first(),
    ).toBeVisible();
    await runPromise(
      Effect.gen(function* () {
        const client = yield* rpcClient(T3_HOME, origin);
        const opened = decodeView(
          yield* client["plugins.request"]({
            action: "open",
            pluginId: "mission-control",
            viewId: "dashboard",
          }),
        );
        yield* client["plugins.host"]({
          pluginId: "mission-control",
          instanceId: opened.instanceId,
          operation: {
            type: "missionControl",
            request: { action: "detail", threadId: ThreadId.make(thread.threadId) },
          },
        });
        yield* client["plugins.request"]({
          action: "release",
          pluginId: "mission-control",
          instanceId: opened.instanceId,
        });
      }).pipe(Effect.scoped),
    );
    await dashboard.locator(`.mc-thread-row[data-select-thread="${thread.threadId}"]`).tap();
    await expect(
      dashboard.getByRole("heading", "Inspect Phoenix plugin", { exact: true }),
    ).toBeVisible();
    await app.screenshot("mission-control-inspector");
    await dashboard.getByRole("button", "Back to inbox", { exact: true }).tap();
    await app.screenshot("mission-control-overview");
    for (const view of ["Board", "Timeline", "Graph", "Usage"]) {
      await dashboard.getByRole("tab", view, { exact: true }).tap();
      await expect(dashboard.locator("#mc-view")).toContainText(
        view === "Usage"
          ? "Provider usage limits"
          : view === "Graph"
            ? "Workspace Topology"
            : "Inspect Phoenix plugin",
      );
    }
    await dashboard.getByRole("tab", "Overview", { exact: true }).tap();
    await dashboard.locator("[data-select-thread]").last().tap();
    await dashboard.getByRole("button", "Review work", { exact: true }).tap();
    await expect(browser.locator('[data-testid="mission-control-review-desk"]')).toBeVisible();
    await expect(screen.getByRole("tab", "Mission Control", { exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await screen.getByRole("button", "Back to inbox", { exact: true }).tap();
    await runPromise(
      Effect.gen(function* () {
        const client = yield* rpcClient(T3_HOME, origin);
        yield* client["plugins.request"]({
          action: "enable",
          pluginId: "mission-control",
          enabled: false,
        });
        const entries = yield* client["plugins.list"]({});
        if (entries.find((entry) => entry.manifest.id === "mission-control")?.enabled !== false)
          throw new Error("Disabling did not persist");
      }).pipe(Effect.scoped),
    );
    await t3.open(`/settings/plugins?machine=${encodeURIComponent(environment)}`);
    await expect(
      screen.getByRole("button", "Mission Control", { exact: true }).last(),
    ).toBeDisabled();
    await screen.getByRole("button", "Enable", { exact: true }).tap();
    await screen.getByRole("button", "Mission Control", { exact: true }).last().tap();
    await expect(dashboard.getByRole("heading", "Mission Control", { exact: true })).toBeVisible();
  },
);

test("Mission Control starts and replies to a conversation", WEB, async ({ t3, app, browser }) => {
  const environment = await runPromise(environmentId(app.baseUrl ?? ""));
  await t3.project("mission-control-actions");
  await t3.open(
    `/plugins?environmentId=${encodeURIComponent(environment)}&pluginId=mission-control&viewId=dashboard`,
  );
  const dashboard = browser.frameLocator('iframe[title="dashboard"]');
  await expect(dashboard.getByRole("heading", "Mission Control", { exact: true })).toBeVisible();
  await dashboard.getByRole("tab", "Overview", { exact: true }).tap();
  await expect(dashboard.getByText("mission-control-actions", { exact: true })).toBeVisible();
  await dashboard.locator("#mc-new-thread-btn").tap();
  await dashboard
    .getByRole("textbox", "Title (optional)", { exact: true })
    .fill("Created from Mission Control");
  await dashboard
    .getByRole("textbox", "Prompt", { exact: true })
    .fill("Check the Mission Control plugin flow.");
  await dashboard
    .getByRole("combobox", "Model", { exact: true })
    .selectOption({ label: "Replay (dev) · Multi turn" });
  await dashboard.getByRole("button", "Start Thread", { exact: true }).tap();
  await expect(
    dashboard.getByRole("heading", "Created from Mission Control", { exact: true }),
  ).toBeVisible();
  await expect(dashboard.locator("#mc-insp-scroll")).toContainText(
    "Check the Mission Control plugin flow.",
  );
  await dashboard
    .getByRole("textbox", "Reply or steer thread", { exact: true })
    .fill("Reply from Mission Control.");
  await dashboard.getByRole("button", "Send reply", { exact: true }).tap();
  await expect(dashboard.locator("#mc-toast-root")).toContainText("Reply queued");
  await expect(dashboard.locator("#mc-insp-scroll")).toContainText("Reply from Mission Control.");
  await app.screenshot("mission-control-created-thread-and-reply");
});

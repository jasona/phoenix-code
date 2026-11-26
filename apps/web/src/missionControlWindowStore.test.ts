import { describe, expect, it } from "vite-plus/test";

import { fitMissionControlWindow, useMissionControlWindowStore } from "./missionControlWindowStore";

function resetStore() {
  useMissionControlWindowStore.setState({ byThreadKey: {}, newThreadPlacement: {} });
  return useMissionControlWindowStore.getState();
}

async function reloadStore() {
  const { storage, name } = useMissionControlWindowStore.persist.getOptions();
  const saved = await storage!.getItem(name!);
  resetStore();
  await storage!.setItem(name!, saved!);
  await useMissionControlWindowStore.persist.rehydrate();
}

describe("Mission Control window state", () => {
  it("fits saved windows to a smaller viewport without losing their desktop geometry", () => {
    const bounds = { x: 900, y: 500, width: 800, height: 600 };
    expect(fitMissionControlWindow(bounds, { width: 1200, height: 800 })).toEqual({
      x: 400,
      y: 200,
      width: 800,
      height: 600,
    });
    expect(fitMissionControlWindow(bounds, { width: 390, height: 280 })).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 280,
    });
    expect(bounds).toEqual({ x: 900, y: 500, width: 800, height: 600 });
    expect(
      fitMissionControlWindow(
        { x: -30, y: -50, width: 20, height: 40 },
        { width: 1200, height: 800 },
      ),
    ).toEqual({ x: 0, y: 0, width: 360, height: 320 });
    expect(
      fitMissionControlWindow(
        { x: Number.NaN, y: Infinity, width: -1, height: Infinity },
        { width: 1200, height: 800 },
        Number.NaN,
      ),
    ).toEqual({ x: 150, y: 75, width: 900, height: 650 });
    expect(fitMissionControlWindow(undefined, { width: 1200, height: 800 }, 24)).toEqual({
      x: 174,
      y: 99,
      width: 900,
      height: 650,
    });
  });

  it("restores independent geometry, file selection, and panes for the same thread ID on different environments", async () => {
    const store = resetStore();
    const bounds = { x: 40, y: 60, width: 780, height: 540 };
    const file = {
      kind: "file" as const,
      id: "file:src/index.ts" as const,
      relativePath: "src/index.ts",
      revealLine: 12,
      revealRequestId: 3,
    };
    store.setBounds("local:thread-1", bounds);
    store.setMaximized("local:thread-1", true);
    store.setTasksOpen("local:thread-1", false);
    store.setSubagentsOpen("local:thread-1", true);
    store.setImagesOpen("local:thread-1", true);
    store.setImagesLayout("local:thread-1", "grid");
    store.setPreferredSidebar("local:thread-1", "subagents");
    store.setFile("local:thread-1", file);
    store.setPane("local:thread-1", "file");
    store.setPane("remote:thread-1", "terminal");
    await reloadStore();
    expect(useMissionControlWindowStore.getState().byThreadKey).toEqual({
      "local:thread-1": {
        bounds,
        maximized: true,
        tasksOpen: false,
        subagentsOpen: true,
        imagesOpen: true,
        imagesLayout: "grid",
        preferredSidebar: "subagents",
        file,
        pane: "file",
      },
      "remote:thread-1": { pane: "terminal" },
    });
    useMissionControlWindowStore.getState().setMaximized("local:thread-1", false);
    expect(useMissionControlWindowStore.getState().byThreadKey["local:thread-1"]?.bounds).toEqual(
      bounds,
    );
  });

  it("discards malformed persisted geometry and selections while retaining usable thread preferences", () => {
    const store = resetStore();
    const merge = useMissionControlWindowStore.persist.getOptions().merge!;
    const restored = merge(
      {
        setBounds: "not a function",
        byThreadKey: {
          "local:good": { bounds: { x: 10, y: 20, width: 500, height: 400 }, pane: "changes" },
          "local:broken": {
            bounds: { x: -5, y: 0, width: 800, height: 650 },
            pane: "file",
            maximized: true,
            file: { kind: "file", id: "file:src/index.ts", relativePath: "src/index.ts" },
          },
          "remote:nonfinite": {
            bounds: { x: 0, y: 0, width: Infinity, height: 650 },
            pane: "unknown",
            maximized: "true",
          },
          unscoped: { pane: "changes" },
          " :thread": { pane: "changes" },
          "local: ": { pane: "changes" },
          "local:null": null,
        },
      },
      store,
    );
    expect(restored.byThreadKey).toEqual({
      "local:good": { bounds: { x: 10, y: 20, width: 500, height: 400 }, pane: "changes" },
      "local:broken": { pane: "conversation", maximized: true },
    });
    expect(restored.setBounds).toBe(store.setBounds);
    expect(merge({ byThreadKey: null }, store).byThreadKey).toEqual({});
    expect(
      merge(
        {
          byThreadKey: null,
          newThreadPlacement: {
            bounds: { x: 24, y: 36, width: 720, height: 520 },
            maximized: "yes",
          },
        },
        store,
      ).newThreadPlacement,
    ).toEqual({ bounds: { x: 24, y: 36, width: 720, height: 520 } });
    expect(
      merge(
        {
          newThreadPlacement: {
            bounds: { x: -10, y: 20, width: 720, height: 520 },
            maximized: true,
          },
        },
        store,
      ).newThreadPlacement,
    ).toEqual({ maximized: true });
  });

  it("persists and applies saved new-thread modal placement across storage reloads", async () => {
    const store = resetStore();
    const bounds = { x: 64, y: 48, width: 1020, height: 700 };
    store.applyNewThreadPlacement("local:untouched");
    expect(useMissionControlWindowStore.getState().byThreadKey["local:untouched"]).toBeUndefined();

    store.setNewThreadBounds({ x: -1, y: 0, width: 500, height: 400 });
    expect(useMissionControlWindowStore.getState().newThreadPlacement).toEqual({});

    store.setNewThreadBounds(bounds);
    store.setNewThreadMaximized(true);
    await reloadStore();
    expect(useMissionControlWindowStore.getState().newThreadPlacement).toEqual({
      bounds,
      maximized: true,
    });

    useMissionControlWindowStore.getState().applyNewThreadPlacement("local:next-draft");
    expect(useMissionControlWindowStore.getState().byThreadKey["local:next-draft"]).toEqual({
      bounds,
      maximized: true,
    });

    useMissionControlWindowStore.getState().setNewThreadMaximized(false);
    await reloadStore();
    useMissionControlWindowStore.getState().applyNewThreadPlacement("local:next-draft");
    expect(useMissionControlWindowStore.getState().byThreadKey["local:next-draft"]).toEqual({
      bounds,
      maximized: false,
    });
  });

  it("keeps the 100 most recently changed windows across storage reloads", async () => {
    const store = resetStore();
    for (let index = 0; index < 100; index++) store.setPane(`local:thread-${index}`, "changes");
    store.setPane("local:thread-0", "terminal");
    store.setPane("local:thread-100", "preview");
    await reloadStore();
    const entries = useMissionControlWindowStore.getState().byThreadKey;
    expect(Object.keys(entries)).toHaveLength(100);
    expect(entries["local:thread-0"]).toEqual({ pane: "terminal" });
    expect(entries["local:thread-1"]).toBeUndefined();
    expect(entries["local:thread-100"]).toEqual({ pane: "preview" });
  });
});

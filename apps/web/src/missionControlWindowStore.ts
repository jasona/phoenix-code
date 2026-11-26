import { ChatFileAttachment } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import type { RightPanelSurface } from "./rightPanelStore";

export interface MissionControlWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MissionControlWindowPlacement {
  bounds?: MissionControlWindowBounds;
  maximized?: boolean;
}

const Pane = Schema.Literals(["conversation", "changes", "terminal", "preview", "file"]);
export type MissionControlWindowPane = typeof Pane.Type;
const ImageStreamLayout = Schema.Literals(["stream", "grid"]);
export type MissionControlImageStreamLayout = typeof ImageStreamLayout.Type;
const SidebarKind = Schema.Literals(["tasks", "images"]);
export type MissionControlSidebarKind = typeof SidebarKind.Type;
type WindowFile = Extract<RightPanelSurface, { kind: "file" | "files" }>;
type WindowState = MissionControlWindowPlacement & {
  pane?: MissionControlWindowPane;
  file?: WindowFile;
  tasksOpen?: boolean;
  imagesOpen?: boolean;
  imagesLayout?: MissionControlImageStreamLayout;
  preferredSidebar?: MissionControlSidebarKind;
};
interface WindowStore {
  byThreadKey: Record<string, WindowState>;
  newThreadPlacement: MissionControlWindowPlacement;
  setBounds: (key: string, bounds: MissionControlWindowBounds) => void;
  setMaximized: (key: string, maximized: boolean) => void;
  setNewThreadBounds: (bounds: MissionControlWindowBounds) => void;
  setNewThreadMaximized: (maximized: boolean) => void;
  applyNewThreadPlacement: (key: string) => void;
  setPane: (key: string, pane: MissionControlWindowPane) => void;
  setFile: (key: string, file: WindowFile) => void;
  setTasksOpen: (key: string, tasksOpen: boolean) => void;
  setImagesOpen: (key: string, imagesOpen: boolean) => void;
  setImagesLayout: (key: string, imagesLayout: MissionControlImageStreamLayout) => void;
  setPreferredSidebar: (key: string, preferredSidebar: MissionControlSidebarKind) => void;
}

const isPane = Schema.is(Pane);
const isImageStreamLayout = Schema.is(ImageStreamLayout);
const isSidebarKind = Schema.is(SidebarKind);
const isBounds = Schema.is(
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  }),
);
const isPersistedFile = Schema.is(
  Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("files"),
      id: Schema.Literal("files"),
      folderTrail: Schema.optional(Schema.String),
    }),
    Schema.Struct({
      kind: Schema.Literal("file"),
      id: Schema.String.check(Schema.isPattern(/^(file|attachment):/)),
      relativePath: Schema.String,
      revealLine: Schema.NullOr(Schema.Int),
      revealRequestId: Schema.Int,
      attachment: Schema.optional(ChatFileAttachment),
      folderTrail: Schema.optional(Schema.String),
    }),
  ]),
);
const isFile = (value: unknown): value is WindowFile => isPersistedFile(value);
const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
const validBounds = (value: unknown): value is MissionControlWindowBounds =>
  isBounds(value) &&
  Object.values(value).every(Number.isFinite) &&
  value.x >= 0 &&
  value.y >= 0 &&
  value.width > 0 &&
  value.height > 0;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function fitMissionControlWindow(
  bounds: MissionControlWindowBounds | undefined,
  viewport: { width: number; height: number },
  offset = 0,
): MissionControlWindowBounds {
  const viewportWidth = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0;
  const viewportHeight = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0;
  const width = clamp(
    bounds && Number.isFinite(bounds.width) && bounds.width > 0 ? bounds.width : 900,
    Math.min(360, viewportWidth),
    viewportWidth,
  );
  const height = clamp(
    bounds && Number.isFinite(bounds.height) && bounds.height > 0 ? bounds.height : 650,
    Math.min(320, viewportHeight),
    viewportHeight,
  );
  const cascade = Number.isFinite(offset) ? offset : 0;
  return {
    x: clamp(
      bounds && Number.isFinite(bounds.x) ? bounds.x : (viewportWidth - width) / 2 + cascade,
      0,
      viewportWidth - width,
    ),
    y: clamp(
      bounds && Number.isFinite(bounds.y) ? bounds.y : (viewportHeight - height) / 2 + cascade,
      0,
      viewportHeight - height,
    ),
    width,
    height,
  };
}

function isScopedKey(key: string) {
  const separator = key.indexOf(":");
  return (
    separator > 0 && key.slice(0, separator).trim() !== "" && key.slice(separator + 1).trim() !== ""
  );
}

function readPlacement(value: unknown): MissionControlWindowPlacement {
  if (!isRecord(value)) return {};
  const placement: MissionControlWindowPlacement = {};
  if (validBounds(value.bounds)) placement.bounds = value.bounds;
  if (typeof value.maximized === "boolean") placement.maximized = value.maximized;
  return placement;
}

function readPersistedState(
  value: unknown,
): Pick<WindowStore, "byThreadKey" | "newThreadPlacement"> {
  if (!isRecord(value)) return { byThreadKey: {}, newThreadPlacement: {} };
  const newThreadPlacement = readPlacement(value.newThreadPlacement);
  if (!isRecord(value.byThreadKey)) return { byThreadKey: {}, newThreadPlacement };
  const entries: Array<[string, WindowState]> = [];
  for (const [key, entry] of Object.entries(value.byThreadKey)) {
    if (!isScopedKey(key) || !isRecord(entry)) continue;
    const state: WindowState = readPlacement(entry);
    if (typeof entry.tasksOpen === "boolean") state.tasksOpen = entry.tasksOpen;
    if (typeof entry.imagesOpen === "boolean") state.imagesOpen = entry.imagesOpen;
    if (isImageStreamLayout(entry.imagesLayout)) state.imagesLayout = entry.imagesLayout;
    if (isSidebarKind(entry.preferredSidebar)) state.preferredSidebar = entry.preferredSidebar;
    if (isFile(entry.file)) state.file = entry.file;
    if (isPane(entry.pane))
      state.pane = entry.pane === "file" && !state.file ? "conversation" : entry.pane;
    if (Object.keys(state).length > 0) entries.push([key, state]);
  }
  return { byThreadKey: Object.fromEntries(entries.slice(-100)), newThreadPlacement };
}

function updateWindow(byThreadKey: WindowStore["byThreadKey"], key: string, patch: WindowState) {
  const entries: Array<[string, WindowState]> = [
    ...Object.entries(byThreadKey).filter(([existing]) => existing !== key),
    [key, { ...byThreadKey[key], ...patch }],
  ];
  return Object.fromEntries(entries.slice(-100));
}

export const useMissionControlWindowStore = create<WindowStore>()(
  persist(
    (set) => ({
      byThreadKey: {},
      newThreadPlacement: {},
      setBounds: (key, bounds) => {
        if (!validBounds(bounds)) return;
        set((state) => ({ byThreadKey: updateWindow(state.byThreadKey, key, { bounds }) }));
      },
      setMaximized: (key, maximized) =>
        set((state) => ({ byThreadKey: updateWindow(state.byThreadKey, key, { maximized }) })),
      setNewThreadBounds: (bounds) => {
        if (!validBounds(bounds)) return;
        set((state) => ({
          newThreadPlacement: { ...state.newThreadPlacement, bounds },
        }));
      },
      setNewThreadMaximized: (maximized) =>
        set((state) => ({
          newThreadPlacement: { ...state.newThreadPlacement, maximized },
        })),
      applyNewThreadPlacement: (key) =>
        set((state) => {
          const { bounds, maximized } = state.newThreadPlacement;
          const patch: WindowState = {};
          if (bounds) patch.bounds = bounds;
          if (maximized !== undefined) patch.maximized = maximized;
          if (Object.keys(patch).length === 0) return state;
          return { byThreadKey: updateWindow(state.byThreadKey, key, patch) };
        }),
      setPane: (key, pane) =>
        set((state) => ({ byThreadKey: updateWindow(state.byThreadKey, key, { pane }) })),
      setFile: (key, file) =>
        set((state) => ({ byThreadKey: updateWindow(state.byThreadKey, key, { file }) })),
      setTasksOpen: (key, tasksOpen) =>
        set((state) => ({ byThreadKey: updateWindow(state.byThreadKey, key, { tasksOpen }) })),
      setImagesOpen: (key, imagesOpen) =>
        set((state) => ({ byThreadKey: updateWindow(state.byThreadKey, key, { imagesOpen }) })),
      setImagesLayout: (key, imagesLayout) =>
        set((state) => ({ byThreadKey: updateWindow(state.byThreadKey, key, { imagesLayout }) })),
      setPreferredSidebar: (key, preferredSidebar) =>
        set((state) => ({
          byThreadKey: updateWindow(state.byThreadKey, key, { preferredSidebar }),
        })),
    }),
    {
      name: "phoenix:mission-control-windows:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: ({ byThreadKey, newThreadPlacement }) => ({ byThreadKey, newThreadPlacement }),
      migrate: readPersistedState,
      merge: (persisted, current) => ({ ...current, ...readPersistedState(persisted) }),
    },
  ),
);

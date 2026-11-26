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

const Pane = Schema.Literals(["conversation", "changes", "terminal", "preview", "file"]);
export type MissionControlWindowPane = typeof Pane.Type;
type WindowFile = Extract<RightPanelSurface, { kind: "file" | "files" }>;
type WindowState = {
  bounds?: MissionControlWindowBounds;
  maximized?: boolean;
  pane?: MissionControlWindowPane;
  file?: WindowFile;
};
interface WindowStore {
  byThreadKey: Record<string, WindowState>;
  setBounds: (key: string, bounds: MissionControlWindowBounds) => void;
  setMaximized: (key: string, maximized: boolean) => void;
  setPane: (key: string, pane: MissionControlWindowPane) => void;
  setFile: (key: string, file: WindowFile) => void;
}

const isPane = Schema.is(Pane);
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

function readPersistedState(value: unknown): Pick<WindowStore, "byThreadKey"> {
  if (!isRecord(value) || !isRecord(value.byThreadKey)) return { byThreadKey: {} };
  const entries: Array<[string, WindowState]> = [];
  for (const [key, entry] of Object.entries(value.byThreadKey)) {
    if (!isScopedKey(key) || !isRecord(entry)) continue;
    const state: WindowState = {};
    if (validBounds(entry.bounds)) state.bounds = entry.bounds;
    if (typeof entry.maximized === "boolean") state.maximized = entry.maximized;
    if (isFile(entry.file)) state.file = entry.file;
    if (isPane(entry.pane))
      state.pane = entry.pane === "file" && !state.file ? "conversation" : entry.pane;
    if (Object.keys(state).length > 0) entries.push([key, state]);
  }
  return { byThreadKey: Object.fromEntries(entries.slice(-100)) };
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
      setBounds: (key, bounds) => {
        if (!validBounds(bounds)) return;
        set((state) => ({ byThreadKey: updateWindow(state.byThreadKey, key, { bounds }) }));
      },
      setMaximized: (key, maximized) =>
        set((state) => ({ byThreadKey: updateWindow(state.byThreadKey, key, { maximized }) })),
      setPane: (key, pane) =>
        set((state) => ({ byThreadKey: updateWindow(state.byThreadKey, key, { pane }) })),
      setFile: (key, file) =>
        set((state) => ({ byThreadKey: updateWindow(state.byThreadKey, key, { file }) })),
    }),
    {
      name: "phoenix:mission-control-windows:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: ({ byThreadKey }) => ({ byThreadKey }),
      migrate: readPersistedState,
      merge: (persisted, current) => ({ ...current, ...readPersistedState(persisted) }),
    },
  ),
);

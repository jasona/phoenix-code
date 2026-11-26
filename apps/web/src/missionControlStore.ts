import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";
import type { DraftId } from "./composerDraftStore";

export interface MissionControlWindow {
  threadRef: ScopedThreadRef;
  instanceId: string;
  minimized: boolean;
  draftId?: DraftId;
}

export const useMissionControlStore = create<{
  environmentId: EnvironmentId | null;
  active: boolean;
  windows: Array<MissionControlWindow>;
  focusedKey: string | null;
  open: (environmentId: EnvironmentId) => void;
  inspectThread: (threadRef: ScopedThreadRef, instanceId: string) => void;
  openDraft: (threadRef: ScopedThreadRef, draftId: DraftId, instanceId: string) => void;
  focusWindow: (key: string) => void;
  minimizeWindow: (key: string) => void;
  closeWindow: (key: string) => void;
  showWorkspace: () => void;
  showMissionControl: () => void;
  close: () => void;
}>((set) => ({
  environmentId: null,
  active: false,
  windows: [],
  focusedKey: null,
  open: (environmentId) =>
    set((state) => ({
      environmentId,
      active: true,
      windows: state.environmentId === environmentId ? state.windows : [],
      focusedKey: state.environmentId === environmentId ? state.focusedKey : null,
    })),
  inspectThread: (threadRef, instanceId) =>
    set((state) => ({
      environmentId: threadRef.environmentId,
      active: true,
      focusedKey: scopedThreadKey(threadRef),
      windows: [
        ...(state.environmentId === threadRef.environmentId ? state.windows : []).filter(
          (item) => scopedThreadKey(item.threadRef) !== scopedThreadKey(threadRef),
        ),
        { threadRef, instanceId, minimized: false },
      ],
    })),
  openDraft: (threadRef, draftId, instanceId) =>
    set((state) => ({
      environmentId: threadRef.environmentId,
      active: true,
      focusedKey: scopedThreadKey(threadRef),
      windows: [
        ...(state.environmentId === threadRef.environmentId ? state.windows : []).filter(
          (item) =>
            item.draftId !== draftId &&
            scopedThreadKey(item.threadRef) !== scopedThreadKey(threadRef),
        ),
        { threadRef, draftId, instanceId, minimized: false },
      ],
    })),
  focusWindow: (key) =>
    set((state) => {
      const target = state.windows.find((item) => scopedThreadKey(item.threadRef) === key);
      return target
        ? {
            focusedKey: key,
            windows: [
              ...state.windows.filter((item) => item !== target),
              { ...target, minimized: false },
            ],
          }
        : state;
    }),
  minimizeWindow: (key) =>
    set((state) => {
      const windows = state.windows.map((item) =>
        scopedThreadKey(item.threadRef) === key ? { ...item, minimized: true } : item,
      );
      const next = windows.findLast((item) => !item.minimized);
      return {
        windows,
        focusedKey:
          state.focusedKey === key
            ? next
              ? scopedThreadKey(next.threadRef)
              : null
            : state.focusedKey,
      };
    }),
  closeWindow: (key) =>
    set((state) => {
      const windows = state.windows.filter((item) => scopedThreadKey(item.threadRef) !== key);
      const next = windows.findLast((item) => !item.minimized);
      return {
        windows,
        focusedKey:
          state.focusedKey === key
            ? next
              ? scopedThreadKey(next.threadRef)
              : null
            : state.focusedKey,
      };
    }),
  showWorkspace: () => set({ active: false }),
  showMissionControl: () => set((state) => ({ active: state.environmentId !== null })),
  close: () => set({ environmentId: null, active: false, windows: [], focusedKey: null }),
}));

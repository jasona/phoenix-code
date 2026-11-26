import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

export const useMissionControlStore = create<{
  environmentId: EnvironmentId | null;
  active: boolean;
  reviewThreadRef: ScopedThreadRef | null;
  open: (environmentId: EnvironmentId) => void;
  inspectThread: (threadRef: ScopedThreadRef) => void;
  returnToInbox: () => void;
  showWorkspace: () => void;
  showMissionControl: () => void;
  close: () => void;
}>((set) => ({
  environmentId: null,
  active: false,
  reviewThreadRef: null,
  open: (environmentId) =>
    set((state) => ({
      environmentId,
      active: true,
      reviewThreadRef: state.environmentId === environmentId ? state.reviewThreadRef : null,
    })),
  inspectThread: (threadRef) =>
    set({ environmentId: threadRef.environmentId, active: true, reviewThreadRef: threadRef }),
  returnToInbox: () => set({ reviewThreadRef: null }),
  showWorkspace: () => set({ active: false }),
  showMissionControl: () => set((state) => ({ active: state.environmentId !== null })),
  close: () => set({ environmentId: null, active: false, reviewThreadRef: null }),
}));

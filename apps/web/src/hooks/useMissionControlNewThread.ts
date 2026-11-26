import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { useComposerDraftStore } from "../composerDraftStore";
import { useMissionControlStore } from "../missionControlStore";
import { useMissionControlWindowStore } from "../missionControlWindowStore";
import { readProjects, readThreadShell } from "../state/entities";
import { getClientSettings } from "./useSettings";
import { useNewThreadHandler, type NewThreadHandler } from "./useHandleNewThread";

export function useMissionControlNewThread() {
  const createDraft = useNewThreadHandler();
  const openDraft = async (
    projectRef: Parameters<NewThreadHandler>[0],
    instanceId: string,
    options?: Parameters<NewThreadHandler>[1],
    replacingKey?: string,
  ) => {
    const project = readProjects().find(
      (item) => item.id === projectRef.projectId && item.environmentId === projectRef.environmentId,
    );
    if (!project || project.archivedAt != null) return null;
    const drafts = useComposerDraftStore.getState();
    const saved = drafts.getDraftSessionByLogicalProjectKey(
      deriveLogicalProjectKeyFromSettings(
        project,
        selectProjectGroupingSettings(getClientSettings()),
      ),
    );
    const reusable =
      saved &&
      saved.environmentId === projectRef.environmentId &&
      saved.projectId === projectRef.projectId &&
      !saved.promotedTo &&
      !readThreadShell(scopeThreadRef(saved.environmentId, saved.threadId));
    const opened = reusable
      ? { draftId: saved.draftId, threadId: saved.threadId }
      : await createDraft(projectRef, { ...options, navigate: false });
    if (!opened) return null;
    const ref = scopeThreadRef(projectRef.environmentId, opened.threadId);
    const key = scopedThreadKey(ref);
    const existing = useMissionControlStore
      .getState()
      .windows.find((window) => window.draftId === opened.draftId);
    const previousKey = replacingKey ?? (existing ? scopedThreadKey(existing.threadRef) : null);
    if (previousKey && previousKey !== key) {
      const placement = useMissionControlWindowStore.getState().byThreadKey[previousKey];
      if (placement?.bounds)
        useMissionControlWindowStore.getState().setBounds(key, placement.bounds);
      if (placement?.maximized !== undefined)
        useMissionControlWindowStore.getState().setMaximized(key, placement.maximized);
      useMissionControlStore.getState().closeWindow(previousKey);
    }
    useMissionControlStore.getState().openDraft(ref, opened.draftId, instanceId);
    return opened;
  };
  return openDraft;
}

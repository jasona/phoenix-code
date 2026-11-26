import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  createDraft: vi.fn(),
  serverThreadExists: false,
}));

vi.mock("./useHandleNewThread", () => ({
  useNewThreadHandler: () => testState.createDraft,
}));
vi.mock("./useSettings", () => ({ getClientSettings: () => ({}) }));
vi.mock("@t3tools/client-runtime/state/project-grouping", () => ({
  deriveLogicalProjectKeyFromSettings: (project: { id: string }) => project.id,
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => ({
  readProjects: () => [
    { id: "project", environmentId: "local", archivedAt: null },
    { id: "other-project", environmentId: "local", archivedAt: null },
    { id: "project", environmentId: "remote", archivedAt: null },
  ],
  readThreadShell: () => (testState.serverThreadExists ? {} : null),
}));

import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useMissionControlStore } from "../missionControlStore";
import { useMissionControlWindowStore } from "../missionControlWindowStore";
import { useMissionControlNewThread } from "./useMissionControlNewThread";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const project = scopeProjectRef(local, ProjectId.make("project"));
const otherProject = scopeProjectRef(local, ProjectId.make("other-project"));
const savedId = DraftId.make("saved-draft");
const savedRef = scopeThreadRef(local, ThreadId.make("saved-thread"));

function setup() {
  useComposerDraftStore.setState(useComposerDraftStore.getInitialState());
  useMissionControlStore.setState(useMissionControlStore.getInitialState());
  useMissionControlWindowStore.setState({ byThreadKey: {}, newThreadPlacement: {} });
  testState.serverThreadExists = false;
  testState.createDraft.mockReset();
  testState.createDraft.mockImplementation(async (projectRef) => {
    const draftId = DraftId.make("created-draft");
    const threadId = ThreadId.make("created-thread");
    useComposerDraftStore
      .getState()
      .setLogicalProjectDraftThreadId(projectRef.projectId, projectRef, draftId, { threadId });
    return { draftId, threadId };
  });
  useComposerDraftStore
    .getState()
    .setLogicalProjectDraftThreadId(project.projectId, project, savedId, {
      threadId: savedRef.threadId,
      branch: "work-in-progress",
      envMode: "worktree",
      runtimeMode: "full-access",
    });
  useComposerDraftStore.getState().setPrompt(savedId, "Keep this unsent investigation.");
  return useMissionControlNewThread();
}

describe("Mission Control new threads", () => {
  it("reopens the same populated draft after closing its window without resetting its context", async () => {
    const openDraft = setup();
    await openDraft(project, "plugin-instance");
    useMissionControlStore.getState().closeWindow(scopedThreadKey(savedRef));

    const reopened = await openDraft(project, "reopened-instance");

    expect(reopened).toEqual({ draftId: savedId, threadId: savedRef.threadId });
    expect(testState.createDraft).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().getComposerDraft(savedId)?.prompt).toBe(
      "Keep this unsent investigation.",
    );
    expect(useComposerDraftStore.getState().getDraftSession(savedId)).toMatchObject({
      branch: "work-in-progress",
      envMode: "worktree",
      runtimeMode: "full-access",
    });
    expect(useMissionControlStore.getState().windows).toEqual([
      { threadRef: savedRef, draftId: savedId, instanceId: "reopened-instance", minimized: false },
    ]);
  });

  it.each(["promoting", "already on server"])(
    "starts a fresh draft when the previous draft is %s",
    async (state) => {
      const openDraft = setup();
      await openDraft(project, "plugin-instance");
      if (state === "promoting")
        useComposerDraftStore.getState().markDraftThreadPromoting(savedId, savedRef);
      else testState.serverThreadExists = true;

      const opened = await openDraft(project, "plugin-instance");

      expect(opened?.draftId).toBe("created-draft");
      expect(testState.createDraft).toHaveBeenCalledWith(project, { navigate: false });
      expect(
        useMissionControlStore.getState().windows.map((window) => window.threadRef.threadId),
      ).toEqual(["saved-thread", "created-thread"]);
      expect(useComposerDraftStore.getState().getComposerDraft(savedId)?.prompt).toBe(
        "Keep this unsent investigation.",
      );
    },
  );

  it("keeps placement when switching the draft's project and preserves its old unsent draft", async () => {
    const openDraft = setup();
    await openDraft(project, "plugin-instance");
    const oldKey = scopedThreadKey(savedRef);
    const bounds = { x: 80, y: 60, width: 800, height: 600 };
    useMissionControlWindowStore.getState().setBounds(oldKey, bounds);
    useMissionControlWindowStore.getState().setMaximized(oldKey, true);

    const opened = await openDraft(otherProject, "plugin-instance", undefined, oldKey);
    const newKey = scopedThreadKey(scopeThreadRef(local, opened!.threadId));

    expect(useMissionControlStore.getState().windows).toHaveLength(1);
    expect(useMissionControlStore.getState().focusedKey).toBe(newKey);
    expect(useMissionControlWindowStore.getState().byThreadKey[newKey]).toMatchObject({
      bounds,
      maximized: true,
    });
    expect(useComposerDraftStore.getState().getComposerDraft(savedId)?.prompt).toBe(
      "Keep this unsent investigation.",
    );
  });

  it("does not reuse a draft on another machine for the same logical project", async () => {
    const openDraft = setup();
    const remoteProject = scopeProjectRef(remote, project.projectId);

    const opened = await openDraft(remoteProject, "remote-instance");

    expect(opened?.draftId).toBe("created-draft");
    expect(testState.createDraft).toHaveBeenCalledWith(remoteProject, { navigate: false });
    expect(useMissionControlStore.getState().windows[0]?.threadRef.environmentId).toBe(remote);
    expect(useComposerDraftStore.getState().getDraftSession(savedId)?.environmentId).toBe(local);
  });

  it("restores one window and its placement after a failed send gives its draft a new thread id", async () => {
    const openDraft = setup();
    await openDraft(project, "plugin-instance");
    const bounds = { x: 80, y: 60, width: 800, height: 600 };
    useMissionControlWindowStore.getState().setBounds(scopedThreadKey(savedRef), bounds);
    const retriedRef = scopeThreadRef(local, ThreadId.make("retried-thread"));
    useComposerDraftStore
      .getState()
      .setLogicalProjectDraftThreadId(project.projectId, project, savedId, {
        threadId: retriedRef.threadId,
      });

    await openDraft(project, "reopened-instance");

    expect(useMissionControlStore.getState().windows).toEqual([
      {
        threadRef: retriedRef,
        draftId: savedId,
        instanceId: "reopened-instance",
        minimized: false,
      },
    ]);
    expect(
      useMissionControlWindowStore.getState().byThreadKey[scopedThreadKey(retriedRef)]?.bounds,
    ).toEqual(bounds);
  });

  it("restores the last saved new-thread modal size, position, and maximize state for new and reopened closed drafts", async () => {
    const openDraft = setup();
    const savedBounds = { x: 96, y: 52, width: 1080, height: 720 };
    useMissionControlWindowStore.getState().setNewThreadBounds(savedBounds);
    useMissionControlWindowStore.getState().setNewThreadMaximized(true);

    const otherOpened = await openDraft(otherProject, "plugin-instance");
    const otherKey = scopedThreadKey(scopeThreadRef(local, otherOpened!.threadId));
    expect(useMissionControlWindowStore.getState().byThreadKey[otherKey]).toMatchObject({
      bounds: savedBounds,
      maximized: true,
    });

    const updatedBounds = { x: 40, y: 28, width: 820, height: 580 };
    useMissionControlWindowStore.getState().setNewThreadBounds(updatedBounds);
    useMissionControlWindowStore.getState().setNewThreadMaximized(false);
    useMissionControlStore.getState().closeWindow(otherKey);

    await openDraft(project, "reopened-instance");
    expect(
      useMissionControlWindowStore.getState().byThreadKey[scopedThreadKey(savedRef)],
    ).toMatchObject({
      bounds: updatedBounds,
      maximized: false,
    });
  });
});

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { useMissionControlStore } from "./missionControlStore";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const first = scopeThreadRef(local, ThreadId.make("first"));
const second = scopeThreadRef(local, ThreadId.make("second"));
const third = scopeThreadRef(local, ThreadId.make("third"));
const remoteFirst = scopeThreadRef(remote, ThreadId.make("first"));
const key = scopedThreadKey;

function setup() {
  useMissionControlStore.setState(useMissionControlStore.getInitialState());
  return useMissionControlStore.getState();
}

const orderedThreads = () =>
  useMissionControlStore.getState().windows.map((item) => key(item.threadRef));

describe("Mission Control thread windows", () => {
  it("opens separate windows and raises or restores an existing thread without duplicating it", () => {
    const store = setup();
    store.inspectThread(first, "plugin-instance-1");
    store.inspectThread(second, "plugin-instance-1");
    expect(orderedThreads()).toEqual([key(first), key(second)]);
    expect(useMissionControlStore.getState().focusedKey).toBe(key(second));

    store.inspectThread(first, "plugin-instance-2");
    expect(orderedThreads()).toEqual([key(second), key(first)]);
    expect(useMissionControlStore.getState().windows.at(-1)).toEqual({
      threadRef: first,
      instanceId: "plugin-instance-2",
      minimized: false,
    });
    store.minimizeWindow(key(first));
    store.inspectThread(first, "plugin-instance-2");
    expect(orderedThreads()).toEqual([key(second), key(first)]);
    expect(useMissionControlStore.getState().windows.at(-1)?.minimized).toBe(false);
    expect(useMissionControlStore.getState().focusedKey).toBe(key(first));

    store.focusWindow(key(second));
    expect(orderedThreads()).toEqual([key(first), key(second)]);
    expect(useMissionControlStore.getState().focusedKey).toBe(key(second));
  });

  it("hands focus to the next visible window when minimizing or closing and restores minimized windows", () => {
    const store = setup();
    for (const ref of [first, second, third]) store.inspectThread(ref, "plugin-instance");
    store.minimizeWindow(key(second));
    expect(useMissionControlStore.getState().focusedKey).toBe(key(third));
    store.minimizeWindow(key(third));
    expect(useMissionControlStore.getState().focusedKey).toBe(key(first));
    store.closeWindow(key(first));
    expect(useMissionControlStore.getState().focusedKey).toBeNull();
    expect(orderedThreads()).toEqual([key(second), key(third)]);

    store.focusWindow(key(second));
    expect(useMissionControlStore.getState().windows.at(-1)?.minimized).toBe(false);
    expect(useMissionControlStore.getState().focusedKey).toBe(key(second));
    store.focusWindow(key(third));
    store.closeWindow(key(third));
    expect(useMissionControlStore.getState().focusedKey).toBe(key(second));
    store.closeWindow(key(second));
    expect(useMissionControlStore.getState().focusedKey).toBeNull();
    expect(orderedThreads()).toEqual([]);
  });

  it("preserves live windows across workspace toggles and same-environment opens, but clears them on environment changes", () => {
    const store = setup();
    store.inspectThread(first, "local-instance");
    store.inspectThread(second, "local-instance");
    store.minimizeWindow(key(first));
    const windows = useMissionControlStore.getState().windows;
    store.showWorkspace();
    expect(useMissionControlStore.getState().active).toBe(false);
    store.showMissionControl();
    store.open(local);
    expect(useMissionControlStore.getState().windows).toBe(windows);
    expect(useMissionControlStore.getState().focusedKey).toBe(key(second));

    store.open(remote);
    expect(useMissionControlStore.getState()).toMatchObject({
      environmentId: remote,
      active: true,
      focusedKey: null,
      windows: [],
    });
    store.inspectThread(remoteFirst, "remote-instance");
    store.close();
    expect(useMissionControlStore.getState()).toMatchObject({
      environmentId: null,
      active: false,
      focusedKey: null,
      windows: [],
    });
  });

  it("does not carry plugin-instance-bound windows into another environment when directly inspecting a thread", () => {
    const store = setup();
    store.inspectThread(first, "local-instance");
    store.inspectThread(second, "local-instance");
    store.inspectThread(remoteFirst, "remote-instance");
    expect(useMissionControlStore.getState()).toMatchObject({
      environmentId: remote,
      focusedKey: key(remoteFirst),
      windows: [{ threadRef: remoteFirst, instanceId: "remote-instance", minimized: false }],
    });
  });
});

import "~/index.css";

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { useMissionControlStore } from "../../missionControlStore";
import { MissionControlThreadWindows } from "./MissionControlThreadWindows";

vi.mock("./MissionControlReviewDesk", () => ({
  MissionControlReviewDesk: () => <textarea aria-label="Reply" />,
}));
vi.mock("../../state/entities", async (original) => ({
  ...(await original<typeof import("../../state/entities")>()),
  useQuietThreadShell: () => ({ title: "Thread title" }),
  useProject: () => null,
}));

const local = EnvironmentId.make("local");
const first = scopeThreadRef(local, ThreadId.make("first"));
const second = scopeThreadRef(local, ThreadId.make("second"));

describe("MissionControlThreadWindows", () => {
  it("closes the focused thread window on Escape, from the window or a field inside it", async () => {
    useMissionControlStore.setState(useMissionControlStore.getInitialState());
    useMissionControlStore.getState().inspectThread(first, "instance");
    useMissionControlStore.getState().inspectThread(second, "instance");
    await using screen = await render(
      <div style={{ position: "relative", width: 900, height: 600 }}>
        <MissionControlThreadWindows active />
      </div>,
      { router: false },
    );

    const dialogs = () =>
      document.querySelectorAll('[data-testid="mission-control-thread-window"]');
    await expect.poll(() => dialogs().length).toBe(2);
    await expect
      .poll(() => document.activeElement?.getAttribute("data-thread-key"))
      .toBe(scopedThreadKey(second));

    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => useMissionControlStore.getState().windows.map((item) => item.threadRef))
      .toEqual([first]);
    expect(useMissionControlStore.getState().focusedKey).toBe(scopedThreadKey(first));

    await userEvent.click(screen.getByRole("textbox", { name: "Reply" }));
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => useMissionControlStore.getState().windows).toEqual([]);
    expect(dialogs().length).toBe(0);
  });
});

import { EnvironmentId, RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import type { MissionControlImageStreamLayout } from "../../missionControlWindowStore";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { render } from "../../../test/render";
import { ExpandedImageDialogHost } from "../chat/ExpandedImageDialog";
import type { MissionControlImageStreamSummary } from "./missionControlImages.logic";
import { MissionControlImageStreamSidebar } from "./MissionControlImageStreamSidebar";

const RED_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#e85d26"/></svg>',
  );

const SAGE_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#3fa66b"/></svg>',
  );

const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("thread-img-stream"));
const threadKey = scopedThreadKey(threadRef);

function makeSummary(
  overrides?: Partial<MissionControlImageStreamSummary>,
): MissionControlImageStreamSummary {
  return {
    phase: "streaming",
    runActive: true,
    images: [
      {
        id: "direct:1",
        index: 1,
        runId: RunId.make("run-1"),
        itemId: TurnItemId.make("item-1"),
        sourceKind: "generated",
        title: "01-workshop-badge.png",
        caption: "Anodized workshop isometric badge",
        path: null,
        createdAt: "2026-11-26T18:41:00.000Z",
        updatedAt: "2026-11-26T18:41:00.000Z",
        revision: 1,
        asset: { kind: "direct", src: RED_SVG },
      },
      {
        id: "direct:2",
        index: 2,
        runId: RunId.make("run-1"),
        itemId: TurnItemId.make("item-2"),
        sourceKind: "created",
        title: "02-palette-card.png",
        caption: "Hardware sage telemetry panel",
        path: null,
        createdAt: "2026-11-26T18:42:00.000Z",
        updatedAt: "2026-11-26T18:42:00.000Z",
        revision: 1,
        asset: { kind: "direct", src: SAGE_SVG },
      },
    ],
    pending: [
      {
        id: "item-3",
        runId: RunId.make("run-1"),
        label: "Darkroom schematic poster",
        startedAt: "2026-11-26T18:43:00.000Z",
        kind: "generating",
      },
    ],
    latestImageId: "direct:2",
    activeRunImageCount: 2,
    startedAt: "2026-11-26T18:41:00.000Z",
    latestActivityAt: "2026-11-26T18:43:00.000Z",
    ...overrides,
  };
}

function SidebarHarness({
  summary,
  onClose,
}: {
  readonly summary: MissionControlImageStreamSummary;
  readonly onClose: () => void;
}) {
  const [layout, setLayout] = useState<MissionControlImageStreamLayout>("stream");
  return (
    <AppAtomRegistryProvider>
      <div className="flex h-[620px] w-[420px] justify-end bg-background">
        <MissionControlImageStreamSidebar
          id="test-image-stream"
          threadRef={threadRef}
          workspaceRoot="/repo"
          workspaceMutationId={null}
          summary={summary}
          layout={layout}
          mode="docked"
          wide={false}
          onLayoutChange={setLayout}
          onClose={onClose}
        />
        <ExpandedImageDialogHost threadKey={threadKey} />
      </div>
    </AppAtomRegistryProvider>
  );
}

describe("MissionControlImageStreamSidebar", () => {
  it("renders chronological frames, live pending generation slot, layout toggle, and lightbox gallery", async () => {
    const onClose = vi.fn();
    await using screen = await render(<SidebarHarness summary={makeSummary()} onClose={onClose} />, {
      router: false,
    });

    const sidebar = screen.getByTestId("mission-control-image-stream-sidebar");
    await expect.element(sidebar).toHaveAttribute("data-image-stream-phase", "streaming");
    await expect.element(screen.getByTestId("mission-control-image-stream-count")).toHaveTextContent(
      "2 images",
    );

    const frames = screen.getByTestId("mission-control-image-frame").all();
    expect(frames).toHaveLength(2);
    await expect.element(frames[0]!).toHaveAttribute("data-image-index", "1");
    await expect.element(frames[1]!).toHaveAttribute("data-image-index", "2");

    await expect.element(screen.getByTestId("mission-control-image-pending")).toBeVisible();
    await expect.element(screen.getByText("Darkroom schematic poster")).toBeVisible();

    const firstImg = screen.getByRole("button", {
      name: "Preview Anodized workshop isometric badge",
    });
    await expect.element(firstImg).toBeVisible();
    await userEvent.click(firstImg);

    await expect.element(page.getByText("01-workshop-badge.png (1/2)")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Next media" }));
    await expect.element(page.getByText("02-palette-card.png (2/2)")).toBeVisible();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "Contact sheet grid" }));
    await expect
      .element(screen.getByRole("button", { name: "Contact sheet grid" }))
      .toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: "Hide image stream" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

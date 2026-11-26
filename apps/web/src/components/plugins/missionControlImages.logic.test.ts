import {
  ChatAttachmentId,
  CheckpointId,
  CheckpointScopeId,
  MessageId,
  NodeId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  type OrchestrationV2RunStatus,
} from "@t3tools/contracts";
import type {
  ThreadStructure,
  ThreadStructureTurnItem,
  ThreadStructureVisibleTurnItem,
} from "@t3tools/client-runtime/state/models";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveMissionControlImageStream,
  resolveMissionControlSidebars,
} from "./missionControlImages.logic";

const threadId = ThreadId.make("thread-img-1");
const providerThreadId = ProviderThreadId.make("provider-thread-1");
const nodeId = NodeId.make("node-1");

function makeRun(
  id: string,
  ordinal: number,
  status: OrchestrationV2RunStatus,
  times?: { startedAt?: string; completedAt?: string | null },
): OrchestrationV2Run {
  const startedAt = DateTime.makeUnsafe(times?.startedAt ?? "2026-11-26T18:40:00.000Z");
  const completedAt =
    times?.completedAt === undefined
      ? status === "running"
        ? null
        : DateTime.makeUnsafe("2026-11-26T18:45:00.000Z")
      : times.completedAt === null
        ? null
        : DateTime.makeUnsafe(times.completedAt);
  return {
    id: RunId.make(id),
    threadId,
    ordinal,
    status,
    interactionMode: "default",
    runtimeMode: "full-access",
    modelSelection: null,
    providerThreadId,
    rootNodeId: nodeId,
    requestedAt: startedAt,
    startedAt,
    completedAt,
    failure: null,
  } as unknown as OrchestrationV2Run;
}

function makeVisibleRow(item: ThreadStructureTurnItem): ThreadStructureVisibleTurnItem {
  return {
    position: item.ordinal,
    visibility: "local",
    sourceThreadId: threadId,
    sourceItemId: item.id,
    item,
  };
}

function makeBaseItem(
  id: string,
  runId: string | null,
  ordinal: number,
  status: ThreadStructureTurnItem["status"],
  times?: { startedAt?: string; completedAt?: string | null; updatedAt?: string },
) {
  const startedAt = DateTime.makeUnsafe(times?.startedAt ?? "2026-11-26T18:41:00.000Z");
  const completedAt =
    times?.completedAt === undefined
      ? status === "running" || status === "pending"
        ? null
        : DateTime.makeUnsafe("2026-11-26T18:42:00.000Z")
      : times.completedAt === null
        ? null
        : DateTime.makeUnsafe(times.completedAt);
  const updatedAt = DateTime.makeUnsafe(
    times?.updatedAt ?? times?.completedAt ?? times?.startedAt ?? "2026-11-26T18:42:00.000Z",
  );
  return {
    id: TurnItemId.make(id),
    threadId,
    runId: runId === null ? null : RunId.make(runId),
    nodeId,
    providerThreadId,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status,
    title: null,
    startedAt,
    completedAt,
    updatedAt,
  };
}

function makeProjection(input: {
  runs?: ReadonlyArray<OrchestrationV2Run>;
  messages?: ReadonlyArray<OrchestrationV2ConversationMessage>;
  items?: ReadonlyArray<ThreadStructureTurnItem>;
}): Pick<
  ThreadStructure,
  "thread" | "runs" | "messages" | "turnItems" | "visibleTurnItems" | "checkpoints"
> {
  const items = input.items ?? [];
  return {
    thread: {
      id: threadId,
      worktreePath: "/repo",
    } as ThreadStructure["thread"],
    runs: [...(input.runs ?? [])],
    messages: [...(input.messages ?? [])],
    turnItems: [...items],
    visibleTurnItems: items.map(makeVisibleRow),
    checkpoints: [],
  };
}

describe("deriveMissionControlImageStream", () => {
  it("returns null when no images or image-generation tools exist", () => {
    const projection = makeProjection({
      runs: [makeRun("run-1", 1, "completed")],
      items: [
        {
          ...makeBaseItem("item-1", "run-1", 1, "completed"),
          type: "file_change",
          fileName: "/repo/src/index.ts",
        },
      ],
    });
    expect(deriveMissionControlImageStream(projection, { workspaceRoot: "/repo" })).toBeNull();
  });

  it("ignores user-uploaded attachment images even when the agent reads them", () => {
    const uploadedPath = "/home/jason/.phoenix/userdata/attachments/abc-123.png";
    const promptPath = "/repo/user-ref.png";
    const projection = makeProjection({
      runs: [makeRun("run-1", 1, "running")],
      messages: [
        {
          id: MessageId.make("msg-u1"),
          threadId,
          runId: RunId.make("run-1"),
          nodeId,
          role: "user",
          createdBy: "user",
          creationSource: "web",
          text: `Look at [Attached image "ref.png" is saved at: ${uploadedPath}] and ${promptPath}`,
          attachments: [],
          streaming: false,
          createdAt: DateTime.makeUnsafe("2026-11-26T18:40:00.000Z"),
          updatedAt: DateTime.makeUnsafe("2026-11-26T18:40:00.000Z"),
        },
      ],
      items: [
        {
          ...makeBaseItem("item-read-1", "run-1", 1, "completed"),
          type: "dynamic_tool",
          toolName: "Read",
          viewedImagePath: uploadedPath,
          input: { path: uploadedPath },
        },
        {
          ...makeBaseItem("item-read-2", "run-1", 2, "completed"),
          type: "dynamic_tool",
          toolName: "Read",
          viewedImagePath: promptPath,
          input: { path: promptPath },
        },
      ],
    });

    expect(deriveMissionControlImageStream(projection, { workspaceRoot: "/repo" })).toBeNull();
  });

  it("streams pending image generation slots and preserves images chronologically across runs", () => {
    const projection = makeProjection({
      runs: [makeRun("run-1", 1, "completed"), makeRun("run-2", 2, "running")],
      messages: [
        {
          id: MessageId.make("msg-a1"),
          threadId,
          runId: RunId.make("run-1"),
          nodeId,
          role: "assistant",
          createdBy: "agent",
          creationSource: "provider",
          text: "Here is the first concept:\n\n![](/repo/art/01-hero.png)",
          attachments: [],
          streaming: false,
          createdAt: DateTime.makeUnsafe("2026-11-26T18:42:30.000Z"),
          updatedAt: DateTime.makeUnsafe("2026-11-26T18:42:30.000Z"),
        },
      ],
      items: [
        {
          ...makeBaseItem("item-gen-1", "run-1", 1, "completed", {
            startedAt: "2026-11-26T18:41:00.000Z",
            completedAt: "2026-11-26T18:41:20.000Z",
          }),
          type: "dynamic_tool",
          toolName: "image_gen.imagegen",
          title: "Generate image",
          input: { prompt: "Anodized workshop isometric badge" },
          output: { status: "completed", savedPath: "/repo/art/01-hero.png" },
        },
        {
          ...makeBaseItem("item-view-1", "run-1", 2, "completed", {
            startedAt: "2026-11-26T18:41:25.000Z",
            completedAt: "2026-11-26T18:41:26.000Z",
          }),
          type: "dynamic_tool",
          toolName: "view_image",
          viewedImagePath: "/repo/art/01-hero.png",
          input: { path: "/repo/art/01-hero.png" },
        },
        {
          ...makeBaseItem("item-file-2", "run-2", 1, "completed", {
            startedAt: "2026-11-26T18:46:00.000Z",
            completedAt: "2026-11-26T18:46:10.000Z",
          }),
          type: "file_change",
          fileName: "art/02-diagram.svg",
          changes: [{ path: "art/02-diagram.svg", operation: "created" }],
        },
        {
          ...makeBaseItem("item-gen-3", "run-2", 2, "running", {
            startedAt: "2026-11-26T18:46:20.000Z",
            completedAt: null,
          }),
          type: "dynamic_tool",
          toolName: "image_gen.imagegen",
          title: "Generate image",
          input: { prompt: "Darkroom schematic poster" },
        },
      ],
    });

    const summary = deriveMissionControlImageStream(projection, { workspaceRoot: "/repo" });
    expect(summary).not.toBeNull();
    expect(summary?.phase).toBe("streaming");
    expect(summary?.runActive).toBe(true);
    expect(summary?.activeRunImageCount).toBe(1);
    expect(summary?.images).toHaveLength(2);
    expect(summary?.images[0]).toMatchObject({
      index: 1,
      title: "01-hero.png",
      caption: "Anodized workshop isometric badge",
      sourceKind: "generated",
      revision: 1,
    });
    expect(summary?.images[1]).toMatchObject({
      index: 2,
      title: "02-diagram.svg",
      sourceKind: "created",
      revision: 1,
    });
    expect(summary?.pending).toEqual([
      {
        id: "item-gen-3",
        runId: RunId.make("run-2"),
        label: "Darkroom schematic poster",
        startedAt: "2026-11-26T18:46:20.000Z",
        kind: "generating",
      },
    ]);
    expect(summary?.latestImageId).toBe(summary?.images[1]?.id);
  });

  it("extracts tool output images, image-generator subagents, checkpoints, and assistant attachments", () => {
    const projection = makeProjection({
      runs: [makeRun("run-1", 1, "completed")],
      messages: [
        {
          id: MessageId.make("msg-a1"),
          threadId,
          runId: RunId.make("run-1"),
          nodeId,
          role: "assistant",
          createdBy: "agent",
          creationSource: "provider",
          text: "Attached output",
          attachments: [
            {
              type: "image",
              id: ChatAttachmentId.make("att_img_1"),
              name: "final-render.png",
              mimeType: "image/png",
              sizeBytes: 1200,
            },
          ],
          streaming: false,
          createdAt: DateTime.makeUnsafe("2026-11-26T18:44:00.000Z"),
          updatedAt: DateTime.makeUnsafe("2026-11-26T18:44:00.000Z"),
        },
      ],
      items: [
        {
          ...makeBaseItem("item-subagent", "run-1", 1, "completed"),
          type: "subagent",
          title: "Image Generator",
          subagentId: nodeId,
          origin: "provider_native",
          driver: "antigravity" as never,
          providerInstanceId: "inst-1" as never,
          childThreadId: null,
          prompt: "Invoke image-generator for sunset icon",
          result: "Saved image to /repo/out/sunset.png",
        },
        {
          ...makeBaseItem("item-shot", "run-1", 2, "completed"),
          type: "dynamic_tool",
          toolName: "device_screenshot",
          title: "Device screenshot",
          input: {},
          output: [{ type: "image", mimeType: "image/png" }],
        },
        {
          ...makeBaseItem("item-checkpoint", "run-1", 3, "completed"),
          type: "checkpoint",
          checkpointId: CheckpointId.make("cp-1"),
          scopeId: CheckpointScopeId.make("scope-1"),
          files: [
            { path: "out/chart.webp", kind: "added", additions: 1, deletions: 0 },
            { path: "out/deleted.png", kind: "deleted", additions: 0, deletions: 1 },
          ],
        },
      ],
    });

    const summary = deriveMissionControlImageStream(projection, { workspaceRoot: "/repo" });
    expect(summary?.phase).toBe("complete");
    expect(summary?.images.map((img) => ({ title: img.title, kind: img.sourceKind }))).toEqual([
      { title: "sunset.png", kind: "generated" },
      { title: "Device screenshot", kind: "tool-output" },
      { title: "chart.webp", kind: "created" },
      { title: "final-render.png", kind: "generated" },
    ]);
  });

  it("increments revision without duplicating when an image file is regenerated in place", () => {
    const projection = makeProjection({
      runs: [makeRun("run-1", 1, "completed")],
      items: [
        {
          ...makeBaseItem("item-1", "run-1", 1, "completed", {
            completedAt: "2026-11-26T18:41:00.000Z",
          }),
          type: "dynamic_tool",
          toolName: "image_gen",
          input: { prompt: "Draft v1" },
          output: { savedPath: "/repo/logo.png" },
        },
        {
          ...makeBaseItem("item-2", "run-1", 2, "completed", {
            completedAt: "2026-11-26T18:42:00.000Z",
          }),
          type: "dynamic_tool",
          toolName: "image_edit",
          input: { prompt: "Sharpen contrast v2" },
          output: { savedPath: "logo.png" },
        },
      ],
    });

    const summary = deriveMissionControlImageStream(projection, { workspaceRoot: "/repo" });
    expect(summary?.images).toHaveLength(1);
    expect(summary?.images[0]?.revision).toBe(2);
    expect(summary?.images[0]?.updatedAt).toBe("2026-11-26T18:42:00.000Z");
  });
});

describe("resolveMissionControlSidebars", () => {
  it("auto-opens images when images exist and window can dock", () => {
    expect(
      resolveMissionControlSidebars({
        hasTasks: false,
        hasImages: true,
        imagesStreaming: true,
        windowWidth: 900,
        savedTasksOpen: undefined,
        savedImagesOpen: undefined,
        preferredSidebar: undefined,
      }),
    ).toEqual({
      tasksVisible: false,
      imagesVisible: true,
      tasksMode: "docked",
      imagesMode: "docked",
      dockedSidebarCount: 1,
    });
  });

  it("docks both tasks and images side-by-side on wide modals", () => {
    expect(
      resolveMissionControlSidebars({
        hasTasks: true,
        hasImages: true,
        imagesStreaming: false,
        windowWidth: 1320,
        savedTasksOpen: undefined,
        savedImagesOpen: undefined,
        preferredSidebar: undefined,
      }),
    ).toEqual({
      tasksVisible: true,
      imagesVisible: true,
      tasksMode: "docked",
      imagesMode: "docked",
      dockedSidebarCount: 2,
    });
  });

  it("shows only the preferred sidebar when both want to open at medium width", () => {
    expect(
      resolveMissionControlSidebars({
        hasTasks: true,
        hasImages: true,
        imagesStreaming: true,
        windowWidth: 900,
        savedTasksOpen: undefined,
        savedImagesOpen: undefined,
        preferredSidebar: "tasks",
      }),
    ).toEqual({
      tasksVisible: true,
      imagesVisible: false,
      tasksMode: "docked",
      imagesMode: "docked",
      dockedSidebarCount: 1,
    });
  });

  it("stays closed on narrow modals unless explicitly opened as overlay", () => {
    expect(
      resolveMissionControlSidebars({
        hasTasks: false,
        hasImages: true,
        imagesStreaming: true,
        windowWidth: 560,
        savedTasksOpen: undefined,
        savedImagesOpen: undefined,
        preferredSidebar: undefined,
      }),
    ).toEqual({
      tasksVisible: false,
      imagesVisible: false,
      tasksMode: "overlay",
      imagesMode: "overlay",
      dockedSidebarCount: 0,
    });
  });
});

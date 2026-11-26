import type {
  AssetResource,
  OrchestrationV2ConversationMessage,
  OrchestrationV2RunStatus,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { resolveMediaSource } from "@t3tools/client-runtime/media-source";
import type {
  EnvironmentThreadShell,
  ThreadStructure,
  ThreadStructureTurnItem,
} from "@t3tools/client-runtime/state/models";
import { turnItemOutputImages } from "@t3tools/client-runtime/work-log/item-detail";
import { resolveViewedImageAsset } from "@t3tools/client-runtime/work-log/presentation";
import { chatMarkdownImageSources } from "@t3tools/shared/markdownPipeline";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/mediaPreview";
import { fileBasename, normalizeProjectPathForComparison } from "@t3tools/shared/path";
import { sentMessageFromToolItem } from "@t3tools/shared/toolOutput";
import * as DateTime from "effect/DateTime";

export type MissionControlImageSourceKind =
  | "generated"
  | "created"
  | "tool-output"
  | "embedded"
  | "viewed";

export type MissionControlImageAsset =
  | {
      readonly kind: "resource";
      readonly resource: Extract<
        AssetResource,
        { readonly _tag: "media-file" | "tool-output-image" | "attachment" }
      >;
      readonly srcFragment: string;
      readonly originalUrl?: string;
    }
  | {
      readonly kind: "direct";
      readonly src: string;
      readonly originalUrl?: string;
    };

export interface MissionControlStreamImage {
  readonly id: string;
  readonly index: number;
  readonly runId: RunId | null;
  readonly itemId: TurnItemId | null;
  readonly sourceKind: MissionControlImageSourceKind;
  readonly title: string;
  readonly caption: string | null;
  readonly path: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly revision: number;
  readonly asset: MissionControlImageAsset;
}

export interface MissionControlPendingImage {
  readonly id: string;
  readonly runId: RunId | null;
  readonly label: string | null;
  readonly startedAt: string | null;
  readonly kind: "generating" | "subagent";
}

export type MissionControlImageStreamPhase =
  | "streaming"
  | "active"
  | "complete"
  | "failed"
  | "stopped";

export interface MissionControlImageStreamSummary {
  readonly phase: MissionControlImageStreamPhase;
  readonly runActive: boolean;
  readonly images: ReadonlyArray<MissionControlStreamImage>;
  readonly pending: ReadonlyArray<MissionControlPendingImage>;
  readonly latestImageId: string | null;
  readonly activeRunImageCount: number;
  readonly startedAt: string | null;
  readonly latestActivityAt: string | null;
}

const ACTIVE_RUN_STATUSES = new Set<OrchestrationV2RunStatus>([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

const ACTIVE_ITEM_STATUSES = new Set<ThreadStructureTurnItem["status"]>([
  "pending",
  "running",
  "waiting",
]);

const SOURCE_KIND_PRIORITY: Readonly<Record<MissionControlImageSourceKind, number>> = {
  generated: 5,
  created: 4,
  "tool-output": 3,
  embedded: 2,
  viewed: 1,
};

const IMAGE_GENERATION_TOOL_PATTERN =
  /(?:^|[._:/-\s])(?:image[-_]?gen(?:eration|erator)?|imagegen|image[-_]?edit|generate[-_]?image|create[-_]?image|make[-_]?image|edit[-_]?image|experimental_image_generate|dall[-_]?e|imagen|nano[-_]?banana)(?:$|[._:/-\s])/i;

const IMAGE_WRITE_TOOL_PATTERN =
  /(?:^|[._:/-])(?:write[-_]?file|create[-_]?file|save[-_]?file|write)(?:$|[._:/-])/i;

const IMAGE_GENERATOR_SUBAGENT_PATTERN =
  /\b(?:image[-_\s]?generator|generate\s+(?:an?\s+)?image|create\s+(?:an?\s+)?image)\b/i;

const IMAGE_PATH_FIELD_KEYS = [
  "savedPath",
  "saved_path",
  "outputPath",
  "output_path",
  "screenshotPath",
  "screenshot_path",
  "imagePath",
  "image_path",
  "filePath",
  "file_path",
  "path",
  "Path",
] as const;

const IMAGE_PATH_ARRAY_KEYS = ["savedPaths", "outputPaths", "paths", "files", "images"] as const;

const PROMPT_FIELD_KEYS = ["prompt", "revisedPrompt", "revised_prompt", "brief", "description"] as const;

const ABSOLUTE_OR_FILE_IMAGE_PATH_PATTERN =
  /(?:file:\/\/[^\s"'`<>()[\]]+|(?:\/|[A-Za-z]:[\\/])[^\s"'`<>()[\]]+\.(?:png|jpe?g|webp|gif|avif|svg|bmp|tiff?|heic|heif))/gi;

const SAVED_IMAGE_LINE_PATTERN = /Saved image:\s+(.+?)\s+\([^\n]+\)\./g;

const USER_UPLOAD_PATH_SEGMENT_PATTERN =
  /(?:^|[\\/])(?:\.phoenix|\.t3)[\\/]userdata[\\/]attachments[\\/]|(?:^|[\\/])\.user_uploaded[\\/]/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatOptionalDateTime(value: DateTime.Utc | null | undefined): string | null {
  return value == null ? null : DateTime.formatIso(value);
}

function cleanSingleLine(value: string | null | undefined, maxLength = 160): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized === "") return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function resolveCanonicalPath(path: string, workspaceRoot?: string | null): string {
  const trimmed = path.trim().replace(/^file:\/\//i, "");
  if (
    workspaceRoot &&
    !trimmed.startsWith("/") &&
    !/^[A-Za-z]:[\\/]/.test(trimmed) &&
    !trimmed.startsWith("\\\\")
  ) {
    const base = workspaceRoot.replace(/[\\/]+$/, "");
    const relative = trimmed.replace(/^\.[\\/]/, "");
    return normalizeProjectPathForComparison(`${base}/${relative}`);
  }
  return normalizeProjectPathForComparison(trimmed);
}

function stripTrailingPathPunctuation(candidate: string): string {
  return candidate.replace(/[.,;:!?)}\]]+$/, "").trim();
}

function extractImagePathsFromText(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(SAVED_IMAGE_LINE_PATTERN)) {
    const candidate = match[1]?.trim();
    if (candidate && !/[\r\n]/.test(candidate) && isWorkspaceImagePreviewPath(candidate)) {
      paths.push(candidate);
    }
  }
  for (const match of text.matchAll(ABSOLUTE_OR_FILE_IMAGE_PATH_PATTERN)) {
    const raw = stripTrailingPathPunctuation(match[0]);
    const cleaned = raw.replace(/^file:\/\//i, "");
    if (cleaned && !/[\r\n]/.test(cleaned) && isWorkspaceImagePreviewPath(cleaned)) {
      paths.push(cleaned);
    }
  }
  return paths;
}

function collectImagePathsFromUnknown(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (!/[\r\n]/.test(trimmed) && isWorkspaceImagePreviewPath(trimmed)) {
      return [trimmed];
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return collectImagePathsFromUnknown(JSON.parse(trimmed), depth + 1);
      } catch {
        return extractImagePathsFromText(trimmed);
      }
    }
    return extractImagePathsFromText(trimmed);
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectImagePathsFromUnknown(entry, depth + 1));
  }
  if (!isRecord(value)) return [];

  const found: string[] = [];
  for (const key of IMAGE_PATH_FIELD_KEYS) {
    const field = value[key];
    if (typeof field === "string") {
      const trimmed = field.trim();
      if (trimmed && !/[\r\n]/.test(trimmed) && isWorkspaceImagePreviewPath(trimmed)) {
        found.push(trimmed);
      }
    }
  }
  for (const key of IMAGE_PATH_ARRAY_KEYS) {
    const field = value[key];
    if (field !== undefined) {
      found.push(...collectImagePathsFromUnknown(field, depth + 1));
    }
  }
  if (value.type === "text" && typeof value.text === "string") {
    found.push(...collectImagePathsFromUnknown(value.text, depth + 1));
  }
  if (value.content !== undefined) {
    found.push(...collectImagePathsFromUnknown(value.content, depth + 1));
  }
  if (value.structuredContent !== undefined) {
    found.push(...collectImagePathsFromUnknown(value.structuredContent, depth + 1));
  }
  if (value.result !== undefined) {
    found.push(...collectImagePathsFromUnknown(value.result, depth + 1));
  }
  return found;
}

function extractPromptFromInput(input: unknown): string | null {
  if (!isRecord(input)) return null;
  for (const key of PROMPT_FIELD_KEYS) {
    const value = cleanSingleLine(typeof input[key] === "string" ? input[key] : null);
    if (value !== null) return value;
  }
  return null;
}

function isImageGenerationTool(item: Extract<ThreadStructureTurnItem, { readonly type: "dynamic_tool" }>): boolean {
  if (item.toolName && IMAGE_GENERATION_TOOL_PATTERN.test(item.toolName)) return true;
  if (item.title && IMAGE_GENERATION_TOOL_PATTERN.test(item.title)) return true;
  return false;
}

function isImageWriteTool(item: Extract<ThreadStructureTurnItem, { readonly type: "dynamic_tool" }>): boolean {
  return item.toolName !== null && IMAGE_WRITE_TOOL_PATTERN.test(item.toolName);
}

function isImageGeneratorSubagent(item: Extract<ThreadStructureTurnItem, { readonly type: "subagent" }>): boolean {
  if (item.title && IMAGE_GENERATOR_SUBAGENT_PATTERN.test(item.title)) return true;
  return /\bimage-generator\b/i.test(item.prompt);
}

function isDeletedFileKind(kind: string | undefined): boolean {
  if (!kind) return false;
  const normalized = kind.toLowerCase();
  return normalized === "deleted" || normalized === "delete" || normalized === "removed";
}

function collectUserProvidedImageKeys(
  projection: Pick<ThreadStructure, "messages" | "visibleTurnItems" | "turnItems">,
  workspaceRoot: string | null | undefined,
): ReadonlySet<string> {
  const keys = new Set<string>();
  const recordText = (text: string) => {
    for (const path of extractImagePathsFromText(text)) {
      keys.add(resolveCanonicalPath(path, workspaceRoot));
    }
    for (const src of chatMarkdownImageSources(text)) {
      keys.add(resolveCanonicalPath(src, workspaceRoot));
    }
  };
  for (const message of projection.messages) {
    if (message.role !== "user") continue;
    recordText(message.text);
  }
  for (const row of projection.visibleTurnItems) {
    if (row.item.type === "user_message") recordText(row.item.text);
  }
  for (const item of projection.turnItems) {
    if (item.type === "user_message") recordText(item.text);
  }
  return keys;
}

function isUserProvidedImagePath(
  path: string,
  userProvidedKeys: ReadonlySet<string>,
  workspaceRoot: string | null | undefined,
): boolean {
  if (USER_UPLOAD_PATH_SEGMENT_PATTERN.test(path)) return true;
  return userProvidedKeys.has(resolveCanonicalPath(path, workspaceRoot));
}

function isIgnorableViewedAssetPath(path: string): boolean {
  return path.trim().toLowerCase().endsWith(".ico");
}

interface MutableStreamEntry {
  id: string;
  runId: RunId | null;
  itemId: TurnItemId | null;
  sourceKind: MissionControlImageSourceKind;
  title: string;
  caption: string | null;
  path: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  revision: number;
  lastMutationItemId: TurnItemId | null;
  asset: MissionControlImageAsset;
}

export function deriveMissionControlImageStream(
  projection: Pick<
    ThreadStructure,
    "thread" | "runs" | "messages" | "turnItems" | "visibleTurnItems" | "checkpoints"
  > | null,
  options?: {
    readonly shell?: Pick<EnvironmentThreadShell, "source"> | null;
    readonly workspaceRoot?: string | null | undefined;
  },
): MissionControlImageStreamSummary | null {
  if (projection === null) return null;

  const threadId: ThreadId = projection.thread.id;
  const workspaceRoot = options?.workspaceRoot ?? projection.thread.worktreePath ?? null;
  const runById = new Map(projection.runs.map((run) => [run.id, run] as const));
  const latestRun = projection.runs.reduce<(typeof projection.runs)[number] | null>(
    (best, candidate) => (best === null || candidate.ordinal > best.ordinal ? candidate : best),
    null,
  );
  const activeRunId =
    options?.shell?.source.activeRunId ??
    (latestRun !== null && ACTIVE_RUN_STATUSES.has(latestRun.status) ? latestRun.id : null);
  const runActive =
    activeRunId !== null || (latestRun !== null && ACTIVE_RUN_STATUSES.has(latestRun.status));

  const userProvidedKeys = collectUserProvidedImageKeys(projection, workspaceRoot);
  const messageById = new Map<string, OrchestrationV2ConversationMessage>(
    projection.messages.map((message) => [message.id, message] as const),
  );
  const seenMessageIds = new Set<string>();

  const entries: MutableStreamEntry[] = [];
  const entryById = new Map<string, MutableStreamEntry>();
  const pending: MissionControlPendingImage[] = [];

  const upsertImage = (candidate: {
    readonly id: string;
    readonly runId: RunId | null;
    readonly itemId: TurnItemId | null;
    readonly sourceKind: MissionControlImageSourceKind;
    readonly title: string;
    readonly caption: string | null;
    readonly path: string | null;
    readonly createdAt: string | null;
    readonly updatedAt: string | null;
    readonly asset: MissionControlImageAsset;
  }) => {
    const existing = entryById.get(candidate.id);
    if (!existing) {
      const entry: MutableStreamEntry = {
        ...candidate,
        revision: 1,
        lastMutationItemId:
          candidate.sourceKind === "generated" || candidate.sourceKind === "created"
            ? candidate.itemId
            : null,
      };
      entries.push(entry);
      entryById.set(entry.id, entry);
      return;
    }

    if (SOURCE_KIND_PRIORITY[candidate.sourceKind] > SOURCE_KIND_PRIORITY[existing.sourceKind]) {
      existing.sourceKind = candidate.sourceKind;
    }
    if (candidate.caption && (!existing.caption || existing.sourceKind === "viewed")) {
      existing.caption = candidate.caption;
    }
    if (
      (candidate.sourceKind === "generated" || candidate.sourceKind === "created") &&
      candidate.itemId !== null &&
      candidate.itemId !== existing.lastMutationItemId
    ) {
      existing.revision += 1;
      existing.lastMutationItemId = candidate.itemId;
      existing.updatedAt = candidate.updatedAt ?? candidate.createdAt ?? existing.updatedAt;
      existing.runId = candidate.runId ?? existing.runId;
    }
  };

  const recordWorkspacePath = (input: {
    readonly path: string;
    readonly runId: RunId | null;
    readonly itemId: TurnItemId | null;
    readonly sourceKind: MissionControlImageSourceKind;
    readonly caption?: string | null;
    readonly createdAt: string | null;
    readonly updatedAt: string | null;
    readonly allowUserProvided?: boolean;
  }) => {
    const trimmed = input.path.trim();
    if (!trimmed || /[\r\n]/.test(trimmed) || !isWorkspaceImagePreviewPath(trimmed)) return false;
    if (!input.allowUserProvided && isUserProvidedImagePath(trimmed, userProvidedKeys, workspaceRoot)) {
      return false;
    }
    const resolved = resolveViewedImageAsset(trimmed, { threadId, workspaceRoot });
    if (resolved === null) return false;
    const canonicalKey = `file:${resolveCanonicalPath(resolved.resource.path, workspaceRoot)}`;
    const title = fileBasename(resolved.resource.path) || resolved.alt || trimmed;
    const caption = cleanSingleLine(input.caption ?? null);
    upsertImage({
      id: canonicalKey,
      runId: input.runId,
      itemId: input.itemId,
      sourceKind: input.sourceKind,
      title,
      caption: caption && caption !== title ? caption : null,
      path: resolved.resource.path,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      asset: {
        kind: "resource",
        resource: resolved.resource,
        srcFragment: resolved.srcFragment,
      },
    });
    return true;
  };

  const recordMarkdownImages = (input: {
    readonly markdown: string;
    readonly runId: RunId | null;
    readonly itemId: TurnItemId | null;
    readonly sourceKind: MissionControlImageSourceKind;
    readonly createdAt: string | null;
    readonly updatedAt: string | null;
  }) => {
    if (!input.markdown.includes("![") && !/<img\b/i.test(input.markdown)) return;
    for (const source of chatMarkdownImageSources(input.markdown)) {
      const media = resolveMediaSource(source, {
        threadId,
        workspaceRoot,
        imageEmbed: true,
      });
      if (media === null || media.kind !== "image" || media.access === "unavailable") continue;
      if (media.access === "environment") {
        if (isUserProvidedImagePath(media.resource.path, userProvidedKeys, workspaceRoot)) continue;
        const canonicalKey = `file:${resolveCanonicalPath(media.resource.path, workspaceRoot)}`;
        const title = fileBasename(media.resource.path) || media.name;
        upsertImage({
          id: canonicalKey,
          runId: input.runId,
          itemId: input.itemId,
          sourceKind: input.sourceKind,
          title,
          caption: null,
          path: media.resource.path,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          asset: {
            kind: "resource",
            resource: media.resource,
            srcFragment: media.srcFragment,
          },
        });
      } else {
        const key = `direct:${media.uri}`;
        upsertImage({
          id: key,
          runId: input.runId,
          itemId: input.itemId,
          sourceKind: input.sourceKind,
          title: media.name,
          caption: null,
          path: null,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          asset: {
            kind: "direct",
            src: media.uri + media.srcFragment,
            originalUrl: media.uri,
          },
        });
      }
    }
  };

  const orderedItems: ReadonlyArray<ThreadStructureTurnItem> =
    projection.visibleTurnItems.length > 0
      ? projection.visibleTurnItems.map((row) => row.item)
      : projection.turnItems;

  const sortedItems = [...orderedItems].toSorted((left, right) => {
    const leftRun = left.runId === null ? -1 : (runById.get(left.runId)?.ordinal ?? -1);
    const rightRun = right.runId === null ? -1 : (runById.get(right.runId)?.ordinal ?? -1);
    if (leftRun !== rightRun) return leftRun - rightRun;
    return left.ordinal - right.ordinal;
  });

  for (const item of sortedItems) {
    const createdAt = formatOptionalDateTime(item.completedAt ?? item.startedAt);
    const updatedAt = formatOptionalDateTime(
      "updatedAt" in item ? item.updatedAt : (item.completedAt ?? item.startedAt),
    );
    const startedAt = formatOptionalDateTime(item.startedAt);
    const failed = item.status === "failed" || item.status === "cancelled";

    switch (item.type) {
      case "dynamic_tool": {
        const isImageGen = isImageGenerationTool(item);
        const promptCaption = extractPromptFromInput(item.input) ?? cleanSingleLine(item.title);
        if (isImageGen && ACTIVE_ITEM_STATUSES.has(item.status) && runActive) {
          pending.push({
            id: item.id,
            runId: item.runId,
            label: promptCaption,
            startedAt,
            kind: "generating",
          });
          break;
        }
        if (failed) break;

        let savedCount = 0;
        const outputPaths = collectImagePathsFromUnknown(item.output);
        for (const path of outputPaths) {
          if (
            recordWorkspacePath({
              path,
              runId: item.runId,
              itemId: item.id,
              sourceKind: isImageGen ? "generated" : "created",
              caption: promptCaption,
              createdAt,
              updatedAt,
            })
          ) {
            savedCount += 1;
          }
        }

        if (savedCount === 0 && (isImageGen || isImageWriteTool(item)) && item.status === "completed") {
          for (const path of collectImagePathsFromUnknown(item.input)) {
            if (
              recordWorkspacePath({
                path,
                runId: item.runId,
                itemId: item.id,
                sourceKind: isImageGen ? "generated" : "created",
                caption: promptCaption,
                createdAt,
                updatedAt,
              })
            ) {
              savedCount += 1;
            }
          }
        }

        const inlineImages = turnItemOutputImages(item);
        if (inlineImages.length > 0 && savedCount === 0) {
          for (const resource of inlineImages) {
            const title = cleanSingleLine(item.title) ?? cleanSingleLine(item.toolName) ?? "Captured image";
            upsertImage({
              id: `tool-output:${item.id}:${resource.index}`,
              runId: item.runId,
              itemId: item.id,
              sourceKind: isImageGen ? "generated" : "tool-output",
              title,
              caption: promptCaption && promptCaption !== title ? promptCaption : null,
              path: null,
              createdAt,
              updatedAt,
              asset: {
                kind: "resource",
                resource,
                srcFragment: "",
              },
            });
          }
        }

        const sentMessage = sentMessageFromToolItem(item);
        if (sentMessage) {
          recordMarkdownImages({
            markdown: sentMessage,
            runId: item.runId,
            itemId: item.id,
            sourceKind: "embedded",
            createdAt,
            updatedAt,
          });
        }

        if (
          item.viewedImagePath &&
          !isIgnorableViewedAssetPath(item.viewedImagePath)
        ) {
          recordWorkspacePath({
            path: item.viewedImagePath,
            runId: item.runId,
            itemId: item.id,
            sourceKind: "viewed",
            caption: cleanSingleLine(item.title),
            createdAt,
            updatedAt,
          });
        }
        break;
      }

      case "file_change": {
        if (failed) break;
        const candidatePaths: string[] = [];
        if (item.changes && item.changes.length > 0) {
          for (const change of item.changes) {
            if (!isDeletedFileKind(change.operation)) {
              candidatePaths.push(change.path);
            }
          }
        } else {
          candidatePaths.push(item.fileName);
        }
        for (const path of candidatePaths) {
          recordWorkspacePath({
            path,
            runId: item.runId,
            itemId: item.id,
            sourceKind: "created",
            caption: cleanSingleLine(item.title),
            createdAt,
            updatedAt,
          });
        }
        break;
      }

      case "checkpoint": {
        if (failed) break;
        for (const file of item.files) {
          if (isDeletedFileKind(file.kind)) continue;
          recordWorkspacePath({
            path: file.path,
            runId: item.runId,
            itemId: item.id,
            sourceKind: "created",
            createdAt,
            updatedAt,
          });
        }
        break;
      }

      case "subagent": {
        const isImageSubagent = isImageGeneratorSubagent(item);
        if (isImageSubagent && ACTIVE_ITEM_STATUSES.has(item.status) && runActive) {
          pending.push({
            id: item.id,
            runId: item.runId,
            label: cleanSingleLine(item.prompt) ?? cleanSingleLine(item.title),
            startedAt,
            kind: "subagent",
          });
        }
        if (failed || !item.result) break;
        const caption = cleanSingleLine(item.prompt) ?? cleanSingleLine(item.title);
        recordMarkdownImages({
          markdown: item.result,
          runId: item.runId,
          itemId: item.id,
          sourceKind: isImageSubagent ? "generated" : "embedded",
          createdAt,
          updatedAt,
        });
        for (const path of extractImagePathsFromText(item.result)) {
          recordWorkspacePath({
            path,
            runId: item.runId,
            itemId: item.id,
            sourceKind: isImageSubagent ? "generated" : "created",
            caption,
            createdAt,
            updatedAt,
          });
        }
        break;
      }

      case "assistant_message": {
        seenMessageIds.add(item.messageId);
        const message = messageById.get(item.messageId);
        const attachments = item.attachments ?? message?.attachments ?? [];
        for (const attachment of attachments) {
          if (attachment.type !== "image") continue;
          upsertImage({
            id: `attachment:${attachment.id}`,
            runId: item.runId,
            itemId: item.id,
            sourceKind: "generated",
            title: attachment.name,
            caption: null,
            path: null,
            createdAt: formatOptionalDateTime(message?.createdAt) ?? createdAt,
            updatedAt: formatOptionalDateTime(message?.updatedAt) ?? updatedAt,
            asset: {
              kind: "resource",
              resource: { _tag: "attachment", attachmentId: attachment.id },
              srcFragment: "",
            },
          });
        }
        if (message && message.text) {
          recordMarkdownImages({
            markdown: message.text,
            runId: item.runId,
            itemId: item.id,
            sourceKind: "embedded",
            createdAt: formatOptionalDateTime(message.createdAt) ?? createdAt,
            updatedAt: formatOptionalDateTime(message.updatedAt) ?? updatedAt,
          });
        }
        break;
      }

      default:
        break;
    }
  }

  for (const message of projection.messages) {
    if (message.role !== "assistant" || seenMessageIds.has(message.id)) continue;
    const msgCreatedAt = formatOptionalDateTime(message.createdAt);
    const msgUpdatedAt = formatOptionalDateTime(message.updatedAt);
    for (const attachment of message.attachments) {
      if (attachment.type !== "image") continue;
      upsertImage({
        id: `attachment:${attachment.id}`,
        runId: message.runId,
        itemId: null,
        sourceKind: "generated",
        title: attachment.name,
        caption: null,
        path: null,
        createdAt: msgCreatedAt,
        updatedAt: msgUpdatedAt,
        asset: {
          kind: "resource",
          resource: { _tag: "attachment", attachmentId: attachment.id },
          srcFragment: "",
        },
      });
    }
    if (message.text) {
      recordMarkdownImages({
        markdown: message.text,
        runId: message.runId,
        itemId: null,
        sourceKind: "embedded",
        createdAt: msgCreatedAt,
        updatedAt: msgUpdatedAt,
      });
    }
  }

  if (entries.length === 0 && pending.length === 0) return null;

  const images: MissionControlStreamImage[] = entries.map((entry, idx) => ({
    id: entry.id,
    index: idx + 1,
    runId: entry.runId,
    itemId: entry.itemId,
    sourceKind: entry.sourceKind,
    title: entry.title,
    caption: entry.caption,
    path: entry.path,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    revision: entry.revision,
    asset: entry.asset,
  }));

  const activeRunImageCount =
    activeRunId === null
      ? 0
      : images.filter((image) => image.runId === activeRunId).length;

  const phase: MissionControlImageStreamPhase =
    pending.length > 0 || (runActive && activeRunImageCount > 0)
      ? "streaming"
      : runActive
        ? "active"
        : latestRun?.status === "failed"
          ? "failed"
          : latestRun?.status === "interrupted" || latestRun?.status === "cancelled"
            ? "stopped"
            : "complete";

  const latestImage = images.at(-1) ?? null;
  const startedAt =
    images[0]?.createdAt ??
    pending[0]?.startedAt ??
    formatOptionalDateTime(latestRun?.startedAt);
  const latestActivityAt =
    pending.at(-1)?.startedAt ??
    latestImage?.updatedAt ??
    latestImage?.createdAt ??
    formatOptionalDateTime(latestRun?.completedAt ?? latestRun?.startedAt);

  return {
    phase,
    runActive,
    images,
    pending,
    latestImageId: latestImage?.id ?? null,
    activeRunImageCount,
    startedAt,
    latestActivityAt,
  };
}

export const MISSION_CONTROL_IMAGES_DOCK_MIN_WIDTH = 680;
export const MISSION_CONTROL_DUAL_SIDEBAR_MIN_WIDTH = 1240;

export interface MissionControlSidebarsState {
  readonly tasksVisible: boolean;
  readonly imagesVisible: boolean;
  readonly tasksMode: "docked" | "overlay";
  readonly imagesMode: "docked" | "overlay";
  readonly dockedSidebarCount: number;
}

export function resolveMissionControlSidebars(input: {
  readonly hasTasks: boolean;
  readonly hasImages: boolean;
  readonly imagesStreaming: boolean;
  readonly windowWidth: number;
  readonly savedTasksOpen: boolean | undefined;
  readonly savedImagesOpen: boolean | undefined;
  readonly preferredSidebar: "tasks" | "images" | undefined;
}): MissionControlSidebarsState {
  const canDock = input.windowWidth >= MISSION_CONTROL_IMAGES_DOCK_MIN_WIDTH;
  const canDockBoth = input.windowWidth >= MISSION_CONTROL_DUAL_SIDEBAR_MIN_WIDTH;

  const wantsTasks =
    input.hasTasks &&
    (typeof input.savedTasksOpen === "boolean" ? input.savedTasksOpen : canDock);
  const wantsImages =
    input.hasImages &&
    (typeof input.savedImagesOpen === "boolean" ? input.savedImagesOpen : canDock);

  if (!wantsTasks && !wantsImages) {
    return {
      tasksVisible: false,
      imagesVisible: false,
      tasksMode: canDock ? "docked" : "overlay",
      imagesMode: canDock ? "docked" : "overlay",
      dockedSidebarCount: 0,
    };
  }

  if (wantsTasks && wantsImages && !canDockBoth) {
    // Only one right-hand sidebar fits alongside the conversation below the dual-dock width.
    const preferImages =
      input.preferredSidebar === "images"
        ? true
        : input.preferredSidebar === "tasks"
          ? false
          : input.imagesStreaming || input.savedImagesOpen === true || input.savedTasksOpen !== true;
    return {
      tasksVisible: !preferImages,
      imagesVisible: preferImages,
      tasksMode: canDock ? "docked" : "overlay",
      imagesMode: canDock ? "docked" : "overlay",
      dockedSidebarCount: canDock ? 1 : 0,
    };
  }

  return {
    tasksVisible: wantsTasks,
    imagesVisible: wantsImages,
    tasksMode: canDock ? "docked" : "overlay",
    imagesMode: canDock ? "docked" : "overlay",
    dockedSidebarCount: canDock ? (wantsTasks ? 1 : 0) + (wantsImages ? 1 : 0) : 0,
  };
}

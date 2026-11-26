import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { formatDuration } from "@t3tools/shared/orchestrationTimingCopy";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { useGT, useMessages } from "gt-react";
import {
  ArrowDownIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ImagePlusIcon,
  ImagesIcon,
  LayoutGridIcon,
  PanelRightCloseIcon,
  Rows2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAssetUrls } from "../../assets/assetUrls";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { tickTextContent } from "../../lib/tickTextContent";
import { cn } from "../../lib/utils";
import type { MissionControlImageStreamLayout } from "../../missionControlWindowStore";
import { formatShortTimestamp } from "../../timestampFormat";
import {
  assetMediaActionsSource,
  ChatMarkdownAssetImage,
  ChatMarkdownImage,
} from "../chat/ChatMarkdownMedia";
import { openExpandedImagePreview } from "../chat/ExpandedImageDialog";
import type { ExpandedImageItem, ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import type {
  MissionControlImageSourceKind,
  MissionControlImageStreamPhase,
  MissionControlImageStreamSummary,
  MissionControlPendingImage,
  MissionControlStreamImage,
} from "./missionControlImages.logic";

function phaseBadgeVariant(phase: MissionControlImageStreamPhase) {
  switch (phase) {
    case "streaming":
      return "default" as const;
    case "active":
      return "secondary" as const;
    case "complete":
      return "success" as const;
    case "failed":
      return "error" as const;
    case "stopped":
      return "warning" as const;
  }
}

function LiveElapsed({
  anchorIso,
  className,
}: {
  readonly anchorIso: string;
  readonly className?: string;
}) {
  const resolve = useMessages();
  const anchorMs = Date.parse(anchorIso);
  if (!Number.isFinite(anchorMs)) return null;
  return (
    <span
      ref={tickTextContent(
        (nowMs) => formatDuration(Math.max(1_000, nowMs - anchorMs), resolve),
        true,
      )}
      className={cn("font-mono text-2xs tabular-nums", className)}
    />
  );
}

function useSourceKindLabel(sourceKind: MissionControlImageSourceKind): string {
  const gt = useGT();
  switch (sourceKind) {
    case "generated":
      return gt("Generated", { $context: "image stream origin" });
    case "created":
      return gt("Created", { $context: "image stream origin" });
    case "tool-output":
      return gt("Captured", { $context: "image stream origin" });
    case "embedded":
      return gt("Embedded", { $context: "image stream origin" });
    case "viewed":
      return gt("Inspected", { $context: "image stream origin" });
  }
}

function ImageStreamFrame({
  image,
  threadRef,
  workspaceRoot,
  workspaceMutationId,
  layout,
  isLatestLive,
  timestampFormat,
  onExpand,
}: {
  readonly image: MissionControlStreamImage;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceRoot: string | undefined;
  readonly workspaceMutationId: string | null;
  readonly layout: MissionControlImageStreamLayout;
  readonly isLatestLive: boolean;
  readonly timestampFormat: TimestampFormat;
  readonly onExpand: (imageId: string, preview: ExpandedImagePreview) => void;
}) {
  const gt = useGT();
  const sourceLabel = useSourceKindLabel(image.sourceKind);
  const sequenceLabel = `#${String(image.index).padStart(2, "0")}`;
  const revisionKey =
    image.asset.kind === "resource" && image.asset.resource._tag === "media-file"
      ? `${workspaceMutationId ?? ""}:rev:${image.revision}`
      : undefined;
  const formattedTime = image.createdAt
    ? formatShortTimestamp(image.createdAt, timestampFormat)
    : null;

  const mediaElement =
    image.asset.kind === "resource" ? (
      <ChatMarkdownAssetImage
        environmentId={threadRef.environmentId}
        resource={image.asset.resource}
        alt={image.caption ?? image.title}
        srcFragment={image.asset.srcFragment}
        originalUrl={image.asset.originalUrl}
        workspaceRoot={workspaceRoot}
        workspaceMutationId={revisionKey}
        framed={false}
        maxHeightRem={layout === "grid" ? 12 : 16}
        className={cn(
          "block w-full transition-opacity duration-200 starting:opacity-0",
          layout === "grid"
            ? "aspect-square h-full object-cover"
            : "max-h-60 min-h-24 object-contain",
        )}
        onImageExpand={(preview) => onExpand(image.id, preview)}
      />
    ) : (
      <ChatMarkdownImage
        src={image.asset.src}
        alt={image.caption ?? image.title}
        copyMarkdown={undefined}
        standalone
        originalUrl={image.asset.originalUrl}
        actionsSource={{
          kind: "image",
          name: image.title,
          src: image.asset.src,
        }}
        className={cn(
          "block w-full transition-opacity duration-200 starting:opacity-0",
          layout === "grid"
            ? "aspect-square h-full object-cover"
            : "max-h-60 min-h-24 object-contain",
        )}
        onImageExpand={(preview) => onExpand(image.id, preview)}
      />
    );

  if (layout === "grid") {
    return (
      <li
        data-testid="mission-control-image-frame"
        data-image-index={image.index}
        data-image-latest={isLatestLive ? "true" : undefined}
        className="min-w-0"
      >
        <div
          className={cn(
            "group relative overflow-hidden rounded-md border bg-background/85 transition-colors",
            isLatestLive ? "border-primary" : "border-border/75 hover:border-border",
          )}
        >
          <div className="aspect-square w-full overflow-hidden">{mediaElement}</div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-1.5 pt-4 pb-1 text-2xs text-white/95">
            <span className="font-mono font-semibold tabular-nums">{sequenceLabel}</span>
            {formattedTime ? (
              <span className="truncate font-mono tabular-nums text-white/75">{formattedTime}</span>
            ) : null}
          </div>
          {isLatestLive ? (
            <span className="pointer-events-none absolute top-1.5 left-1.5 rounded-sm bg-primary px-1.5 py-0.5 font-mono text-2xs leading-none font-semibold tracking-wide text-primary-foreground uppercase">
              {gt("New", { $context: "latest streamed image badge" })}
            </span>
          ) : null}
        </div>
        <p className="mt-1 truncate text-2xs font-medium text-foreground">{image.title}</p>
      </li>
    );
  }

  return (
    <li
      data-testid="mission-control-image-frame"
      data-image-index={image.index}
      data-image-latest={isLatestLive ? "true" : undefined}
      className={cn(
        "flex flex-col gap-2 border-b border-border/70 px-3 py-3 transition-colors last:border-b-0",
        isLatestLive && "bg-accent/35",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "font-mono text-2xs font-semibold tabular-nums",
              isLatestLive ? "text-primary" : "text-muted-foreground",
            )}
          >
            {sequenceLabel}
          </span>
          <span className="text-2xs text-muted-foreground">{sourceLabel}</span>
          {isLatestLive ? (
            <Badge size="sm" variant="default">
              {gt("Latest", { $context: "newest image in active stream" })}
            </Badge>
          ) : null}
        </div>
        {formattedTime ? (
          <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
            {formattedTime}
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          "relative flex min-h-24 w-full items-center justify-center overflow-hidden rounded-md border bg-background/85",
          isLatestLive ? "border-primary/80" : "border-border/75",
        )}
      >
        {mediaElement}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-xs font-medium text-foreground">{image.title}</p>
        {image.caption ? (
          <p className="line-clamp-2 text-2xs leading-snug text-muted-foreground">
            {image.caption}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function PendingImageFrame({
  pending,
  sequenceIndex,
  layout,
}: {
  readonly pending: MissionControlPendingImage;
  readonly sequenceIndex: number;
  readonly layout: MissionControlImageStreamLayout;
}) {
  const gt = useGT();
  const sequenceLabel = `#${String(sequenceIndex).padStart(2, "0")}`;
  const label =
    pending.label ??
    (pending.kind === "subagent"
      ? gt("Image generator", { $context: "pending image generation fallback label" })
      : gt("Generate image", { $context: "pending image generation fallback label" }));

  if (layout === "grid") {
    return (
      <li data-testid="mission-control-image-pending" className="flex min-w-0 flex-col">
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-primary/70 bg-accent/40 p-3 text-center">
          <span className="text-primary">
            <Spinner size="sm" />
          </span>
          <span className="font-mono text-2xs font-semibold tabular-nums text-primary">
            {sequenceLabel}
          </span>
          {pending.startedAt ? (
            <LiveElapsed anchorIso={pending.startedAt} className="text-muted-foreground" />
          ) : null}
        </div>
        <p className="mt-1 truncate text-2xs text-muted-foreground">{label}</p>
      </li>
    );
  }

  return (
    <li
      data-testid="mission-control-image-pending"
      className="flex flex-col gap-2 border-b border-border/70 bg-accent/35 px-3 py-3 last:border-b-0"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-2xs font-semibold tabular-nums text-primary">
            {sequenceLabel}
          </span>
          <span className="inline-flex items-center gap-1 text-2xs font-medium text-primary">
            <ImagePlusIcon className="size-3 shrink-0" aria-hidden />
            {gt("Generating…")}
          </span>
        </div>
        {pending.startedAt ? (
          <LiveElapsed anchorIso={pending.startedAt} className="shrink-0 text-primary" />
        ) : null}
      </div>

      <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-primary/65 bg-background/70 px-4 py-5 text-center">
        <span className="text-primary">
          <Spinner size="md" />
        </span>
        <p className="line-clamp-2 text-xs text-foreground/90">{label}</p>
      </div>
    </li>
  );
}

export function MissionControlImageStreamSidebar({
  id,
  threadRef,
  workspaceRoot,
  workspaceMutationId,
  summary,
  layout,
  mode,
  wide,
  onLayoutChange,
  onClose,
}: {
  readonly id: string;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceRoot: string | undefined;
  readonly workspaceMutationId: string | null;
  readonly summary: MissionControlImageStreamSummary;
  readonly layout: MissionControlImageStreamLayout;
  readonly mode: "docked" | "overlay";
  readonly wide: boolean;
  readonly onLayoutChange: (layout: MissionControlImageStreamLayout) => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const threadKey = scopedThreadKey(threadRef);
  const settings = useEnvironmentSettings(threadRef.environmentId);
  const scrollRef = useRef<HTMLOListElement>(null);

  const isLive = summary.phase === "streaming" || summary.phase === "active";
  const isStreaming = summary.phase === "streaming";
  const streamEndKey = `${summary.images.length}:${summary.latestImageId ?? ""}:${summary.pending.length}`;

  const [nearBottom, setNearBottom] = useState(true);
  const [seenStreamKey, setSeenStreamKey] = useState(streamEndKey);
  if (nearBottom && seenStreamKey !== streamEndKey) {
    setSeenStreamKey(streamEndKey);
  }
  const hasUnseenLatest = !nearBottom && isLive && seenStreamKey !== streamEndKey;

  const resourceImages = summary.images.flatMap((image) =>
    image.asset.kind === "resource" ? [{ image, resource: image.asset.resource }] : [],
  );
  const resolvedResourceUrls = useAssetUrls(
    threadRef.environmentId,
    resourceImages.map((entry) => entry.resource),
  );
  const urlByImageId = new Map<string, string | null>();
  for (let idx = 0; idx < resourceImages.length; idx += 1) {
    const entry = resourceImages[idx];
    if (entry) {
      urlByImageId.set(entry.image.id, resolvedResourceUrls[idx] ?? null);
    }
  }

  const handleExpand = (clickedImageId: string, preview: ExpandedImagePreview) => {
    const clickedPreview = preview.images[preview.index];
    const gallery: ExpandedImageItem[] = [];
    let selectedIndex = -1;
    for (const image of summary.images) {
      if (image.id === clickedImageId && clickedPreview) {
        selectedIndex = gallery.length;
        gallery.push({ ...clickedPreview, name: image.title });
        continue;
      }
      if (image.asset.kind === "direct") {
        gallery.push({
          src: image.asset.src,
          name: image.title,
          ...(image.asset.originalUrl ? { originalUrl: image.asset.originalUrl } : {}),
          actionsSource: {
            kind: "image",
            name: image.title,
            src: image.asset.src,
          },
        });
      } else {
        const url = urlByImageId.get(image.id) ?? null;
        if (!url) continue;
        const src = url + image.asset.srcFragment;
        gallery.push({
          src,
          name: image.title,
          ...(image.asset.originalUrl ? { originalUrl: image.asset.originalUrl } : {}),
          actionsSource: assetMediaActionsSource({
            environmentId: threadRef.environmentId,
            resource: image.asset.resource,
            kind: "image",
            name: image.title,
            src,
            workspaceRoot,
            originalUrl: image.asset.originalUrl,
          }),
        });
      }
    }
    const nextPreview: ExpandedImagePreview =
      selectedIndex >= 0 ? { images: gallery, index: selectedIndex } : preview;
    openExpandedImagePreview(threadKey, nextPreview);
  };

  const scrollToLatest = (behavior: ScrollBehavior = "smooth") => {
    const list = scrollRef.current;
    if (!list) return;
    setNearBottom(true);
    setSeenStreamKey(streamEndKey);
    list.scrollTo({ top: list.scrollHeight, behavior });
  };

  const handleScroll = () => {
    const list = scrollRef.current;
    if (!list) return;
    const distanceFromBottom = list.scrollHeight - list.clientHeight - list.scrollTop;
    const atBottom = distanceFromBottom <= 48;
    setNearBottom(atBottom);
    if (atBottom) {
      setSeenStreamKey(streamEndKey);
    }
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes DOM scroll offset with the latest appended stream frame when auto-follow is active
  useEffect(() => {
    const list = scrollRef.current;
    if (!list || !nearBottom || streamEndKey === "") return;
    list.scrollTo({ top: list.scrollHeight, behavior: "auto" });
  }, [nearBottom, streamEndKey]);

  const phaseLabel =
    summary.phase === "streaming"
      ? summary.pending.length > 0
        ? gt("Generating", { $context: "image stream status" })
        : gt("Live", { $context: "image stream status" })
      : summary.phase === "active"
        ? gt("Working", { $context: "image stream status" })
        : summary.phase === "complete"
          ? gt("Ready", { $context: "image stream status" })
          : summary.phase === "failed"
            ? gt("Failed", { $context: "image stream status" })
            : gt("Stopped", { $context: "image stream status" });

  const countLabel = gt("{count, plural, one {{count} image} other {{count} images}}", {
    count: summary.images.length,
  });

  const footerLabel =
    summary.pending.length > 0
      ? gt("Generating into stream")
      : summary.phase === "streaming"
        ? gt("Streaming images live")
        : summary.phase === "active"
          ? gt("Watching for new images")
          : summary.phase === "failed"
            ? gt("Ended with error")
            : summary.phase === "stopped"
              ? gt("Stopped early")
              : gt("Chronological stream");

  const panel = (
    <aside
      id={id}
      aria-label={gt("Created image stream")}
      data-testid="mission-control-image-stream-sidebar"
      data-image-stream-phase={summary.phase}
      onKeyDown={
        mode === "overlay"
          ? (event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
              }
            }
          : undefined
      }
      className={cn(
        "relative flex h-full min-h-0 flex-col border-l border-border bg-card text-card-foreground",
        mode === "overlay"
          ? "absolute inset-y-0 right-0 z-20 w-[min(22rem,calc(100%-2rem))] shadow-xl"
          : wide
            ? "w-88 shrink-0"
            : "w-80 shrink-0",
      )}
    >
      <div className="relative flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-0.5 transition-colors",
            isStreaming ? "bg-primary" : isLive ? "bg-primary/50" : "bg-transparent",
          )}
        />
        <div className="flex min-w-0 items-center gap-1.5">
          <ImagesIcon
            className={cn(
              "size-3.5 shrink-0",
              isLive
                ? "text-primary"
                : summary.phase === "complete"
                  ? "text-success"
                  : "text-muted-foreground",
            )}
            aria-hidden
          />
          <h3 className="truncate text-xs font-semibold tracking-tight text-foreground">
            {gt("Image stream")}
          </h3>
          <Badge size="sm" variant={phaseBadgeVariant(summary.phase)}>
            {phaseLabel}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            size="icon-xs"
            variant={layout === "stream" ? "secondary" : "ghost"}
            aria-label={gt("Stream view")}
            aria-pressed={layout === "stream"}
            onClick={() => onLayoutChange("stream")}
          >
            <Rows2Icon aria-hidden />
          </Button>
          <Button
            size="icon-xs"
            variant={layout === "grid" ? "secondary" : "ghost"}
            aria-label={gt("Contact sheet grid")}
            aria-pressed={layout === "grid"}
            onClick={() => onLayoutChange("grid")}
          >
            <LayoutGridIcon aria-hidden />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={gt("Hide image stream")}
            onClick={onClose}
          >
            <PanelRightCloseIcon aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background/40 px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            data-testid="mission-control-image-stream-count"
            className="font-mono text-xs font-semibold tabular-nums text-foreground"
          >
            {countLabel}
          </span>
          <span className="truncate text-2xs text-muted-foreground">
            {gt("Chronological", { $context: "image stream ordering" })}
          </span>
        </div>
        {summary.pending.length > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-2xs font-medium tabular-nums text-primary">
            <Spinner size="xs" />
            {gt("{count} generating", { count: summary.pending.length })}
          </span>
        ) : summary.runActive && summary.activeRunImageCount > 0 ? (
          <span className="shrink-0 font-mono text-2xs font-medium tabular-nums text-primary">
            {gt("+{count} live", { count: summary.activeRunImageCount })}
          </span>
        ) : null}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <ol
          ref={scrollRef}
          onScroll={handleScroll}
          data-image-gallery
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            layout === "grid" && "grid auto-rows-max grid-cols-2 gap-2.5 p-2.5",
          )}
        >
          {summary.images.map((image) => (
            <ImageStreamFrame
              key={image.id}
              image={image}
              threadRef={threadRef}
              workspaceRoot={workspaceRoot}
              workspaceMutationId={workspaceMutationId}
              layout={layout}
              isLatestLive={
                isLive && summary.pending.length === 0 && image.id === summary.latestImageId
              }
              timestampFormat={settings.timestampFormat}
              onExpand={handleExpand}
            />
          ))}
          {summary.pending.map((pending, idx) => (
            <PendingImageFrame
              key={pending.id}
              pending={pending}
              sequenceIndex={summary.images.length + idx + 1}
              layout={layout}
            />
          ))}
        </ol>

        {hasUnseenLatest ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <div className="pointer-events-auto">
              <Button size="xs" variant="default" onClick={() => scrollToLatest("smooth")}>
                <ArrowDownIcon aria-hidden />
                <span>{gt("Jump to latest")}</span>
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-background/40 px-3 py-2 text-2xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {isLive ? (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          ) : summary.phase === "complete" ? (
            <CheckCircle2Icon className="size-3 shrink-0 text-success" aria-hidden />
          ) : summary.phase === "failed" ? (
            <CircleAlertIcon className="size-3 shrink-0 text-destructive" aria-hidden />
          ) : (
            <CircleAlertIcon className="size-3 shrink-0 text-warning" aria-hidden />
          )}
          <span className="truncate">{footerLabel}</span>
        </span>
        {summary.runActive && summary.startedAt !== null ? (
          <LiveElapsed anchorIso={summary.startedAt} className="shrink-0 text-muted-foreground" />
        ) : summary.latestActivityAt !== null ? (
          <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
            {formatShortTimestamp(summary.latestActivityAt, settings.timestampFormat)}
          </span>
        ) : null}
      </div>
    </aside>
  );

  if (mode === "overlay") {
    return (
      <>
        <div
          aria-hidden
          className="absolute inset-0 z-10 bg-background/50"
          onClick={onClose}
        />
        {panel}
      </>
    );
  }

  return panel;
}

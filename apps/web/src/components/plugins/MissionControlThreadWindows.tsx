import {
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { useGT } from "gt-react";
import * as Schema from "effect/Schema";
import { GripIcon, Maximize2Icon, Minimize2Icon, MinusIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useMissionControlStore, type MissionControlWindow } from "../../missionControlStore";
import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { ComposerHandleContext } from "../../composerHandleContext";
import { NewThreadHandlerContext } from "../../hooks/useHandleNewThread";
import { useMissionControlNewThread } from "../../hooks/useMissionControlNewThread";
import {
  fitMissionControlWindow,
  useMissionControlWindowStore,
  type MissionControlWindowBounds,
} from "../../missionControlWindowStore";
import { useProject, useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { pluginViewAtom } from "../../state/mcpApps";
import { cn } from "../../lib/utils";
import { observeResize } from "../../lib/observeResize";
import { Button } from "../ui/button";
import { MissionControlReviewDesk } from "./MissionControlReviewDesk";
import ChatView from "../ChatView";
import { BackgroundThreadContext, HiddenThreadContext } from "../chat/backgroundThread";

function useWindowDraft(window: MissionControlWindow) {
  const draft = useComposerDraftStore((state) =>
    window.draftId ? state.getDraftSession(window.draftId) : null,
  );
  const redirect = useComposerDraftStore((state) =>
    window.draftId ? state.getPromotedDraftRedirect(window.draftId) : null,
  );
  const threadRef = draft
    ? scopeThreadRef(draft.environmentId, draft.threadId)
    : (redirect ?? window.threadRef);
  return { draft, threadRef };
}

function ThreadWindowLabel({ window }: { window: MissionControlWindow }) {
  const gt = useGT();
  const { draft, threadRef } = useWindowDraft(window);
  const shell = useQuietThreadShell(threadRef);
  const project = useProject(draft ? scopeProjectRef(draft.environmentId, draft.projectId) : null);
  return draft && !draft.promotedTo ? (
    <>
      {gt("New thread")}
      {project ? ` · ${project.title}` : ""}
    </>
  ) : (
    (shell?.title ?? gt("Review thread"))
  );
}

const hasInstanceId = Schema.is(Schema.Struct({ instanceId: Schema.String }));

function MissionControlDraftContent({
  window,
  active,
  visible,
  windowWidth,
}: {
  window: MissionControlWindow;
  active: boolean;
  visible: boolean;
  windowWidth: number;
}) {
  const gt = useGT();
  const { draft, threadRef } = useWindowDraft(window);
  const openDraft = useMissionControlNewThread();
  // A native draft can move to another machine through its project picker or load balancing.
  const view = useEnvironmentQuery(
    draft
      ? null
      : pluginViewAtom(
          JSON.stringify([threadRef.environmentId, "mission-control", "dashboard", null]),
        ),
  );
  if (!draft || !window.draftId) {
    if (view.error)
      return (
        <div className="flex flex-col items-start gap-3 p-5">
          <p role="alert" className="text-sm">
            {gt("The plugin is unavailable. Check that it is enabled and try again.")}
          </p>
          <Button variant="outline" onClick={() => view.refresh()}>
            {gt("Retry")}
          </Button>
        </div>
      );
    return hasInstanceId(view.data) ? (
      <MissionControlReviewDesk
        threadRef={threadRef}
        instanceId={view.data.instanceId}
        active={active}
        visible={visible}
        windowWidth={windowWidth}
      />
    ) : (
      <p role="status" className="p-5 text-sm text-muted-foreground">
        {gt("Loading…")}
      </p>
    );
  }
  return (
    <NewThreadHandlerContext
      value={(projectRef, options) =>
        openDraft(projectRef, window.instanceId, options, scopedThreadKey(window.threadRef))
      }
    >
      <BackgroundThreadContext value>
        <HiddenThreadContext value={!active}>
          <ComposerHandleContext value={null}>
            {/* Contain the native workspace's fixed panel controls inside this window. */}
            <div className="relative flex h-full min-h-0 flex-col [contain:layout] [--workspace-controls-top:0px] [--workspace-controls-right:0.5rem] [&_[data-chat-header]]:pr-28">
              <ChatView
                environmentId={draft.environmentId}
                threadId={draft.threadId}
                routeKind="draft"
                draftId={window.draftId}
                reserveTitleBarControlInset={false}
              />
            </div>
          </ComposerHandleContext>
        </HiddenThreadContext>
      </BackgroundThreadContext>
    </NewThreadHandlerContext>
  );
}

export function MissionControlThreadWindows({ active }: { active: boolean }) {
  const gt = useGT();
  const { windows, focusedKey, focusWindow, minimizeWindow, closeWindow } =
    useMissionControlStore();
  const layer = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window bounds follow the actual workspace, including sidebar and browser resizing.
  useEffect(() => {
    const element = layer.current;
    if (!element) return;
    return observeResize(element, ([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0)
        setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
  }, []);
  return (
    <>
      <div ref={layer} className="pointer-events-none absolute inset-x-0 top-0 bottom-10 isolate">
        {viewport.width > 0 &&
          windows.map((window, index) => {
            const key = scopedThreadKey(window.threadRef);
            return (
              <MissionControlThreadWindow
                key={key}
                threadKey={key}
                draftId={window.draftId}
                title={<ThreadWindowLabel window={window} />}
                viewport={viewport}
                order={index}
                visible={active && !window.minimized}
                focused={focusedKey === key}
                onFocus={() => focusWindow(key)}
                onMinimize={() => minimizeWindow(key)}
                onClose={() => closeWindow(key)}
              >
                {(windowWidth) =>
                  window.draftId ? (
                    <MissionControlDraftContent
                      window={window}
                      active={active && !window.minimized && focusedKey === key}
                      visible={active && !window.minimized}
                      windowWidth={windowWidth}
                    />
                  ) : (
                    <MissionControlReviewDesk
                      threadRef={window.threadRef}
                      instanceId={window.instanceId}
                      active={active && !window.minimized && focusedKey === key}
                      visible={active && !window.minimized}
                      windowWidth={windowWidth}
                    />
                  )
                }
              </MissionControlThreadWindow>
            );
          })}
      </div>
      {windows.length > 0 && (
        <div
          className="absolute inset-x-2 bottom-1 flex h-8 gap-1 overflow-x-auto"
          aria-label={gt("Open thread windows")}
        >
          {windows.map((window) => {
            const key = scopedThreadKey(window.threadRef);
            return (
              <div key={key} className="max-w-52 shrink-0 truncate">
                <Button
                  size="sm"
                  id={`${key}-mission-window-restore`}
                  variant={focusedKey === key && !window.minimized ? "secondary" : "outline"}
                  onClick={() => focusWindow(key)}
                >
                  <span className="truncate">
                    <ThreadWindowLabel window={window} />
                  </span>
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

const handles = [
  ["n", "inset-x-3 -top-1 h-2 cursor-n-resize"],
  ["s", "inset-x-3 -bottom-1 h-2 cursor-s-resize"],
  ["w", "inset-y-3 -left-1 w-2 cursor-w-resize"],
  ["e", "inset-y-3 -right-1 w-2 cursor-e-resize"],
  ["nw", "-top-1 -left-1 size-3 cursor-nw-resize"],
  ["ne", "-top-1 -right-1 size-3 cursor-ne-resize"],
  ["sw", "-bottom-1 -left-1 size-3 cursor-sw-resize"],
  ["se", "-bottom-1 -right-1 size-4 cursor-se-resize"],
] as const;

function MissionControlThreadWindow({
  threadKey,
  draftId,
  title,
  viewport,
  order,
  visible,
  focused,
  onFocus,
  onMinimize,
  onClose,
  children,
}: {
  threadKey: string;
  draftId?: DraftId | undefined;
  title: ReactNode;
  viewport: { width: number; height: number };
  order: number;
  visible: boolean;
  focused: boolean;
  onFocus: () => void;
  onMinimize: () => void;
  onClose: () => void;
  children: (windowWidth: number) => ReactNode;
}) {
  const gt = useGT();
  const titleId = useId();
  const popup = useRef<HTMLDivElement>(null);
  const draft = useComposerDraftStore((state) => (draftId ? state.getDraftSession(draftId) : null));
  const isNewThread = Boolean(draft && !draft.promotedTo);
  const saved = useMissionControlWindowStore((state) => state.byThreadKey[threadKey]);
  const newThreadPlacement = useMissionControlWindowStore((state) => state.newThreadPlacement);
  const { setBounds, setMaximized, setNewThreadBounds, setNewThreadMaximized } =
    useMissionControlWindowStore();
  const [moving, setMoving] = useState<MissionControlWindowBounds | null>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    bounds: MissionControlWindowBounds;
    direction: string;
    latest?: MissionControlWindowBounds;
  } | null>(null);
  const compact = viewport.width < 640;
  const [initialMaximized] = useState(() =>
    isNewThread ? newThreadPlacement.maximized === true : false,
  );
  const maximizedSaved = saved?.maximized ?? initialMaximized;
  const maximized = compact || maximizedSaved;
  const [initialBounds] = useState(() =>
    fitMissionControlWindow(
      saved?.bounds ?? (isNewThread ? newThreadPlacement.bounds : undefined),
      viewport,
      order * 24,
    ),
  );
  const normal = fitMissionControlWindow(moving ?? saved?.bounds ?? initialBounds, viewport);
  const bounds = maximized ? { x: 0, y: 0, ...viewport } : normal;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opening, restoring, or raising a modeless window moves keyboard focus into it without focusing the composer on touch.
  useEffect(() => {
    if (visible && focused && !popup.current?.contains(document.activeElement))
      popup.current?.focus();
  }, [visible, focused]);
  const start = (event: PointerEvent<HTMLElement>, direction: string) => {
    if (maximized || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { x: event.clientX, y: event.clientY, bounds: normal, direction };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const next = { ...drag.bounds };
    if (drag.direction === "move") {
      next.x += dx;
      next.y += dy;
    } else {
      if (drag.direction.includes("e"))
        next.width = Math.min(viewport.width - next.x, Math.max(360, next.width + dx));
      if (drag.direction.includes("s"))
        next.height = Math.min(viewport.height - next.y, Math.max(320, next.height + dy));
      if (drag.direction.includes("w")) {
        next.x = Math.max(0, Math.min(next.x + dx, next.x + next.width - 360));
        next.width = drag.bounds.x + drag.bounds.width - next.x;
      }
      if (drag.direction.includes("n")) {
        next.y = Math.max(0, Math.min(next.y + dy, next.y + next.height - 320));
        next.height = drag.bounds.y + drag.bounds.height - next.y;
      }
    }
    const fitted = fitMissionControlWindow(next, viewport);
    drag.latest = fitted;
    setMoving(fitted);
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag) return;
    const nextBounds = drag.latest ?? moving;
    if (nextBounds) {
      setBounds(threadKey, nextBounds);
      if (isNewThread) setNewThreadBounds(nextBounds);
    }
    gesture.current = null;
    setMoving(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const savePlacement = () => {
    if (!saved?.bounds) setBounds(threadKey, initialBounds);
  };
  const minimize = () => {
    savePlacement();
    onMinimize();
    document.getElementById(`${threadKey}-mission-window-restore`)?.focus();
  };
  const close = () => {
    savePlacement();
    popup.current?.parentElement?.parentElement?.querySelector("iframe")?.focus();
    onClose();
  };
  const toggleMaximized = () => {
    if (compact) return;
    const nextMaximized = !maximizedSaved;
    if (!saved?.bounds) setBounds(threadKey, normal);
    setMaximized(threadKey, nextMaximized);
    if (isNewThread) {
      if (!newThreadPlacement.bounds) setNewThreadBounds(normal);
      setNewThreadMaximized(nextMaximized);
    }
  };
  return (
    <div
      ref={popup}
      role="dialog"
      aria-modal={false}
      aria-labelledby={titleId}
      tabIndex={-1}
      hidden={!visible}
      inert={!visible}
      data-testid="mission-control-thread-window"
      data-thread-key={threadKey}
      onPointerDownCapture={() => {
        if (!focused) onFocus();
      }}
      onFocusCapture={() => {
        if (!focused) onFocus();
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          event.target instanceof Element &&
          event.target.closest('[role="dialog"]') === event.currentTarget
        ) {
          // Closing (not minimizing) keeps the dock clear while hopping between threads;
          // new-thread drafts survive in the draft store and reopen from the board.
          event.stopPropagation();
          close();
        }
      }}
      className={cn(
        "pointer-events-auto absolute flex flex-col rounded-lg border bg-background shadow-xl outline-none [-webkit-app-region:no-drag]",
        focused ? "border-ring" : "border-border",
        !visible && "hidden",
      )}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        zIndex: order + 1,
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 rounded-t-lg border-b border-border bg-muted px-2">
        <div
          role="button"
          tabIndex={0}
          aria-label={gt("Move thread window")}
          aria-description={gt(
            "Drag to move. Use arrow keys to move, or Shift + arrow keys to resize.",
          )}
          className={cn(
            "flex min-w-0 flex-1 touch-none select-none items-center gap-2 self-stretch rounded-sm px-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            !maximized && "cursor-move",
          )}
          onPointerDown={(event) => start(event, "move")}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onDoubleClick={toggleMaximized}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleMaximized();
              return;
            }
            if (
              maximized ||
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
            )
              return;
            event.preventDefault();
            const dx = event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0;
            const dy = event.key === "ArrowUp" ? -20 : event.key === "ArrowDown" ? 20 : 0;
            const nextBounds = fitMissionControlWindow(
              event.shiftKey
                ? { ...normal, width: normal.width + dx, height: normal.height + dy }
                : { ...normal, x: normal.x + dx, y: normal.y + dy },
              viewport,
            );
            setBounds(threadKey, nextBounds);
            if (isNewThread) setNewThreadBounds(nextBounds);
          }}
        >
          <GripIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <h2 id={titleId} className="truncate text-sm font-medium">
            {title}
          </h2>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={gt("Minimize thread window")}
          title={gt("Minimize thread window")}
          onClick={minimize}
        >
          <MinusIcon />
        </Button>
        {!compact && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={maximizedSaved ? gt("Restore thread window") : gt("Maximize thread window")}
            title={maximizedSaved ? gt("Restore thread window") : gt("Maximize thread window")}
            onClick={toggleMaximized}
          >
            {maximizedSaved ? <Minimize2Icon /> : <Maximize2Icon />}
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={gt("Close thread window")}
          title={gt("Close thread window")}
          onClick={close}
        >
          <XIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-b-lg">{children(bounds.width)}</div>
      {!maximized &&
        handles.map(([direction, className]) => (
          <div
            key={direction}
            aria-hidden
            className={cn("absolute touch-none", className)}
            onPointerDown={(event) => start(event, direction)}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
          />
        ))}
      {!maximized && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1 bottom-1 size-2 border-r border-b border-muted-foreground/50"
        />
      )}
      {moving && <div className="absolute inset-0 z-10" />}
    </div>
  );
}

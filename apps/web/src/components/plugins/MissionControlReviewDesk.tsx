import { useAtomValue } from "@effect/atom-react";
import {
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { deriveWorkspaceMutationId } from "@t3tools/client-runtime/state/threads";
import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  RunId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import {
  BotIcon,
  CheckCircle2Icon,
  FileCodeIcon,
  FilesIcon,
  GlobeIcon,
  ImagesIcon,
  ListTodoIcon,
  MessageSquareIcon,
  TerminalIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useId, useState } from "react";
import * as Schema from "effect/Schema";

import { useComposerDraftStore } from "../../composerDraftStore";
import { ComposerHandleContext } from "../../composerHandleContext";
import { useDiffPanelStore } from "../../diffPanelStore";
import { useMissionControlStore } from "../../missionControlStore";
import {
  useMissionControlWindowStore,
  type MissionControlImageStreamLayout,
  type MissionControlSidebarKind,
  type MissionControlWindowPane,
} from "../../missionControlWindowStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useWorkspaceRevision } from "../../hooks/useWorkspaceRevision";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import { cn, randomUUID } from "../../lib/utils";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "../../rightPanelStore";
import {
  useProject,
  useQuietThreadProjection,
  useQuietThreadShell,
  useQuietThreadVisibleTurnItems,
  useThreadCheckpointSummaries,
  useThreadStatus,
} from "../../state/entities";
import { primaryServerKeybindingsAtom, serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useEnvironmentShellStatus } from "../../state/shell";
import { useKnownTerminalSessions } from "../../state/terminalSessions";
import { useEnvironmentThread } from "../../state/threads";
import { mcpAppEnvironment } from "../../state/mcpApps";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  isThreadRouteSnapshotAuthoritative,
  resolveThreadRouteRenderState,
} from "../../threadRoutes";
import ChatView from "../ChatView";
import { PersistentThreadTerminalPanel } from "../PersistentThreadTerminals";
import { useOpenThreadFamily } from "../ThreadRouteView";
import { BackgroundThreadContext, HiddenThreadContext } from "../chat/backgroundThread";
import { useThreadTerminalActions } from "../terminal/useThreadTerminalActions";
import { Button } from "../ui/button";
import { MissionControlImageStreamSidebar } from "./MissionControlImageStreamSidebar";
import {
  deriveMissionControlImageStream,
  resolveMissionControlSidebars,
} from "./missionControlImages.logic";
import { deriveMissionControlSubagents } from "./missionControlSubagents.logic";
import { MissionControlWorkSidebar } from "./MissionControlSubagentsSidebar";
import {
  deriveMissionControlTasks,
  MISSION_CONTROL_WIDE_SPLIT_WITH_TASKS_MIN_WIDTH,
} from "./missionControlTasks.logic";

const DiffPanel = lazy(() => import("../DiffPanel"));
const FilePreviewPanel = lazy(() => import("../files/FilePreviewPanel"));
const PreviewPanel = lazy(() =>
  import("../preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
type DeskFile = Extract<RightPanelSurface, { kind: "file" | "files" }>;
const isReviewStatus = Schema.is(
  Schema.Struct({
    accepted: Schema.Boolean,
    dismissed: Schema.optionalKey(Schema.Boolean),
    canDismiss: Schema.optionalKey(Schema.Boolean),
    latestRunId: Schema.NullOr(RunId),
  }),
);

export function MissionControlReviewDesk({
  threadRef,
  instanceId,
  active,
  visible,
  windowWidth,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly instanceId: string;
  readonly active: boolean;
  readonly visible: boolean;
  readonly windowWidth: number;
}) {
  const gt = useGT();
  const shell = useQuietThreadShell(threadRef);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const sendHostRequest = useAtomCommand(mcpAppEnvironment.pluginsHost, { reportFailure: false });
  const hostRequest = useStableCallback(sendHostRequest);
  const [review, setReview] = useState<{
    accepted: boolean;
    dismissed: boolean;
    canDismiss: boolean;
    latestRunId: RunId | null;
    requestKey: string;
  } | null>(null);
  const [reviewFailed, setReviewFailed] = useState(false);
  const [reloadReview, setReloadReview] = useState(0);
  const [changingReview, setChangingReview] = useState(false);
  const latestRunId = shell?.source.latestRunId ?? null;
  const reviewRequestKey = JSON.stringify([
    scopedThreadKey(threadRef),
    latestRunId,
    shell?.settledAt,
    shell?.unsettledAt,
    shell?.source.status,
    shell?.source.pendingRuntimeRequest?.id,
    shell?.source.hasActionableProposedPlan,
    shell?.source.blockedOnThreadWait,
    shell?.source.pendingGuestMessageCount,
    shell?.pendingBackgroundTasks.length,
    reloadReview,
  ]);
  const reviewLoaded =
    review !== null && review.latestRunId === latestRunId && review.requestKey === reviewRequestKey;
  const canAccept =
    shell?.source.status === "completed" &&
    shell.source.activeRunId === null &&
    shell.source.pendingRuntimeRequest === null &&
    !shell.source.hasActionableProposedPlan &&
    shell.source.latestRunId !== null &&
    shell.pendingBackgroundTasks.length === 0;
  const accepted = reviewLoaded && review.accepted && canAccept;
  const canDismiss =
    reviewLoaded &&
    review.canDismiss &&
    shell?.source.activeRunId === null &&
    shell.source.pendingRuntimeRequest === null &&
    !shell.source.hasActionableProposedPlan &&
    shell.pendingBackgroundTasks.length === 0;
  const dismissed = canDismiss && review.dismissed;
  const resolved = accepted || dismissed;
  const changeReview = async () => {
    if (!canOperate || changingReview || !shell || !reviewLoaded) return;
    setChangingReview(true);
    const result = await hostRequest({
      environmentId: threadRef.environmentId,
      input: {
        pluginId: "mission-control",
        instanceId,
        operation: {
          type: "missionControl",
          request: {
            action: "triage",
            threadId: threadRef.threadId,
            disposition: resolved ? "reopen" : canDismiss ? "dismiss" : "accept",
            expectedLatestRunId: latestRunId,
            expectedRequestId: shell.source.pendingRuntimeRequest?.id ?? null,
          },
        },
      },
    });
    if (result._tag === "Success") setReloadReview((value) => value + 1);
    setReviewFailed(result._tag !== "Success");
    setChangingReview(false);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the plugin's explicit human review record for the currently inspected run
  useEffect(() => {
    if (!active) return;
    let current = true;
    void hostRequest({
      environmentId: threadRef.environmentId,
      input: {
        pluginId: "mission-control",
        instanceId,
        operation: {
          type: "missionControl",
          request: { action: "detail", threadId: threadRef.threadId },
        },
      },
    }).then((result) => {
      if (!current) return;
      if (result._tag === "Success" && isReviewStatus(result.value)) {
        setReview({
          accepted: result.value.accepted,
          dismissed: result.value.dismissed ?? false,
          canDismiss: result.value.canDismiss ?? false,
          latestRunId: result.value.latestRunId,
          requestKey: reviewRequestKey,
        });
        setReviewFailed(false);
      } else setReviewFailed(true);
    });
    return () => {
      current = false;
    };
  }, [active, hostRequest, instanceId, reviewRequestKey, threadRef]);
  const bootstrapComplete = isThreadRouteSnapshotAuthoritative(
    useEnvironmentShellStatus(threadRef.environmentId),
  );
  const unlistedDetail = useEnvironmentThread(
    shell === null ? threadRef.environmentId : null,
    shell === null ? threadRef.threadId : null,
  );
  useOpenThreadFamily(threadRef, bootstrapComplete && shell === null);
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadExists: shell !== null,
    serverThreadDeleted: shell?.deletedAt != null,
    unlistedThreadDetail: unlistedDetail,
    draftThreadExists: false,
  });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="mission-control-review-desk">
      <div className="flex min-h-11 shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">{gt("Review status")}</span>
        <Button
          size="sm"
          variant={resolved ? "outline" : "default"}
          disabled={
            !canOperate ||
            changingReview ||
            (!reviewFailed && (!reviewLoaded || (!resolved && !canAccept && !canDismiss)))
          }
          onClick={() => {
            if (reviewFailed) {
              setReviewFailed(false);
              setReloadReview((value) => value + 1);
            } else void changeReview();
          }}
        >
          {reviewFailed
            ? gt("Retry review status")
            : changingReview
              ? gt("Saving…")
              : accepted
                ? gt("Reopen review")
                : dismissed
                  ? gt("Reopen")
                  : canDismiss
                    ? gt("Dismiss")
                    : gt("Accept review")}
        </Button>
      </div>
      {reviewFailed && (
        <p role="alert" className="border-b border-border px-4 py-2 text-xs text-destructive">
          {gt("Review status could not be updated. Reload it and try again.")}
        </p>
      )}
      {renderState === "ready" ? (
        <ReviewDeskContent
          threadRef={threadRef}
          instanceId={instanceId}
          active={active}
          visible={visible}
          windowWidth={windowWidth}
        />
      ) : (
        <p className="p-6 text-sm text-muted-foreground" role="status">
          {renderState === "loading"
            ? gt("Loading the thread…")
            : gt("This thread is no longer there.")}
        </p>
      )}
    </div>
  );
}

function ReviewDeskContent({
  threadRef,
  instanceId,
  active,
  visible,
  windowWidth,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly instanceId: string;
  readonly active: boolean;
  readonly visible: boolean;
  readonly windowWidth: number;
}) {
  const gt = useGT();
  const paneId = useId();
  const threadKey = scopedThreadKey(threadRef);
  const saved = useMissionControlWindowStore((state) => state.byThreadKey[threadKey]);
  const pane = saved?.pane ?? "conversation";
  const file = saved?.file ?? null;
  const setPane = useStableCallback((value: MissionControlWindowPane) =>
    useMissionControlWindowStore.getState().setPane(threadKey, value),
  );
  const setFile = useStableCallback((value: DeskFile) =>
    useMissionControlWindowStore.getState().setFile(threadKey, value),
  );
  const setTasksOpen = useStableCallback((value: boolean) =>
    useMissionControlWindowStore.getState().setTasksOpen(threadKey, value),
  );
  const setSubagentsOpen = useStableCallback((value: boolean) =>
    useMissionControlWindowStore.getState().setSubagentsOpen(threadKey, value),
  );
  const setImagesOpen = useStableCallback((value: boolean) =>
    useMissionControlWindowStore.getState().setImagesOpen(threadKey, value),
  );
  const setImagesLayout = useStableCallback((value: MissionControlImageStreamLayout) =>
    useMissionControlWindowStore.getState().setImagesLayout(threadKey, value),
  );
  const setPreferredSidebar = useStableCallback((value: MissionControlSidebarKind) =>
    useMissionControlWindowStore.getState().setPreferredSidebar(threadKey, value),
  );
  const filePath = file?.kind === "file" ? file.relativePath : null;
  const [pendingFiles, setPendingFiles] = useState<ReadonlySet<string>>(new Set());
  const shell = useQuietThreadShell(threadRef);
  const projection = useQuietThreadProjection(threadRef);
  const thread = shell ?? projection?.projection.thread ?? null;
  const project = useProject(
    thread ? scopeProjectRef(threadRef.environmentId, thread.projectId) : null,
  );
  const cwd = thread?.worktreePath ?? project?.workspaceRoot;
  const taskSummary = deriveMissionControlTasks(projection?.projection ?? null, shell);
  const subagentSummary = deriveMissionControlSubagents(projection?.projection ?? null, shell);
  const imageStream = deriveMissionControlImageStream(projection?.projection ?? null, {
    shell,
    workspaceRoot: cwd,
  });
  const sidebars = resolveMissionControlSidebars({
    hasTasks: taskSummary !== null,
    hasSubagents: subagentSummary !== null,
    hasImages: imageStream !== null,
    imagesStreaming: imageStream?.phase === "streaming",
    windowWidth,
    savedTasksOpen: saved?.tasksOpen,
    savedSubagentsOpen: saved?.subagentsOpen,
    savedImagesOpen: saved?.imagesOpen,
    preferredSidebar: saved?.preferredSidebar,
  });
  const imagesLayout = saved?.imagesLayout ?? "stream";
  const wide =
    windowWidth >=
    (sidebars.dockedSidebarCount >= 2
      ? 1480
      : sidebars.dockedSidebarCount === 1
        ? MISSION_CONTROL_WIDE_SPLIT_WITH_TASKS_MIN_WIDTH
        : 1000);
  const conversationVisible = visible && (pane === "conversation" || wide);
  const subagentsPanelId = `${paneId}-subagents-sidebar`;
  const tasksPanelId = `${paneId}-tasks-sidebar`;
  const imagesPanelId = `${paneId}-images-sidebar`;
  const toggleSubagentsSidebar = () => {
    const next = !sidebars.subagentsVisible;
    setSubagentsOpen(next);
    if (next) setPreferredSidebar("subagents");
  };
  const toggleTasksSidebar = () => {
    const next = !sidebars.tasksVisible;
    setTasksOpen(next);
    if (next) setPreferredSidebar("tasks");
  };
  const toggleImagesSidebar = () => {
    const next = !sidebars.imagesVisible;
    setImagesOpen(next);
    if (next) setPreferredSidebar("images");
  };
  const inspectSubagent = (childThreadId: ThreadId) => {
    useMissionControlStore
      .getState()
      .inspectThread(scopeThreadRef(threadRef.environmentId, childThreadId), instanceId);
  };
  const items = useQuietThreadVisibleTurnItems(threadRef);
  const checkpoints = useThreadCheckpointSummaries(threadRef);
  const status = useThreadStatus(threadRef);
  const mutationId = deriveWorkspaceMutationId(items, checkpoints.at(-1)?.completedAt ?? null);
  const workspace = useWorkspaceRevision({
    threadKey: scopedThreadKey(threadRef),
    unloaded: status !== "live" && status !== "deleted",
    mutationId,
  });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const terminalActions = useThreadTerminalActions(threadRef);
  const canOperateTerminal = useEnvironmentScope(threadRef.environmentId, AuthTerminalOperateScope);
  const sessions = useKnownTerminalSessions(threadRef);
  const panel = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, threadRef),
  );
  const terminalSurface =
    panel.surfaces.find(
      (surface) => surface.kind === "terminal" && surface.id === panel.activeSurfaceId,
    ) ?? panel.surfaces.find((surface) => surface.kind === "terminal");

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- routes native conversation file/preview actions from the shared panel store into the visible review desk
  useEffect(
    () =>
      useRightPanelStore.subscribe((state, previous) => {
        if (!active) return;
        const current = selectThreadRightPanelState(state.byThreadKey, threadRef);
        const before = selectThreadRightPanelState(previous.byThreadKey, threadRef);
        if (current === before) return;
        const surface = current.surfaces.find((entry) => entry.id === current.activeSurfaceId);
        const oldSurface = before.surfaces.find((entry) => entry.id === before.activeSurfaceId);
        if (!surface || surface === oldSurface) return;
        if (surface.kind === "file" || surface.kind === "files") {
          setFile(surface);
          setPane("file");
        } else if (surface.kind === "preview") setPane("preview");
        else if (surface.kind === "terminal") setPane("terminal");
        else if (surface.kind === "diff") setPane("changes");
      }),
    [active, threadRef, setFile, setPane],
  );

  const openFile = (relativePath: string) =>
    useRightPanelStore.getState().openFile(threadRef, relativePath);
  const launchTerminal = (direction?: "horizontal" | "vertical") =>
    terminalActions.launchTerminal({
      place: (terminalId) => {
        const store = useRightPanelStore.getState();
        if (direction && terminalSurface?.kind === "terminal")
          store.splitTerminal(threadRef, terminalSurface.id, terminalId, direction);
        else store.openTerminal(threadRef, terminalId);
        setPane("terminal");
      },
    });
  const parentPanel: SideChatParentPanel = {
    hostRef: threadRef,
    openToolDiff: (target) => {
      useDiffPanelStore.getState().selectToolCall(threadRef, target);
      setPane("changes");
    },
    runShellCommand: (command) => {
      const terminal = launchTerminal();
      if (terminal)
        void terminal.result.then((result) => {
          if (result._tag === "Success")
            return terminalActions.writeToTerminal(terminal.terminalId, `${command}\n`);
          return null;
        });
    },
  };
  const tabs = [
    { id: "conversation" as const, label: gt("Conversation"), icon: MessageSquareIcon },
    { id: "changes" as const, label: gt("Changes"), icon: FilesIcon },
    { id: "terminal" as const, label: gt("Terminal"), icon: TerminalIcon },
    { id: "preview" as const, label: gt("Preview"), icon: GlobeIcon },
    ...(file ? [{ id: "file" as const, label: gt("File"), icon: FileCodeIcon }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <div
          role="tablist"
          aria-label={gt("Review tools")}
          className="flex min-w-0 flex-1 overflow-x-auto"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const index = tabs.findIndex((tab) => tab.id === pane);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            const tab = tabs[next];
            if (tab) setPane(tab.id);
            event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}
        >
          {tabs.map((tab) => (
            <button
              type="button"
              role="tab"
              key={tab.id}
              id={`${paneId}-${tab.id}-tab`}
              aria-selected={pane === tab.id}
              aria-controls={`${paneId}-${tab.id}-panel`}
              tabIndex={pane === tab.id ? 0 : -1}
              onClick={() => setPane(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                pane === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <tab.icon className="size-3.5" aria-hidden />
              {tab.label}
            </button>
          ))}
        </div>
        {imageStream || subagentSummary || taskSummary ? (
          <div className="flex shrink-0 items-center gap-1 py-1">
            {imageStream ? (
              <Button
                size="xs"
                variant={sidebars.imagesVisible ? "secondary" : "ghost"}
                aria-expanded={sidebars.imagesVisible}
                aria-controls={imagesPanelId}
                data-testid="mission-control-images-toggle"
                onClick={toggleImagesSidebar}
              >
                <ImagesIcon
                  className={
                    imageStream.phase === "streaming" || imageStream.phase === "active"
                      ? "text-primary"
                      : imageStream.phase === "complete"
                        ? "text-success"
                        : undefined
                  }
                  aria-hidden
                />
                <span>{gt("Images")}</span>
                <span className="font-mono tabular-nums">
                  {imageStream.pending.length > 0
                    ? `${imageStream.images.length}+`
                    : imageStream.images.length}
                </span>
              </Button>
            ) : null}
            {subagentSummary ? (
              <Button
                size="xs"
                variant={sidebars.subagentsVisible ? "secondary" : "ghost"}
                aria-expanded={sidebars.subagentsVisible}
                aria-controls={subagentsPanelId}
                data-testid="mission-control-subagents-toggle"
                onClick={toggleSubagentsSidebar}
              >
                <BotIcon
                  className={
                    subagentSummary.phase === "running"
                      ? "text-primary"
                      : subagentSummary.phase === "completed"
                        ? "text-success"
                        : subagentSummary.phase === "failed"
                          ? "text-destructive"
                          : undefined
                  }
                  aria-hidden
                />
                <span>{gt("Subagents")}</span>
                <span className="font-mono tabular-nums">{subagentSummary.total}</span>
              </Button>
            ) : null}
            {taskSummary ? (
              <Button
                size="xs"
                variant={sidebars.tasksVisible ? "secondary" : "ghost"}
                aria-expanded={sidebars.tasksVisible}
                aria-controls={tasksPanelId}
                data-testid="mission-control-tasks-toggle"
                onClick={toggleTasksSidebar}
              >
                {taskSummary.phase === "completed" ? (
                  <CheckCircle2Icon className="text-success" aria-hidden />
                ) : (
                  <ListTodoIcon
                    className={taskSummary.phase === "running" ? "text-primary" : undefined}
                    aria-hidden
                  />
                )}
                <span>{gt("Tasks")}</span>
                <span className="font-mono tabular-nums">
                  {taskSummary.completed}/{taskSummary.total}
                </span>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          data-side-chat-pane
          role="tabpanel"
          id={`${paneId}-conversation-panel`}
          aria-labelledby={`${paneId}-conversation-tab`}
          hidden={!conversationVisible}
          inert={!conversationVisible}
          className={cn(
            "min-h-0 min-w-0 flex-col",
            conversationVisible ? "flex" : "hidden",
            pane === "conversation" ? "flex-1" : "w-2/5 shrink-0 border-r border-border",
          )}
        >
          <BackgroundThreadContext value>
            <HiddenThreadContext value={!active || !conversationVisible}>
              <ComposerHandleContext value={null}>
                <ChatView
                  environmentId={threadRef.environmentId}
                  threadId={threadRef.threadId}
                  routeKind="server"
                  embedded={parentPanel}
                  onDiffPanelOpen={() => setPane("changes")}
                />
              </ComposerHandleContext>
            </HiddenThreadContext>
          </BackgroundThreadContext>
        </div>
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1",
            pane === "conversation" ? "hidden" : "flex flex-col",
          )}
          inert={!active || pane === "conversation"}
        >
          {visible && (
            <Suspense
              fallback={
                <p className="p-6 text-sm text-muted-foreground" role="status">
                  {gt("Loading…")}
                </p>
              }
            >
              {pane === "changes" && (
                <div
                  role="tabpanel"
                  id={`${paneId}-changes-panel`}
                  aria-labelledby={`${paneId}-changes-tab`}
                  className={cn("h-full min-h-0 flex-col", pane === "changes" ? "flex" : "hidden")}
                >
                  <DiffPanel
                    mode="embedded"
                    threadRef={threadRef}
                    composerDraftTarget={threadRef}
                    workspaceMutationId={workspace.revision}
                    visible={active && pane === "changes"}
                    onOpenFile={openFile}
                  />
                </div>
              )}
              {pane === "terminal" && (
                <div
                  role="tabpanel"
                  id={`${paneId}-terminal-panel`}
                  aria-labelledby={`${paneId}-terminal-tab`}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                    {(sessions ?? []).map((session) => (
                      <Button
                        key={session.target.terminalId}
                        size="xs"
                        variant={
                          terminalSurface?.kind === "terminal" &&
                          terminalSurface.activeTerminalId === session.target.terminalId
                            ? "secondary"
                            : "ghost"
                        }
                        onClick={() =>
                          useRightPanelStore
                            .getState()
                            .openTerminal(threadRef, session.target.terminalId)
                        }
                      >
                        {session.target.terminalId}
                      </Button>
                    ))}
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!canOperateTerminal}
                      onClick={() => {
                        void launchTerminal()?.result;
                      }}
                    >
                      {gt("New terminal")}
                    </Button>
                  </div>
                  {terminalSurface?.kind === "terminal" ? (
                    <PersistentThreadTerminalPanel
                      visible={active}
                      threadRef={threadRef}
                      surface={terminalSurface}
                      launchContext={null}
                      keybindings={keybindings}
                      onAddTerminalContext={(selection) => {
                        useComposerDraftStore.getState().addTerminalContexts(
                          threadRef,
                          [
                            {
                              ...selection,
                              id: randomUUID(),
                              threadId: threadRef.threadId,
                              createdAt: new Date().toISOString(),
                            },
                          ],
                          { insertAtCaret: false },
                        );
                        setPane("conversation");
                      }}
                      onSplitTerminal={() => {
                        void launchTerminal("horizontal")?.result;
                      }}
                      onSplitTerminalVertical={() => {
                        void launchTerminal("vertical")?.result;
                      }}
                      onNewTerminal={() => {
                        void launchTerminal()?.result;
                      }}
                      onActiveTerminalChange={(terminalId) =>
                        useRightPanelStore
                          .getState()
                          .activateTerminal(threadRef, terminalSurface.id, terminalId)
                      }
                      onCloseTerminal={(terminalId) => {
                        if (!terminalActions.canWrite()) return;
                        terminalActions.closeTerminalSession(terminalId);
                        useRightPanelStore
                          .getState()
                          .closeTerminal(threadRef, terminalSurface.id, terminalId);
                      }}
                    />
                  ) : (
                    <p className="p-6 text-sm text-muted-foreground">
                      {gt("Open a terminal to inspect or run checks in this thread's workspace.")}
                    </p>
                  )}
                </div>
              )}
              {pane === "preview" && (
                <div
                  role="tabpanel"
                  id={`${paneId}-preview-panel`}
                  aria-labelledby={`${paneId}-preview-tab`}
                  className="min-h-0 flex-1"
                >
                  <PreviewPanel
                    mode="embedded"
                    threadRef={threadRef}
                    visible={active}
                    onSendAnnotation={(annotation, image) => {
                      const store = useComposerDraftStore.getState();
                      store.addPreviewAnnotation(threadRef, annotation, { insertAtCaret: false });
                      if (image) store.addImages(threadRef, [image]);
                      setPane("conversation");
                    }}
                  />
                </div>
              )}
              {pane === "file" && file && cwd && project && (
                <div
                  role="tabpanel"
                  id={`${paneId}-file-panel`}
                  aria-labelledby={`${paneId}-file-tab`}
                  className={cn("min-h-0 flex-1", pane === "file" ? "flex flex-col" : "hidden")}
                >
                  <FilePreviewPanel
                    environmentId={threadRef.environmentId}
                    cwd={cwd}
                    projectName={project.title}
                    projectId={project.id}
                    relativePath={filePath}
                    {...(file.kind === "file" && file.attachment
                      ? { attachment: file.attachment }
                      : {})}
                    threadRef={threadRef}
                    composerDraftTarget={threadRef}
                    keybindings={keybindings}
                    availableEditors={config?.availableEditors ?? []}
                    openInShortcutEnabled={active && pane === "file"}
                    revealLine={file.kind === "file" ? file.revealLine : null}
                    revealRequestId={file.kind === "file" ? file.revealRequestId : 0}
                    folderTrail={file.folderTrail}
                    onOpenFile={openFile}
                    onNavigateFolder={(relativePath, folderTrail, keepSource) =>
                      useRightPanelStore
                        .getState()
                        .navigateFolder(threadRef, file.id, relativePath, folderTrail, keepSource)
                    }
                    selectedFilePending={filePath !== null && pendingFiles.has(filePath)}
                    onPendingChange={(relativePath, pending) =>
                      setPendingFiles((previous) => {
                        const next = new Set(previous);
                        if (pending) next.add(relativePath);
                        else next.delete(relativePath);
                        return next;
                      })
                    }
                    workspaceMutationId={workspace.revision}
                  />
                </div>
              )}
            </Suspense>
          )}
        </div>
        {imageStream && sidebars.imagesVisible ? (
          <MissionControlImageStreamSidebar
            id={imagesPanelId}
            threadRef={threadRef}
            workspaceRoot={cwd}
            workspaceMutationId={workspace.revision}
            summary={imageStream}
            layout={imagesLayout}
            mode={sidebars.imagesMode}
            wide={windowWidth >= MISSION_CONTROL_WIDE_SPLIT_WITH_TASKS_MIN_WIDTH}
            onLayoutChange={setImagesLayout}
            onClose={() => setImagesOpen(false)}
          />
        ) : null}
        {(subagentSummary && sidebars.subagentsVisible) ||
        (taskSummary && sidebars.tasksVisible) ? (
          <MissionControlWorkSidebar
            threadRef={threadRef}
            subagentsPanelId={subagentsPanelId}
            tasksPanelId={tasksPanelId}
            subagentSummary={subagentSummary}
            taskSummary={taskSummary}
            subagentsVisible={sidebars.subagentsVisible}
            tasksVisible={sidebars.tasksVisible}
            mode={sidebars.tasksMode}
            wide={windowWidth >= MISSION_CONTROL_WIDE_SPLIT_WITH_TASKS_MIN_WIDTH}
            onCloseSubagents={() => setSubagentsOpen(false)}
            onCloseTasks={() => setTasksOpen(false)}
            onCloseAll={() => {
              if (sidebars.subagentsVisible) setSubagentsOpen(false);
              if (sidebars.tasksVisible) setTasksOpen(false);
            }}
            onInspectSubagent={inspectSubagent}
          />
        ) : null}
      </div>
    </div>
  );
}

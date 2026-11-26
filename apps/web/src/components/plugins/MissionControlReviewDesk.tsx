import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { deriveWorkspaceMutationId } from "@t3tools/client-runtime/state/threads";
import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  RunId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import {
  ArrowLeftIcon,
  FileCodeIcon,
  FilesIcon,
  GlobeIcon,
  MessageSquareIcon,
  TerminalIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import * as Schema from "effect/Schema";

import { useComposerDraftStore } from "../../composerDraftStore";
import { ComposerHandleContext } from "../../composerHandleContext";
import { useDiffPanelStore } from "../../diffPanelStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";
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

const DiffPanel = lazy(() => import("../DiffPanel"));
const FilePreviewPanel = lazy(() => import("../files/FilePreviewPanel"));
const PreviewPanel = lazy(() =>
  import("../preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
type DeskPane = "conversation" | "changes" | "terminal" | "preview" | "file";
type DeskFile = Extract<RightPanelSurface, { kind: "file" | "files" }>;
const isReviewStatus = Schema.is(
  Schema.Struct({ accepted: Schema.Boolean, latestRunId: Schema.NullOr(RunId) }),
);

export function MissionControlReviewDesk({
  threadRef,
  instanceId,
  active,
  onBack,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly instanceId: string;
  readonly active: boolean;
  readonly onBack: () => void;
}) {
  const gt = useGT();
  const shell = useQuietThreadShell(threadRef);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const sendHostRequest = useAtomCommand(mcpAppEnvironment.pluginsHost, { reportFailure: false });
  const hostRequest = useStableCallback(sendHostRequest);
  const [review, setReview] = useState<{
    accepted: boolean;
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
            disposition: accepted ? "reopen" : "accept",
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
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeftIcon aria-hidden />
          {gt("Back to inbox")}
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {shell?.title ?? gt("Review thread")}
        </h2>
        <Button
          size="sm"
          variant={accepted ? "outline" : "default"}
          disabled={
            !canOperate ||
            changingReview ||
            (!reviewFailed && (!reviewLoaded || (!accepted && !canAccept)))
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
                : gt("Accept review")}
        </Button>
      </div>
      {reviewFailed && (
        <p role="alert" className="border-b border-border px-4 py-2 text-xs text-destructive">
          {gt("Review status could not be updated. Reload it and try again.")}
        </p>
      )}
      {renderState === "ready" ? (
        <ReviewDeskContent threadRef={threadRef} active={active} />
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
  active,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly active: boolean;
}) {
  const gt = useGT();
  const [pane, setPane] = useState<DeskPane>("conversation");
  const [file, setFile] = useState<DeskFile | null>(null);
  const filePath = file?.kind === "file" ? file.relativePath : null;
  const [pendingFiles, setPendingFiles] = useState<ReadonlySet<string>>(new Set());
  const wide = useMediaQuery("lg");
  const conversationVisible = active && (pane === "conversation" || wide);
  const shell = useQuietThreadShell(threadRef);
  const projection = useQuietThreadProjection(threadRef);
  const thread = shell ?? projection?.projection.thread ?? null;
  const project = useProject(
    thread ? scopeProjectRef(threadRef.environmentId, thread.projectId) : null,
  );
  const cwd = thread?.worktreePath ?? project?.workspaceRoot;
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
    [active, threadRef],
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
      <div
        role="tablist"
        aria-label={gt("Review tools")}
        className="flex shrink-0 overflow-x-auto border-b border-border px-2"
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
            id={`mission-review-${tab.id}-tab`}
            aria-selected={pane === tab.id}
            aria-controls={`mission-review-${tab.id}-panel`}
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
      <div className="flex min-h-0 flex-1">
        <div
          data-side-chat-pane
          role="tabpanel"
          id="mission-review-conversation-panel"
          aria-labelledby="mission-review-conversation-tab"
          hidden={!conversationVisible}
          inert={!conversationVisible}
          className={cn(
            "min-h-0 min-w-0 flex-col",
            conversationVisible ? "flex" : "hidden",
            pane === "conversation" ? "flex-1" : "w-2/5 shrink-0 border-r border-border",
          )}
        >
          <BackgroundThreadContext value>
            <HiddenThreadContext value={!conversationVisible}>
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
          {active && (
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
                  id="mission-review-changes-panel"
                  aria-labelledby="mission-review-changes-tab"
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
                  id="mission-review-terminal-panel"
                  aria-labelledby="mission-review-terminal-tab"
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
                  id="mission-review-preview-panel"
                  aria-labelledby="mission-review-preview-tab"
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
                  id="mission-review-file-panel"
                  aria-labelledby="mission-review-file-tab"
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
      </div>
    </div>
  );
}

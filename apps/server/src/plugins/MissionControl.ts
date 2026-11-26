import {
  CommandId,
  IsoDateTime,
  MessageId,
  ModelSelection,
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  PluginError,
  ThreadId,
  type MissionControlRequest,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Schema from "effect/Schema";
import * as Plugins from "./Plugins.ts";
import * as Reviews from "./MissionControlReviews.ts";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Git from "../vcs/GitVcsDriver.ts";
import * as Providers from "../provider/ProviderRegistry.ts";
import * as Schedules from "../scheduledTasks/ScheduledTaskService.ts";
import { isProviderSignOutPrompt } from "../orchestration-v2/CommandPolicy.ts";

export class MissionControl extends Context.Service<
  MissionControl,
  {
    readonly request: (input: MissionControlRequest) => Effect.Effect<unknown, PluginError>;
  }
>()("t3/plugins/MissionControl") {}

function summarize(
  thread: OrchestrationV2ThreadShell,
  children: number,
  now: DateTime.Utc,
  reviews: ReadonlyMap<ThreadId, { runId: string; settledAt: string; acceptedAt: string }>,
) {
  const pending = thread.pendingRuntimeRequest;
  const running = thread.activeRunId !== null;
  const failed = thread.status === "failed";
  const stopped = thread.status === "interrupted" || thread.status === "cancelled";
  const waitingForAgent =
    thread.blockedOnThreadWait === true || (thread.pendingBackgroundTasks?.length ?? 0) > 0;
  const review = reviews.get(thread.id);
  const accepted =
    !running &&
    !pending &&
    !thread.hasActionableProposedPlan &&
    !waitingForAgent &&
    thread.status === "completed" &&
    thread.settledOverride === "settled" &&
    thread.settledAt != null &&
    review?.runId === thread.latestRunId &&
    review.settledAt === DateTime.formatIso(thread.settledAt);
  const attentionCategory =
    pending || thread.hasActionableProposedPlan
      ? "decision"
      : !running && (failed || stopped)
        ? "failure"
        : !running && !waitingForAgent && thread.status === "completed" && thread.latestRunId
          ? "review"
          : null;
  const attentionReason = pending
    ? pending.kind === "user_input"
      ? "The agent needs your answer."
      : pending.kind === "auth_refresh"
        ? "The provider needs you to sign in again."
        : `A ${pending.kind.replaceAll("_", " ")} request needs your approval.`
    : thread.hasActionableProposedPlan
      ? "A proposed plan needs your decision."
      : failed
        ? (thread.lastError ?? "The run failed before completing.").slice(0, 300)
        : stopped
          ? "The run stopped before completing."
          : attentionCategory === "review"
            ? "The run completed; review its changes and evidence."
            : null;
  const raisedHand =
    (thread.pendingGuestMessageCount ?? 0) > 0 ||
    (!!pending &&
      (pending.kind !== "user_input" ||
        !thread.snoozedAt ||
        DateTime.toEpochMillis(pending.createdAt) > DateTime.toEpochMillis(thread.snoozedAt))) ||
    (failed &&
      !!thread.latestRunCompletedAt &&
      (!thread.snoozedAt ||
        DateTime.toEpochMillis(thread.latestRunCompletedAt) >
          DateTime.toEpochMillis(thread.snoozedAt)));
  const snoozed =
    !!thread.snoozedUntil &&
    DateTime.toEpochMillis(thread.snoozedUntil) > DateTime.toEpochMillis(now) &&
    !raisedHand;
  const unseen =
    thread.latestRunCompletedAt != null &&
    (thread.lastVisitedAt == null ||
      DateTime.toEpochMillis(thread.latestRunCompletedAt) >
        DateTime.toEpochMillis(thread.lastVisitedAt));
  const needsAttention = attentionCategory !== null && !accepted && !snoozed;
  const statusLabel =
    pending || thread.hasActionableProposedPlan
      ? "Waiting for you"
      : accepted
        ? "Accepted"
        : thread.status === "preparing"
          ? "Preparing"
          : thread.status === "queued"
            ? "Queued"
            : thread.latestRunStopRequested && running
              ? "Stopping"
              : waitingForAgent
                ? "Waiting for agent"
                : running
                  ? "Working"
                  : failed
                    ? "Failed"
                    : stopped
                      ? "Stopped"
                      : attentionCategory === "review"
                        ? "Review ready"
                        : "Idle";
  const tone =
    accepted || snoozed
      ? "gray"
      : pending
        ? "amber"
        : failed || stopped
          ? "red"
          : running
            ? "green"
            : needsAttention
              ? "blue"
              : "gray";
  return {
    id: thread.id,
    title: thread.title.slice(0, 300),
    status: pending ? "attention" : failed ? "error" : running ? "live" : "idle",
    dotTone: tone,
    subtitleTone: tone,
    rightTone: tone,
    subtitle: pending
      ? "Needs your response"
      : failed
        ? (thread.lastError ?? "Run failed").slice(0, 300)
        : children
          ? `${children} team threads`
          : (thread.latestVisibleMessage?.text ?? "No messages yet").slice(0, 160),
    rightLabel: statusLabel,
    statusLabel,
    attentionCategory,
    attentionId: `${thread.id}:${pending?.id ?? thread.latestRunId ?? "plan"}:${attentionCategory ?? "idle"}`,
    attentionReason,
    latestRunId: thread.latestRunId,
    activeRunId: thread.activeRunId,
    pendingRequestId: pending?.id ?? null,
    accepted,
    acceptedAt: accepted ? (review?.acceptedAt ?? null) : null,
    snoozed,
    snoozedUntil: thread.snoozedUntil ? DateTime.formatIso(thread.snoozedUntil) : null,
    needsAttention,
    unseen,
    running,
    hasTeam: children > 0,
    swarmCount: children,
    isCron: false,
    updatedAt: DateTime.formatIso(thread.updatedAt),
    column: needsAttention ? "attention" : running ? "running" : "done",
  };
}

function commandEvidence(item: Extract<OrchestrationV2TurnItem, { type: "command_execution" }>) {
  const status =
    item.status === "running" || item.status === "pending" || item.status === "waiting"
      ? "running"
      : item.status === "failed" ||
          item.outputIndicatesFailure ||
          (item.exitCode !== undefined && item.exitCode !== 0)
        ? "failed"
        : item.status === "completed" && item.exitCode === 0
          ? "passed"
          : "unknown";
  return {
    id: item.id,
    command: item.input.slice(0, 2_048),
    output: (item.output ?? "").slice(-4_096),
    outputTruncated: (item.output?.length ?? 0) > 4_096 || item.outputOmitted === true,
    status,
    exitCode: item.exitCode ?? null,
    startedAt: item.startedAt ? DateTime.formatIso(item.startedAt) : null,
    completedAt: item.completedAt ? DateTime.formatIso(item.completedAt) : null,
  };
}

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const encodeModelSelection = Schema.encodeSync(Schema.fromJsonString(ModelSelection));
const isPluginError = Schema.is(PluginError);

const make = Effect.gen(function* () {
  const crypto = yield* Digest.Digest;
  const plugins = yield* Plugins.Plugins;
  const reviews = yield* Reviews.MissionControlReviews;
  const threads = yield* Threads.ThreadManagementService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const git = yield* Git.GitVcsDriver;
  const providers = yield* Providers.ProviderRegistry;
  const schedules = yield* Schedules.ScheduledTaskService;
  const gitStatus = yield* Cache.make({
    capacity: 64,
    timeToLive: "30 seconds",
    lookup: (cwd: string) =>
      git.statusDetailsLocal(cwd, { includeBranchChanges: false }).pipe(
        Effect.timeout("10 seconds"),
        Effect.orElseSucceed(() => null),
      ),
  });
  const gitDiff = yield* Cache.make({
    capacity: 8,
    timeToLive: "15 seconds",
    lookup: (cwd: string) =>
      git
        .execute({
          cwd,
          operation: "mission-control.diff",
          args: ["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--"],
          timeoutMs: 10_000,
          maxOutputBytes: 196_608,
          allowNonZeroExit: true,
        })
        .pipe(Effect.orElseSucceed(() => null)),
  });
  const getThread = Effect.fn("MissionControl.getThread")(function* (threadId: ThreadId) {
    const thread = yield* threads.getThreadShell(threadId);
    if (!thread || thread.deletedAt !== null || thread.archivedAt !== null)
      return yield* new PluginError({ reason: "not-found" });
    const project = Option.getOrUndefined(yield* projects.get(thread.projectId));
    if (!project || project.archivedAt !== null)
      return yield* new PluginError({ reason: "not-found" });
    return { thread, project };
  });
  const getIntervention = Effect.fn("MissionControl.getIntervention")(function* (
    thread: OrchestrationV2ThreadShell,
  ) {
    const [records, available] = yield* Effect.all(
      [
        threads.getThreadRecords(thread.id, ["runs", "providerThreads", "providerSessions"], {
          runStatuses: ["preparing", "starting", "running", "waiting", "queued"],
          includeLatestRun: true,
        }),
        providers.getProviders,
      ],
      { concurrency: 2 },
    );
    const latestRun = records.runs.find((run) => run.id === thread.latestRunId);
    const activeRun = records.runs.find((run) => run.id === thread.activeRunId);
    const run = activeRun ?? latestRun;
    const sessionId = records.providerThreads.find(
      (entry) => entry.id === run?.providerThreadId,
    )?.providerSessionId;
    const session = sessionId
      ? records.providerSessions.find((entry) => entry.id === sessionId)
      : records.providerSessions.findLast(
          (entry) => entry.providerInstanceId === thread.providerInstanceId,
        );
    const capabilities = session?.capabilities.turns;
    const enabled = available.some(
      (entry) => entry.enabled && entry.instanceId === thread.providerInstanceId,
    );
    const idle = !thread.activeRunId && !thread.pendingRuntimeRequest;
    return {
      latestRun,
      intervention: {
        expectedLatestRunId: thread.latestRunId,
        expectedActiveRunId: thread.activeRunId,
        pendingRequest: thread.pendingRuntimeRequest
          ? {
              id: thread.pendingRuntimeRequest.id,
              kind: thread.pendingRuntimeRequest.kind,
              createdAt: DateTime.formatIso(thread.pendingRuntimeRequest.createdAt),
              userOnly: thread.pendingRuntimeRequest.userOnly === true,
            }
          : null,
        canStop:
          !!activeRun &&
          (capabilities?.supportsInterrupt === true ||
            activeRun.status === "preparing" ||
            activeRun.status === "starting"),
        canSteer:
          enabled &&
          activeRun?.status === "running" &&
          !thread.pendingRuntimeRequest &&
          (capabilities?.supportsActiveSteering === true ||
            capabilities?.supportsSteeringByInterruptRestart === true),
        canQueue: enabled,
        canResume:
          enabled &&
          idle &&
          ((latestRun?.status === "queued" && latestRun.queueHeld === true) ||
            (capabilities?.supportsNativeResume === true &&
              (latestRun?.status === "interrupted" ||
                (latestRun?.status === "failed" && thread.lastErrorClass === "usage_limit")))),
        canRetry: enabled && idle && latestRun?.status === "failed",
      },
    };
  });
  const request = Effect.fn("MissionControl.request")(
    function* (input: MissionControlRequest) {
      if (input.action === "usage") {
        return {
          accounts: (yield* providers.getProviders)
            .filter((provider) => provider.enabled)
            .map((provider) => ({
              id: provider.instanceId,
              label: provider.displayName ?? provider.driver,
              checkedAt: provider.usageLimits?.checkedAt ?? null,
              windows: (provider.usageLimits?.windows ?? []).map((window) => ({
                id: window.id,
                label: window.label,
                usedPercent: window.usedPercent,
                resetsAt: window.resetsAt ?? null,
              })),
              unavailable:
                provider.usageLimits?.unavailable?.message ??
                (provider.usageLimits ? null : "This provider does not report usage limits."),
            })),
        };
      }
      if (input.action === "snapshot") {
        const now = yield* DateTime.now;
        const capturedAt = DateTime.formatIso(now);
        const today = capturedAt.slice(0, 10);
        const [shell, allProjects, scheduled, availableProviders, installations, acceptedReviews] =
          yield* Effect.all(
            [
              threads.getShellSnapshot(),
              projects.list(),
              schedules.list(),
              providers.getProviders,
              plugins.list(),
              reviews.read(),
            ],
            { concurrency: 3 },
          );
        const activeProjects = allProjects.filter((p) => p.archivedAt === null);
        const reviewMap = new Map(acceptedReviews.map((entry) => [entry.threadId, entry]));
        const activeIds = new Set(activeProjects.map((p) => p.projectId));
        const candidates = shell.threads.filter(
          (t) => !t.deletedAt && !t.archivedAt && activeIds.has(t.projectId),
        );
        const children = new Map<string, number>();
        for (const t of candidates) {
          const parent =
            t.delegatedFrom?.threadId ??
            (t.lineage.relationshipToParent === "subagent" ? t.lineage.parentThreadId : null);
          if (parent) children.set(parent, (children.get(parent) ?? 0) + 1);
        }
        const summaries = candidates.map((t) => ({
          ...summarize(t, children.get(t.id) ?? 0, now, reviewMap),
          projectId: t.projectId,
        }));
        const priority = (card: (typeof summaries)[number]) =>
          card.needsAttention && card.attentionCategory === "decision"
            ? 0
            : card.running
              ? 1
              : card.needsAttention && card.attentionCategory === "failure"
                ? 2
                : card.needsAttention
                  ? 3
                  : 4;
        const cards = summaries
          .toSorted((a, b) => priority(a) - priority(b) || b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 300);
        const sources = new Map(candidates.map((entry) => [entry.id, entry]));
        const all = cards.map((card) => sources.get(card.id)!);
        const projectCards = yield* Effect.forEach(
          activeProjects.slice(0, 100),
          (p) =>
            Effect.gen(function* () {
              const status = Option.getOrNull(yield* Cache.getOption(gitStatus, p.workspaceRoot));
              const projectThreads = cards.filter((t) => t.projectId === p.projectId);
              const projectSummaries = summaries.filter((t) => t.projectId === p.projectId);
              const live = projectSummaries.filter((t) => t.running).length;
              const attention = projectSummaries.filter((t) => t.needsAttention).length;
              const automationCount = scheduled.tasks.filter(
                (t) => t.projectId === p.projectId && t.enabled,
              ).length;
              const worktreeCount = new Set(
                all
                  .filter((t) => t.projectId === p.projectId && t.worktreePath)
                  .map((t) => t.worktreePath),
              ).size;
              const pr = all.find(
                (t) => t.projectId === p.projectId && t.branchPullRequest,
              )?.branchPullRequest;
              return {
                id: p.projectId,
                name: p.title.slice(0, 200),
                path: p.workspaceRoot,
                branch:
                  status?.branch ?? all.find((t) => t.projectId === p.projectId)?.branch ?? "",
                diff: {
                  added: status?.workingTree.insertions ?? 0,
                  removed: status?.workingTree.deletions ?? 0,
                },
                badge: {
                  label: attention ? `${attention} Waiting` : live ? `${live} Live` : "Idle",
                  tone: attention ? "amber" : live ? "green" : "idle",
                },
                threads: projectThreads,
                automationCount,
                worktreeCount,
                footerText: [
                  status
                    ? status.hasWorkingTreeChanges
                      ? "Uncommitted changes"
                      : "Clean tree"
                    : "Git details in inspector",
                  `${automationCount} automations`,
                  `${worktreeCount} worktrees`,
                  pr ? `PR #${pr.number}` : "",
                ]
                  .filter(Boolean)
                  .join(" · "),
              };
            }),
          { concurrency: 4 },
        );
        const attentionItems = cards
          .filter((t) => t.attentionCategory !== null)
          .map((t) => ({
            id: t.attentionId,
            threadId: t.id,
            projectId: t.projectId,
            projectName: activeProjects.find((p) => p.projectId === t.projectId)?.title ?? "",
            threadTitle: t.title.slice(0, 300),
            kind:
              t.attentionCategory === "decision"
                ? "question"
                : t.attentionCategory === "failure"
                  ? "error"
                  : "done",
            category: t.attentionCategory,
            badgeLabel: t.statusLabel,
            summary: t.attentionReason,
            latestRunId: t.latestRunId,
            activeRunId: t.activeRunId,
            pendingRequestId: t.pendingRequestId,
            accepted: t.accepted,
            acceptedAt: t.acceptedAt,
            snoozed: t.snoozed,
            snoozedUntil: t.snoozedUntil,
            actions: t.accepted
              ? ["review", "reopen"]
              : t.snoozed
                ? ["review", "unsnooze"]
                : t.attentionCategory === "review"
                  ? ["review", "accept", "snooze"]
                  : all.find((source) => source.id === t.id)?.pendingRuntimeRequest?.kind !==
                        "user_input" && t.pendingRequestId
                    ? ["review"]
                    : ["review", "snooze"],
          }));
        const attention = attentionItems.filter((t) => !t.accepted && !t.snoozed);
        const timeline = [
          ...cards.map((t) => ({
            id: t.id,
            threadId: t.id,
            title: t.title,
            summary: t.subtitle,
            projectName: activeProjects.find((p) => p.projectId === t.projectId)?.title,
            timestamp: t.updatedAt,
            bucket: t.updatedAt.slice(0, 10) === today ? "today" : "earlier",
            kind: t.rightLabel,
            tone: t.dotTone,
            running: t.running,
            needsAttention: t.needsAttention,
          })),
          ...scheduled.tasks
            .filter((t) => t.enabled && activeIds.has(t.projectId))
            .slice(0, 100)
            .map((t) => ({
              id: t.id,
              threadId: t.threadId ?? "",
              title: t.title,
              summary: t.lastRunError ?? "Scheduled task",
              projectName: activeProjects.find((p) => p.projectId === t.projectId)?.title,
              timestamp: t.nextRunAt,
              bucket: "upcoming",
              kind: "Scheduled",
              tone: "blue",
              running: false,
              needsAttention: false,
            })),
        ];
        const snapshot = {
          plugins: installations.map((entry) => ({
            id: entry.manifest.id,
            displayName: entry.manifest.name,
            version: entry.manifest.version,
            enabled: entry.enabled,
            builtin: entry.bundled === true,
          })),
          models: availableProviders
            .filter((provider) => provider.enabled)
            .flatMap((provider) =>
              provider.models.map((model) => ({
                id: encodeModelSelection({ instanceId: provider.instanceId, model: model.slug }),
                label: `${provider.displayName ?? provider.driver} · ${model.name}`,
              })),
            )
            .slice(0, 300),
          mode: "live",
          projects: projectCards,
          needsAttention: attention,
          snoozedAttention: attentionItems.filter((t) => t.snoozed && !t.accepted),
          acceptedAttention: attentionItems.filter((t) => t.accepted),
          timeline,
          truncated: candidates.length > 300 || activeProjects.length > 100,
          summary: {
            projectCount: activeProjects.length,
            threadCount: summaries.length,
            liveTeamCount: summaries.filter((t) => t.hasTeam).length,
            needsAttentionCount: summaries.filter((t) => t.needsAttention).length,
            runningCount: summaries.filter((t) => t.running).length,
          },
          defaultThreadId: attention[0]?.threadId ?? all[0]?.id ?? "",
        };
        const etag = Hex.encode(
          yield* crypto.digest(
            Digest.sha256,
            new TextEncoder().encode(yield* encodeJson(snapshot)),
          ),
        );
        return input.etag === etag
          ? { unchanged: true, capturedAt }
          : { ...snapshot, etag, capturedAt };
      }
      if (input.action === "create") {
        const project = Option.getOrUndefined(yield* projects.get(input.projectId));
        if (!project || project.archivedAt !== null)
          return yield* new PluginError({ reason: "not-found" });
        const modelSelection = input.modelSelection ?? project.defaultModelSelection;
        if (
          !modelSelection ||
          !input.text.trim() ||
          isProviderSignOutPrompt({ text: input.text, attachments: [] })
        )
          return yield* new PluginError({ reason: "request-failed" });
        const threadId = ThreadId.make(yield* randomUuidV4);
        yield* threads.dispatch({
          type: "thread.create",
          commandId: CommandId.make(yield* randomUuidV4),
          threadId,
          projectId: project.projectId,
          title: input.title.trim() || input.text.slice(0, 80),
          titleRenamed: Boolean(input.title.trim()),
          modelSelection,
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdBy: "user",
          creationSource: "web",
        });
        yield* threads.sendToThread({
          projectId: project.projectId,
          threadId,
          commandId: CommandId.make(yield* randomUuidV4),
          messageId: MessageId.make(yield* randomUuidV4),
          text: input.text,
          attachments: [],
          mode: "queue",
          createdBy: "user",
          creationSource: "web",
        });
        return { threadId };
      }
      const { thread, project } = yield* getThread(input.threadId);
      if (input.action === "openThread") return { threadId: thread.id };
      if (input.action === "seen") {
        yield* threads.dispatch({
          type: "thread.visit",
          commandId: CommandId.make(yield* randomUuidV4),
          threadId: thread.id,
          visitedAt: IsoDateTime.make(DateTime.formatIso(yield* DateTime.now)),
        });
        return { ok: true };
      }
      if (input.action === "triage") {
        if (
          input.expectedLatestRunId !== thread.latestRunId ||
          (thread.pendingRuntimeRequest !== null &&
            input.expectedRequestId !== thread.pendingRuntimeRequest.id) ||
          (input.expectedRequestId !== undefined &&
            input.expectedRequestId !== (thread.pendingRuntimeRequest?.id ?? null))
        )
          return yield* new PluginError({ reason: "stale-view" });
        const commandId = CommandId.make(yield* randomUuidV4);
        const now = yield* DateTime.now;
        if (input.disposition === "accept") {
          if (
            thread.activeRunId ||
            thread.pendingRuntimeRequest ||
            thread.hasActionableProposedPlan ||
            thread.blockedOnThreadWait ||
            thread.status !== "completed" ||
            !thread.latestRunId ||
            (thread.pendingBackgroundTasks?.length ?? 0) > 0
          )
            return yield* new PluginError({ reason: "permission-denied" });
          yield* threads.dispatch({
            type: "thread.settle",
            commandId,
            threadId: thread.id,
            expectedLatestRunId: thread.latestRunId,
          });
          const settled = yield* threads.getThreadShell(thread.id);
          if (
            !settled ||
            settled.latestRunId !== thread.latestRunId ||
            settled.activeRunId ||
            settled.pendingRuntimeRequest ||
            settled.hasActionableProposedPlan ||
            settled.blockedOnThreadWait ||
            (settled.pendingBackgroundTasks?.length ?? 0) > 0 ||
            settled.settledOverride !== "settled" ||
            !settled.settledAt
          )
            return yield* new PluginError({ reason: "stale-view" });
          yield* reviews.accept({
            threadId: thread.id,
            runId: thread.latestRunId,
            acceptedAt: IsoDateTime.make(DateTime.formatIso(now)),
            settledAt: IsoDateTime.make(DateTime.formatIso(settled.settledAt)),
          });
        } else if (input.disposition === "reopen") {
          yield* threads.dispatch({
            type: "thread.unsettle",
            commandId,
            threadId: thread.id,
            reason: "user",
          });
          yield* reviews.reopen(thread.id);
        } else if (input.disposition === "unsnooze") {
          yield* threads.dispatch({
            type: "thread.unsnooze",
            commandId,
            threadId: thread.id,
            reason: "user",
          });
        } else {
          if (
            !input.snoozedUntil ||
            Date.parse(input.snoozedUntil) <= DateTime.toEpochMillis(now) ||
            (thread.pendingRuntimeRequest && thread.pendingRuntimeRequest.kind !== "user_input")
          )
            return yield* new PluginError({ reason: "permission-denied" });
          yield* threads.dispatch({
            type: "thread.snooze",
            commandId,
            threadId: thread.id,
            snoozedUntil: input.snoozedUntil,
          });
        }
        return { ok: true };
      }
      if (input.action === "control") {
        if (
          input.expectedRunId !==
          (input.command === "stop" ? thread.activeRunId : thread.latestRunId)
        )
          return yield* new PluginError({ reason: "stale-view" });
        const { latestRun, intervention } = yield* getIntervention(thread);
        const commandId = CommandId.make(yield* randomUuidV4);
        if (input.command === "stop") {
          if (!intervention.canStop) return yield* new PluginError({ reason: "permission-denied" });
          yield* threads.interruptThread({
            projectId: thread.projectId,
            threadId: thread.id,
            commandId,
            runId: input.expectedRunId,
            reason: "Stopped from Mission Control",
          });
        } else if (input.command === "resume") {
          if (!intervention.canResume || !latestRun)
            return yield* new PluginError({ reason: "permission-denied" });
          if (latestRun.status === "queued") {
            yield* threads.dispatch({
              type: "queued-run.start",
              commandId,
              threadId: thread.id,
              runId: input.expectedRunId,
            });
          } else {
            yield* threads.dispatch({
              type: "message.dispatch",
              commandId,
              threadId: thread.id,
              messageId: MessageId.make(yield* randomUuidV4),
              manualContinuationOfRunId: input.expectedRunId,
              text: "",
              attachments: [],
              dispatchMode: { type: "start_immediately" },
              createdBy: "user",
              creationSource: "web",
            });
          }
        } else {
          if (!intervention.canRetry || !latestRun)
            return yield* new PluginError({ reason: "permission-denied" });
          if (thread.lastErrorCode === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE) {
            yield* threads.dispatch({
              type: "prepared-run.retry",
              commandId,
              threadId: thread.id,
              runId: input.expectedRunId,
            });
          } else {
            const message = (yield* threads.getMessagesById(thread.id, [
              latestRun.userMessageId,
            ])).get(latestRun.userMessageId);
            if (
              !message ||
              (!message.text.trim() && message.attachments.length === 0) ||
              isProviderSignOutPrompt(message)
            )
              return yield* new PluginError({ reason: "permission-denied" });
            const current = yield* threads.getThreadShell(thread.id);
            if (
              !current ||
              current.latestRunId !== input.expectedRunId ||
              current.activeRunId ||
              current.pendingRuntimeRequest
            )
              return yield* new PluginError({ reason: "stale-view" });
            yield* threads.dispatch({
              type: "message.dispatch",
              commandId,
              threadId: thread.id,
              messageId: MessageId.make(yield* randomUuidV4),
              text: message.text,
              modelSelection: latestRun.modelSelection,
              attachments: message.attachments,
              ...(message.context ? { context: message.context } : {}),
              ...(latestRun.freshContext ? { freshContext: true } : {}),
              ...(latestRun.outputSchema ? { outputSchema: latestRun.outputSchema } : {}),
              dispatchMode: { type: "start_immediately" },
              createdBy: "user",
              creationSource: "web",
            });
          }
        }
        return { ok: true };
      }
      if (input.action === "reply") {
        if (!input.text.trim() || isProviderSignOutPrompt({ text: input.text, attachments: [] }))
          return yield* new PluginError({ reason: "permission-denied" });
        const mode = input.mode ?? "queue";
        if (mode === "steer" || (mode === "auto" && thread.activeRunId)) {
          if (
            input.expectedActiveRunId !== undefined &&
            input.expectedActiveRunId !== thread.activeRunId
          )
            return yield* new PluginError({ reason: "stale-view" });
          const { intervention } = yield* getIntervention(thread);
          if (
            !thread.activeRunId ||
            input.expectedActiveRunId !== thread.activeRunId ||
            !intervention.canSteer
          )
            return yield* new PluginError({ reason: "permission-denied" });
          yield* threads.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make(yield* randomUuidV4),
            threadId: thread.id,
            messageId: MessageId.make(yield* randomUuidV4),
            text: input.text,
            attachments: [],
            dispatchMode: { type: "steer_active", targetRunId: thread.activeRunId },
            deliveryIntent: "steer",
            createdBy: "user",
            creationSource: "web",
          });
          return { ok: true, delivery: "steered" };
        }
        const sent = yield* threads.sendToThread({
          projectId: thread.projectId,
          threadId: thread.id,
          commandId: CommandId.make(yield* randomUuidV4),
          messageId: MessageId.make(yield* randomUuidV4),
          text: input.text,
          attachments: [],
          mode: "queue",
          createdBy: "user",
          creationSource: "web",
        });
        return { ok: true, delivery: sent.delivery };
      }
      const [page, shell, status, patch, activityPage, controls, checkpoints] = yield* Effect.all(
        [
          threads.getTimelinePage(thread.id, { view: "messages", limit: 20 }),
          threads.getShellSnapshot(),
          Cache.get(gitStatus, thread.worktreePath ?? project.workspaceRoot),
          Cache.get(gitDiff, thread.worktreePath ?? project.workspaceRoot),
          threads.getTimelinePage(thread.id, { view: "activity", limit: 100 }),
          getIntervention(thread),
          threads.getCheckpointContext(thread.id),
        ],
        { concurrency: 4 },
      );
      const roster = shell.threads
        .filter(
          (t) =>
            !t.deletedAt &&
            (t.delegatedFrom?.threadId === thread.id ||
              (t.lineage.relationshipToParent === "subagent" &&
                t.lineage.parentThreadId === thread.id)),
        )
        .slice(0, 50)
        .map((t) => ({
          name: t.title.slice(0, 100),
          role: t.modelSelection.model,
          tone: t.activeRunId ? "green" : "gray",
          stateLabel: t.pendingRuntimeRequest ? "Waiting" : t.status,
          conversationId: t.id,
        }));
      const files =
        status?.workingTree.files
          .slice(0, 200)
          .map((f) => ({ path: f.path, added: f.insertions, removed: f.deletions })) ?? [];
      const diff = (patch?.exitCode === 0 ? patch.stdout : "")
        .split(/(?=^diff --git )/m)
        .filter(Boolean)
        .slice(0, 100)
        .map((block) => ({
          path:
            block.match(/^\+\+\+ b\/(.+)$/m)?.[1] ??
            block.match(/^--- a\/(.+)$/m)?.[1] ??
            "Changes",
          patch: block,
          added: block.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
          removed: block.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"))
            .length,
        }));
      const now = yield* DateTime.now;
      const summary = summarize(
        thread,
        roster.length,
        now,
        new Map((yield* reviews.read()).map((entry) => [entry.threadId, entry])),
      );
      const runItems = activityPage.items
        .map(({ item }) => item)
        .filter((item) => thread.latestRunId !== null && item.runId === thread.latestRunId);
      const commandItems = runItems.filter((item) => item.type === "command_execution");
      const commands = commandItems.slice(-40).map(commandEvidence);
      const counts = {
        passed: commands.filter((command) => command.status === "passed").length,
        failed: commands.filter((command) => command.status === "failed").length,
        running: commands.filter((command) => command.status === "running").length,
        unknown: commands.filter((command) => command.status === "unknown").length,
      };
      const lastCommand = commandItems.at(-1);
      const stale =
        !!lastCommand?.completedAt &&
        runItems.some(
          (item) =>
            item.type === "file_change" &&
            DateTime.toEpochMillis(item.updatedAt) >
              DateTime.toEpochMillis(lastCommand.completedAt!),
        );
      const verification = {
        runId: thread.latestRunId,
        capturedAt: DateTime.formatIso(now),
        state: counts.failed
          ? "failed"
          : counts.running
            ? "running"
            : commands.length
              ? "observed"
              : "unknown",
        freshness: stale ? "stale" : "unknown",
        reason: !commands.length
          ? "No command execution evidence was recorded for this run in the available activity."
          : stale
            ? "Files changed after the last recorded command completed. Recorded results do not verify the current files."
            : "These are recorded command outcomes. Their exact source revision is not recorded; they do not establish that all required checks passed.",
        commands,
        counts,
        revisions: checkpoints.checkpoints
          .filter((checkpoint) => checkpoint.runId === thread.latestRunId)
          .slice(-20)
          .map((checkpoint) => ({
            scopeId: checkpoint.scopeId,
            ref: checkpoint.ref,
            status: checkpoint.status,
          })),
        truncated: activityPage.hasEarlier || commandItems.length > 40,
      };
      return {
        ...summary,
        projectId: thread.projectId,
        projectName: project.title,
        statusTone: summary.dotTone,
        statusLabel: summary.statusLabel,
        latestRunStatus: controls.latestRun?.status ?? thread.status,
        agentFinished: !thread.activeRunId && thread.status === "completed",
        shipped: null,
        shippedReason: "No verified shipping evidence is recorded for this run.",
        intervention: controls.intervention,
        verification,
        pendingRequest: !!thread.pendingRuntimeRequest,
        composerPlaceholder: "Reply to this conversation…",
        defaultModel: thread.modelSelection.model,
        models: [{ id: thread.modelSelection.model, label: thread.modelSelection.model }],
        modes: [thread.interactionMode],
        swarm: { exists: roster.length > 0, count: roster.length, roster, messages: [] },
        files,
        diff,
        diffTruncated: patch?.stdoutTruncated ?? false,
        activity: page.items.map(({ item }) => ({
          id: item.id,
          from: item.type === "user_message" ? "you" : "agent",
          time: DateTime.formatIso(item.startedAt ?? item.updatedAt),
          body: ("text" in item ? item.text : "").slice(0, 8_192),
        })),
        historyTruncated: page.hasEarlier,
      };
    },
    Effect.mapError((cause) =>
      isPluginError(cause) ? cause : new PluginError({ reason: "request-failed", cause }),
    ),
  );
  return MissionControl.of({ request });
});
export const layer = Layer.effect(MissionControl, make);

import { summarizeSubagentStatuses } from "@t3tools/client-runtime/state/subagent-display";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTimingCopy";
import { useGT, useMessages } from "gt-react";
import {
  BotIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  PanelRightCloseIcon,
} from "lucide-react";

import { tickTextContent } from "../../lib/tickTextContent";
import { cn } from "../../lib/utils";
import { EnvironmentSubagentAvatar, SubagentElapsed } from "../chat/V2LifecycleRow";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type {
  MissionControlSubagentEntry,
  MissionControlSubagentPhase,
  MissionControlSubagentsSummary,
} from "./missionControlSubagents.logic";
import { MissionControlTasksSection } from "./MissionControlTasksSidebar";
import type { MissionControlTaskSummary } from "./missionControlTasks.logic";

function phaseBadgeVariant(phase: MissionControlSubagentPhase) {
  switch (phase) {
    case "running":
      return "secondary" as const;
    case "completed":
      return "success" as const;
    case "failed":
      return "error" as const;
    case "stopped":
      return "warning" as const;
    case "idle":
      return "outline" as const;
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

function SubagentRow({
  threadRef,
  entry,
  onInspectSubagent,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly entry: MissionControlSubagentEntry;
  readonly onInspectSubagent?: ((threadId: ThreadId) => void) | undefined;
}) {
  const gt = useGT();
  const title = entry.title ?? gt("Subagent");
  const statusLabel =
    entry.status === "pending"
      ? gt("Queued", { $context: "subagent status" })
      : entry.status === "running"
        ? gt("Running", { $context: "subagent status" })
        : entry.status === "waiting"
          ? gt("Waiting", { $context: "subagent status" })
          : entry.status === "idle"
            ? gt("Idle · resumable", { $context: "subagent status" })
            : entry.status === "completed"
              ? gt("Completed", { $context: "subagent status" })
              : entry.status === "failed"
                ? gt("Failed", { $context: "subagent status" })
                : gt("Stopped", { $context: "subagent status" });

  const secondaryText =
    entry.detail ??
    (entry.workflowAgentCount !== null && entry.workflowAgentCount > 0
      ? entry.workflowActiveCount > 0
        ? gt("{active} of {total} agents working", {
            active: entry.workflowActiveCount,
            total: entry.workflowAgentCount,
          })
        : gt("{count, plural, one {{count} agent} other {{count} agents}}", {
            count: entry.workflowAgentCount,
          })
      : statusLabel);

  const canOpen = entry.childThreadId !== null && onInspectSubagent !== undefined;

  const content = (
    <>
      <EnvironmentSubagentAvatar
        environmentId={threadRef.environmentId}
        providerInstanceId={entry.providerInstanceId}
        driver={entry.driver}
        remote={entry.remoteChild}
        status={entry.status}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "min-w-0 truncate text-xs leading-snug",
              entry.isActive ? "font-medium text-foreground" : "font-medium text-foreground/85",
            )}
          >
            {title}
          </span>
          {entry.remoteChild !== undefined ? (
            <span className="shrink-0 text-2xs text-muted-foreground">
              {gt("on {environment}", { environment: entry.remoteChild.label })}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "block truncate text-2xs leading-snug",
            entry.isFailed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {secondaryText}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 font-mono text-2xs tabular-nums",
          entry.isActive
            ? "text-primary"
            : entry.isFailed
              ? "text-destructive-foreground"
              : "text-muted-foreground/75",
        )}
      >
        <SubagentElapsed
          agent={{
            status: entry.status,
            startedAt: entry.startedAt,
            completedAt: entry.completedAt,
          }}
        />
      </span>
      {canOpen ? (
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover/subagent-row:text-foreground"
        />
      ) : null}
    </>
  );

  const rowClassName = cn(
    "group/subagent-row flex w-full min-w-0 items-center gap-2.5 border-l-2 pr-3 pl-2.5 text-left transition-colors",
    entry.isActive
      ? "border-primary bg-accent/60 py-2"
      : entry.isFailed
        ? "border-destructive/75 bg-destructive/5 py-1.5"
        : "border-transparent py-1.5 hover:bg-accent/30",
  );

  return (
    <li data-testid="mission-control-subagent-item" data-subagent-status={entry.status}>
      {canOpen ? (
        <button
          type="button"
          aria-label={gt("Open {title}", { title })}
          aria-description={statusLabel}
          onClick={() => {
            if (entry.childThreadId !== null) onInspectSubagent(entry.childThreadId);
          }}
          className={cn(
            rowClassName,
            "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
        >
          {content}
        </button>
      ) : (
        <div aria-description={statusLabel} className={rowClassName}>
          {content}
        </div>
      )}
    </li>
  );
}

function MissionControlSubagentsSection({
  id,
  threadRef,
  summary,
  standalone,
  onClose,
  onInspectSubagent,
  className,
}: {
  readonly id?: string | undefined;
  readonly threadRef: ScopedThreadRef;
  readonly summary: MissionControlSubagentsSummary;
  readonly standalone: boolean;
  readonly onClose: () => void;
  readonly onInspectSubagent?: ((threadId: ThreadId) => void) | undefined;
  readonly className?: string | undefined;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const phaseLabel =
    summary.phase === "running"
      ? gt("Running", { $context: "subagents list status" })
      : summary.phase === "completed"
        ? gt("Done", { $context: "subagents list status" })
        : summary.phase === "failed"
          ? gt("Failed", { $context: "subagents list status" })
          : summary.phase === "stopped"
            ? gt("Stopped", { $context: "subagents list status" })
            : gt("Idle", { $context: "subagents list status" });

  const statusBreakdown = summarizeSubagentStatuses(
    summary.subagents.map((entry) => entry.status),
    resolve,
  );

  const footerLabel =
    summary.phase === "running"
      ? gt("Updating live")
      : summary.phase === "completed"
        ? gt("All subagents finished")
        : summary.phase === "failed"
          ? gt("Ended with error")
          : summary.phase === "stopped"
            ? gt("Stopped early")
            : gt("Idle");

  const settledDurationMs =
    summary.phase !== "running" && summary.startedAt !== null && summary.completedAt !== null
      ? Math.max(0, Date.parse(summary.completedAt) - Date.parse(summary.startedAt))
      : null;

  return (
    <section
      id={id}
      aria-label={gt("Subagents")}
      data-testid="mission-control-subagents-section"
      data-subagents-phase={summary.phase}
      className={cn("flex min-h-0 flex-col", standalone ? "flex-1" : "shrink-0", className)}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <BotIcon
            className={cn(
              "size-3.5 shrink-0",
              summary.phase === "running"
                ? "text-primary"
                : summary.phase === "completed"
                  ? "text-success"
                  : summary.phase === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground",
            )}
            aria-hidden
          />
          <h3 className="truncate text-xs font-semibold tracking-tight text-foreground">
            {gt("Subagents")}
          </h3>
          <Badge size="sm" variant={phaseBadgeVariant(summary.phase)}>
            {phaseLabel}
          </Badge>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Hide subagents sidebar")}
          title={gt("Hide subagents sidebar")}
          onClick={onClose}
        >
          <PanelRightCloseIcon aria-hidden />
        </Button>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background/40 px-3 py-1.5 text-2xs">
        <span
          data-testid="mission-control-subagents-count"
          className="font-mono font-semibold tabular-nums text-foreground"
        >
          {gt("{count, plural, one {{count} subagent} other {{count} subagents}}", {
            count: summary.total,
          })}
        </span>
        <span
          data-testid="mission-control-subagents-status"
          className={cn(
            "truncate font-mono tabular-nums",
            summary.phase === "running"
              ? "text-primary"
              : summary.phase === "failed"
                ? "text-destructive-foreground"
                : "text-muted-foreground",
          )}
        >
          {statusBreakdown}
        </span>
      </div>

      <ol className="min-h-0 flex-1 overflow-y-auto py-1">
        {summary.subagents.map((entry) => (
          <SubagentRow
            key={entry.id}
            threadRef={threadRef}
            entry={entry}
            onInspectSubagent={onInspectSubagent}
          />
        ))}
      </ol>

      {standalone ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-background/40 py-2 pr-4 pl-3 text-2xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            {summary.phase === "running" ? (
              <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            ) : summary.phase === "completed" ? (
              <CheckCircle2Icon className="size-3 shrink-0 text-success" aria-hidden />
            ) : summary.phase === "failed" ? (
              <CircleAlertIcon className="size-3 shrink-0 text-destructive" aria-hidden />
            ) : summary.phase === "stopped" ? (
              <CircleAlertIcon className="size-3 shrink-0 text-warning" aria-hidden />
            ) : null}
            <span className="truncate">{footerLabel}</span>
          </span>
          {summary.phase === "running" && summary.startedAt !== null ? (
            <LiveElapsed anchorIso={summary.startedAt} className="shrink-0 text-muted-foreground" />
          ) : settledDurationMs !== null && settledDurationMs > 0 ? (
            <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
              {formatDuration(settledDurationMs, resolve)}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function MissionControlWorkSidebar({
  threadRef,
  subagentsPanelId,
  tasksPanelId,
  subagentSummary,
  taskSummary,
  subagentsVisible,
  tasksVisible,
  mode,
  wide,
  onCloseSubagents,
  onCloseTasks,
  onCloseAll,
  onInspectSubagent,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly subagentsPanelId: string;
  readonly tasksPanelId: string;
  readonly subagentSummary: MissionControlSubagentsSummary | null;
  readonly taskSummary: MissionControlTaskSummary | null;
  readonly subagentsVisible: boolean;
  readonly tasksVisible: boolean;
  readonly mode: "docked" | "overlay";
  readonly wide: boolean;
  readonly onCloseSubagents: () => void;
  readonly onCloseTasks: () => void;
  readonly onCloseAll: () => void;
  readonly onInspectSubagent?: ((threadId: ThreadId) => void) | undefined;
}) {
  const gt = useGT();
  const showSubagents = subagentSummary !== null && subagentsVisible;
  const showTasks = taskSummary !== null && tasksVisible;
  if (!showSubagents && !showTasks) return null;

  const ariaLabel =
    showSubagents && showTasks
      ? gt("Subagents and tasks")
      : showSubagents
        ? gt("Subagents")
        : gt("Agent tasks");

  const panel = (
    <aside
      aria-label={ariaLabel}
      data-testid="mission-control-work-sidebar"
      onKeyDown={
        mode === "overlay"
          ? (event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onCloseAll();
              }
            }
          : undefined
      }
      className={cn(
        "flex h-full min-h-0 flex-col border-l border-border bg-card text-card-foreground",
        mode === "overlay"
          ? "absolute inset-y-0 right-0 z-20 w-[min(20rem,calc(100%-2rem))] shadow-xl"
          : wide
            ? "w-72 shrink-0"
            : "w-68 shrink-0",
      )}
    >
      {showSubagents ? (
        <MissionControlSubagentsSection
          id={subagentsPanelId}
          threadRef={threadRef}
          summary={subagentSummary}
          standalone={!showTasks}
          onClose={onCloseSubagents}
          onInspectSubagent={onInspectSubagent}
          className={showTasks ? "max-h-[45%] border-b border-border" : undefined}
        />
      ) : null}
      {showTasks ? (
        <MissionControlTasksSection
          id={tasksPanelId}
          summary={taskSummary}
          onClose={onCloseTasks}
        />
      ) : null}
    </aside>
  );

  if (mode === "overlay") {
    return (
      <>
        <div aria-hidden className="absolute inset-0 z-10 bg-background/50" onClick={onCloseAll} />
        {panel}
      </>
    );
  }

  return panel;
}

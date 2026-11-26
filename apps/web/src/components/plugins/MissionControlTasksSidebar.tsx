import { formatDuration } from "@t3tools/shared/orchestrationTimingCopy";
import { useGT, useMessages } from "gt-react";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDotIcon,
  CircleIcon,
  ListTodoIcon,
  PanelRightCloseIcon,
} from "lucide-react";

import { tickTextContent } from "../../lib/tickTextContent";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type {
  MissionControlTaskPhase,
  MissionControlTaskStep,
  MissionControlTaskSummary,
} from "./missionControlTasks.logic";

function phaseBadgeVariant(phase: MissionControlTaskPhase) {
  switch (phase) {
    case "completed":
      return "success" as const;
    case "running":
      return "secondary" as const;
    case "failed":
      return "error" as const;
    case "stopped":
      return "warning" as const;
    case "incomplete":
      return "outline" as const;
  }
}

function progressBarClassName(phase: MissionControlTaskPhase): string {
  switch (phase) {
    case "completed":
      return "bg-success";
    case "running":
      return "bg-primary";
    case "failed":
      return "bg-destructive";
    case "stopped":
      return "bg-warning";
    case "incomplete":
      return "bg-foreground/60";
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

function TaskRow({
  step,
  phase,
}: {
  readonly step: MissionControlTaskStep;
  readonly phase: MissionControlTaskPhase;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const isRunning = step.displayStatus === "running";
  const isCompleted = step.displayStatus === "completed";
  const isInterrupted = step.displayStatus === "interrupted";
  const isFailed = isInterrupted && phase === "failed";

  return (
    <li
      data-testid="mission-control-task-item"
      data-task-status={step.displayStatus}
      aria-current={isRunning ? "step" : undefined}
      className={cn(
        "flex items-start gap-2.5 border-l-2 pr-3 pl-2.5 transition-colors",
        isRunning
          ? "border-primary bg-accent/60 py-2"
          : "border-transparent py-1.5 hover:bg-accent/30",
      )}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center" aria-hidden>
        {isCompleted ? (
          <CheckCircle2Icon className="size-3.5 text-success" />
        ) : isRunning ? (
          <CircleDotIcon className="size-3.5 text-primary" />
        ) : isInterrupted ? (
          <CircleAlertIcon
            className={cn("size-3.5", isFailed ? "text-destructive" : "text-warning")}
          />
        ) : (
          <CircleIcon className="size-3.5 text-muted-foreground/45" />
        )}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-xs leading-snug break-words",
          isCompleted
            ? "text-muted-foreground"
            : isRunning
              ? "font-medium text-foreground"
              : "text-foreground/85",
        )}
      >
        {step.text}
      </span>
      <span className="mt-0.5 shrink-0 font-mono text-2xs tabular-nums">
        {isRunning && step.durationAnchorAt !== null ? (
          <LiveElapsed anchorIso={step.durationAnchorAt} className="text-primary" />
        ) : isRunning ? (
          <span className="text-primary">{gt("Active", { $context: "task status" })}</span>
        ) : isCompleted ? (
          step.durationMs !== null ? (
            <span className="text-muted-foreground/75">
              {formatDuration(step.durationMs, resolve)}
            </span>
          ) : null
        ) : isInterrupted ? (
          <span className={isFailed ? "text-destructive-foreground" : "text-warning-foreground"}>
            {isFailed
              ? gt("Failed", { $context: "task status" })
              : gt("Stopped", { $context: "task status" })}
          </span>
        ) : (
          <span className="text-muted-foreground/45">{String(step.index).padStart(2, "0")}</span>
        )}
      </span>
    </li>
  );
}

export function MissionControlTasksSection({
  id,
  summary,
  onClose,
  className,
}: {
  readonly id?: string | undefined;
  readonly summary: MissionControlTaskSummary;
  readonly onClose: () => void;
  readonly className?: string | undefined;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const phaseLabel =
    summary.phase === "completed"
      ? gt("Done", { $context: "task list status" })
      : summary.phase === "running"
        ? gt("Running", { $context: "task list status" })
        : summary.phase === "failed"
          ? gt("Failed", { $context: "task list status" })
          : summary.phase === "stopped"
            ? gt("Stopped", { $context: "task list status" })
            : gt("Incomplete", { $context: "task list status" });

  const progressCaption =
    summary.phase === "completed"
      ? gt("All tasks completed")
      : gt("{count, plural, one {{count} remaining} other {{count} remaining}}", {
          count: summary.remaining,
        });

  const middleStatLabel =
    summary.interrupted > 0
      ? gt("Stopped", { $context: "task accounting column" })
      : gt("Active", { $context: "task accounting column" });
  const middleStatValue = summary.interrupted > 0 ? summary.interrupted : summary.running;

  const footerLabel =
    summary.phase === "running"
      ? gt("Updating live")
      : summary.phase === "completed"
        ? summary.runActive
          ? gt("Tasks done · wrapping up")
          : gt("Finished")
        : summary.phase === "failed"
          ? gt("Ended with error")
          : summary.phase === "stopped"
            ? gt("Stopped early")
            : gt("Finished · {done}/{total} done", {
                done: summary.completed,
                total: summary.total,
              });

  return (
    <section
      id={id}
      aria-label={gt("Agent tasks")}
      data-testid="mission-control-tasks-section"
      data-tasks-phase={summary.phase}
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <ListTodoIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <h3 className="truncate text-xs font-semibold tracking-tight text-foreground">
            {gt("Tasks")}
          </h3>
          <Badge size="sm" variant={phaseBadgeVariant(summary.phase)}>
            {phaseLabel}
          </Badge>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Hide tasks sidebar")}
          title={gt("Hide tasks sidebar")}
          onClick={onClose}
        >
          <PanelRightCloseIcon aria-hidden />
        </Button>
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border px-3 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span
              data-testid="mission-control-tasks-ratio"
              className="font-mono text-sm font-semibold tabular-nums text-foreground"
            >
              {summary.completed}/{summary.total}
            </span>
            <span className="truncate text-xs text-muted-foreground">{progressCaption}</span>
          </div>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {summary.percent}%
          </span>
        </div>

        <div
          role="progressbar"
          aria-label={gt("Task completion progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={summary.percent}
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-200 ease-out",
              progressBarClassName(summary.phase),
            )}
            style={{ width: `${summary.percent}%` }}
          />
        </div>

        <dl className="grid grid-cols-3 divide-x divide-border rounded-sm border border-border/70 bg-background/60">
          <div className="flex flex-col gap-0.5 px-2 py-1.5">
            <dt className="font-mono text-3xs tracking-wide text-muted-foreground uppercase">
              {gt("Done", { $context: "task accounting column" })}
            </dt>
            <dd
              data-testid="mission-control-tasks-done-count"
              className={cn(
                "font-mono text-xs font-semibold tabular-nums",
                summary.completed > 0 ? "text-success-foreground" : "text-muted-foreground",
              )}
            >
              {summary.completed}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 px-2 py-1.5">
            <dt className="font-mono text-3xs tracking-wide text-muted-foreground uppercase">
              {middleStatLabel}
            </dt>
            <dd
              data-testid="mission-control-tasks-active-count"
              className={cn(
                "font-mono text-xs font-semibold tabular-nums",
                summary.interrupted > 0
                  ? summary.phase === "failed"
                    ? "text-destructive-foreground"
                    : "text-warning-foreground"
                  : summary.running > 0
                    ? "text-primary"
                    : "text-muted-foreground",
              )}
            >
              {middleStatValue}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 px-2 py-1.5">
            <dt className="font-mono text-3xs tracking-wide text-muted-foreground uppercase">
              {gt("Queued", { $context: "task accounting column" })}
            </dt>
            <dd
              data-testid="mission-control-tasks-queued-count"
              className={cn(
                "font-mono text-xs font-semibold tabular-nums",
                summary.pending > 0 ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {summary.pending}
            </dd>
          </div>
        </dl>
      </div>

      {summary.explanation ? (
        <p className="shrink-0 border-b border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {summary.explanation}
        </p>
      ) : null}

      <ol className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {summary.steps.map((step) => (
          <TaskRow key={`${step.id}:${step.index}`} step={step} phase={summary.phase} />
        ))}
      </ol>

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
        {summary.runActive && summary.startedAt !== null ? (
          <LiveElapsed anchorIso={summary.startedAt} className="shrink-0 text-muted-foreground" />
        ) : summary.trackedDurationMs !== null ? (
          <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
            {formatDuration(summary.trackedDurationMs, resolve)}
          </span>
        ) : null}
      </div>
    </section>
  );
}

export function MissionControlTasksSidebar({
  id,
  summary,
  mode,
  wide,
  onClose,
}: {
  readonly id: string;
  readonly summary: MissionControlTaskSummary;
  readonly mode: "docked" | "overlay";
  readonly wide: boolean;
  readonly onClose: () => void;
}) {
  const gt = useGT();

  const panel = (
    <aside
      id={id}
      aria-label={gt("Agent tasks")}
      data-testid="mission-control-tasks-sidebar"
      data-tasks-phase={summary.phase}
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
        "flex h-full min-h-0 flex-col border-l border-border bg-card text-card-foreground",
        mode === "overlay"
          ? "absolute inset-y-0 right-0 z-20 w-[min(20rem,calc(100%-2rem))] shadow-xl"
          : wide
            ? "w-72 shrink-0"
            : "w-68 shrink-0",
      )}
    >
      <MissionControlTasksSection summary={summary} onClose={onClose} />
    </aside>
  );

  if (mode === "overlay") {
    return (
      <>
        <div aria-hidden className="absolute inset-0 z-10 bg-background/50" onClick={onClose} />
        {panel}
      </>
    );
  }

  return panel;
}

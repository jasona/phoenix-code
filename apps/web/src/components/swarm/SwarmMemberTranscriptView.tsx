import type {
  EnvironmentId,
  OrchestrationV2GetSwarmMemberTranscriptResult,
  SwarmMember,
  SwarmMemberTranscriptStep,
  ThreadId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ArrowLeft, RefreshCw } from "lucide-react";

import { orchestrationEnvironment } from "~/state/orchestration";
import { useEnvironmentQuery } from "~/state/query";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

function stepLabel(type: string): string {
  const words = type.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function memberStatusTone(status: SwarmMember["status"]): "success" | "outline" | "secondary" {
  if (status === "working") return "success";
  if (status === "waiting") return "outline";
  return "secondary";
}

export function SwarmMemberTranscriptView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly member: SwarmMember;
  readonly onBack: () => void;
}) {
  const gt = useGT();
  const { member } = props;
  const query = useEnvironmentQuery<OrchestrationV2GetSwarmMemberTranscriptResult, unknown>(
    orchestrationEnvironment.swarmMemberTranscript({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, memberName: member.name },
    }),
  );

  const steps = query.data?.steps;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Back to swarm board")}
          onClick={props.onBack}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-medium text-foreground text-sm">{member.name}</h2>
            <Badge size="sm" variant={memberStatusTone(member.status)}>
              {member.status === "working" ? (
                <T>Working</T>
              ) : member.status === "waiting" ? (
                <T>Waiting</T>
              ) : (
                <T>Killed</T>
              )}
            </Badge>
          </div>
          <p className="truncate text-muted-foreground text-xs">
            <T>Read-only worker transcript</T>
            {member.model ? ` · ${member.model}` : ""}
          </p>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Refresh transcript")}
          disabled={query.isPending}
          onClick={query.refresh}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {member.failure ? (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            {member.failure.text}
          </div>
        ) : null}

        {query.error !== null ? (
          <p className="text-destructive-foreground text-sm">{query.error}</p>
        ) : steps === undefined ? (
          <p className="text-muted-foreground text-sm">
            <T>Loading transcript…</T>
          </p>
        ) : steps === null || steps.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            <T>No transcript steps recorded yet.</T>
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {query.data?.truncated ? (
              <p className="text-muted-foreground text-xs">
                <T>Showing the newest transcript tail. Earlier steps are omitted.</T>
              </p>
            ) : null}
            <ol className="m-0 flex list-none flex-col gap-3 border-s border-border ps-3">
              {steps.map((step) => (
                <TranscriptStepRow key={`${step.index}:${step.type}`} step={step} />
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

function TranscriptStepRow(props: { readonly step: SwarmMemberTranscriptStep }) {
  const { step } = props;
  const seenCalls = new Map<string, number>();
  const keyedToolCalls = step.toolCalls.map((call) => {
    const baseKey = `${step.index}:${call.name}:${call.input}`;
    const count = (seenCalls.get(baseKey) ?? 0) + 1;
    seenCalls.set(baseKey, count);
    return { key: `${baseKey}#${count}`, call };
  });
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <span className="font-mono text-2xs">{`#${step.index}`}</span>
        <span className="font-medium">{stepLabel(step.type)}</span>
        {step.status !== null && step.status !== "DONE" ? (
          <span>{`· ${stepLabel(step.status)}`}</span>
        ) : null}
      </div>
      {keyedToolCalls.length > 0 ? (
        <div className="flex flex-col gap-1">
          {keyedToolCalls.map(({ key, call }) => (
            <code
              key={key}
              className="block whitespace-pre-wrap break-all rounded bg-muted/60 px-2 py-1 font-mono text-2xs text-foreground"
            >
              {`${call.name} ${call.input}`}
            </code>
          ))}
        </div>
      ) : null}
      {step.text !== null && step.text.trim().length > 0 ? (
        <pre className="m-0 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 px-2.5 py-2 font-mono text-xs text-foreground">
          {step.text}
        </pre>
      ) : null}
    </li>
  );
}

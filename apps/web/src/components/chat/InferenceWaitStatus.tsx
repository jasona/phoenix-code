import { useGT } from "gt-react";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { formatThreadInferenceWait } from "@t3tools/client-runtime/state/inference-activity";

import { threadInferenceWaitAtom } from "../../state/inference";

/** "Waiting for rtx · 2 ahead" while T3's gateway holds this thread's request for a busy server. */
export function InferenceWaitStatus({
  threadRef,
  className,
  compact = false,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const gt = useGT();
  const wait = useAtomValue(
    threadInferenceWaitAtom({
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
    }),
  );
  if (wait === null) return null;
  return (
    <span role="status" className={className}>
      {compact
        ? wait.ahead === 0
          ? gt("Queued · next")
          : gt("Queued · {count} ahead", { count: wait.ahead })
        : formatThreadInferenceWait(wait)}
    </span>
  );
}

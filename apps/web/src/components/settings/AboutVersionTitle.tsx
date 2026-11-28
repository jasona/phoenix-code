import { msg, useGT } from "gt-react";

import { APP_VERSION } from "../../branding";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { InlineButton } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function AboutVersionTitle({ checkout = false }: { checkout?: boolean } = {}) {
  const gt = useGT();
  const commit = checkout && import.meta.env.SOURCE_COMMIT;
  const value = commit || APP_VERSION;
  const { copyToClipboard } = useCopyToClipboard<void>({
    target: {
      target: "version",
      unavailableMessage: msg("Clipboard API is unavailable while copying version."),
      failureMessage: msg("Failed to copy version to the clipboard."),
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not copy version"),
          description: error.message,
        }),
      );
    },
  });

  return (
    <span className="inline-flex items-baseline gap-2">
      <span>{checkout ? gt("Running from your checkout") : gt("Version")}</span>
      {commit && <code className="text-2xs font-medium">{APP_VERSION}</code>}
      <code className="text-2xs font-medium">
        <Tooltip>
          <TooltipTrigger
            render={
              <InlineButton
                tone="muted"
                aria-label={
                  commit
                    ? gt("Copy commit hash")
                    : gt("Copy version {version}", { version: APP_VERSION })
                }
                onClick={() => copyToClipboard(value, undefined)}
              >
                {value}
              </InlineButton>
            }
          />
          <TooltipPopup>{commit ? gt("Copy commit hash") : gt("Copy version")}</TooltipPopup>
        </Tooltip>
      </code>
    </span>
  );
}

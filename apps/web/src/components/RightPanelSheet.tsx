import { T } from "gt-react";
import { use, type ReactNode } from "react";

import { HiddenThreadContext } from "./chat/backgroundThread";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "./ui/sheet";

export function RightPanelSheet(props: {
  animationDurationMs: number;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const hidden = use(HiddenThreadContext);
  return (
    <Sheet
      open={props.open && !hidden}
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        // Base UI's dismiss handler fires on held Esc repeats after a nested popup closes.
        if (eventDetails.reason === "escape-key" && eventDetails.event.repeat) {
          return eventDetails.cancel();
        }
        props.onClose();
      }}
    >
      <SheetPopup
        transitionDurationMs={props.animationDurationMs}
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(42vw,28rem)] min-w-80 max-w-[28rem] max-[760px]:w-[min(88vw,24rem)] max-[760px]:min-w-0 wco:mt-(--workspace-topbar-height) wco:h-[calc(100%-var(--workspace-topbar-height))] wco:max-h-[calc(100%-var(--workspace-topbar-height))]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>
            <T>Workspace panel</T>
          </SheetTitle>
        </SheetHeader>
        {props.children}
      </SheetPopup>
    </Sheet>
  );
}

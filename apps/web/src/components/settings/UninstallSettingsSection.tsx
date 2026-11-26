import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import type { DesktopUninstallPlan } from "@t3tools/contracts";
import { msg, T, useGT } from "gt-react";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { m } from "../../i18n/messages";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const CONFIRMATION_PHRASE = "UNINSTALL";

function getDesktopUninstallBridge() {
  return typeof window === "undefined" ? undefined : window.desktopBridge?.uninstall;
}

export function UninstallSettingsSection() {
  const bridge = getDesktopUninstallBridge();
  const gt = useGT();
  const setting = useSearchableSetting();
  const [open, setOpen] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [plan, setPlan] = useState<DesktopUninstallPlan | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [running, setRunning] = useState(false);

  if (!bridge) return null;

  const openDialog = () => {
    setOpen(true);
    setConfirmationText("");
    setPlan(null);
    setLoadingPlan(true);
    void bridge
      .getPlan()
      .then((nextPlan) => {
        setPlan(nextPlan);
      })
      .catch((error: unknown) => {
        setOpen(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: m(msg("Could not prepare uninstall")),
            description:
              error instanceof Error
                ? (thrownErrorMessage(error, m) ?? error.message)
                : m(msg("Something went wrong.")),
          }),
        );
      })
      .finally(() => {
        setLoadingPlan(false);
      });
  };

  const confirmUninstall = () => {
    if (running || confirmationText.trim() !== CONFIRMATION_PHRASE) return;
    setRunning(true);
    void bridge.run().catch((error: unknown) => {
      setRunning(false);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: m(msg("Could not uninstall Phoenix")),
          description:
            error instanceof Error
              ? (thrownErrorMessage(error, m) ?? error.message)
              : m(msg("Something went wrong.")),
        }),
      );
    });
  };

  const canConfirm =
    !loadingPlan && !running && plan !== null && confirmationText.trim() === CONFIRMATION_PHRASE;

  return (
    <>
      <SettingsSection id="danger" title={gt("Danger")}>
        <SettingsRow
          {...setting("uninstall-app")}
          description={gt(
            "Permanently remove Phoenix, its background service, CLI command, databases, settings, caches, and local data from this computer.",
          )}
          control={
            <Button size="sm" variant="destructive-outline" onClick={openDialog}>
              <Trash2Icon />
              <T>Uninstall Phoenix</T>
            </Button>
          }
        />
      </SettingsSection>

      <AlertDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (running) return;
          setOpen(nextOpen);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>Uninstall Phoenix completely?</T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <div className="flex flex-col gap-3">
                <p>
                  <T>
                    This permanently deletes Phoenix from this computer, including all local
                    threads, databases, settings, caches, preferences, background services, and the
                    CLI command. Your project repositories on disk are not touched.
                  </T>
                </p>

                {loadingPlan ? (
                  <p className="text-xs text-muted-foreground">
                    <T>Scanning installed files…</T>
                  </p>
                ) : plan ? (
                  <div className="flex flex-col gap-2">
                    <p className="font-medium text-foreground text-xs">
                      <T>Items to be removed:</T>
                    </p>
                    <ul className="max-h-44 overflow-y-auto rounded-lg border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
                      {plan.hasBackgroundService ? (
                        <li>{gt("Background service (stopped and unregistered)")}</li>
                      ) : null}
                      {plan.cliCommandPath ? (
                        <li>{gt("CLI command: {path}", { path: plan.cliCommandPath })}</li>
                      ) : null}
                      {plan.paths.map((targetPath) => (
                        <li key={targetPath} className="break-all">
                          {targetPath}
                        </li>
                      ))}
                    </ul>
                    {!plan.isPackaged ? (
                      <p className="text-xs text-muted-foreground">
                        <T>
                          Running in development mode: your source checkout will not be deleted.
                        </T>
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-col gap-1.5 pt-1">
                  <label
                    htmlFor="uninstall-confirmation-input"
                    className="font-medium text-foreground text-xs"
                  >
                    {gt("Type {phrase} to confirm:", { phrase: CONFIRMATION_PHRASE })}
                  </label>
                  <Input
                    id="uninstall-confirmation-input"
                    value={confirmationText}
                    onChange={(event) => setConfirmationText(event.target.value)}
                    placeholder={CONFIRMATION_PHRASE}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={running}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={running} />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button variant="destructive" disabled={!canConfirm} onClick={confirmUninstall}>
              {running ? <T>Uninstalling…</T> : <T>Uninstall completely</T>}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useCallback, useState, type ReactElement, type ReactNode } from "react";

import { Button } from "./button";
import { usePortalContainer } from "./context";

export type ConfirmProps = {
  title?: ReactNode;
  /** A string is the description; anything else (a list, a field) renders as block content. */
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
  /**
   * Runs on confirm. The dialog stays open, its action busy, while a promise
   * runs; it stays open after `false` or a throw, and closes otherwise.
   */
  onConfirm?: () => unknown;
  /** Skip the question and run `onConfirm` straight from the trigger. */
  bypass?: boolean;
  /** The trigger opens nothing. */
  disabled?: boolean;
  /** Only the action is disabled, for a question whose message collects required input. */
  confirmDisabled?: boolean;
  /** Controlled: the caller owns `open` and renders no trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The trigger; omit it in controlled mode. */
  children?: ReactElement;
};

/** The editor's confirmation, never a native prompt. */
export function Confirm({
  title = "Are you sure?",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  onConfirm,
  bypass = false,
  disabled = false,
  confirmDisabled = false,
  open: openProp,
  onOpenChange,
  children,
}: ConfirmProps) {
  const container = usePortalContainer();
  const [openState, setOpenState] = useState(false);
  const [running, setRunning] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setOpenState(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const confirm = async () => {
    if (running) return;
    if (!onConfirm) return setOpen(false);
    setRunning(true);
    let close = true;
    try {
      close = (await onConfirm()) !== false;
    } catch {
      // The caller reports its own failure; the question stays up so it can be retried.
      close = false;
    } finally {
      setRunning(false);
    }
    if (close) setOpen(false);
  };

  const textMessage = typeof message === "string" || typeof message === "number";
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next && (bypass || disabled)) {
          if (bypass && !disabled) void onConfirm?.();
          return;
        }
        if (!next && running) return;
        setOpen(next);
      }}
    >
      {children ? <AlertDialog.Trigger render={children} /> : null}
      <AlertDialog.Portal container={container}>
        <AlertDialog.Backdrop className="je-backdrop" />
        <AlertDialog.Popup className="je-dialog" data-variant={variant}>
          <div className="je-dialog-header">
            <AlertDialog.Title className="je-dialog-title" data-variant={variant}>
              {title}
            </AlertDialog.Title>
            {textMessage ? (
              <AlertDialog.Description className="je-dialog-description">
                {message}
              </AlertDialog.Description>
            ) : null}
          </div>
          {message != null && !textMessage ? <div className="je-dialog-body">{message}</div> : null}
          <div className="je-dialog-footer">
            <AlertDialog.Close disabled={running} render={<Button variant="ghost" cue={null} />}>
              {cancelText}
            </AlertDialog.Close>
            <Button
              variant={variant === "destructive" ? "destructive" : "default"}
              busy={running}
              disabled={confirmDisabled}
              // oxlint-disable-next-line jsx-a11y/no-autofocus
              autoFocus={!confirmDisabled}
              onClick={() => void confirm()}
            >
              {confirmText}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

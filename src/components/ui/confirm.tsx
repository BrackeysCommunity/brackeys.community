"use client";

import { Store, useStore } from "@tanstack/react-store";
import * as React from "react";
import { useState, useCallback } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";

// ── Types ──────────────────────────────────────────────────────────

type ConfirmOptions = {
  title?: React.ReactNode;
  message?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
};

type ConfirmProps = ConfirmOptions & {
  onConfirm?: () => void | Promise<void>;
  bypass?: boolean;
  disabled?: boolean;
  /** Disables only the confirm action — for dialogs whose message collects
   * required input (the trigger still opens, so the requirement is visible).
   * While disabled the action also yields initial focus, so the dialog's
   * default — the first tabbable element, i.e. that input — takes it. */
  confirmDisabled?: boolean;
  /** Controlled mode: the caller owns `open` and renders no trigger — for a
   * dialog raised from a menu item, which unmounts the moment it's picked. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactElement;
};

/**
 * Title and message, shared by both surfaces. A string message is the
 * dialog's description; anything else (a reason field, a preview) is block
 * content and renders after the header instead of inside the description's
 * `<p>`, which can't legally hold it. A destructive question wears the
 * colour of its action, so the tint is on the title and not only the
 * button at the bottom.
 */
function ConfirmBody({
  title,
  message,
  variant,
}: {
  title: React.ReactNode;
  message?: React.ReactNode;
  variant: "default" | "destructive";
}) {
  const textMessage = typeof message === "string" || typeof message === "number";
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className={variant === "destructive" ? "text-destructive" : undefined}>
          {title}
        </AlertDialogTitle>
        {textMessage ? <AlertDialogDescription>{message}</AlertDialogDescription> : null}
      </AlertDialogHeader>
      {message && !textMessage ? (
        <div className="flex flex-col gap-3 text-xs/relaxed text-muted-foreground">{message}</div>
      ) : null}
    </>
  );
}

// ── <Confirm> Wrapper Component ────────────────────────────────────

function Confirm({
  title = "Are you sure?",
  message,
  confirmText = "Confirm",
  cancelText = "CANCEL",
  variant = "default",
  onConfirm,
  bypass = false,
  disabled = false,
  confirmDisabled = false,
  open: openProp,
  onOpenChange,
  children,
}: ConfirmProps) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setOpenState(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  const [loading, setLoading] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (!onConfirm) {
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch {
      // Keep modal open on error — let caller handle
    } finally {
      setLoading(false);
    }
  }, [onConfirm, setOpen]);

  const handleTriggerClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      if (bypass) {
        e.preventDefault();
        onConfirm?.();
        return;
      }
    },
    [bypass, disabled, onConfirm],
  );

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // The trigger opens regardless of preventDefault, so bypass/disabled
        // must be enforced here rather than in the click handler.
        if (next && (bypass || disabled)) return;
        setOpen(next);
      }}
    >
      {children ? <AlertDialogTrigger onClick={handleTriggerClick} render={children} /> : null}
      <AlertDialogContent>
        <ConfirmBody title={title} message={message} variant={variant} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            autoFocus={!confirmDisabled}
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={loading || confirmDisabled}
          >
            {loading && <Spinner className="mr-1.5 size-3" />}
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Imperative API: openConfirmModal() ─────────────────────────────

type ConfirmModalState = {
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
};

const confirmStore = new Store<ConfirmModalState>({
  options: null,
  resolve: null,
});

/**
 * Open a confirm modal imperatively. Returns a Promise<boolean>.
 *
 * @example
 * ```tsx
 * const confirmed = await openConfirmModal({
 *   title: "Delete item?",
 *   message: "This cannot be undone.",
 *   variant: "destructive",
 * });
 * if (confirmed) await deleteItem();
 * ```
 */
function openConfirmModal(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    confirmStore.setState(() => ({ options, resolve }));
  });
}

/**
 * Mount this once near the root of your app to enable `openConfirmModal()`.
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <>
 *       <Router />
 *       <ConfirmPortal />
 *     </>
 *   );
 * }
 * ```
 */
function ConfirmPortal() {
  const state = useStore(confirmStore);

  const handleClose = useCallback(
    (result: boolean) => {
      state.resolve?.(result);
      confirmStore.setState(() => ({ options: null, resolve: null }));
    },
    [state],
  );

  const isOpen = state.options !== null;
  const opts = state.options ?? {};

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose(false);
      }}
    >
      <AlertDialogContent>
        <ConfirmBody
          title={opts.title ?? "Are you sure?"}
          message={opts.message}
          variant={opts.variant ?? "default"}
        />
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => handleClose(false)}>
            {opts.cancelText ?? "CANCEL"}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={opts.variant === "destructive" ? "destructive" : "default"}
            onClick={async (e) => {
              e.preventDefault();
              handleClose(true);
            }}
          >
            {opts.confirmText ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { Confirm, ConfirmPortal, openConfirmModal };
export type { ConfirmProps, ConfirmOptions };

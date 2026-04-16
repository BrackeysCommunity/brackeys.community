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
  children: React.ReactElement;
};

// ── <Confirm> Wrapper Component ────────────────────────────────────

function Confirm({
  title = "Are you sure?",
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  onConfirm,
  bypass = false,
  disabled = false,
  children,
}: ConfirmProps) {
  const [open, setOpen] = useState(false);
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
  }, [onConfirm]);

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
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger onClick={handleTriggerClick} render={children} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {message && <AlertDialogDescription>{message}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            autoFocus
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={loading}
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
        <AlertDialogHeader>
          <AlertDialogTitle>{opts.title ?? "Are you sure?"}</AlertDialogTitle>
          {opts.message && <AlertDialogDescription>{opts.message}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => handleClose(false)}>
            {opts.cancelText ?? "Cancel"}
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

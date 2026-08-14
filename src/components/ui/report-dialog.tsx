"use client";

import * as React from "react";
import { useCallback, useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";

type ReportDialogProps = {
  title?: React.ReactNode;
  message?: React.ReactNode;
  placeholder?: string;
  maxLength?: number;
  submitText?: string;
  cancelText?: string;
  /** Rejecting keeps the dialog open with the reason intact, so the
   *  caller's error toast lands on a form the reporter can retry. */
  onSubmit: (reason: string) => void | Promise<unknown>;
  children: React.ReactElement;
};

/**
 * The `Confirm` shape with a required reason — every report surface
 * collects its "why" here rather than growing its own inline form.
 */
function ReportDialog({
  title = "Report this?",
  message = "Tell staff what's wrong. Only staff see this.",
  placeholder = "Reason",
  maxLength = 1000,
  submitText = "REPORT",
  cancelText = "CANCEL",
  onSubmit,
  children,
}: ReportDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await onSubmit(trimmed);
      setOpen(false);
      setReason("");
    } catch {
      // Keep the dialog open on error — the caller surfaces the message.
    } finally {
      setLoading(false);
    }
  }, [onSubmit, reason]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (loading) return;
        setOpen(next);
        if (!next) setReason("");
      }}
    >
      <AlertDialogTrigger render={children} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {message && <AlertDialogDescription>{message}</AlertDialogDescription>}
        </AlertDialogHeader>
        <Textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={placeholder}
          rows={3}
          maxLength={maxLength}
          disabled={loading}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading} className="tracking-widest">
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="tracking-widest"
            onClick={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            disabled={loading || !reason.trim()}
          >
            {loading && <Spinner className="mr-1.5 size-3" />}
            {submitText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { ReportDialog };
export type { ReportDialogProps };

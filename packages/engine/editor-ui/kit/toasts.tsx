import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useSyncExternalStore } from "react";

import type { EditorCue, EditorHost, EditorNotify, NotifyOptions } from "../host";
import { cx } from "./cx";
import { Icon } from "./icon";

export type ToastTone = "default" | "success" | "warning" | "error";

export type Toast = {
  id: string;
  tone: ToastTone;
  message: string;
  description?: string;
};

/** At most this many show; a newer toast pushes out the oldest. */
export const TOAST_LIMIT = 4;
export const TOAST_DURATION_MS = 5000;

export type Toaster = {
  /** The editor's default `notify`; a repeated `id` replaces that toast. */
  readonly notify: EditorNotify;
  toasts: () => readonly Toast[];
  subscribe: (listener: () => void) => () => void;
  dismiss: (id: string) => void;
  /** Clears every toast and timer. */
  destroy: () => void;
};

/** The default toast region's state; `notify.error` sounds the `error` cue. */
export function createToaster(
  opts: { cue?: (cue: EditorCue) => void; durationMs?: number; limit?: number } = {},
): Toaster {
  const durationMs = opts.durationMs ?? TOAST_DURATION_MS;
  const limit = opts.limit ?? TOAST_LIMIT;
  let list: readonly Toast[] = [];
  let seq = 0;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };
  const clearTimer = (id: string) => {
    clearTimeout(timers.get(id));
    timers.delete(id);
  };
  const dismiss = (id: string) => {
    if (!list.some((t) => t.id === id)) return;
    clearTimer(id);
    list = list.filter((t) => t.id !== id);
    emit();
  };

  const show = (tone: ToastTone, message: string, options?: NotifyOptions): string => {
    const id = options?.id ?? `toast-${++seq}`;
    clearTimer(id);
    const toast: Toast = { id, tone, message, description: options?.description };
    const rest = list.filter((t) => t.id !== id);
    const next = [...rest, toast];
    for (const dropped of next.slice(0, Math.max(0, next.length - limit))) clearTimer(dropped.id);
    list = next.slice(-limit);
    timers.set(
      id,
      setTimeout(() => dismiss(id), durationMs),
    );
    if (tone === "error") opts.cue?.("error");
    emit();
    return id;
  };

  const notify = Object.assign(
    (message: string, options?: NotifyOptions) => show("default", message, options),
    {
      success: (message: string, options?: NotifyOptions) => show("success", message, options),
      warning: (message: string, options?: NotifyOptions) => show("warning", message, options),
      error: (message: string, options?: NotifyOptions) => show("error", message, options),
    },
  ) satisfies EditorNotify;

  return {
    notify,
    toasts: () => list,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dismiss,
    destroy: () => {
      for (const id of timers.keys()) clearTimer(id);
      list = [];
      emit();
    },
  };
}

/** The host's `notify`, or the default region's. */
export function hostNotify(host: Pick<EditorHost, "notify">, toaster: Toaster): EditorNotify {
  return host.notify ?? toaster.notify;
}

/** The default notify region: plain and success toasts are `status`, errors `alert`. */
export function Toasts({ toaster, className }: { toaster: Toaster; className?: string }) {
  const toasts = useSyncExternalStore(toaster.subscribe, toaster.toasts, toaster.toasts);
  return (
    <section className={cx("je-toasts", className)} aria-label="Notifications">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="je-toast"
          data-tone={toast.tone}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <div className="je-toast-text">
            <p className="je-toast-message">{toast.message}</p>
            {toast.description ? <p className="je-toast-description">{toast.description}</p> : null}
          </div>
          <button
            type="button"
            className="je-toast-close"
            aria-label="Dismiss"
            onClick={() => toaster.dismiss(toast.id)}
          >
            <Icon icon={Cancel01Icon} size={12} />
          </button>
        </div>
      ))}
    </section>
  );
}

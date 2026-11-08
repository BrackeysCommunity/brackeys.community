import type { Store } from "@tanstack/store";

import type { EditorNotify } from "../host";

/**
 * Every async editor action as a task: the control that started it shows
 * busy at once, the status island shows tasks that outlast
 * `ACTIVITY_DELAY_MS`, and an error is announced once. Pure: no React.
 */

export type PendingTask = {
  id: string;
  label: string;
  /** A control or row (`project:rename:<assetId>`), a panel (`panel:problems`), or `editor`. */
  scope: string;
  progress: { done: number; total: number } | null;
  startedAt: number;
};
export type PendingStep = {
  progress(done: number, total?: number): void;
  label(text: string): void;
};
export type PendingRun<T> = {
  label: string;
  scope: string;
  /** One task per id; a second run with a running id joins the first. Default: `scope`. */
  id?: string;
  total?: number;
  /** Said on success; omit when the result shows on screen. */
  success?: string | ((value: T) => string | null);
  /** The error toast's title; its description is the error's message. */
  error: string | ((error: unknown) => string);
};
export type Pending = {
  readonly store: Store<{ tasks: readonly PendingTask[] }>;
  run<T>(
    spec: PendingRun<T>,
    work: (step: PendingStep) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: unknown }>;
  /** For work that isn't one promise (a debounce, a boot phase): busy until the returned call. */
  hold(spec: {
    id: string;
    label: string;
    scope: string;
  }): (outcome?: { error?: unknown; errorTitle?: string }) => void;
  busy(scope: string): PendingTask | undefined;
};

export const ACTIVITY_DELAY_MS = 300;

export const createPending: (opts: {
  notify: EditorNotify;
  now?: () => number;
}) => Pending = () => {
  throw new Error("createPending: not built");
};

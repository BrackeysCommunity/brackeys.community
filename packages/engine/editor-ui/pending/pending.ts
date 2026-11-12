import { Store } from "@tanstack/store";

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

type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createPending = (opts: { notify: EditorNotify; now?: () => number }): Pending => {
  const { notify, now = Date.now } = opts;
  const store = new Store<{ tasks: readonly PendingTask[] }>({ tasks: [] });
  const runs = new Map<string, Promise<Result<unknown>>>();
  const holds = new Map<string, { task: PendingTask; count: number }>();

  // Tasks are matched by identity, so a run and a hold that share an id stay apart.
  const add = (task: PendingTask) => store.setState((s) => ({ tasks: [...s.tasks, task] }));
  const remove = (task: PendingTask) =>
    store.setState((s) =>
      s.tasks.includes(task) ? { tasks: s.tasks.filter((t) => t !== task) } : s,
    );
  const update = (task: PendingTask, next: PendingTask) =>
    store.setState((s) =>
      s.tasks.includes(task) ? { tasks: s.tasks.map((t) => (t === task ? next : t)) } : s,
    );

  const announce = (title: string, error: unknown) =>
    notify.error(title, { description: errorMessage(error) });

  function run<T>(spec: PendingRun<T>, work: (step: PendingStep) => Promise<T>) {
    const id = spec.id ?? spec.scope;
    const joined = runs.get(id);
    if (joined) return joined as Promise<Result<T>>;

    let task: PendingTask = {
      id,
      label: spec.label,
      scope: spec.scope,
      progress: spec.total === undefined ? null : { done: 0, total: spec.total },
      startedAt: now(),
    };
    let settled = false;
    const set = (next: PendingTask) => {
      if (settled) return;
      update(task, next);
      task = next;
    };
    const step: PendingStep = {
      progress(done, total) {
        const last = task.progress;
        if (last && done < last.done) return;
        const whole = total ?? last?.total ?? spec.total ?? done;
        set({ ...task, progress: { done, total: Math.max(whole, done) } });
      },
      label(text) {
        set({ ...task, label: text });
      },
    };

    let resolve!: (result: Result<T>) => void;
    const promise = new Promise<Result<T>>((r) => (resolve = r));
    runs.set(id, promise);
    add(task);

    void (async () => {
      let result: Result<T>;
      try {
        const value = await work(step);
        result = { ok: true, value };
        const said = typeof spec.success === "function" ? spec.success(value) : spec.success;
        if (said) notify.success(said);
      } catch (error) {
        result = { ok: false, error };
        try {
          announce(typeof spec.error === "function" ? spec.error(error) : spec.error, error);
        } catch (thrown) {
          console.error(thrown);
        }
      } finally {
        settled = true;
        runs.delete(id);
        remove(task);
      }
      resolve(result);
    })();
    return promise;
  }

  function hold(spec: { id: string; label: string; scope: string }) {
    let held = holds.get(spec.id);
    if (held && store.state.tasks.includes(held.task)) held.count += 1;
    else {
      held = {
        task: { ...spec, progress: null, startedAt: now() },
        count: 1,
      };
      holds.set(spec.id, held);
      add(held.task);
    }
    const entry = held;
    let released = false;
    return (outcome?: { error?: unknown; errorTitle?: string }) => {
      if (released) return;
      released = true;
      entry.count -= 1;
      if (entry.count <= 0) {
        if (holds.get(spec.id) === entry) holds.delete(spec.id);
        remove(entry.task);
      }
      if (outcome?.error !== undefined)
        announce(outcome.errorTitle ?? `${spec.label} failed`, outcome.error);
    };
  }

  return {
    store,
    run,
    hold,
    busy(scope) {
      const { tasks } = store.state;
      for (let i = tasks.length - 1; i >= 0; i--) if (tasks[i]?.scope === scope) return tasks[i];
      return undefined;
    },
  };
};

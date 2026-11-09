import { useEffect, useReducer } from "react";

import type { SceneDocStatus } from "../connect/scene-doc";
import { Progress } from "../kit/progress";
import { Spinner } from "../kit/spinner";
import { ACTIVITY_DELAY_MS } from "../pending/pending";
import { usePendingTasks } from "../pending/use-pending";

export type SaveTone = "muted" | "success" | "warning" | "danger";

/**
 * What the status island says about the server holding the edits, in the
 * canvas editor's words. The dev server's file write after its debounce
 * isn't part of it.
 */
export function saveState(
  connection: SceneDocStatus,
  unsynced: number,
): { label: string; tone: SaveTone } {
  switch (connection) {
    case "connecting":
      return { label: "Connecting…", tone: "muted" };
    case "reconnecting":
      return { label: "Reconnecting…", tone: "warning" };
    case "offline":
      return unsynced > 0
        ? { label: "Offline — changes will sync", tone: "warning" }
        : { label: "Offline", tone: "warning" };
    case "failed":
      return { label: "Disconnected", tone: "danger" };
    case "live":
      return unsynced > 0
        ? { label: "Saving…", tone: "muted" }
        : { label: "Saved", tone: "success" };
  }
}

export function SaveState({
  connection,
  unsynced,
}: {
  connection: SceneDocStatus;
  unsynced: number;
}) {
  const { label, tone } = saveState(connection, unsynced);
  return (
    <span className="je-save-state" data-tone={tone}>
      {label}
    </span>
  );
}

/**
 * The newest task that has run for at least `ACTIVITY_DELAY_MS`, with its
 * progress when known and a count of the others; shorter tasks never show.
 */
export function Activity({ now = Date.now }: { now?: () => number }) {
  const tasks = usePendingTasks();
  const [, recheck] = useReducer((n: number) => n + 1, 0);

  const at = now();
  const shown = tasks.filter((task) => at - task.startedAt >= ACTIVITY_DELAY_MS);
  let nextAt = Infinity;
  for (const task of tasks) {
    const due = task.startedAt + ACTIVITY_DELAY_MS;
    if (due > at && due < nextAt) nextAt = due;
  }
  const waiting = Number.isFinite(nextAt) ? nextAt : null;

  useEffect(() => {
    if (waiting === null) return;
    const timer = setTimeout(recheck, Math.max(0, waiting - now()));
    return () => clearTimeout(timer);
  }, [waiting, now]);

  const task = shown.at(-1);
  const others = shown.length - 1;
  return (
    <span role="status" aria-live="polite" className="je-activity">
      {task ? (
        <>
          <Spinner size={12} label={null} />
          <span className="je-activity-label">{task.label}</span>
          {task.progress ? (
            <>
              <span className="je-activity-count">
                {task.progress.done} of {task.progress.total}
              </span>
              <Progress
                className="je-activity-progress"
                value={task.progress.done}
                max={task.progress.total}
                label={task.label}
              />
            </>
          ) : null}
          {others > 0 ? <span className="je-activity-more">+{others} more</span> : null}
        </>
      ) : null}
    </span>
  );
}

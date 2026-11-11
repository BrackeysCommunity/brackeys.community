import { Alert02Icon, AlertCircleIcon } from "@hugeicons/core-free-icons";
import type { Store } from "@tanstack/store";
import { useEffect, useReducer } from "react";

import type { EditorSession } from "../../editor/index";
import { Activity, saveState, SaveState } from "../frame/Activity";
import { useBottomRow } from "../frame/EditorFrame";
import { Icon } from "../kit/index";
import { ACTIVITY_DELAY_MS, type PendingTask } from "../pending/pending";
import { usePendingTasks } from "../pending/use-pending";
import type { EditorHostState } from "../session/live-scene-editor";
import { useEditorStore } from "../session/use-editor-store";
import type { SceneNotice } from "../session/use-scene-editor";
import { useStoreValue, type ReadableStore } from "../session/use-store-value";
import { distinctPeople, PeerFaces } from "./peer-faces";

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

// The status's widths, matching the stylesheet: the island's padding and
// border, the row's own padding, its gaps, a 12 px glyph, a face and the dot.
const W = { island: 10, pad: 16, gap: 12, tight: 6, char: 6, face: 16, overlap: 4, dot: 8 };
// The activity's: its spinner, the label's widest and least, the progress bar.
const A = { spinner: 12, label: 160, labelLeast: 64, bar: 64 };

const text = (s: string) => Math.ceil(s.length * W.char);
const facesWidth = (people: number, max: number) => {
  const shown = Math.min(people, max);
  if (shown === 0) return 0;
  const more = people > shown ? W.tight + text(`+${people - shown}`) : 0;
  return W.face + (shown - 1) * (W.face - W.overlap) + more;
};
const sum = (widths: readonly number[], gap: number) =>
  widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1);
const countWidth = (n: number) => 12 + 2 + text(String(n));

/**
 * What the activity takes beside the status's words, as `Activity` draws it
 * once its newest task outlasts the delay: in full, and with the label cut
 * short and the bar and "+n more" left out. Null while nothing shows.
 */
function useActivityWidths(now: () => number = Date.now): { full: number; least: number } | null {
  const tasks = usePendingTasks();
  const [, recheck] = useReducer((n: number) => n + 1, 0);
  const at = now();
  const shown = tasks.filter((t) => at - t.startedAt >= ACTIVITY_DELAY_MS);
  const due = tasks
    .map((t) => t.startedAt + ACTIVITY_DELAY_MS)
    .filter((d) => d > at)
    .reduce((a, b) => Math.min(a, b), Infinity);
  const waiting = Number.isFinite(due) ? due : null;
  useEffect(() => {
    if (waiting === null) return;
    const timer = setTimeout(recheck, Math.max(0, waiting - now()));
    return () => clearTimeout(timer);
  }, [waiting, now]);

  const task: PendingTask | undefined = shown.at(-1);
  if (!task) return null;
  const label = Math.min(A.label, text(task.label));
  const count = task.progress
    ? W.tight + text(`${task.progress.done} of ${task.progress.total}`)
    : 0;
  const bar = task.progress ? W.tight + A.bar : 0;
  const more = shown.length > 1 ? W.tight + text(`+${shown.length - 1} more`) : 0;
  const lead = W.gap + A.spinner + W.tight;
  return {
    full: lead + label + count + bar + more,
    least: lead + Math.min(label, A.labelLeast) + count,
  };
}

// The notice's width in the short row, matching `.je-status-notice`'s max-width: cut short past it.
const NOTICE_LEAST = 200;

const NO_NOTICE: ReadableStore<SceneNotice | null> = { state: null, subscribe: () => () => {} };

/**
 * The scene, why the editor last opened it by itself (an undo in another
 * scene), its save state, who is here, its errors and warnings and what is
 * running. When the bottom row is short it draws a save-state dot (with a
 * short word while the connection isn't live) and counts, keeping the full
 * words for screen readers and in the dot's hint; the notice and what is
 * running keep their words, cut short.
 */
export function EditorStatusBar({
  session,
  host,
  notice: noticeStore = NO_NOTICE,
}: {
  session: EditorSession;
  host: Store<EditorHostState>;
  /** Why the editor switched to this scene by itself. */
  notice?: ReadableStore<SceneNotice | null>;
}) {
  const sceneName = useEditorStore(session, (s) => s.sceneName);
  const notice = useStoreValue(noticeStore, (n) => n?.text ?? null);
  const issues = useEditorStore(session, (s) => s.issues);
  const peers = useEditorStore(session, (s) => s.peers);
  const connection = useStoreValue(host, (s) => s.connection);
  const unsynced = useStoreValue(host, (s) => s.unsynced ?? 0);
  const activity = useActivityWidths();
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warn").length;
  const others = distinctPeople(peers).length;
  const save = saveState(connection, unsynced);
  const here = others === 0 ? "Just you" : plural(others, "other here", "others here");
  const errorText = plural(errors, "error", "errors");
  const warningText = plural(warnings, "warning", "warnings");

  const full =
    W.island +
    W.pad +
    sum(
      [
        text(sceneName) + 4,
        notice ? text(notice) : -1,
        text(save.label),
        others > 0 ? facesWidth(others, 3) + 8 + text(here) : -1,
        errors > 0 ? text(errorText) : -1,
        warnings > 0 ? text(warningText) : -1,
      ].filter((w) => w >= 0),
      W.gap,
    );
  const least =
    W.island +
    W.pad +
    sum(
      [
        W.dot + (save.short ? W.tight + text(save.short) : 0),
        notice ? Math.min(text(notice), NOTICE_LEAST) : -1,
        errors > 0 ? countWidth(errors) : -1,
        warnings > 0 ? countWidth(warnings) : -1,
        others > 0 ? facesWidth(others, 1) : -1,
      ].filter((w) => w >= 0),
      W.tight,
    );
  const { compactStatus } = useBottomRow("status", {
    full,
    least,
    ...(activity ? { activity } : {}),
  });

  if (compactStatus) {
    return (
      <div role="status" className="je-status" data-compact="">
        <span className="je-sr-only">{sceneName}</span>
        <SaveState
          connection={connection}
          unsynced={unsynced}
          compact
          hint={[sceneName, notice, save.label].filter(Boolean).join(" · ")}
        />
        {notice ? (
          <span className="je-status-notice" data-tone="muted">
            {notice}
          </span>
        ) : null}
        {errors > 0 ? (
          <span className="je-status-count" data-tone="danger">
            <Icon icon={AlertCircleIcon} size={12} />
            <span aria-hidden>{errors}</span>
            <span className="je-sr-only">{errorText}</span>
          </span>
        ) : null}
        {warnings > 0 ? (
          <span className="je-status-count" data-tone="warning">
            <Icon icon={Alert02Icon} size={12} />
            <span aria-hidden>{warnings}</span>
            <span className="je-sr-only">{warningText}</span>
          </span>
        ) : null}
        <span className="je-status-peers" data-tone="muted">
          <PeerFaces peers={peers} label="Here:" size={16} max={1} />
          <span className="je-sr-only">{here}</span>
        </span>
        <Activity />
      </div>
    );
  }

  return (
    <div role="status" className="je-status">
      <span className="je-status-scene">{sceneName}</span>
      {notice ? (
        <span className="je-status-notice" data-tone="muted">
          {notice}
        </span>
      ) : null}
      <SaveState connection={connection} unsynced={unsynced} />
      {others > 0 ? (
        <span className="je-status-peers" data-tone="muted">
          <PeerFaces peers={peers} label="Here:" size={16} />
          {here}
        </span>
      ) : (
        <span className="je-sr-only">{here}</span>
      )}
      {errors > 0 ? <span data-tone="danger">{errorText}</span> : null}
      {warnings > 0 ? <span data-tone="warning">{warningText}</span> : null}
      <Activity />
    </div>
  );
}

import {
  resolveEditorKey,
  type EditorCommand,
  type EditorSession,
  type SceneIssue,
} from "@jams/engine/editor";
import { useCallback, useEffect } from "react";

import { Island } from "@/components/canvas/shell/CanvasShell";
import { Badge } from "@/components/ui/badge";
import { openConfirmModal } from "@/components/ui/confirm";
import { toast } from "@/lib/toast";

import { EditorInspector } from "./EditorInspector";
import { EditorOutliner } from "./EditorOutliner";
import { EditorStatusBar } from "./EditorStatusBar";
import { EditorToolbar } from "./EditorToolbar";
import { useEditorStore } from "./use-editor-store";

export type EditorShellProps = {
  session: EditorSession;
  onPlay: () => void;
  onStop: () => void;
  onSave: () => void;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function inOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]') !== null
  );
}

const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);

function blockingErrors(issues: SceneIssue[], action: string): boolean {
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length === 0) return false;
  toast.error(`Fix ${plural(errors.length, "error")} before you ${action}`, {
    description: errors[0]!.message,
  });
  return true;
}

/** Editor chrome floated over the game canvas. In play mode only a stop hint remains. */
export function EditorShell({ session, onPlay, onStop, onSave }: EditorShellProps) {
  const mode = useEditorStore(session, (s) => s.mode);

  const play = useCallback(() => {
    if (!blockingErrors(session.store.state.issues, "play")) onPlay();
  }, [session, onPlay]);

  const save = useCallback(async () => {
    const issues = session.store.state.issues;
    if (blockingErrors(issues, "save")) return;
    const warnings = issues.filter((i) => i.severity === "warn");
    if (warnings.length > 0) {
      const ok = await openConfirmModal({
        title: `Save with ${plural(warnings.length, "warning")}?`,
        message: (
          <ul className="list-disc pl-4">
            {warnings.slice(0, 8).map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
            {warnings.length > 8 ? <li>and {warnings.length - 8} more</li> : null}
          </ul>
        ),
        confirmText: "Save",
      });
      if (!ok) return;
    }
    onSave();
  }, [session, onSave]);

  const run = useCallback(
    (cmd: EditorCommand) => {
      switch (cmd) {
        case "undo":
          session.undo();
          return;
        case "redo":
          session.redo();
          return;
        case "delete": {
          const refs = session.store.state.selection;
          if (refs.length > 0) session.dispatch({ ops: [{ op: "remove", refs }] });
          return;
        }
        case "escape":
          session.select([], "replace");
          return;
        case "play":
          play();
          return;
        case "stop":
          onStop();
          return;
        case "save":
          void save();
          return;
      }
    },
    [session, play, save, onStop],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || inOverlay(e.target)) return;
      const cmd = resolveEditorKey(e, {
        mode: session.store.state.mode,
        editableTarget: isEditableTarget(e.target),
      });
      if (!cmd) return;
      e.preventDefault();
      run(cmd);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, run]);

  if (mode === "play") {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
        <Badge size="label" variant="secondary">
          Playing · Esc to stop
        </Badge>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-3 z-20">
      <Island className="absolute top-0 left-1/2 -translate-x-1/2">
        <EditorToolbar session={session} onPlay={play} onSave={() => void save()} />
      </Island>
      <Island className="absolute top-14 bottom-14 left-0 flex w-72 max-w-[calc(100%-1.5rem)] flex-col items-stretch overflow-hidden">
        <EditorOutliner session={session} />
      </Island>
      <Island className="absolute top-14 right-0 flex max-h-[calc(100%-7rem)] w-72 flex-col items-stretch overflow-y-auto">
        <EditorInspector session={session} />
      </Island>
      <Island className="absolute bottom-0 left-0">
        <EditorStatusBar session={session} />
      </Island>
    </div>
  );
}

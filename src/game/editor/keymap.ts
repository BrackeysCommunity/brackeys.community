import type { EditorMode } from "./store";

export type EditorCommand = "undo" | "redo" | "delete" | "escape" | "play" | "stop" | "save";

export type EditorKeyEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

export type EditorKeyContext = {
  mode: EditorMode;
  /** Focus is in a text field, select or contenteditable. */
  editableTarget: boolean;
};

/**
 * Mod is Ctrl or Cmd. Play is Mod+Enter, not Mod+P, which opens the print
 * dialog; Shift+Mod+Enter is kept for playing from the cursor.
 */
export function resolveEditorKey(e: EditorKeyEvent, ctx: EditorKeyContext): EditorCommand | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (mod && !e.altKey && !e.shiftKey && key === "s") return "save";
  if (ctx.editableTarget) return null;

  if (ctx.mode === "play") {
    return key === "Escape" && !mod && !e.altKey ? "stop" : null;
  }

  if (mod && !e.altKey) {
    if (key === "z") return e.shiftKey ? "redo" : "undo";
    if (key === "y" && !e.shiftKey) return "redo";
    if (key === "Enter" && !e.shiftKey) return "play";
    return null;
  }
  if (e.altKey) return null;
  if ((key === "Delete" || key === "Backspace") && !e.shiftKey) return "delete";
  if (key === "Escape") return "escape";
  return null;
}

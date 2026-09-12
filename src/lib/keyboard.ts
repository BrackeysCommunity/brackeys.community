import type { KeyboardEvent } from "react";

/**
 * The house answer to "I typed the thing, now what":
 *
 * - Enter submits a single-line field.
 * - Ctrl/Cmd+Enter submits a multi-line one; plain Enter keeps inserting
 *   a newline there.
 * - Escape closes the nearest overlay (dialogs and popovers own that one).
 *
 * Both predicates ignore a key that is still part of an IME composition,
 * which also arrives as Enter.
 */
export function isSubmitKey(e: KeyboardEvent): boolean {
  return (
    e.key === "Enter" &&
    !e.shiftKey &&
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.nativeEvent.isComposing
  );
}

export function isMultilineSubmitKey(e: KeyboardEvent): boolean {
  return e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing;
}

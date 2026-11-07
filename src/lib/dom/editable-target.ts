/** Where a key press is typing: a text field, select, contenteditable or CodeMirror editor. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest(
      '.cm-editor, input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    ) != null
  );
}

/**
 * Whether `el` (by default the focused element) is inside a menu, popover or
 * dialog, which owns Escape and shortcuts while focus is there.
 */
export function inOverlay(el: EventTarget | null = document.activeElement): boolean {
  return (
    el instanceof Element &&
    el.closest(
      '[role="menu"], [role="dialog"], [role="alertdialog"], [data-slot="popover-content"]',
    ) != null
  );
}

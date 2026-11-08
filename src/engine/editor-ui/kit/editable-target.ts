export { isEditableTarget } from "../../tool-router";

/**
 * Whether `el` (by default the focused element) is inside a menu, popover or
 * dialog, which owns Escape and shortcuts while focus is there.
 */
export function inOverlay(el: EventTarget | null = document.activeElement): boolean {
  return (
    el instanceof Element &&
    el.closest('[role="menu"], [role="dialog"], [role="alertdialog"], [data-je-overlay]') != null
  );
}

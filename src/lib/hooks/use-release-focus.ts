import { useEffect } from "react";

/**
 * Drops DOM focus when an overlay opens.
 *
 * The control that opened it keeps focus while the overlay marks the
 * page behind it `aria-hidden`, and browsers reject that — focus must
 * never sit inside a hidden subtree. Releasing it here lets the overlay
 * take focus cleanly.
 */
export function useReleaseFocusOnOpen(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, [open]);
}

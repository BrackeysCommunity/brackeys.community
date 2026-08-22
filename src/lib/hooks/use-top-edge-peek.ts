import { useEffect, useState } from "react";

// How close to the top edge the pointer has to get to summon the bar. Small on
// purpose — this is the "shove the cursor at the ceiling" gesture, so it should
// not fire while you're aiming at anything real.
const EDGE = 6;
// Once summoned the bar stays out while the pointer is anywhere in this band,
// which covers the bar itself plus a little slack. Re-arming at `EDGE` instead
// would snatch the nav away the moment you moved down onto it.
const KEEP_OPEN_WITHIN = 96;
// Debounces: just long enough that a cursor flung across the top of the screen
// doesn't drag the bar out behind it. Kept short so the reveal reads as a
// direct response to the gesture rather than a delay.
const ENTER_DELAY = 60;
const LEAVE_DELAY = 150;

/**
 * Reveals an auto-hidden top bar when the pointer is parked at the very top of
 * the viewport, and lets it go again once the pointer wanders off. Pairs with
 * {@link useHideOnScrollDown} — pass its result as `enabled` so the peek only
 * exists while the bar is actually hidden, and so scrolling back up (which
 * clears `enabled`) takes over cleanly.
 */
export function useTopEdgePeek(enabled: boolean): boolean {
  const [peeking, setPeeking] = useState(false);

  // Drop any peek the moment the bar stops being hidden (reset during render,
  // so the next paint is already correct).
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled);
    setPeeking(false);
  }

  useEffect(() => {
    if (!enabled) return;

    // `open` mirrors the committed state; `pending` is the state a timer is
    // counting toward. Tracking `pending` is what makes the debounce survive a
    // continuous mousemove stream — re-scheduling on every event would keep
    // pushing the deadline out and the bar would never appear.
    let open = false;
    let pending: boolean | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const want = (next: boolean, delay: number) => {
      if (next === open) {
        // Back where we started — call off any countdown in the other direction.
        if (pending !== null) {
          clearTimeout(timer);
          pending = null;
        }
        return;
      }
      if (pending === next) return;
      if (pending !== null) clearTimeout(timer);
      pending = next;
      timer = setTimeout(() => {
        pending = null;
        open = next;
        setPeeking(next);
      }, delay);
    };

    const onMove = (event: MouseEvent) => {
      if (open) want(event.clientY <= KEEP_OPEN_WITHIN, LEAVE_DELAY);
      else want(event.clientY <= EDGE, ENTER_DELAY);
    };

    // Leaving through the top of the window (to the browser chrome) stops
    // firing mousemove, so retract on the way out rather than staying stuck open.
    const onLeave = () => want(false, LEAVE_DELAY);

    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [enabled]);

  return peeking;
}

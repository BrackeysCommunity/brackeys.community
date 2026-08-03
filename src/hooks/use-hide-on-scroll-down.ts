import { useEffect, useState } from "react";

// Don't start hiding until scrolled past this — keeps the bar pinned at the top.
const REVEAL_AT = 150;
// Pixels of continuous travel in one direction before the bar reacts. Without
// this buffer a 1px jitter (or the natural wobble at a momentum-scroll direction
// change) flips the bar every frame. Measured from the turning point, so a real
// swipe still crosses it almost immediately.
const BUFFER = 24;

/**
 * Tracks vertical scroll *direction* to drive an auto-hiding top bar: hidden
 * while scrolling down, revealed as soon as you scroll up. A directional buffer
 * keeps tiny jitters from toggling it. Disabled under reduced-motion, and
 * returns false on the server / first paint so the bar always renders open.
 *
 * The page doesn't scroll the document here — the shells in `routes/__root.tsx`
 * put `overflow-y-auto` on an inner container — so this listens in the capture
 * phase (scroll events don't bubble) and only reacts to elements tagged
 * `data-scroll-root`. That keeps horizontal chip rows and the page-specific
 * sidebar from driving the header.
 *
 * @param resetKey change this (e.g. the pathname) to force the bar back open;
 * a freshly mounted scroll container sits at 0 but never fires a scroll event
 * to say so.
 */
export function useHideOnScrollDown(resetKey?: string): boolean {
  const [hidden, setHidden] = useState(false);

  // Reset during render rather than in an effect — no wasted paint of the
  // hidden bar on the page you just navigated to.
  const [prevKey, setPrevKey] = useState(resetKey);
  if (prevKey !== resetKey) {
    setPrevKey(resetKey);
    setHidden(false);
  }

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    // Last observed position, the direction we're travelling, and the position
    // where that direction last began (the turning point the buffer measures
    // from).
    let prevY = 0;
    let dir: "up" | "down" = "up";
    let anchor = 0;

    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.hasAttribute("data-scroll-root")) return;

      const current = el.scrollTop;
      const previous = prevY;
      prevY = current;
      const delta = current - previous;
      if (delta === 0) return;
      const goingDown = delta > 0;

      // On a direction reversal, plant the anchor at the turning point so the
      // buffer counts travel *since* the reversal, not since we last toggled.
      if (goingDown ? dir === "up" : dir === "down") {
        dir = goingDown ? "down" : "up";
        anchor = previous;
      }

      if (current <= REVEAL_AT) {
        setHidden(false);
        return;
      }

      const travelled = current - anchor; // positive down, negative up
      if (goingDown && travelled > BUFFER) setHidden(true);
      else if (!goingDown && -travelled > BUFFER) setHidden(false);
    };

    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, []);

  return hidden;
}

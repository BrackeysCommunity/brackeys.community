import type { Transition } from "framer-motion";
import { useEffect, useState } from "react";

import { useReducedMotion } from "@/lib/hooks/use-app-settings";

// Fallback for pages that don't mark a hero (`data-header-hero`).
const PIN_UNTIL = 320;
// Travel in one direction before the bar reacts, measured from the turning
// point — without it, momentum-scroll wobble flips the bar every frame.
const BUFFER = 24;

// Leaves immediately and decelerates in; a symmetric ease reads as lag.
const SLIDE: Transition = { duration: 0.4, ease: [0.32, 0.72, 0, 1] };
const SNAP: Transition = { duration: 0 };

/**
 * The transition the app bars slide on; zero under reduced motion. The
 * `.header-follow` transition in `styles.css` is the same movement, so its
 * duration and curve have to match these.
 */
export function useHeaderSlideTransition(): Transition {
  return useReducedMotion() ? SNAP : SLIDE;
}

/**
 * Tracks scroll *direction* to drive an auto-hiding top bar. False on the server
 * and first paint, so the bar always renders open.
 *
 * The document doesn't scroll here — the shells in `routes/__root.tsx` put
 * `overflow-y-auto` on an inner container — so this listens in the capture phase
 * and only reacts to elements tagged `data-scroll-root`.
 *
 * @param resetKey change this (e.g. the pathname) to force the bar back open; a
 * freshly mounted scroll container sits at 0 but never fires a scroll event.
 */
export function useHideOnScrollDown(resetKey?: string): boolean {
  const [hidden, setHidden] = useState(false);

  // During render, not in an effect: no wasted paint of a hidden bar.
  const [prevKey, setPrevKey] = useState(resetKey);
  if (prevKey !== resetKey) {
    setPrevKey(resetKey);
    setHidden(false);
  }

  useEffect(() => {
    let prevY = 0;
    let dir: "up" | "down" = "up";
    let anchor = 0;

    // Measured on first use and again on hero resize, so a hero that is still
    // a skeleton doesn't lock in a short value.
    let pinned: number | null = null;
    let heroSize: ResizeObserver | undefined;

    const pinnedUntil = (root: HTMLElement) => {
      if (pinned !== null) return pinned;
      const hero = root.querySelector<HTMLElement>("[data-header-hero]");
      // Keep looking on the next scroll: the page may not have rendered it yet.
      if (!hero) return PIN_UNTIL;
      if (!heroSize) {
        heroSize = new ResizeObserver(() => {
          pinned = null;
        });
        heroSize.observe(hero);
      }
      pinned =
        hero.getBoundingClientRect().bottom - root.getBoundingClientRect().top + root.scrollTop;
      return pinned;
    };

    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.hasAttribute("data-scroll-root")) return;

      const current = el.scrollTop;
      const previous = prevY;
      prevY = current;
      const delta = current - previous;
      if (delta === 0) return;
      const goingDown = delta > 0;

      // Anchor at the turning point, so the buffer counts travel since the
      // reversal rather than since the last toggle.
      if (goingDown ? dir === "up" : dir === "down") {
        dir = goingDown ? "down" : "up";
        anchor = previous;
      }

      if (current <= pinnedUntil(el)) {
        setHidden(false);
        return;
      }

      const travelled = current - anchor; // positive down, negative up
      if (goingDown && travelled > BUFFER) setHidden(true);
      else if (!goingDown && -travelled > BUFFER) setHidden(false);
    };

    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      heroSize?.disconnect();
    };
    // Re-armed per page: travel state and measurement belong to one route.
  }, [resetKey]);

  return hidden;
}

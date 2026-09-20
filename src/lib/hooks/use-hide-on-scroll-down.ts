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
 * Direction is the only thing read from the user; everything else is measured
 * off the live scroller. Nothing here may assume where the page sits: the
 * router moves the scroller on its own (restoring a back/forward offset, or
 * scrolling a new route to the top), a shell can hand over a different
 * scroller mid-navigation, and either one arrives without a scroll event or
 * with one that has no travel behind it.
 *
 * @param resetKey change this (e.g. the pathname) to force the bar back open;
 * arriving somewhere new should always show the nav.
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
    // The scroller the numbers below describe, and where it was last seen.
    // `null` means unmeasured — the distinction matters, because treating an
    // unknown position as 0 turns the router's scroll restoration into a
    // page-long scroll *down* and slams the bar shut on arrival.
    let root: HTMLElement | null = null;
    let prevY: number | null = null;
    let dir: "up" | "down" = "up";
    let anchor = 0;

    // Measured on first use and again on hero resize, so a hero that is still
    // a skeleton doesn't lock in a short value.
    let pinned: number | null = null;
    let heroSize: ResizeObserver | undefined;

    const pinnedUntil = (el: HTMLElement) => {
      if (pinned !== null) return pinned;
      const hero = el.querySelector<HTMLElement>("[data-header-hero]");
      // Keep looking on the next scroll: the page may not have rendered it yet.
      if (!hero) return PIN_UNTIL;
      if (!heroSize) {
        heroSize = new ResizeObserver(() => {
          pinned = null;
        });
        heroSize.observe(hero);
      }
      pinned = hero.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop;
      return pinned;
    };

    /** Take `el`'s position as the new zero point for travel. */
    const rebase = (el: HTMLElement) => {
      if (el !== root) {
        root = el;
        pinned = null;
        heroSize?.disconnect();
        heroSize = undefined;
      }
      prevY = el.scrollTop;
      anchor = el.scrollTop;
      dir = "up";
    };

    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.hasAttribute("data-scroll-root")) return;

      const current = el.scrollTop;

      // Nothing to compare against: this is the first event from this
      // scroller, so the jump to `current` is as likely to be the router
      // restoring an offset as it is to be the user. Take the position and
      // read direction from the next one.
      if (el !== root || prevY === null) {
        rebase(el);
        if (current <= pinnedUntil(el)) setHidden(false);
        return;
      }

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

    // The bar can't be left hanging over a page that is sitting at the top,
    // and a scroll event is not enough to guarantee that: the router restores
    // scroll in a layout effect after the route commits, and a shell that
    // swapped scrollers (its two branches mount different elements) hands over
    // a fresh one already at 0, which never fires anything. So measure the
    // live scroller once the incoming page has painted.
    const settle = () => {
      const el = document.querySelector<HTMLElement>("[data-scroll-root]");
      if (!el) return;
      rebase(el);
      if (el.scrollTop <= pinnedUntil(el)) setHidden(false);
    };

    let frame = 0;
    const settleAfterPaint = () => {
      cancelAnimationFrame(frame);
      // Two frames: the first lands after the router's restoration, the second
      // after the new page has had a chance to lay out under it.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(settle);
      });
    };
    settleAfterPaint();

    // Back/forward inside one page (the filters write to the search params)
    // never changes `resetKey`, so this effect isn't re-armed — and that is
    // the navigation most likely to move the scroller out from under us.
    window.addEventListener("popstate", settleAfterPaint);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("popstate", settleAfterPaint);
      document.removeEventListener("scroll", onScroll, true);
      heroSize?.disconnect();
    };
    // Re-armed per page: travel state and measurement belong to one route.
  }, [resetKey]);

  return hidden;
}

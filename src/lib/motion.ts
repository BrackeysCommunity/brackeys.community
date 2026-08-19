import type { Variants } from "framer-motion";

/** The house easing — a soft overshoot-free ease-out used by every
 * deliberate transition in the app. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Page-level stagger. No `delayChildren`: the cross-route view
 * transition runs *over* the new pane, so anything held back until it
 * finishes is a page that reads as empty for as long as the handoff
 * lasts. The sections start immediately and the stagger is short enough
 * that a six-section page is fully settled inside ~400ms. */
export const pageContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.12, ease: EASE_OUT, staggerChildren: 0.035 },
  },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.22, ease: EASE_OUT },
  },
};

/**
 * `fadeUp` without the travel — for a section that contains a
 * `position: sticky` descendant.
 *
 * A transform on an ancestor re-resolves a sticky element's containing
 * block, so a stuck child stops tracking the content it sits in: it holds
 * still through the rise and then jumps by the travel distance at the end,
 * when framer clears the transform. Opacity has no such effect.
 */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.22, ease: EASE_OUT },
  },
};

export const fadeLeft: Variants = {
  hidden: { opacity: 0, x: 12 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.24, ease: EASE_OUT },
  },
};

/** A row of cards that staggers its own children on top of the page
 * stagger — opacity stays at 1 so the row itself never dips. */
export const cardRow: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

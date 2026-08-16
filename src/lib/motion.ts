import type { Variants } from "framer-motion";

/** The house easing — a soft overshoot-free ease-out used by every
 * deliberate transition in the app. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Page-level stagger. The 0.25 delay hands off from the cross-route view
 * transition: the pane finishes its fade+rise as the first child starts. */
export const pageContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.25 },
  },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: EASE_OUT },
  },
};

export const fadeLeft: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.45, ease: EASE_OUT },
  },
};

/** A row of cards that staggers its own children on top of the page
 * stagger — opacity stays at 1 so the row itself never dips. */
export const cardRow: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};

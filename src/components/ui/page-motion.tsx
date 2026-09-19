import { motion, type HTMLMotionProps } from "framer-motion";

import { useReducedMotion } from "@/lib/hooks/use-app-settings";
import { useIsHydrated } from "@/lib/hooks/use-is-hydrated";
import { pageContainer } from "@/lib/motion";

/**
 * The page-level stagger container. Wrap a page's top-level element and
 * tag its major sections with `fadeUp`/`fadeLeft`/`cardRow` from
 * `@/lib/motion` — 3–6 sections, not every leaf.
 *
 * `initial={false}` — children mount straight into `visible` with no
 * animation and, crucially, no stagger delay — is the whole story in two
 * cases:
 *
 * - Under reduced motion. `MotionConfig` alone zeroes durations but still
 *   walks the children through the schedule.
 * - On the server render and the hydrating render that matches it. The
 *   `hidden` variant is `opacity: 0`, which framer serialises as an inline
 *   `style="opacity:0"` in the SSR output — so the page has its full DOM at
 *   first paint and stays blank until ~780KB of JS lands and React commits.
 *   That was seconds of "element render delay" on every route. The entrance
 *   is for arriving somewhere, and a hydrating page has already arrived.
 *
 * Client navigations keep the stagger: `useIsHydrated` only reports false
 * for the initial tree.
 */
export function PageStack({ children, ...props }: HTMLMotionProps<"div">) {
  const reduced = useReducedMotion();
  const hydrated = useIsHydrated();

  return (
    <motion.div
      variants={pageContainer}
      initial={reduced || !hydrated ? false : "hidden"}
      animate="visible"
      {...props}
    >
      {children}
    </motion.div>
  );
}

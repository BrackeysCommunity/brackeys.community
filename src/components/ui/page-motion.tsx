import { motion, type HTMLMotionProps } from "framer-motion";

import { useReducedMotion } from "@/lib/hooks/use-app-settings";
import { pageContainer } from "@/lib/motion";

/**
 * The page-level stagger container. Wrap a page's top-level element and
 * tag its major sections with `fadeUp`/`fadeLeft`/`cardRow` from
 * `@/lib/motion` — 3–6 sections, not every leaf.
 *
 * Under reduced motion `initial={false}` is the whole story: children
 * mount straight into `visible` with no animation and, crucially, no
 * stagger delay — `MotionConfig` alone zeroes durations but still walks
 * the children through the schedule.
 */
export function PageStack({ children, ...props }: HTMLMotionProps<"div">) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      variants={pageContainer}
      initial={reduced ? false : "hidden"}
      animate="visible"
      {...props}
    >
      {children}
    </motion.div>
  );
}

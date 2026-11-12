import type { ComponentProps } from "react";

import { cx } from "./cx";

/** A placeholder block while something loads; size it with `style` or a class. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden {...props} className={cx("je-skeleton", className)} />;
}

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type { ReactNode } from "react";

import { cx } from "./cx";

/** A determinate bar (`value` of `max`), or an indeterminate one when `value` is null. */
export function Progress({
  value,
  max = 100,
  label,
  className,
}: {
  value: number | null;
  max?: number;
  /** The accessible name; also shown above the bar when given as a node. */
  label?: ReactNode;
  className?: string;
}) {
  return (
    <ProgressPrimitive.Root
      value={value}
      max={max}
      className={cx("je-progress", className)}
      aria-label={typeof label === "string" ? label : undefined}
    >
      {label != null && typeof label !== "string" ? (
        <ProgressPrimitive.Label className="je-progress-label">{label}</ProgressPrimitive.Label>
      ) : null}
      <ProgressPrimitive.Track className="je-progress-track">
        <ProgressPrimitive.Indicator className="je-progress-bar" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

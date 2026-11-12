import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type { ReactNode } from "react";

import { cx } from "./cx";

export type ProgressTone = "primary" | "warning" | "danger";

/**
 * A determinate bar (`value` of `max`), or an indeterminate one when `value`
 * is null. `tone` colours the bar, e.g. for a nearly-full or full quota.
 */
export function Progress({
  value,
  max = 100,
  label,
  tone = "primary",
  className,
}: {
  value: number | null;
  max?: number;
  /** The accessible name; also shown above the bar when given as a node. */
  label?: ReactNode;
  tone?: ProgressTone;
  className?: string;
}) {
  return (
    <ProgressPrimitive.Root
      value={value}
      max={max}
      className={cx("je-progress", className)}
      data-tone={tone}
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

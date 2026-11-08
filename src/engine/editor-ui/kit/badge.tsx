import type { ComponentProps } from "react";

import { cx } from "./cx";

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "warning"
  | "success"
  | "outline"
  | "ghost";

export type BadgeProps = ComponentProps<"span"> & {
  variant?: BadgeVariant;
  /** `label` is the mono micro voice, for issue codes and states. */
  size?: "default" | "label";
};

/** A short state or count beside a row or control. */
export function Badge({ variant = "default", size = "default", className, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={cx("je-badge", className)}
      data-variant={variant}
      data-size={size}
    />
  );
}

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cx } from "./cx";

/** The kit's one busy glyph. `label` null makes it decorative, for a control that says `aria-busy` itself. */
export function Spinner({
  size = 14,
  label = "Loading",
  className,
}: {
  size?: number;
  label?: string | null;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      size={size}
      strokeWidth={2}
      className={cx("je-spinner", className)}
      role={label ? "status" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    />
  );
}

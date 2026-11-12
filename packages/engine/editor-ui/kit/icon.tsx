import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { cx } from "./cx";

export type { IconSvgElement };

/** A Hugeicons glyph at the kit's sizes; decorative unless given a label. */
export function Icon({
  icon,
  size = 14,
  label,
  className,
}: {
  icon: IconSvgElement;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={2}
      className={cx("je-icon", className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}

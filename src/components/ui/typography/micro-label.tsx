import { forwardRef } from "react";

import { cn } from "@/lib/utils";

import { Text, type TextProps } from "./text";

type MicroLabelProps = Omit<TextProps, "size" | "monospace">;

/**
 * The house micro-label voice — `font-mono text-[10px] tracking-widest`,
 * muted by default. Section markers (`§ 01`), stat captions, host names,
 * timestamps and the like.
 *
 * It exists because that class string was spelled raw across dozens of
 * files, so any change to the label style was a many-file diff. `variant`
 * still overrides the color for the handful of labels that are not muted;
 * `Badge` carries the same voice as `size="label"`.
 */
const MicroLabel = forwardRef<HTMLElement, MicroLabelProps>(
  ({ variant = "muted", className, ...props }, ref) => (
    <Text
      ref={ref}
      monospace
      size="xs"
      variant={variant}
      className={cn("tracking-widest", className)}
      {...props}
    />
  ),
);
MicroLabel.displayName = "MicroLabel";

export { MicroLabel, type MicroLabelProps };

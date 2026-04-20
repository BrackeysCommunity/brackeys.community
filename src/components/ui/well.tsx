import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { type NotchOpts, buildNotchPath, resolveNotchOpts } from "@/lib/notch";
import { cn } from "@/lib/utils";

const wellVariants = cva(
  "relative flex flex-col rounded-xs bg-card/85 text-card-foreground backdrop-blur-md",
  {
    variants: {
      variant: {
        default: "chonk-deboss border border-input",
        ghost: "border border-muted/60",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type WellProps = React.ComponentProps<"div"> &
  VariantProps<typeof wellVariants> & {
    notchOpts?: NotchOpts | true;
  };

/**
 * Debossed container surface. Non-interactive frame for panels, readouts, and
 * list containers. Pass `notchOpts` for the notched variant.
 *
 * Notched composition mirrors `Input`: an outer `rounded-xs overflow-hidden`
 * wrapper keeps a subtle radius at the non-notched corners, a middle layer
 * clipped to the outer notch path and filled with `var(--deboss-shadow)` acts
 * as the 1px frame, and the inner content surface clips to the same path
 * inset by 1px and carries the inset deboss shadow.
 */
function Well({ className, variant, notchOpts, style, children, ...props }: WellProps) {
  if (notchOpts) {
    const resolved = resolveNotchOpts(notchOpts === true ? { size: 14 } : notchOpts);
    return (
      <div
        data-slot="well"
        data-notched="true"
        className={cn("flex w-full overflow-hidden rounded-xs", className)}
        style={style}
      >
        <div
          className="flex w-full"
          style={{
            clipPath: buildNotchPath(resolved),
            background: "var(--deboss-shadow)",
          }}
        >
          <div
            className={cn(
              "relative flex w-full flex-col bg-card/85 text-card-foreground backdrop-blur-md",
              variant !== "ghost" &&
                "shadow-[inset_0_4px_0_0_var(--deboss-shadow)]",
            )}
            style={{ clipPath: buildNotchPath(resolved, 1) }}
            {...props}
          >
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-slot="well"
      className={cn(wellVariants({ variant }), className)}
      style={style}
      {...props}
    >
      {children}
    </div>
  );
}

export { Well, wellVariants };
export type { WellProps };

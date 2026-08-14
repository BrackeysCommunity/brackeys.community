import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { type NotchOpts, buildNotchPath, resolveNotchOpts } from "@/lib/notch";
import { cn } from "@/lib/utils";

const wellVariants = cva(
  "relative flex flex-col rounded-lg bg-card/85 text-card-foreground backdrop-blur-md",
  {
    variants: {
      variant: {
        // The recessed read is just a heavier top edge — a real border, so it
        // takes part in layout and the radius instead of an inset shadow
        // painted over the content. One colour for all four sides: a corner
        // where the widths change is mitered on the diagonal, so a top edge
        // that differs in colour as well draws a visible wedge through the
        // radius.
        default: "border border-t-[3px] border-deboss-shadow",
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
    /** Notched only: classes for the inner content surface. `className` lands
     * on the outer clip wrapper there, so it can't reach the fill — this is
     * how a notched well opts out of the default translucent card. */
    surfaceClassName?: string;
  };

/**
 * Debossed container surface. Non-interactive frame for panels, readouts, and
 * list containers. Pass `notchOpts` for the notched variant.
 *
 * Notched composition mirrors `Input`: an outer `rounded-lg overflow-hidden`
 * wrapper carries the radius at the non-notched corners, a middle layer
 * clipped to the outer notch path and filled with `var(--deboss-shadow)` acts
 * as the 1px frame, and the inner content surface takes the same path a notch
 * size smaller and thickens its own top border to match the plain variant.
 *
 * The triangles the notch cuts away fall outside every clip path, so the
 * wrapper is what fills them. `--emboss-surface` is the lit face of a raised
 * edge, which is what a chamfer should read as — dark enough to stay part of
 * the frame, light enough not to look like a hole punched to the page. A
 * consumer can override it through `className`, which lands on the wrapper.
 *
 * The 1px frame is real padding on the middle layer, not a 1px clip-path
 * inset on the surface: a radius is measured from the element's own border
 * box, so a full-bleed surface rounds about a centre 1px off the frame's and
 * the two curves converge at the corner. Inset the box and the 7px surface
 * radius stays concentric inside the 8px frame. 8px is `--radius`, matching
 * `Chonk size="lg"` so panels and tiles agree.
 */
function Well({
  className,
  variant,
  notchOpts,
  surfaceClassName,
  style,
  children,
  ...props
}: WellProps) {
  if (notchOpts) {
    const resolved = resolveNotchOpts(notchOpts === true ? { size: 14 } : notchOpts);
    return (
      <div
        data-slot="well"
        data-notched="true"
        className={cn(
          "flex w-full overflow-hidden rounded-lg bg-emboss-surface outline-[0.5px] -outline-offset-[0.5px] outline-deboss-shadow",
          className,
        )}
        style={style}
      >
        <div
          className="flex h-full w-full rounded-lg p-px"
          style={{
            clipPath: buildNotchPath(resolved),
            background: "var(--deboss-shadow)",
          }}
        >
          <div
            className={cn(
              // `overflow-hidden` is what carries the radius through to the
              // children: border-radius alone only shapes this element's own
              // background, so a consumer's full-bleed overlay would keep its
              // square corners. It costs nothing — the clip path already
              // confines descendants to exactly this outline.
              "relative flex h-full w-full flex-col overflow-hidden rounded-[7px] bg-card/85 text-card-foreground backdrop-blur-md",
              // Same heavier top edge as the plain variant, stacked on the
              // 1px frame below it. A border rather than an overlay, so it
              // sits above background washes a consumer lays over the
              // surface — absolute `inset-0` children start under it.
              variant !== "ghost" && "border-t-2 border-t-deboss-shadow",
              surfaceClassName,
            )}
            style={{ clipPath: buildNotchPath({ ...resolved, size: resolved.size - 1 }) }}
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

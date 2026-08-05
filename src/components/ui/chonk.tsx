import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { type NotchOpts, buildNotchPath, resolveNotchOpts } from "@/lib/notch";
import { cn } from "@/lib/utils";

const chonkVariants = cva(
  "chonk-emboss relative flex rounded-lg border bg-clip-padding text-left transition-all outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        // Primary-tinted surface — the "active / focused" chonk
        default:
          "bg-primary/10 text-foreground [--emboss-shadow:color-mix(in_srgb,var(--primary)_55%,black)] hover:bg-primary/15",
        // Neutral surface — inherits the theme's default --emboss-shadow, and
        // shifts to primary on hover so the lift reads as an "activated" tile.
        surface:
          "bg-card/95 text-foreground backdrop-blur-md hover:border-primary hover:bg-card hover:[--emboss-shadow:var(--primary)]",
        // Solid primary — action chonk
        primary:
          "bg-primary text-primary-foreground [--emboss-shadow:color-mix(in_srgb,var(--primary)_50%,black)] hover:bg-primary/90",
      },
      size: {
        sm: "[--chonk-lift-hover:2px]! [--chonk-lift:1px]!",
        default: "[--chonk-lift-hover:3px]! [--chonk-lift:2px]!",
        lg: "rounded-lg! [--chonk-lift-hover:4px]! [--chonk-lift:3px]!",
        xl: "rounded-lg! [--chonk-lift-hover:16px]! [--chonk-lift:8px]!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ChonkProps = useRender.ComponentProps<"div"> &
  VariantProps<typeof chonkVariants> & {
    notchOpts?: NotchOpts | true;
    /**
     * Whether the cursor's corner frame latches onto this chonk. Defaults to
     * on for interactive chonks — one rendered as a link/button or given an
     * `onClick` — and off for the static embossed surfaces (stat tiles,
     * monogram squares) that have no hover state to mark. Pass `false` to opt
     * a hoverable chonk out, e.g. while it sits depressed as the active item.
     */
    isMagnetic?: boolean;
  };

/**
 * Embossed container surface — sits between Badge and Button.
 * Use for interactive card-sized tiles (nav cards, feature tiles) that should
 * lift on hover and press on click.
 *
 * Pass `render={<Link to="…" />}` or any element via base-ui's useRender to
 * control the rendered tag (the default is `<div>`).
 */
function Chonk({
  className,
  variant,
  size,
  notchOpts,
  isMagnetic,
  render,
  style,
  ...props
}: ChonkProps) {
  const resolved = notchOpts
    ? resolveNotchOpts(notchOpts === true ? { size: 8 } : notchOpts)
    : null;

  // Every hoverable chonk is a magnet target, the same way every Button is —
  // `data-magnetic` is what the cursor's corner frame latches onto, and a tile
  // that lifts under the pointer should be framed like one. A chonk is
  // hoverable when it renders something clickable or takes an `onClick`; the
  // bare embossed surfaces stay out of it.
  const magnetic = isMagnetic ?? Boolean(render || props.onClick);
  // `data-*` isn't part of base-ui's prop type, so the marker rides in as its
  // own merged set rather than inline in the literal below.
  const magneticProps = {
    "data-magnetic": magnetic ? "" : undefined,
  } as React.HTMLAttributes<HTMLDivElement>;

  const chonk = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      magneticProps,
      {
        className: cn(
          chonkVariants({ variant, size }),
          // When notched, the outer wrapper handles emboss; flatten the inner.
          resolved && "!translate-y-0 !transform-none !border-0 !shadow-none",
          className,
        ),
        style: resolved ? { clipPath: buildNotchPath(resolved) } : style,
      },
      props,
    ),
    render,
    state: {
      slot: "chonk",
      variant,
    },
  });

  if (resolved) {
    // Outer handles the drop-shadow-based lift; inner is flat and clipped.
    const outerClip = buildNotchPath(resolved);
    const liftVars =
      size === "xl"
        ? "[--chonk-lift:8px] [--chonk-lift-hover:16px]"
        : size === "lg"
          ? "[--chonk-lift:3px] [--chonk-lift-hover:4px]"
          : size === "sm"
            ? "[--chonk-lift:1px] [--chonk-lift-hover:2px]"
            : "[--chonk-lift:2px] [--chonk-lift-hover:3px]";
    return (
      <div
        className={cn("chonk-emboss-notched relative flex", liftVars)}
        style={{ clipPath: outerClip, ...style }}
      >
        {chonk}
      </div>
    );
  }

  return chonk;
}

export { Chonk, chonkVariants };
export type { ChonkProps };

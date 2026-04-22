import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { type NotchOpts, buildNotchPath, resolveNotchOpts } from "@/lib/notch";
import { cn } from "@/lib/utils";

const chonkVariants = cva(
  "chonk-emboss relative flex rounded border bg-clip-padding text-left transition-all outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
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
        lg: "[--chonk-lift-hover:4px]! [--chonk-lift:3px]!",
        xl: "[--chonk-lift-hover:16px]! [--chonk-lift:8px]!",
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
  };

/**
 * Embossed container surface — sits between Badge and Button.
 * Use for interactive card-sized tiles (nav cards, feature tiles) that should
 * lift on hover and press on click.
 *
 * Pass `render={<Link to="…" />}` or any element via base-ui's useRender to
 * control the rendered tag (the default is `<div>`).
 */
function Chonk({ className, variant, size, notchOpts, render, style, ...props }: ChonkProps) {
  const resolved = notchOpts
    ? resolveNotchOpts(notchOpts === true ? { size: 8 } : notchOpts)
    : null;

  const chonk = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
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

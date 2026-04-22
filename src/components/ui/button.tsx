import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "framer-motion";

import { useMagnetic } from "@/lib/hooks/use-cursor";
import { type NotchOpts, buildNotchPath, resolveNotchOpts } from "@/lib/notch";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded border border-transparent bg-clip-padding text-xs font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "chonk-emboss bg-primary text-primary-foreground [--emboss-shadow:color-mix(in_srgb,var(--primary)_50%,black)] [a]:hover:bg-primary/80",
        secondary:
          "chonk-emboss bg-secondary text-secondary-foreground [--emboss-shadow:color-mix(in_srgb,var(--secondary)_50%,black)] hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        destructive:
          "chonk-emboss bg-destructive text-destructive-foreground [--emboss-shadow:color-mix(in_srgb,var(--destructive)_45%,black)] hover:bg-destructive/90 focus-visible:ring-destructive/30",
        outline:
          "chonk-emboss bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-emboss-surface dark:hover:bg-muted",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-xs [--chonk-lift-hover:2px] [--chonk-lift:1px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs":
          "size-6 [--chonk-lift-hover:2px] [--chonk-lift:1px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const notchEmbossColor: Record<string, string | undefined> = {
  default: "color-mix(in srgb, var(--primary) 50%, black)",
  outline: undefined, // inherits --emboss-shadow from theme
  secondary: "color-mix(in srgb, var(--secondary) 50%, black)",
  destructive: "color-mix(in srgb, var(--destructive) 45%, black)",
};

const springTransition = { type: "spring", stiffness: 1000, damping: 30, mass: 0.1 } as const;

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    isMagnetic?: boolean;
    notchOpts?: NotchOpts | true;
    wrapperClassName?: string;
  };

function Button({
  className,
  variant = "default",
  size = "default",
  isMagnetic,
  notchOpts,
  wrapperClassName,
  ...props
}: ButtonProps) {
  const { ref, position } = useMagnetic(0.2);

  // ── Notched variant ──────────────────────────────────────────────
  if (notchOpts) {
    const resolved = resolveNotchOpts(notchOpts);
    const outerClip = buildNotchPath(resolved);
    const innerClip = buildNotchPath(resolved, 1);
    const embossColor = notchEmbossColor[variant ?? "default"];
    const bgColor = embossColor ?? "var(--emboss-shadow)";

    const button = (
      <ButtonPrimitive
        data-slot="button"
        data-magnetic={isMagnetic ? "" : undefined}
        className={cn(
          buttonVariants({ variant, size, className }),
          "translate-y-0! transform-none! border-0! shadow-none! transition-[background-color]!",
        )}
        style={{ clipPath: innerClip }}
        {...props}
      />
    );

    const frame = (
      <div
        className={cn("chonk-emboss-notched inline-flex overflow-hidden rounded", wrapperClassName)}
        data-slot="button"
        style={
          {
            "--outer-clip": outerClip,
            ...(embossColor ? { "--emboss-shadow": embossColor } : {}),
          } as React.CSSProperties
        }
      >
        <div className="flex w-full" style={{ clipPath: outerClip, background: bgColor }}>
          {button}
        </div>
      </div>
    );

    if (isMagnetic) {
      return (
        <motion.div
          ref={ref as React.RefObject<HTMLDivElement>}
          animate={{ x: position.x, y: position.y }}
          transition={springTransition}
          className="relative z-10 inline-flex"
        >
          {frame}
        </motion.div>
      );
    }

    return frame;
  }

  // ── Standard variant ─────────────────────────────────────────────
  if (isMagnetic) {
    return (
      <motion.div
        ref={ref as React.RefObject<HTMLDivElement>}
        animate={{ x: position.x, y: position.y }}
        transition={springTransition}
        className="relative z-10 inline-flex"
      >
        <ButtonPrimitive
          data-slot="button"
          data-magnetic=""
          className={cn(buttonVariants({ variant, size, className }))}
          {...props}
        />
      </motion.div>
    );
  }

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };

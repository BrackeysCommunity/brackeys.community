import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { type NotchOpts, buildNotchPath, resolveNotchOpts } from "@/lib/notch";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-xs border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3! focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 group/badge",
  {
    variants: {
      variant: {
        default:
          "chonk-emboss bg-primary text-primary-foreground [--emboss-shadow:color-mix(in_srgb,var(--primary)_50%,black)]",
        secondary:
          "chonk-emboss bg-secondary text-secondary-foreground [--emboss-shadow:color-mix(in_srgb,var(--secondary)_50%,black)]",
        destructive:
          "chonk-emboss bg-destructive/10 text-destructive [--emboss-shadow:color-mix(in_srgb,var(--destructive)_40%,black)] dark:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "chonk-emboss border-border text-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

// Badge emboss is static — override the hover/active lift from chonk-emboss
const staticEmbossOverride =
  "[--chonk-lift:2px] [--chonk-lift-hover:2px] active:transition-none pointer-events-none";

const notchEmbossColor: Record<string, string | undefined> = {
  default: "color-mix(in srgb, var(--primary) 50%, black)",
  secondary: "color-mix(in srgb, var(--secondary) 50%, black)",
  destructive: "color-mix(in srgb, var(--destructive) 40%, black)",
  outline: undefined,
};

type BadgeProps = useRender.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    notchOpts?: NotchOpts | true;
  };

function Badge({ className, variant = "default", notchOpts, render, ...props }: BadgeProps) {
  const hasEmboss = variant !== "ghost" && variant !== "link";

  const badge = useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(
          badgeVariants({ variant }),
          hasEmboss && staticEmbossOverride,
          notchOpts && "!border-0 !shadow-none !translate-y-0 !transform-none",
          className,
        ),
        style: notchOpts
          ? { clipPath: buildNotchPath(resolveNotchOpts(notchOpts === true ? { size: 4 } : notchOpts), 1) }
          : undefined,
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });

  if (notchOpts && hasEmboss) {
    const resolved = resolveNotchOpts(notchOpts === true ? { size: 4 } : notchOpts);
    const outerClip = buildNotchPath(resolved);
    const embossColor = notchEmbossColor[variant ?? "default"];
    const bgColor = embossColor ?? "var(--emboss-shadow)";

    return (
      <div
        className="chonk-emboss-notched inline-flex [--chonk-lift:2px] [--chonk-lift-hover:2px] pointer-events-none"
        style={
          {
            "--outer-clip": outerClip,
            ...(embossColor ? { "--emboss-shadow": embossColor } : {}),
          } as React.CSSProperties
        }
      >
        <div className="flex" style={{ clipPath: outerClip, background: bgColor }}>
          {badge}
        </div>
      </div>
    );
  }

  if (notchOpts) {
    const resolved = resolveNotchOpts(notchOpts === true ? { size: 4 } : notchOpts);
    return (
      <div
        className="inline-flex shrink-0"
        style={{ clipPath: buildNotchPath(resolved) }}
      >
        {badge}
      </div>
    );
  }

  return badge;
}

export { Badge, badgeVariants };
export type { BadgeProps };

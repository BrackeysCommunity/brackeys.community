import { cva, type VariantProps } from "class-variance-authority";
import { type ComponentProps, forwardRef } from "react";

import { cn } from "@/lib/utils";

const inlineCodeVariants = cva(
  "chonk-emboss pointer-events-none relative -mb-0.5 inline-flex items-center rounded border px-1 py-0.5 align-baseline font-mono text-[0.9em] leading-none not-italic [--chonk-lift-hover:2px] [--chonk-lift:2px] active:transition-none",
  {
    variants: {
      variant: {
        default: "border-accent/30 bg-background/50 text-accent [--emboss-shadow:var(--accent)]",
        neutral: "border-border bg-muted text-foreground [--emboss-shadow:var(--muted-foreground)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type InlineCodeProps = VariantProps<typeof inlineCodeVariants> &
  Omit<ComponentProps<"code">, "ref">;

const InlineCode = forwardRef<HTMLElement, InlineCodeProps>(
  ({ variant, className, ...props }, ref) => {
    return (
      <code
        ref={ref}
        data-slot="inline-code"
        className={cn(inlineCodeVariants({ variant }), className)}
        {...props}
      />
    );
  },
);
InlineCode.displayName = "InlineCode";

export { InlineCode, inlineCodeVariants, type InlineCodeProps };

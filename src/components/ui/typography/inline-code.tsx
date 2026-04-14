import { cva, type VariantProps } from "class-variance-authority";
import { type ComponentProps, forwardRef } from "react";

import { cn } from "@/lib/utils";

const inlineCodeVariants = cva(
  "rounded-sm border px-1 py-0.5 font-mono text-[0.9em] leading-none",
  {
    variants: {
      variant: {
        default: "border-accent/20 bg-accent/10 text-accent",
        neutral: "border-border bg-muted text-foreground",
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

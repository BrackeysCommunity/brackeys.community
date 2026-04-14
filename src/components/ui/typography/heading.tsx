import { cva, type VariantProps } from "class-variance-authority";
import { type ComponentProps, forwardRef } from "react";

import { cn } from "@/lib/utils";

const headingVariants = cva("font-bold tracking-tight", {
  variants: {
    size: {
      xs: "text-xs",
      sm: "text-sm",
      md: "text-base",
      lg: "text-lg",
      xl: "text-xl",
      "2xl": "text-2xl",
      "3xl": "text-3xl",
      "4xl": "text-4xl",
    },
    variant: {
      primary: "text-foreground",
      muted: "text-muted-foreground",
      accent: "text-accent",
      success: "text-success",
      warning: "text-warning",
      danger: "text-destructive",
    },
    align: {
      left: "text-left",
      center: "text-center",
      right: "text-right",
      justify: "text-justify",
    },
  },
  defaultVariants: {
    variant: "primary",
  },
});

type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

const defaultSizeMap: Record<
  HeadingLevel,
  NonNullable<VariantProps<typeof headingVariants>["size"]>
> = {
  h1: "4xl",
  h2: "3xl",
  h3: "2xl",
  h4: "xl",
  h5: "lg",
  h6: "md",
};

type HeadingProps = VariantProps<typeof headingVariants> &
  Omit<ComponentProps<"h1">, "ref"> & {
    as: HeadingLevel;
    display?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    monospace?: boolean;
    ellipsis?: boolean;
  };

const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  (
    {
      as: Tag,
      size,
      variant,
      align,
      display,
      italic,
      underline,
      strikethrough,
      monospace,
      ellipsis,
      className,
      ...props
    },
    ref,
  ) => {
    const resolvedSize = size ?? defaultSizeMap[Tag];

    return (
      <Tag
        ref={ref}
        data-slot="heading"
        className={cn(
          headingVariants({ size: resolvedSize, variant, align }),
          display && !monospace && "font-display",
          italic && "italic",
          underline && "underline underline-offset-4",
          strikethrough && "line-through",
          monospace && "font-mono",
          ellipsis && "truncate",
          className,
        )}
        {...props}
      />
    );
  },
);
Heading.displayName = "Heading";

export { Heading, headingVariants, type HeadingProps, type HeadingLevel };

import { cva, type VariantProps } from "class-variance-authority";
import { type ComponentProps, forwardRef } from "react";

import { cn } from "@/lib/utils";

const textVariants = cva("", {
  variants: {
    size: {
      xs: "text-[10px]/tight",
      sm: "text-xs/snug",
      md: "text-sm/normal",
      lg: "text-base/normal",
      xl: "text-lg/relaxed",
      "2xl": "text-xl/relaxed",
    },
    variant: {
      primary: "text-foreground",
      muted: "text-muted-foreground",
      accent: "text-accent",
      success: "text-success",
      warning: "text-warning",
      danger: "text-destructive",
      inherit: "text-inherit",
    },
    density: {
      touching: "leading-0 tracking-tight",
      dense: "leading-none tracking-tight",
      compressed: "leading-tight tracking-tight",
      default: "",
      comfortable: "leading-relaxed tracking-normal",
    },
    align: {
      left: "text-left",
      center: "text-center",
      right: "text-right",
      justify: "text-justify",
    },
  },
  defaultVariants: {
    size: "md",
    variant: "primary",
  },
});

type TextElement = "p" | "span" | "div";

type TextProps = VariantProps<typeof textVariants> &
  Omit<ComponentProps<"span">, "ref"> & {
    as?: TextElement;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    monospace?: boolean;
    ellipsis?: boolean;
    textWrap?: "balance" | "pretty" | "nowrap";
    wordBreak?: "break-word" | "break-all";
    tabular?: boolean;
    fraction?: boolean;
  };

const Text = forwardRef<HTMLElement, TextProps>(
  (
    {
      as: Tag = "span",
      size,
      variant,
      density,
      align,
      bold,
      italic,
      underline,
      strikethrough,
      monospace,
      ellipsis,
      textWrap,
      wordBreak,
      tabular,
      fraction,
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <Tag
        ref={ref as never}
        data-slot="text"
        className={cn(
          textVariants({ size, variant, density, align }),
          bold && "font-bold",
          italic && "italic",
          underline && "underline underline-offset-2",
          strikethrough && "line-through",
          monospace && "font-mono",
          ellipsis && "truncate",
          tabular && "tabular-nums",
          fraction && "[font-variant-numeric:diagonal-fractions]",
          textWrap === "balance" && "text-balance",
          textWrap === "pretty" && "text-pretty",
          textWrap === "nowrap" && "text-nowrap",
          wordBreak === "break-word" && "break-words",
          wordBreak === "break-all" && "break-all",
          className,
        )}
        {...props}
      />
    );
  },
);
Text.displayName = "Text";

export { Text, textVariants, type TextProps };

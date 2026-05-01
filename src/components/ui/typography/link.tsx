import { Link as RouterLink } from "@tanstack/react-router";
import { type ComponentProps, forwardRef } from "react";

type RouterLinkProps = ComponentProps<typeof RouterLink>;

import { cn } from "@/lib/utils";

import { textVariants, type TextProps } from "./text";

type TextStyleProps = Pick<
  TextProps,
  | "size"
  | "variant"
  | "density"
  | "align"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "monospace"
  | "ellipsis"
  | "textWrap"
  | "wordBreak"
  | "tabular"
  | "fraction"
>;

function textClasses({
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
}: TextStyleProps & { className?: string }) {
  return cn(
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
  );
}

type AnchorProps = TextStyleProps & { as?: "a" } & Omit<ComponentProps<"a">, keyof TextStyleProps>;
type RouterProps = TextStyleProps & { as: "router" } & Omit<RouterLinkProps, keyof TextStyleProps>;

export type LinkProps = AnchorProps | RouterProps;

/**
 * Typography-aware link. `as="a"` (default) renders a plain anchor; `as="router"`
 * renders a TanStack Router `<Link>`. Accepts all `Text` styling props.
 */
const Link = forwardRef<HTMLAnchorElement, LinkProps>((props, ref) => {
  const {
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
    as = "a",
    ...rest
  } = props;

  const finalClassName = textClasses({
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
  });

  if (as === "router") {
    return (
      <RouterLink
        ref={ref}
        {...(rest as Omit<RouterLinkProps, keyof TextStyleProps>)}
        className={finalClassName}
      />
    );
  }

  return (
    <a
      ref={ref}
      {...(rest as Omit<ComponentProps<"a">, keyof TextStyleProps>)}
      className={finalClassName}
    />
  );
});
Link.displayName = "Link";

export { Link };

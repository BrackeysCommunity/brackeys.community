import type { ComponentProps } from "react";

import { cx } from "./cx";

export type TextSize = "xs" | "sm" | "md" | "lg";
export type TextTone = "primary" | "muted" | "success" | "warning" | "danger" | "inherit";

export type TextProps = Omit<ComponentProps<"span">, "ref"> & {
  as?: "p" | "span" | "div";
  size?: TextSize;
  variant?: TextTone;
  bold?: boolean;
  ellipsis?: boolean;
  tabular?: boolean;
  textWrap?: "balance" | "pretty" | "nowrap";
};

/** Body copy at the editor's sizes. */
export function Text({
  as: Tag = "span",
  size = "sm",
  variant = "primary",
  bold,
  ellipsis,
  tabular,
  textWrap,
  className,
  ...props
}: TextProps) {
  return (
    <Tag
      {...props}
      className={cx("je-text", className)}
      data-size={size}
      data-tone={variant}
      data-bold={bold ? "" : undefined}
      data-ellipsis={ellipsis ? "" : undefined}
      data-tabular={tabular ? "" : undefined}
      data-wrap={textWrap}
    />
  );
}

export type MicroLabelProps = Omit<TextProps, "size" | "bold">;

/** The section-label voice: small, tracked out, muted unless told otherwise. */
export function MicroLabel({ variant = "muted", className, ...props }: MicroLabelProps) {
  return <Text {...props} size="xs" variant={variant} className={cx("je-micro", className)} />;
}

import type { ComponentProps } from "react";

import { cx } from "./cx";

export type InputProps = Omit<ComponentProps<"input">, "size"> & {
  /** `sm` sits in a row of icon buttons; the default is the editor's control height. */
  size?: "default" | "sm";
};

export function Input({ size = "default", className, ...props }: InputProps) {
  return <input {...props} className={cx("je-input", className)} data-size={size} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx("je-textarea", className)} />;
}

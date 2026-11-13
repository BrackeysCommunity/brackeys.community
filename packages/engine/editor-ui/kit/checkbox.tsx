import type { InputHTMLAttributes } from "react";

import { useKit } from "./context";
import { cx } from "./cx";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/** One pick of several from a list; each change sounds the `toggle` cue. */
export function Checkbox({ className, onChange, ...props }: CheckboxProps) {
  const kit = useKit();
  return (
    <input
      {...props}
      type="checkbox"
      className={cx("je-checkbox", className)}
      onChange={(event) => {
        kit.cue("toggle");
        onChange?.(event);
      }}
    />
  );
}

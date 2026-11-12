import type { InputHTMLAttributes } from "react";

import { useKit } from "./context";
import { cx } from "./cx";

export type RadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Radios sharing a `name` are one group, wherever each is drawn. */
  name: string;
};

/** One choice of a group named by `name`; picking it sounds the `toggle` cue. */
export function Radio({ className, onChange, ...props }: RadioProps) {
  const kit = useKit();
  return (
    <input
      {...props}
      type="radio"
      className={cx("je-radio", className)}
      onChange={(event) => {
        kit.cue("toggle");
        onChange?.(event);
      }}
    />
  );
}

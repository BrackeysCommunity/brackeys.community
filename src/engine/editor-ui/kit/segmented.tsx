import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { ReactNode } from "react";

import { useKit } from "./context";
import { cx } from "./cx";
import { Hint } from "./hint";

export type SegmentedControlProps = {
  value: string;
  onChange: (value: string) => void;
  size?: "xs" | "sm";
  /** Report a press on the selected item too (an optional field clears on it). */
  emitOnReselect?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
};

/** One choice of a few, as a row of pressed and unpressed buttons; each change sounds `toggle`. */
function SegmentedControlRoot({
  value,
  onChange,
  size = "sm",
  emitOnReselect = false,
  disabled,
  className,
  children,
  ...props
}: SegmentedControlProps) {
  const kit = useKit();
  return (
    <ToggleGroup
      aria-label={props["aria-label"]}
      role="group"
      className={cx("je-segmented", className)}
      data-size={size}
      disabled={disabled}
      value={[value]}
      onValueChange={(next) => {
        const last = next[next.length - 1];
        // A press on the selected item arrives as an empty selection.
        const picked = typeof last === "string" ? last : emitOnReselect ? value : null;
        if (picked == null || (picked === value && !emitOnReselect)) return;
        kit.cue("toggle");
        onChange(picked);
      }}
    >
      {children}
    </ToggleGroup>
  );
}

function SegmentedControlItem({
  value,
  tooltip,
  disabled,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  value: string;
  tooltip?: ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
}) {
  const item = (
    <Toggle
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cx("je-segmented-item", className)}
    >
      {children}
    </Toggle>
  );
  return tooltip ? <Hint content={tooltip}>{item}</Hint> : item;
}

export const SegmentedControl = Object.assign(SegmentedControlRoot, {
  Item: SegmentedControlItem,
});

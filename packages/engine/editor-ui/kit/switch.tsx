import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { useKit } from "./context";
import { cx } from "./cx";

export type SwitchProps = Omit<SwitchPrimitive.Root.Props, "className"> & {
  className?: string;
  /** A disabled switch that keeps its place in the tab order, so a hint on it opens from the keyboard. */
  focusableWhenDisabled?: boolean;
};

/** An on/off control; each change sounds the `toggle` cue. */
export function Switch({
  className,
  onCheckedChange,
  disabled,
  focusableWhenDisabled,
  ...props
}: SwitchProps) {
  const kit = useKit();
  const inert = disabled && focusableWhenDisabled;
  return (
    <SwitchPrimitive.Root
      {...props}
      {...(inert ? { readOnly: true, "aria-disabled": true, "data-disabled": "" } : { disabled })}
      className={cx("je-switch", className)}
      onCheckedChange={(checked, details) => {
        kit.cue("toggle");
        onCheckedChange?.(checked, details);
      }}
    >
      <SwitchPrimitive.Thumb className="je-switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

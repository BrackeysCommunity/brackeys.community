import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { useKit } from "./context";
import { cx } from "./cx";

export type SwitchProps = Omit<SwitchPrimitive.Root.Props, "className"> & { className?: string };

/** An on/off control; each change sounds the `toggle` cue. */
export function Switch({ className, onCheckedChange, ...props }: SwitchProps) {
  const kit = useKit();
  return (
    <SwitchPrimitive.Root
      {...props}
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

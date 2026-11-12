import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Tick02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";

import { usePortalContainer } from "./context";
import { cx } from "./cx";
import { Icon } from "./icon";

type Cls<P> = Omit<P, "className"> & { className?: string };

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;

export function SelectValue({ className, ...props }: Cls<SelectPrimitive.Value.Props>) {
  return <SelectPrimitive.Value {...props} className={cx("je-select-value", className)} />;
}

export function SelectTrigger({
  size = "default",
  className,
  children,
  ...props
}: Cls<SelectPrimitive.Trigger.Props> & { size?: "default" | "sm" | "xs" }) {
  return (
    <SelectPrimitive.Trigger {...props} className={cx("je-select", className)} data-size={size}>
      {children}
      <SelectPrimitive.Icon className="je-select-icon">
        <Icon icon={UnfoldMoreIcon} size={13} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = false,
  className,
  children,
  ...props
}: Cls<SelectPrimitive.Popup.Props> &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  const container = usePortalContainer();
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Positioner
        className="je-positioner"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
      >
        <SelectPrimitive.Popup {...props} className={cx("je-menu", className)} data-je-overlay="">
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }: Cls<SelectPrimitive.Item.Props>) {
  return (
    <SelectPrimitive.Item {...props} className={cx("je-menu-item", className)} data-check="">
      <span className="je-menu-check">
        <SelectPrimitive.ItemIndicator>
          <Icon icon={Tick02Icon} size={13} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText className="je-select-item-text">
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectLabel({ className, ...props }: Cls<SelectPrimitive.GroupLabel.Props>) {
  return <SelectPrimitive.GroupLabel {...props} className={cx("je-menu-label", className)} />;
}

export function SelectSeparator({ className, ...props }: Cls<SelectPrimitive.Separator.Props>) {
  return <SelectPrimitive.Separator {...props} className={cx("je-menu-separator", className)} />;
}

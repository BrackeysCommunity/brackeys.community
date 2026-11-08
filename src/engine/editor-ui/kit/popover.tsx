import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { usePortalContainer } from "./context";
import { cx } from "./cx";

export const Popover = PopoverPrimitive.Root;

export function PopoverTrigger({
  className,
  ...props
}: Omit<PopoverPrimitive.Trigger.Props, "className"> & { className?: string }) {
  return <PopoverPrimitive.Trigger {...props} className={cx("je-popover-trigger", className)} />;
}

export function PopoverContent({
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  anchor,
  className,
  ...props
}: Omit<PopoverPrimitive.Popup.Props, "className"> &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  > & { className?: string }) {
  const container = usePortalContainer();
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Positioner
        className="je-positioner"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
      >
        <PopoverPrimitive.Popup
          {...props}
          className={cx("je-popover", className)}
          data-je-overlay=""
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export const PopoverTitle = PopoverPrimitive.Title;
export const PopoverDescription = PopoverPrimitive.Description;
export const PopoverClose = PopoverPrimitive.Close;

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { ArrowDown01Icon, Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { useRef, type ComponentPropsWithRef } from "react";

import { usePortalContainer } from "./context";
import { cx } from "./cx";
import { Icon } from "./icon";

type Cls<P> = Omit<P, "className"> & { className?: string };

export const Combobox = ComboboxPrimitive.Root;
export const ComboboxValue = ComboboxPrimitive.Value;
export const ComboboxGroup = ComboboxPrimitive.Group;
export const ComboboxCollection = ComboboxPrimitive.Collection;

/** A text field that filters the list, with a button that opens it and, optionally, one that clears it. */
export function ComboboxInput({
  className,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: Cls<ComboboxPrimitive.Input.Props> & { showTrigger?: boolean; showClear?: boolean }) {
  return (
    <div className={cx("je-combobox", className)} data-disabled={disabled ? "" : undefined}>
      <ComboboxPrimitive.Input {...props} disabled={disabled} className="je-combobox-input" />
      {showClear ? (
        <ComboboxPrimitive.Clear
          className="je-combobox-button"
          aria-label="Clear"
          disabled={disabled}
        >
          <Icon icon={Cancel01Icon} size={12} />
        </ComboboxPrimitive.Clear>
      ) : null}
      {showTrigger ? (
        <ComboboxPrimitive.Trigger
          className="je-combobox-button"
          aria-label="Show options"
          disabled={disabled}
        >
          <Icon icon={ArrowDown01Icon} size={12} />
        </ComboboxPrimitive.Trigger>
      ) : null}
    </div>
  );
}

export function ComboboxContent({
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  anchor,
  className,
  ...props
}: Cls<ComboboxPrimitive.Popup.Props> &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "anchor"
  >) {
  const container = usePortalContainer();
  return (
    <ComboboxPrimitive.Portal container={container}>
      <ComboboxPrimitive.Positioner
        className="je-positioner"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
      >
        <ComboboxPrimitive.Popup
          {...props}
          className={cx("je-menu je-combobox-popup", className)}
          data-je-overlay=""
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

export function ComboboxList({ className, ...props }: Cls<ComboboxPrimitive.List.Props>) {
  return <ComboboxPrimitive.List {...props} className={cx("je-combobox-list", className)} />;
}

export function ComboboxItem({ className, children, ...props }: Cls<ComboboxPrimitive.Item.Props>) {
  return (
    <ComboboxPrimitive.Item {...props} className={cx("je-menu-item", className)} data-check="">
      <span className="je-menu-check">
        <ComboboxPrimitive.ItemIndicator>
          <Icon icon={Tick02Icon} size={13} />
        </ComboboxPrimitive.ItemIndicator>
      </span>
      {children}
    </ComboboxPrimitive.Item>
  );
}

export function ComboboxEmpty({ className, ...props }: Cls<ComboboxPrimitive.Empty.Props>) {
  return <ComboboxPrimitive.Empty {...props} className={cx("je-combobox-empty", className)} />;
}

export function ComboboxChips({
  className,
  ...props
}: Cls<ComponentPropsWithRef<typeof ComboboxPrimitive.Chips>>) {
  return <ComboboxPrimitive.Chips {...props} className={cx("je-combobox je-chips", className)} />;
}

export function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: Cls<ComboboxPrimitive.Chip.Props> & { showRemove?: boolean }) {
  return (
    <ComboboxPrimitive.Chip {...props} className={cx("je-chip", className)}>
      {children}
      {showRemove ? (
        <ComboboxPrimitive.ChipRemove className="je-chip-remove" aria-label="Remove">
          <Icon icon={Cancel01Icon} size={10} />
        </ComboboxPrimitive.ChipRemove>
      ) : null}
    </ComboboxPrimitive.Chip>
  );
}

export function ComboboxChipsInput({ className, ...props }: Cls<ComboboxPrimitive.Input.Props>) {
  return <ComboboxPrimitive.Input {...props} className={cx("je-chips-input", className)} />;
}

/** The element a chips combobox's popup lines up under. */
export function useComboboxAnchor() {
  return useRef<HTMLDivElement | null>(null);
}

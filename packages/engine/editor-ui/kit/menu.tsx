import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ArrowRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import type { ComponentProps } from "react";

import { useKit, usePortalContainer } from "./context";
import { cx } from "./cx";
import { Icon } from "./icon";

type Placement = Pick<
  MenuPrimitive.Positioner.Props,
  "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
>;

export const Menu = MenuPrimitive.Root;
export const MenuGroup = MenuPrimitive.Group;
export const MenuRadioGroup = MenuPrimitive.RadioGroup;
export const MenuSub = MenuPrimitive.SubmenuRoot;

export function MenuTrigger({
  className,
  ...props
}: Omit<MenuPrimitive.Trigger.Props, "className"> & { className?: string }) {
  return <MenuPrimitive.Trigger {...props} className={cx("je-menu-trigger", className)} />;
}

export function MenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  anchor,
  className,
  ...props
}: Omit<MenuPrimitive.Popup.Props, "className"> & Placement & { className?: string }) {
  const container = usePortalContainer();
  return (
    <MenuPrimitive.Portal container={container}>
      <MenuPrimitive.Positioner
        className="je-positioner"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
      >
        <MenuPrimitive.Popup {...props} className={cx("je-menu", className)} data-je-overlay="" />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

type ItemProps<P> = Omit<P, "className"> & { className?: string };

/** An action in a menu; `destructive` colours it and sounds the `error` cue. */
export function MenuItem({
  className,
  variant = "default",
  onClick,
  ...props
}: ItemProps<MenuPrimitive.Item.Props> & { variant?: "default" | "destructive" }) {
  const kit = useKit();
  return (
    <MenuPrimitive.Item
      {...props}
      className={cx("je-menu-item", className)}
      data-variant={variant}
      onClick={(event) => {
        kit.cue(variant === "destructive" ? "error" : "toggle");
        onClick?.(event);
      }}
    />
  );
}

export function MenuCheckboxItem({
  className,
  children,
  onCheckedChange,
  ...props
}: ItemProps<MenuPrimitive.CheckboxItem.Props>) {
  const kit = useKit();
  return (
    <MenuPrimitive.CheckboxItem
      {...props}
      className={cx("je-menu-item", className)}
      data-check=""
      onCheckedChange={(checked, details) => {
        kit.cue("toggle");
        onCheckedChange?.(checked, details);
      }}
    >
      <span className="je-menu-check">
        <MenuPrimitive.CheckboxItemIndicator>
          <Icon icon={Tick02Icon} size={13} />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function MenuRadioItem({
  className,
  children,
  onClick,
  ...props
}: ItemProps<MenuPrimitive.RadioItem.Props>) {
  const kit = useKit();
  return (
    <MenuPrimitive.RadioItem
      {...props}
      className={cx("je-menu-item", className)}
      data-check=""
      onClick={(event) => {
        kit.cue("toggle");
        onClick?.(event);
      }}
    >
      <span className="je-menu-check">
        <MenuPrimitive.RadioItemIndicator>
          <Icon icon={Tick02Icon} size={13} />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function MenuLabel({ className, ...props }: ItemProps<MenuPrimitive.GroupLabel.Props>) {
  return <MenuPrimitive.GroupLabel {...props} className={cx("je-menu-label", className)} />;
}

export function MenuSeparator({ className, ...props }: ItemProps<MenuPrimitive.Separator.Props>) {
  return <MenuPrimitive.Separator {...props} className={cx("je-menu-separator", className)} />;
}

export function MenuSubTrigger({
  className,
  children,
  ...props
}: ItemProps<MenuPrimitive.SubmenuTrigger.Props>) {
  return (
    <MenuPrimitive.SubmenuTrigger {...props} className={cx("je-menu-item", className)}>
      {children}
      <Icon icon={ArrowRight01Icon} size={13} className="je-menu-chevron" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

export function MenuSubContent(props: ComponentProps<typeof MenuContent>) {
  return <MenuContent side="right" align="start" sideOffset={0} alignOffset={-4} {...props} />;
}

/** A shortcut or count at the end of a menu item. */
export function MenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} className={cx("je-menu-shortcut", className)} />;
}

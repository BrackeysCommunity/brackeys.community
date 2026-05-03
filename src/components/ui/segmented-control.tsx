"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { SimpleTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Size = "xs" | "sm" | "md" | "lg";
type Priority = "default" | "primary";

const itemVariants = cva(
  [
    // base button-group item: outlined chonk-emboss mini-button
    "group/segmented-item chonk-emboss relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-none border border-input bg-background font-medium outline-none transition-colors",
    // Only apply hover styles on devices with a fine pointer (mouse / trackpad).
    // Touch devices report `(hover: hover)` on some platforms, so a tap can
    // briefly trigger the hover state — we additionally require `(pointer: fine)`.
    "[@media(hover:hover)and(pointer:fine)]:hover:bg-muted [@media(hover:hover)and(pointer:fine)]:hover:text-foreground",
    "focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-ring",
    // Disabled items sit flat (depressed) like checkbox disabled state
    "disabled:pointer-events-none disabled:opacity-50 disabled:translate-y-0 disabled:[--chonk-lift:0px] disabled:[--chonk-lift-hover:0px]",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
    "dark:bg-emboss-surface",
  ].join(" "),
  {
    variants: {
      size: {
        xs: "h-6 min-w-6 px-2 text-[11px] [--chonk-lift-hover:2px] [--chonk-lift:1px]",
        sm: "h-7 min-w-7 px-2.5 text-xs",
        md: "h-8 min-w-8 px-3 text-xs",
        lg: "h-14 min-w-14 px-3 text-xs [--chonk-lift-hover:4px] [--chonk-lift:3px] [&_svg:not([class*='size-'])]:size-[18px]",
      },
      priority: {
        default: [
          "text-foreground",
          // selected: fully depressed, text becomes primary
          "aria-pressed:text-primary",
          "aria-pressed:translate-y-0 aria-pressed:[--chonk-lift:0px] aria-pressed:[--chonk-lift-hover:0px]",
          "aria-pressed:z-10",
        ].join(" "),
        primary: [
          "text-foreground",
          // selected: fully depressed + filled primary; border stays input color
          "aria-pressed:bg-primary aria-pressed:text-primary-foreground",
          "aria-pressed:translate-y-0 aria-pressed:[--chonk-lift:0px] aria-pressed:[--chonk-lift-hover:0px]",
          "aria-pressed:z-10",
          "dark:aria-pressed:bg-primary",
        ].join(" "),
      },
    },
    defaultVariants: { size: "md", priority: "default" },
  },
);

type SegmentedControlContextValue = {
  size: Size;
  priority: Priority;
};

const SegmentedControlContext = React.createContext<SegmentedControlContextValue>({
  size: "md",
  priority: "default",
});

type SegmentedControlProps = Omit<
  ToggleGroupPrimitive.Props<string>,
  "value" | "defaultValue" | "onValueChange" | "multiple" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
  size?: Size;
  priority?: Priority;
};

function SegmentedControlRoot({
  value,
  onChange,
  size = "md",
  priority = "default",
  className,
  children,
  ...props
}: SegmentedControlProps) {
  return (
    <SegmentedControlContext.Provider value={{ size, priority }}>
      <ToggleGroupPrimitive
        role="group"
        data-slot="segmented-control"
        data-size={size}
        data-priority={priority}
        value={[value]}
        onValueChange={(next) => {
          const last = next[next.length - 1];
          // Always single-select: ignore attempts to deselect the current item.
          if (last && last !== value) onChange(last);
        }}
        className={cn(
          // button-group layout: collapse borders, keep a single seam
          "inline-flex w-fit items-stretch rounded-none",
          "[&>[data-slot=segmented-control-item]:not(:first-child)]:-ml-px",
          className,
        )}
        {...props}
      >
        {children}
      </ToggleGroupPrimitive>
    </SegmentedControlContext.Provider>
  );
}

type SegmentedControlItemProps = Omit<TogglePrimitive.Props, "value"> &
  VariantProps<typeof itemVariants> & {
    /** Unique identifier for this item; matched against the parent's `value`. */
    value: string;
    icon?: React.ReactNode;
    tooltip?: React.ReactNode;
    /** Override the group-level priority for this item only. */
    priority?: Priority;
  };

function SegmentedControlItem({
  className,
  children,
  icon,
  tooltip,
  disabled,
  value,
  priority: priorityProp,
  ...props
}: SegmentedControlItemProps) {
  const { size, priority: ctxPriority } = React.useContext(SegmentedControlContext);
  const priority = priorityProp ?? ctxPriority;

  const button = (
    <TogglePrimitive
      value={value}
      disabled={disabled}
      data-slot="segmented-control-item"
      className={cn(itemVariants({ size, priority }), className)}
      {...props}
    >
      {icon}
      {children}
    </TogglePrimitive>
  );

  if (tooltip) {
    return <SimpleTooltip content={tooltip}>{button}</SimpleTooltip>;
  }
  return button;
}

const SegmentedControl = Object.assign(SegmentedControlRoot, { Item: SegmentedControlItem });

export { SegmentedControl };
export type { SegmentedControlProps, SegmentedControlItemProps };

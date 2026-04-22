"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

// ── Compound API (backward-compatible) ─────────────────────────────

function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />;
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

type TooltipContentVariant = "default" | "error";

type TooltipContentProps = TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset"> & {
    variant?: TooltipContentVariant;
    maxWidth?: number;
  };

const variantStyles: Record<TooltipContentVariant, string> = {
  default:
    "bg-foreground text-background [--tooltip-shadow:color-mix(in_srgb,var(--foreground)_50%,black)]",
  error:
    "bg-destructive text-destructive-foreground [--tooltip-shadow:color-mix(in_srgb,var(--destructive)_50%,black)]",
};

const arrowVariantStyles: Record<TooltipContentVariant, string> = {
  default: "bg-foreground fill-foreground",
  error: "bg-destructive fill-destructive",
};

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  variant = "default",
  maxWidth = 225,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          data-variant={variant}
          className={cn(
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            "z-50 w-fit origin-(--transform-origin) -translate-y-0.5 rounded px-3 py-1.5 text-xs filter-[drop-shadow(0_2px_0_var(--tooltip-shadow))]",
            variantStyles[variant],
            className,
          )}
          style={{ maxWidth }}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow
            className={cn(
              "z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-none",
              "data-[side=bottom]:top-1 data-[side=top]:-bottom-2.5",
              "data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2",
              "data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2",
              "data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2",
              "data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2",
              arrowVariantStyles[variant],
            )}
          />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

// ── SimpleTooltip (wrapping API) ───────────────────────────────────

type SimpleTooltipProps = {
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  variant?: TooltipContentVariant;
  maxWidth?: number;
  hoverable?: boolean;
  disabled?: boolean;
  delay?: number;
  /** Force the tooltip open (for error states). */
  open?: boolean;
  children: React.ReactElement;
  className?: string;
};

function SimpleTooltip({
  content,
  side = "top",
  variant = "default",
  maxWidth = 225,
  hoverable = false,
  disabled = false,
  delay = 0,
  open,
  children,
  className,
}: SimpleTooltipProps) {
  if (disabled || !content) {
    return children;
  }

  return (
    <TooltipPrimitive.Provider delay={delay} closeDelay={0}>
      <TooltipPrimitive.Root disableHoverablePopup={!hoverable} open={open}>
        <TooltipPrimitive.Trigger className="flex w-full [&>*]:w-full">
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipContent side={side} variant={variant} maxWidth={maxWidth} className={className}>
          {content}
        </TooltipContent>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, SimpleTooltip };
export type { TooltipContentProps, SimpleTooltipProps, TooltipContentVariant };

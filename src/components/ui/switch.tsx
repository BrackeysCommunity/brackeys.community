"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import * as React from "react";

import { type NotchOpts, buildNotchPath, resolveNotchOpts } from "@/lib/notch";
import { cn } from "@/lib/utils";

type SwitchProps = SwitchPrimitive.Root.Props & {
  size?: "sm" | "lg";
  notchOpts?: NotchOpts | true;
};

function Switch({ className, size = "sm", notchOpts, ...props }: SwitchProps) {
  const isLg = size === "lg";

  const switchEl = (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center outline-none",
        // Deboss container — sunken track, neutral border
        "chonk-deboss rounded-xs border border-input",
        "dark:bg-deboss-surface",
        // Sizes
        isLg ? "h-6 w-11 px-0.5" : "h-[18px] w-8 px-0.5",
        // Track fill
        "data-checked:bg-primary/20 dark:data-checked:bg-primary/30",
        "data-unchecked:bg-input dark:data-unchecked:bg-input/50",
        // Focus / validation
        "focus-visible:outline-hidden",
        "aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20",
        // Expanded click area
        "after:absolute after:-inset-x-3 after:-inset-y-2",
        // Disabled
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        notchOpts && "!border-0 shadow-[inset_0_3px_0_0_var(--deboss-shadow)]",
        className,
      )}
      style={
        notchOpts
          ? {
              clipPath: buildNotchPath(
                resolveNotchOpts(notchOpts === true ? { size: 4 } : { size: 4, ...notchOpts }),
                1,
              ),
            }
          : undefined
      }
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          // Emboss driven by parent hover/active via .switch-thumb-emboss CSS
          "pointer-events-none flex items-center justify-center rounded-[2px]",
          "switch-thumb-emboss",
          // Slide transition
          "transition-[translate] duration-200 ease-in-out",
          // Checked: primary thumb
          "data-checked:bg-primary data-checked:text-primary-foreground data-checked:[--emboss-shadow:var(--deboss-shadow)]",
          // Unchecked: neutral thumb
          "data-unchecked:bg-muted data-unchecked:text-foreground data-unchecked:[--emboss-shadow:var(--deboss-shadow)]",
          "dark:data-unchecked:bg-foreground/80 dark:data-unchecked:text-background",
          // Slightly oversized (~1.1x)
          isLg
            ? "-my-[1px] size-[22px] data-checked:translate-x-[calc(100%-2px)] data-unchecked:-translate-x-1"
            : "-my-[1px] size-[16px] data-checked:translate-x-[calc(100%-2px)] data-unchecked:-translate-x-1",
        )}
      >
        {/* Grip lines */}
        <div className={cn("flex flex-col gap-[2px]", isLg ? "w-2.5" : "w-2")}>
          <div className="h-px rounded-full bg-current opacity-30" />
          <div className="h-px rounded-full bg-current opacity-30" />
        </div>
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );

  if (notchOpts) {
    const resolved = resolveNotchOpts(notchOpts === true ? { size: 4 } : { size: 4, ...notchOpts });
    const outerClip = buildNotchPath(resolved);

    return (
      <div className="inline-flex shrink-0 overflow-hidden rounded-xs">
        <div
          className="chonk-emboss-notched inline-flex [--chonk-lift-hover:1px] [--chonk-lift:1px]"
          style={
            {
              "--outer-clip": outerClip,
            } as React.CSSProperties
          }
        >
          <div className="flex" style={{ clipPath: outerClip, background: "var(--deboss-shadow)" }}>
            {switchEl}
          </div>
        </div>
      </div>
    );
  }

  return switchEl;
}

export { Switch };
export type { SwitchProps };

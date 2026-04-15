"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

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
        "peer group/switch relative inline-flex shrink-0 items-center outline-none transition-all",
        // Deboss container — sunken track, neutral border that doesn't change on check
        "chonk-deboss rounded-xs border border-input",
        "dark:bg-deboss-surface",
        // Sizes — padding for thumb inset
        isLg ? "h-6 w-11 px-0.5" : "h-[18px] w-8 px-0.5",
        // Track fill — subtle tint, NOT full primary (preserves deboss illusion)
        "data-checked:bg-primary/20 dark:data-checked:bg-primary/30",
        "data-unchecked:bg-input dark:data-unchecked:bg-input/50",
        // Focus / validation
        "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20",
        // Expanded click area
        "after:absolute after:-inset-x-3 after:-inset-y-2",
        // Disabled
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        notchOpts && "!border-0 !shadow-none",
        className,
      )}
      style={
        notchOpts
          ? { clipPath: buildNotchPath(resolveNotchOpts(notchOpts === true ? { size: 4 } : { size: 4, ...notchOpts }), 1) }
          : undefined
      }
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          // Emboss thumb — slightly oversized, raised element inside the deboss track
          "pointer-events-none flex items-center justify-center rounded-[2px]",
          // Manual emboss instead of chonk-emboss (thumb can't receive hover, parent drives it)
          "[--chonk-lift:1px] [--chonk-lift-hover:2px] [--chonk-y:var(--chonk-lift)]",
          // Emboss shadow + slide position via CSS variables (avoids transform conflicts)
          "[--slide-x:0px] shadow-[0_var(--chonk-y)_0_0_var(--emboss-shadow)]",
          "translate-x-[var(--slide-x)] translate-y-[calc(-1*var(--chonk-y))]",
          "transition-[translate,box-shadow,--chonk-y,--slide-x] duration-150 ease-out",
          // Checked: primary thumb, slide right
          "data-checked:bg-primary data-checked:text-primary-foreground data-checked:[--emboss-shadow:var(--deboss-shadow)]",
          // Unchecked: neutral thumb, slide left
          "data-unchecked:bg-muted data-unchecked:text-foreground data-unchecked:[--emboss-shadow:var(--deboss-shadow)]",
          "dark:data-unchecked:bg-foreground/80 dark:data-unchecked:text-background",
          // Hover: parent lifts the thumb. Active: press it flat.
          "group-hover/switch:not(:disabled):[--chonk-y:var(--chonk-lift-hover)]",
          "group-active/switch:[--chonk-y:0px]",
          // Slightly oversized (~1.1x): extends ~1px beyond the track
          isLg
            ? "size-[22px] -my-[1px] data-checked:[--slide-x:calc(100%-2px)] data-unchecked:[--slide-x:-4px]"
            : "size-[16px] -my-[1px] data-checked:[--slide-x:calc(100%-2px)] data-unchecked:[--slide-x:-4px]",
        )}
      >
        {/* Grip lines indicating draggability — color inherits from thumb text color */}
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
      <div
        className="chonk-emboss-notched inline-flex [--chonk-lift:1px] [--chonk-lift-hover:1px]"
        style={
          {
            "--outer-clip": outerClip,
          } as React.CSSProperties
        }
      >
        <div
          className="flex"
          style={{ clipPath: outerClip, background: "var(--deboss-shadow)" }}
        >
          {switchEl}
        </div>
      </div>
    );
  }

  return switchEl;
}

export { Switch };
export type { SwitchProps };

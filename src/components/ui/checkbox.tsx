"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { MinusSignIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { type NotchOpts, buildNotchPath, resolveNotchOpts } from "@/lib/notch";
import { cn } from "@/lib/utils";

type CheckboxProps = CheckboxPrimitive.Root.Props & {
  size?: "md" | "sm" | "xs";
  notchOpts?: NotchOpts | true;
};

const sizeClasses = {
  md: "size-5",
  sm: "size-4",
  xs: "size-3.5",
} as const;

const iconSizes = {
  md: "size-4",
  sm: "size-3.5",
  xs: "size-3",
} as const;

function Checkbox({ className, size = "sm", notchOpts, ...props }: CheckboxProps) {
  const checkbox = (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "chonk-emboss peer relative inline-flex shrink-0 items-center justify-center rounded-xs border bg-background transition-colors outline-none select-none [--chonk-lift-hover:2px] [--chonk-lift:1px] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:bg-emboss-surface",
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-checked:[--emboss-shadow:color-mix(in_srgb,var(--primary)_50%,black)] dark:data-checked:bg-primary",
        "focus-visible:outline-hidden",
        "aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        "after:absolute after:-inset-x-3 after:-inset-y-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "group-has-disabled/field:opacity-50",
        sizeClasses[size],
        notchOpts && "!border-0",
        className,
      )}
      style={
        notchOpts
          ? {
              clipPath: buildNotchPath(
                resolveNotchOpts(notchOpts === true ? { size: 3 } : { size: 3, ...notchOpts }),
                1,
              ),
            }
          : undefined
      }
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        {props.indeterminate ? (
          <HugeiconsIcon icon={MinusSignIcon} strokeWidth={2.5} className={iconSizes[size]} />
        ) : (
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2.5} className={iconSizes[size]} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (notchOpts) {
    const resolved = resolveNotchOpts(notchOpts === true ? { size: 3 } : { size: 3, ...notchOpts });
    return (
      <div className="inline-flex shrink-0 overflow-hidden rounded-xs">
        <div
          className="inline-flex shrink-0"
          style={{
            clipPath: buildNotchPath(resolved),
            background: "var(--deboss-shadow)",
          }}
        >
          {checkbox}
        </div>
      </div>
    );
  }

  return checkbox;
}

export { Checkbox };
export type { CheckboxProps };

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { CircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/lib/utils";

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid w-full gap-2", className)}
      {...props}
    />
  );
}

type RadioGroupItemProps = RadioPrimitive.Root.Props & {
  size?: "md" | "sm";
};

const radioSizes = {
  md: "size-5",
  sm: "size-4",
} as const;

const indicatorSizes = {
  md: "size-5",
  sm: "size-4",
} as const;

const dotSizes = {
  md: "size-2.5",
  sm: "size-2",
} as const;

function RadioGroupItem({ className, size = "sm", ...props }: RadioGroupItemProps) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "border-input dark:bg-input/30 peer group/radio-group-item relative inline-flex shrink-0 items-center justify-center rounded-full border outline-none",
        "data-checked:border-primary data-checked:bg-primary",
        "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        "after:absolute after:-inset-x-3 after:-inset-y-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        radioSizes[size],
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className={cn(
          "group-aria-invalid/radio-group-item:text-destructive flex items-center justify-center text-white",
          indicatorSizes[size],
        )}
      >
        <HugeiconsIcon
          icon={CircleIcon}
          strokeWidth={2}
          className={cn(
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 fill-current",
            dotSizes[size],
          )}
        />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  );
}

export { RadioGroup, RadioGroupItem };
export type { RadioGroupItemProps };

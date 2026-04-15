"use client";

import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { ArrowUp01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { type NotchOpts, buildNotchPath, resolveNotchOpts } from "@/lib/notch";
import { cn } from "@/lib/utils";

type NumberInputProps = Omit<NumberFieldPrimitive.Root.Props, "ref"> & {
  size?: "default" | "xs";
  placeholder?: string;
  monospace?: boolean;
  notchOpts?: NotchOpts | true;
};

function NumberInput({
  className,
  size = "default",
  placeholder,
  monospace,
  notchOpts,
  disabled,
  ...props
}: NumberInputProps) {
  const isXs = size === "xs";

  const group = (
    <NumberFieldPrimitive.Root disabled={disabled} className="w-full" {...props}>
      <NumberFieldPrimitive.Group
        data-slot="number-input"
        data-size={size}
        className={cn(
          "relative flex w-full items-center rounded-xs border border-input transition-colors outline-none",
          "has-[[data-slot=number-input-field]:focus-visible]:border-ring has-[[data-slot=number-input-field]:focus-visible]:ring-1 has-[[data-slot=number-input-field]:focus-visible]:ring-ring/50",
          "has-[[data-slot=number-input-field][aria-invalid=true]]:border-destructive has-[[data-slot=number-input-field][aria-invalid=true]]:ring-1 has-[[data-slot=number-input-field][aria-invalid=true]]:ring-destructive/20",
          "dark:bg-deboss-surface dark:bg-input/30",
          isXs ? "h-6" : "h-8",
          disabled && "pointer-events-none opacity-50",
          notchOpts &&
            "!border-0 bg-background shadow-[inset_0_4px_0_0_var(--deboss-shadow)] dark:bg-[#38394C] dark:hover:bg-[#40415A]",
          className,
        )}
        style={notchOpts ? { clipPath: buildNotchPath(resolveNotchOpts(notchOpts), 1) } : undefined}
      >
        <NumberFieldPrimitive.Input
          data-slot="number-input-field"
          placeholder={placeholder}
          className={cn(
            "h-full w-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-xs outline-none placeholder:text-muted-foreground",
            monospace && "font-mono",
          )}
        />
        <div
          className={cn(
            "flex flex-col border-l",
            notchOpts ? "border-border/30" : "border-input",
            isXs ? "w-5 self-stretch" : "w-6 self-stretch",
          )}
        >
          <NumberFieldPrimitive.Increment
            className={cn(
              "flex flex-1 items-center justify-center border-b text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
              notchOpts ? "border-border/30" : "border-input",
            )}
          >
            <HugeiconsIcon
              icon={ArrowUp01Icon}
              strokeWidth={2}
              className={isXs ? "size-2.5" : "size-3"}
            />
          </NumberFieldPrimitive.Increment>
          <NumberFieldPrimitive.Decrement
            className={cn(
              "flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
            )}
          >
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              className={isXs ? "size-2.5" : "size-3"}
            />
          </NumberFieldPrimitive.Decrement>
        </div>
      </NumberFieldPrimitive.Group>
    </NumberFieldPrimitive.Root>
  );

  if (notchOpts) {
    const resolved = resolveNotchOpts(notchOpts);
    return (
      <div className="inline-flex w-full overflow-hidden rounded-xs">
        <div
          className="inline-flex w-full"
          style={{
            clipPath: buildNotchPath(resolved),
            background: "var(--deboss-shadow)",
          }}
        >
          {group}
        </div>
      </div>
    );
  }

  return group;
}

export { NumberInput };
export type { NumberInputProps };

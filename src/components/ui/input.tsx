import { Input as InputPrimitive } from "@base-ui/react/input";
import * as React from "react";

import { type NotchOpts, buildNotchPath, resolveNotchOpts } from "@/lib/notch";
import { cn } from "@/lib/utils";

function Input({
  className,
  type,
  notchOpts,
  ...props
}: React.ComponentProps<"input"> & { notchOpts?: NotchOpts | true }) {
  const inputEl = (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "chonk-deboss h-8 w-full min-w-0 rounded border border-input bg-transparent px-2.5 py-1 text-xs transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-xs dark:bg-deboss-surface dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        notchOpts &&
          "border-0! bg-background shadow-[inset_0_4px_0_0_var(--deboss-shadow)] dark:bg-[#38394C] dark:hover:bg-[#40415A]",
        className,
      )}
      style={notchOpts ? { clipPath: buildNotchPath(resolveNotchOpts(notchOpts), 1) } : undefined}
      {...props}
    />
  );

  if (notchOpts) {
    const resolved = resolveNotchOpts(notchOpts);
    return (
      <div className="inline-flex w-full overflow-hidden rounded">
        <div
          data-slot="input"
          className="inline-flex w-full"
          style={{
            clipPath: buildNotchPath(resolved),
            background: "var(--deboss-shadow)",
          }}
        >
          {inputEl}
        </div>
      </div>
    );
  }

  return inputEl;
}

export { Input };

import * as React from "react";

import { type NotchOpts, buildNotchPath, resolveNotchOpts } from "@/lib/notch";
import { cn } from "@/lib/utils";

function Textarea({
  className,
  notchOpts,
  ...props
}: React.ComponentProps<"textarea"> & { notchOpts?: NotchOpts | true }) {
  const textareaEl = (
    <textarea
      data-slot="textarea"
      className={cn(
        "chonk-deboss flex field-sizing-content min-h-16 w-full rounded-xs border border-input bg-transparent px-2.5 py-2 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:outline-hidden disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:text-xs dark:bg-deboss-surface dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        notchOpts &&
          "!border-0 bg-background shadow-[inset_0_4px_0_0_var(--deboss-shadow)] dark:bg-[#38394C] dark:hover:bg-[#40415A]",
        className,
      )}
      style={notchOpts ? { clipPath: buildNotchPath(resolveNotchOpts(notchOpts), 1) } : undefined}
      {...props}
    />
  );

  if (notchOpts) {
    const resolved = resolveNotchOpts(notchOpts);
    return (
      <div className="inline-flex w-full overflow-hidden rounded-xs">
        <div
          data-slot="textarea"
          className="inline-flex w-full"
          style={{
            clipPath: buildNotchPath(resolved),
            background: "var(--deboss-shadow)",
          }}
        >
          {textareaEl}
        </div>
      </div>
    );
  }

  return textareaEl;
}

export { Textarea };

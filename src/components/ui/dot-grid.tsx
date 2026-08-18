import { cn } from "@/lib/utils";

/**
 * The house stand-in for missing artwork — a fine dot field over whatever
 * the frame already carries (a theme color, a fallback gradient, plain
 * muted). Fills its parent, so the caller owns the box and its aspect.
 *
 * Purely decorative and always `aria-hidden`: it marks the absence of art,
 * it doesn't stand in for the alt text of art that exists.
 */
export function DotGrid({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block h-full w-full", className)}
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--color-muted-foreground) 1px, transparent 1px)",
        backgroundSize: "7px 7px",
        opacity: 0.3,
      }}
    />
  );
}

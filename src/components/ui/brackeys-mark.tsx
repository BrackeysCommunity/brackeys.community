import { cn } from "@/lib/utils";

/**
 * The Brackeys diamond, filled with the brand gradient.
 *
 * The SVG is a solid single-color shape, so the mark is drawn by masking a
 * gradient background with it rather than by rendering the file — that way
 * one asset serves every surface and the gradient stays live against the
 * theme's color variables. Size it with `className` (`h-5 w-5` etc.).
 *
 * `AppHeader` keeps its own copy: that one animates the gradient's
 * position with `motion.div` on a loop, which this static mark does not do.
 */
export function BrackeysMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0", className)}
      style={{
        maskImage: "url(/brackeys-logo.svg)",
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskImage: "url(/brackeys-logo.svg)",
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        background:
          "linear-gradient(135deg, var(--color-brackeys-yellow), var(--color-brackeys-fuscia), var(--color-brackeys-purple))",
      }}
    />
  );
}

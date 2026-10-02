import type { CSSProperties } from "react";

import { SITE } from "@/lib/legal-meta";
import { cn } from "@/lib/utils";

/**
 * The logo as a CSS mask. The SVG is a solid single-color shape, so the
 * mark is drawn by masking a gradient with it rather than by rendering the
 * file: one asset serves every surface, and the gradient stays live
 * against the theme's color variables.
 */
export const BRAND_MASK_STYLE: CSSProperties = {
  maskImage: "url(/logo.svg)",
  maskSize: "contain",
  maskRepeat: "no-repeat",
  maskPosition: "center",
  WebkitMaskImage: "url(/logo.svg)",
  WebkitMaskSize: "contain",
  WebkitMaskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
};

const BRAND_TEXT_GRADIENT =
  "bg-linear-to-r from-[var(--color-brand-yellow)] via-[var(--color-brand-fuchsia)] to-[var(--color-brand-purple)] bg-clip-text text-transparent";

/**
 * The mark, filled with the brand gradient. Size it with `className`
 * (`h-5 w-5` etc.). `AppHeader` animates its own gradient behind
 * `BRAND_MASK_STYLE` instead of using this static fill.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0", className)}
      style={{
        ...BRAND_MASK_STYLE,
        background:
          "linear-gradient(135deg, var(--color-brand-yellow), var(--color-brand-fuchsia), var(--color-brand-purple))",
      }}
    />
  );
}

/** The site name as it sits beside the mark: plain lead, gradient accent. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-bold text-foreground", className)}>
      {SITE.wordmark.lead}
      <span className={BRAND_TEXT_GRADIENT}>{SITE.wordmark.accent}</span>
    </span>
  );
}

import { cn } from "@/lib/utils";

/** Where the ruling is heaviest, and which way it fades out. */
const FADE = {
  bottom: "to bottom",
  "bottom-left": "to bottom left",
} as const;

export interface GraphPaperProps {
  /** Direction the ruling fades toward. Heaviest at the opposite edge. */
  fade?: keyof typeof FADE;
  /** Where the ruling has gone completely. Pull it in for short mastheads. */
  fadeStop?: string;
  /** Ruling pitch. */
  size?: number;
  className?: string;
}

/**
 * The house masthead ruling — 1px graph paper, masked so it frames the
 * headline instead of ending on a hard line. Heaviest behind the
 * headline's shoulder, gone before the panel's far edge.
 *
 * Absolutely positioned and `aria-hidden`; the parent supplies the
 * positioning context and clips it. Content over it needs `relative`.
 *
 * It exists because the same background-image pair, pitch, opacity and
 * mask were spelled raw on the collab inspector and the team directory
 * hero, which is how the two drifted to different opacities.
 */
export function GraphPaper({
  fade = "bottom",
  fadeStop = "85%",
  size = 18,
  className,
}: GraphPaperProps) {
  const mask = `linear-gradient(${FADE[fade]}, #000 0%, transparent ${fadeStop})`;
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{
        backgroundImage:
          "linear-gradient(to right, var(--color-muted-foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--color-muted-foreground) 1px, transparent 1px)",
        backgroundSize: `${size}px ${size}px`,
        opacity: 0.1,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}

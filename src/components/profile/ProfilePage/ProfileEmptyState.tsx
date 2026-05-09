import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

interface ProfileEmptyStateProps {
  /** Big mono-glyph (1–2 chars) — `▢`, `§`, `▶`, etc. */
  glyph: string;
  /** Short uppercase line — "NO PROJECTS YET". */
  title: string;
  /** Friendly second line that explains how to populate the section. */
  hint: string;
  /** Optional CTA — when present, links the empty state to its
   * editor step in the flyout. */
  cta?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * Friendly empty state for profile sections. Same visual rhythm as a
 * filled section (dotted-rule header sits above this), with a chunky
 * mono glyph + two-line copy + optional CTA so a sparse profile still
 * reads as deliberately styled rather than broken.
 */
export function ProfileEmptyState({ glyph, title, hint, cta, className }: ProfileEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded border border-dashed border-muted/40 bg-muted/10 px-4 py-10 text-center",
        className,
      )}
    >
      <span
        aria-hidden
        className="font-mono text-5xl leading-none font-bold tracking-tight text-transparent [-webkit-text-stroke:2px_var(--muted-foreground)]"
      >
        {glyph}
      </span>
      <Text monospace size="xs" variant="muted" bold className="tracking-widest uppercase">
        {title}
      </Text>
      <Text size="sm" variant="muted" className="max-w-[24rem]">
        {hint}
      </Text>
      {cta ? (
        <Button variant="outline" size="sm" onClick={cta.onClick} className="mt-1">
          <span className="font-mono tracking-widest">{cta.label}</span>
        </Button>
      ) : null}
    </div>
  );
}

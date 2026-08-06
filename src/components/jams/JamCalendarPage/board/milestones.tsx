import { InlineCode } from "@/components/ui/typography";
import { formatCountdown } from "@/lib/jam-countdown";
import { cn } from "@/lib/utils";

import { type ChipKind, type JamFromList, lifecyclePoints, nextMilestone } from "../helpers";

export const MILESTONE_VARIANT: Record<ChipKind, "primary" | "warning" | "destructive"> = {
  starting: "primary",
  deadline: "warning",
  ending: "destructive",
};

export const MILESTONE_GLYPH: Record<ChipKind, string> = {
  starting: "▶",
  deadline: "⊙",
  ending: "■",
};

const GLYPH_TINT: Record<ChipKind, string> = {
  starting: "text-primary",
  deadline: "text-warning",
  ending: "text-destructive",
};

/**
 * The one face and scale every piece of supporting text on a jam
 * surface uses — host line, lifecycle dates, countdown chip. Keeping
 * them identical is what stops a row from reading as four competing
 * fonts; the title and the participation counts are the only things
 * allowed to break out of it. Tracking is set per-use: the countdown
 * chip is a long string and can't afford the wide tracking the short
 * labels get.
 */
export const SUPPORTING_TEXT = "font-mono text-[10px] lg:text-xs";

/** Countdown headline for the card, e.g. "⊙ SUBMISSIONS CLOSE IN 2D 14H".
 * `compact` shrinks the chip for tight card footers; `className` lets
 * callers scale it per breakpoint. */
export function MilestoneHeadline({
  jam,
  now,
  compact = false,
  className,
}: {
  jam: JamFromList;
  now: Date;
  compact?: boolean;
  className?: string;
}) {
  const milestone = nextMilestone(jam, now);
  if (!milestone) return null;
  const countdown = formatCountdown(milestone.date, now);
  return (
    <InlineCode
      variant={MILESTONE_VARIANT[milestone.kind]}
      className={cn(compact && `${SUPPORTING_TEXT} tracking-wide`, className)}
    >
      {MILESTONE_GLYPH[milestone.kind]} {milestone.label}
      {countdown && !countdown.past ? ` IN ${countdown.text.toUpperCase()}` : ""}
    </InlineCode>
  );
}

export function LifecycleDates({ jam, now }: { jam: JamFromList; now: Date }) {
  const points = lifecyclePoints(jam);
  if (points.length === 0) return null;
  const t = now.getTime();
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {points.map((p) => (
        <span
          key={p.kind}
          className={cn(
            "flex items-baseline gap-1 tracking-widest whitespace-nowrap",
            SUPPORTING_TEXT,
            p.date.getTime() <= t ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span aria-hidden className={GLYPH_TINT[p.kind]}>
            {MILESTONE_GLYPH[p.kind]}
          </span>
          {p.date
            .toLocaleString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
            .toUpperCase()}
        </span>
      ))}
    </span>
  );
}

import { InlineCode } from "@/components/ui/typography";
import { formatCountdown } from "@/lib/jam-countdown";
import { cn } from "@/lib/utils";

import { type ChipKind, type JamFromList, nextMilestone } from "../helpers";

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

/**
 * The jam's whole arc in one glance: start ▸ submission deadline ▸
 * voting end. The progress *track* renders separately (see
 * `JamProgress`), so this only feeds labels and math.
 */
export function lifecyclePoints(jam: JamFromList): { kind: ChipKind; date: Date }[] {
  const out: { kind: ChipKind; date: Date }[] = [];
  if (jam.startsAt) out.push({ kind: "starting", date: new Date(jam.startsAt) });
  // No voting window → the end date is the jam's full close (■).
  if (jam.endsAt) {
    out.push({ kind: jam.votingEndsAt ? "deadline" : "ending", date: new Date(jam.endsAt) });
  }
  if (jam.votingEndsAt) out.push({ kind: "ending", date: new Date(jam.votingEndsAt) });
  return out;
}

export interface LifecycleProgress {
  /** 0–1 fraction of the start → last-event window elapsed at `now`. */
  fill: number;
  /** Submission-deadline position as a 0–100 percentage of the track,
   * present only when the jam has a separate voting window. */
  deadlinePct: number | null;
}

/** Shared math for both progress renderings (row wash + card bar).
 * Null when the jam doesn't span a measurable window. */
export function lifecycleProgress(jam: JamFromList, now: Date): LifecycleProgress | null {
  const points = lifecyclePoints(jam);
  if (points.length < 2) return null;
  const t0 = points[0]!.date.getTime();
  const t1 = points[points.length - 1]!.date.getTime();
  if (t1 <= t0) return null;
  const fill = clamp01((now.getTime() - t0) / (t1 - t0));
  // Deadline tick only when the jam has a separate voting window (i.e.
  // three points — otherwise the deadline IS the right edge).
  const deadline = points.length === 3 ? points[1]!.date.getTime() : null;
  const deadlinePct = deadline != null ? clamp01((deadline - t0) / (t1 - t0)) * 100 : null;
  return { fill, deadlinePct };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

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

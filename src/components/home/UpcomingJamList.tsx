import type { ReactNode } from "react";

import type { JamFromList } from "@/components/jams/JamCalendarPage/helpers";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { durationDays, effectiveJamState, formatCountdown } from "@/lib/jam-countdown";
import { hostName, jamMonthDay, jamUrl } from "@/lib/jam-links";
import { cn } from "@/lib/utils";

export type UpcomingJamListDensity = "comfortable" | "compact";

interface UpcomingJamListProps {
  jams: JamFromList[];
  isLoading: boolean;
  now: Date;
  /** Rows to show — 6 on desktop, 4 on mobile. */
  limit: number;
  /** `comfortable` is the pointer-targeted desktop row (tighter, hover
   * affordance); `compact` is the touch row (taller, active-press). */
  density?: UpcomingJamListDensity;
  /** Trailing slot in the section bar — desktop's "View all"; mobile omits it. */
  headerRight?: ReactNode;
}

/**
 * The "◆ Soonest Upcoming" Well, shared by the desktop and mobile home
 * pages. They rendered the same list from the same `useHomeJams` data as
 * two copies until they drifted: only desktop suppressed the countdown on
 * a jam that had already ended. That guard is the correct behavior and is
 * now unconditional.
 */
export function UpcomingJamList({
  jams,
  isLoading,
  now,
  limit,
  density = "comfortable",
  headerRight,
}: UpcomingJamListProps) {
  const rows = jams.slice(0, limit);

  return (
    <Well>
      <div className="flex items-center justify-between gap-2 border-b border-muted/30 px-3 py-2">
        <Text size="xs" variant="muted" className="tracking-widest uppercase">
          ◆ Soonest Upcoming
        </Text>
        {headerRight}
      </div>

      {isLoading ? (
        <ul className="divide-y divide-muted/20" aria-hidden>
          {Array.from({ length: limit }, (_, i) => (
            <li key={i} className={cn("flex items-center gap-3 px-3", ROW_PADDING[density])}>
              <Skeleton className="h-8 w-10 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <Text
          as="div"
          size="sm"
          variant="muted"
          align="center"
          className="p-6 tracking-widest uppercase"
        >
          No upcoming jams
        </Text>
      ) : (
        <ul className="divide-y divide-muted/20">
          {rows.map((jam) => (
            <li key={jam.jamId}>
              <UpcomingJamRow jam={jam} now={now} density={density} />
            </li>
          ))}
        </ul>
      )}
    </Well>
  );
}

const ROW_PADDING: Record<UpcomingJamListDensity, string> = {
  comfortable: "py-2.5",
  compact: "py-3",
};

const ROW_FEEDBACK: Record<UpcomingJamListDensity, string> = {
  comfortable: "hover:bg-muted/40",
  compact: "active:bg-muted/40",
};

function UpcomingJamRow({
  jam,
  now,
  density,
}: {
  jam: JamFromList;
  now: Date;
  density: UpcomingJamListDensity;
}) {
  const { month, day } = jamMonthDay(jam.startsAt);
  // A jam whose window has closed gets no countdown — "in 3d" next to an
  // ended jam reads as a start date that already passed.
  const ended = effectiveJamState(jam.startsAt, jam.endsAt, now) === "ended";
  const counted = ended ? null : formatCountdown(jam.startsAt, now);
  const duration = durationDays(jam.startsAt, jam.endsAt);

  return (
    <Link
      href={jamUrl(jam.slug)}
      target="_blank"
      rel="noopener noreferrer"
      variant="inherit"
      className={cn(
        "flex items-center gap-3 px-3 transition-colors",
        ROW_PADDING[density],
        ROW_FEEDBACK[density],
      )}
    >
      <div className="w-10 shrink-0 text-center">
        <Text as="div" size="xs" variant="muted" className="tracking-widest">
          {month}
        </Text>
        <Text as="div" bold density="dense" className="text-base">
          {day}
        </Text>
      </div>

      <div className="min-w-0 flex-1">
        <Text as="div" bold ellipsis size="md">
          {jam.title}
        </Text>
        <Text as="div" size="xs" variant="muted" className="tracking-widest uppercase">
          {hostName(jam)}
          {duration && ` · ${duration}`}
        </Text>
      </div>

      <Text size="xs" variant="muted" className="tracking-widest">
        {counted ? `in ${counted.text}` : ""}
      </Text>
    </Link>
  );
}

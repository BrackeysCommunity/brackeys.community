import { useMemo } from "react";

import { JamShowcaseCard, JamShowcaseRow } from "@/components/home/JamShowcaseRow";
import type { RecentEntry } from "@/components/home/use-recent-entries";
import type { JamFromList } from "@/components/jams/JamCalendarPage/helpers";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { jamLengthDays } from "@/lib/jam-countdown";

/** Jams in the band. Must leave room for the hero under
 * `RECENT_ENTRIES_MAX_JAMS` in `@/orpc/router/jam` — the landing page's
 * covers are one request; `entry-request-caps.test.ts` holds the two in step. */
export const SHOWCASE_MAX_JAMS = 12;

/** Longest jam the band will show. */
export const SHOWCASE_MAX_LENGTH_DAYS = 62;

/**
 * The jams the band shows: the featured tier first, topped up from the
 * ranked upcoming shelf, minus whatever the hero rotation is already
 * promoting and anything running longer than 2 months.
 *
 * Exported so the desktop and mobile pages pick the same set — they used
 * to each slice the same data slightly differently, which is how the two
 * home pages ended up promoting different jams.
 */
export function selectShowcaseJams(
  featured: JamFromList[],
  upcoming: JamFromList[],
  heroJamIds: readonly number[],
): JamFromList[] {
  const seen = new Set<number>(heroJamIds);
  const out: JamFromList[] = [];
  for (const jam of [...featured, ...upcoming]) {
    if (out.length >= SHOWCASE_MAX_JAMS) break;
    if (seen.has(jam.jamId)) continue;
    seen.add(jam.jamId);
    // A jam with no end date is open-ended, which is the case this rule
    // exists for; only a known, short length gets a row.
    const length = jamLengthDays(jam.startsAt, jam.endsAt);
    if (length == null || length > SHOWCASE_MAX_LENGTH_DAYS) continue;
    out.push(jam);
  }
  return out;
}

/**
 * Jams with submissions lead the band as full rows; the rest drop into a
 * two-across grid of compact cards below them.
 *
 * A row carrying a strip of cover art shows what this place is for; a jam
 * without one is four facts and a countdown, which is exactly what the
 * half-width card holds. Order within each bucket preserves the incoming
 * ranking.
 *
 * It keys on the *fetched* entries rather than the jam row's
 * `entriesCount`: itch only fills that column once a jam's deadline has
 * passed, so a live jam with a thousand scraped submissions still reports
 * zero there. That made the column useless as a predictor — the one live
 * jam with real cover art sorted last.
 */
export function splitByEntries(
  jams: JamFromList[],
  byJamId: Map<number, unknown[]>,
): { withEntries: JamFromList[]; withoutEntries: JamFromList[] } {
  const withEntries: JamFromList[] = [];
  const withoutEntries: JamFromList[] = [];
  for (const jam of jams) {
    ((byJamId.get(jam.jamId)?.length ?? 0) > 0 ? withEntries : withoutEntries).push(jam);
  }
  return { withEntries, withoutEntries };
}

interface JamShowcaseBandProps {
  jams: JamFromList[];
  /** Keyed by jam id — fetched once by `useHomeContent`, shared with the hero. */
  entries: Map<number, RecentEntry[]>;
  isLoading: boolean;
  entriesLoading: boolean;
  now: Date;
}

/** The band of jam rows. Entries arrive as a prop: one `listRecentEntries`
 * call covers every row and the hero besides. */
export function JamShowcaseBand({
  jams,
  entries,
  isLoading,
  entriesLoading,
  now,
}: JamShowcaseBandProps) {
  const { withEntries, withoutEntries } = useMemo(
    () => splitByEntries(jams, entries),
    [jams, entries],
  );

  // Waiting on entries too: until they land every jam would classify as
  // entry-less and open in the grid, then jump into a row a beat later.
  if (isLoading || entriesLoading) {
    return (
      <div className="flex flex-col gap-3" aria-hidden>
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full bg-muted/50" />
        ))}
      </div>
    );
  }

  if (jams.length === 0) {
    return (
      <Well variant="ghost">
        <Text
          as="div"
          size="sm"
          variant="muted"
          align="center"
          className="p-6 tracking-widest uppercase"
        >
          No jams to show right now
        </Text>
      </Well>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {withEntries.map((jam) => (
        <JamShowcaseRow
          key={jam.jamId}
          jam={jam}
          entries={entries.get(jam.jamId) ?? []}
          now={now}
        />
      ))}
      {/* An odd count stretches its straggler across both columns rather
          than leaving a hole next to it. */}
      {withoutEntries.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2">
          {withoutEntries.map((jam) => (
            <JamShowcaseCard key={jam.jamId} jam={jam} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

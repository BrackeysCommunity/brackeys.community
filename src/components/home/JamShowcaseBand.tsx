import { useMemo } from "react";

import { JamShowcaseRow } from "@/components/home/JamShowcaseRow";
import { useTopEntries } from "@/components/home/use-top-entries";
import type { JamFromList } from "@/components/jams/JamCalendarPage/helpers";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { jamLengthDays } from "@/lib/jam-countdown";

/** Rows in the band. Kept at or below `TOP_ENTRIES_MAX_JAMS` in
 * `@/orpc/router/jam` (not imported — that module pulls in the db): the
 * band's cover strips are one request for the whole set, and asking for
 * more jams than the server carries would reject it outright. */
export const SHOWCASE_MAX_JAMS = 7;

/** Longest jam the band will show. */
export const SHOWCASE_MAX_LENGTH_DAYS = 62;

/**
 * The jams the band shows: the featured tier first, topped up from the
 * ranked upcoming shelf, minus whichever jam the hero is already
 * promoting and anything running longer than 2 months.
 *
 * Exported so the desktop and mobile pages pick the same set — they used
 * to each slice the same data slightly differently, which is how the two
 * home pages ended up promoting different jams.
 */
export function selectShowcaseJams(
  featured: JamFromList[],
  upcoming: JamFromList[],
  heroJamId: number | null,
): JamFromList[] {
  const seen = new Set<number>(heroJamId != null ? [heroJamId] : []);
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
 * Jams with submissions lead the band.
 *
 * A row carrying a strip of cover art shows what this place is for; a row
 * without one is four facts and a countdown. The sort is stable, so this
 * only lifts a jam past ones it would otherwise have tied with on rank.
 *
 * It keys on the *fetched* entries rather than the jam row's
 * `entriesCount`: itch only fills that column once a jam's deadline has
 * passed, so a live jam with a thousand scraped submissions still reports
 * zero there. That made the column useless as a predictor — the one live
 * jam with real cover art sorted last.
 */
export function orderByEntries(
  jams: JamFromList[],
  byJamId: Map<number, unknown[]>,
): JamFromList[] {
  const has = (j: JamFromList) => Number((byJamId.get(j.jamId)?.length ?? 0) > 0);
  return [...jams].sort((a, b) => has(b) - has(a));
}

interface JamShowcaseBandProps {
  jams: JamFromList[];
  isLoading: boolean;
  now: Date;
}

/**
 * The band of jam rows. One `listTopEntries` call covers every row —
 * per-row queries would turn a four-jam band into four round trips on a
 * page that already ships the whole jam board.
 */
export function JamShowcaseBand({ jams, isLoading, now }: JamShowcaseBandProps) {
  const jamIds = useMemo(() => jams.map((j) => j.jamId), [jams]);
  const { byJamId } = useTopEntries(jamIds);
  const ordered = useMemo(() => orderByEntries(jams, byJamId), [jams, byJamId]);

  if (isLoading) {
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
      {ordered.map((jam, i) => (
        <JamShowcaseRow
          key={jam.jamId}
          jam={jam}
          entries={byJamId.get(jam.jamId) ?? []}
          now={now}
          mirrored={i % 2 === 1}
        />
      ))}
    </div>
  );
}

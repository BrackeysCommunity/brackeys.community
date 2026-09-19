import type { JamFromList } from "@/components/jams/JamCalendarPage/helpers";
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

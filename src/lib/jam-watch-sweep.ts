/**
 * The jam-phase notification pass of the lifecycle sweep — step 5 of
 * `services/lifecycle-sweep`. Lives in `src/lib` in the import-graph-neutral
 * shape of `notify-core.ts` (relative imports, schema + drizzle only, caller
 * passes its own drizzle handle and notify) so the service and DB-backed
 * tests run the same code.
 *
 * Three events, one pass, and each carries its own claimed-timestamp stamp
 * on the *watch* row — never on `itch.jams`, which the scraper owns and
 * reconciles. Claiming before sending is the same trade the expiry nudge
 * makes: losing a notification to a crash beats double-sending it on the
 * re-run, and it is what makes a double-scheduled tick harmless.
 *
 * Tombstoned jams (`missing_since`) are excluded from every query — the
 * scraper stopped finding them, so their dates are the last thing we saw
 * rather than anything true.
 */
import { and, eq, gt, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";

import { itchJamEntries, itchJamEntryResults, itchJams, jamWatches } from "../db/schema";
import { JAM_START_NOTICE_MS } from "./jam-watch";
import type { NotifyParams } from "./notify-core";

// Same convention as notify-core: the caller's drizzle handle, whatever
// driver it was built on.
// biome-ignore lint/suspicious/noExplicitAny: drizzle builder shape changes per env
type DbHandle = any;

export type JamWatchNotify = (
  params: Omit<NotifyParams, "actorId" | "dedupeWithin">,
) => Promise<void>;

/** One event: which watches are due, which stamp claims them, what to send. */
type WatchEvent = {
  stamp: "startNotifiedAt" | "votingNotifiedAt" | "resultsNotifiedAt";
  type: "jam_starting" | "jam_voting_open" | "jam_results_posted";
  due: SQL | undefined;
};

export async function sweepJamWatches(
  db: DbHandle,
  notify: JamWatchNotify,
  now: Date,
): Promise<Record<string, number>> {
  const startCutoff = new Date(now.getTime() + JAM_START_NOTICE_MS);
  const live = isNull(itchJams.missingSince);

  const events: WatchEvent[] = [
    {
      stamp: "startNotifiedAt",
      type: "jam_starting",
      due: and(
        isNotNull(itchJams.startsAt),
        gt(itchJams.startsAt, now),
        lt(itchJams.startsAt, startCutoff),
      ),
    },
    {
      // Submissions closed and a real voting window is open. A jam with no
      // `voting_ends_at` has no voting phase to announce, and inventing one
      // would ping people about nothing.
      stamp: "votingNotifiedAt",
      type: "jam_voting_open",
      due: and(
        isNotNull(itchJams.endsAt),
        lt(itchJams.endsAt, now),
        isNotNull(itchJams.votingEndsAt),
        gt(itchJams.votingEndsAt, now),
      ),
    },
    {
      // Existence of any placement row is the signal, so this fires on the
      // first sweep after the results scrape rather than on a date we would
      // otherwise have to predict.
      stamp: "resultsNotifiedAt",
      type: "jam_results_posted",
      due: sql`EXISTS (
        SELECT 1
        FROM ${itchJamEntries}
        JOIN ${itchJamEntryResults}
          ON ${itchJamEntryResults.entryId} = ${itchJamEntries.entryId}
        WHERE ${itchJamEntries.jamId} = ${itchJams.jamId}
      )`,
    },
  ];

  const sent: Record<string, number> = {};
  for (const event of events) {
    const due: Array<{ userId: string; jamId: number; slug: string; title: string }> = await db
      .select({
        userId: jamWatches.userId,
        jamId: itchJams.jamId,
        slug: itchJams.slug,
        title: itchJams.title,
      })
      .from(jamWatches)
      .innerJoin(itchJams, eq(jamWatches.jamId, itchJams.jamId))
      .where(and(live, isNull(jamWatches[event.stamp]), event.due));

    let count = 0;
    for (const row of due) {
      const [claimed] = await db
        .update(jamWatches)
        .set({ [event.stamp]: now })
        .where(
          and(
            eq(jamWatches.userId, row.userId),
            eq(jamWatches.jamId, row.jamId),
            isNull(jamWatches[event.stamp]),
          ),
        )
        .returning({ jamId: jamWatches.jamId });
      if (!claimed) continue;
      await notify({
        userId: row.userId,
        type: event.type,
        entityType: "jam",
        entityId: String(row.jamId),
        data: { jamId: row.jamId, jamTitle: row.title, jamUrl: `/jams/${row.slug}` },
      });
      count++;
    }
    sent[event.type] = count;
  }

  return sent;
}

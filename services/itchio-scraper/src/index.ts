import { and, eq, exists, gt, isNull, ne, or, sql } from "drizzle-orm";

import { itchJamEntries, itchJams } from "../../../src/db/schema.ts";
import { config } from "./config.ts";
import { db, pool } from "./db/client.ts";
import { syncJam } from "./jobs/sync-jam.ts";
import {
  discoverBrackeysSearchSlugs,
  discoverInProgressSlugs,
  discoverRecentlyEndedSlugs,
  discoverUpcomingSlugs,
} from "./scrape/discover-listings.ts";

// Politeness gap between per-jam syncs; each sync is 1-2 plain fetches.
const JAM_DELAY_MS = 250;

type SlugBuckets = {
  upcoming: string[];
  inProgress: string[];
  brackeysBackfill: string[];
  endedBackfill: string[];
  persistedResync: string[];
};

async function collectSlugs(): Promise<SlugBuckets> {
  const [upcoming, inProgress, brackeysSearch, recentlyEnded, allPersisted, needsResync] =
    await Promise.all([
      discoverUpcomingSlugs().catch((err) => {
        console.error("[scrape] /jams/upcoming failed", err);
        return [] as string[];
      }),
      discoverInProgressSlugs().catch((err) => {
        console.error("[scrape] /jams/in-progress failed", err);
        return [] as string[];
      }),
      discoverBrackeysSearchSlugs().catch((err) => {
        console.error("[scrape] brackeys search failed", err);
        return [] as string[];
      }),
      discoverRecentlyEndedSlugs(config.ENDED_LOOKBACK_DAYS).catch((err) => {
        console.error("[scrape] /jams/past/sort-date failed", err);
        return [] as string[];
      }),
      db
        .select({ slug: itchJams.slug })
        .from(itchJams)
        .then((rows) => new Set(rows.map((r) => r.slug))),
      // Re-sync a persisted jam only if it isn't in a terminal state yet:
      //   - status isn't "over" (catches state transitions), OR
      //   - at least one entry still hasn't had its rate page scraped
      //     (missing entries don't count — their rate pages 404).
      // Jams marked missing keep being retried for MISSING_RETRY_DAYS, then
      // drop out until manually reviewed (or until a successful scrape via
      // discovery clears the mark).
      db
        .select({ slug: itchJams.slug })
        .from(itchJams)
        .where(
          and(
            or(
              isNull(itchJams.missingSince),
              gt(
                itchJams.missingSince,
                sql`now() - make_interval(days => ${config.MISSING_RETRY_DAYS})`,
              ),
            ),
            or(
              ne(itchJams.status, "over"),
              exists(
                db
                  .select({ one: sql<number>`1` })
                  .from(itchJamEntries)
                  .where(
                    and(
                      eq(itchJamEntries.jamId, itchJams.jamId),
                      isNull(itchJamEntries.resultsFetchedAt),
                      isNull(itchJamEntries.missingSince),
                    ),
                  ),
              ),
            ),
          ),
        )
        .then((rows) => rows.map((r) => r.slug)),
    ]);

  const brackeysBackfill = brackeysSearch.filter((s) => !allPersisted.has(s));
  // Ended jams already persisted are either fully done (skip) or carry pending
  // results and are in the resync bucket anyway — only backfill unknown ones.
  const endedBackfill = recentlyEnded.filter((s) => !allPersisted.has(s));

  return { upcoming, inProgress, brackeysBackfill, endedBackfill, persistedResync: needsResync };
}

async function runScrape() {
  const started = Date.now();
  let hadFailure = false;

  const { upcoming, inProgress, brackeysBackfill, endedBackfill, persistedResync } =
    await collectSlugs();
  const slugs = [
    ...new Set([
      ...upcoming,
      ...inProgress,
      ...brackeysBackfill,
      ...endedBackfill,
      ...persistedResync,
    ]),
  ];

  console.log(
    `[scrape] slugs: upcoming=${upcoming.length} in-progress=${inProgress.length} brackeys-backfill=${brackeysBackfill.length} ended-backfill=${endedBackfill.length} persisted-resync=${persistedResync.length} total=${slugs.length}`,
  );

  if (slugs.length === 0) {
    console.warn("[scrape] nothing to sync this tick");
    return;
  }

  for (const slug of slugs) {
    try {
      await syncJam(slug);
    } catch (err) {
      hadFailure = true;
      console.error(`[scrape] failed to sync jam ${slug}`, err);
    }
    await new Promise((r) => setTimeout(r, JAM_DELAY_MS));
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`[scrape] finished run in ${elapsed}s`);
  if (hadFailure) {
    throw new Error("one or more jams failed to sync");
  }
}

async function main() {
  try {
    await runScrape();
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[boot] fatal", err);
  process.exit(1);
});

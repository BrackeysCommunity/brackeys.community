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
  /** Finished jams with unfetched rankings. Drained before anything else. */
  pendingResults: string[];
  upcoming: string[];
  inProgress: string[];
  brackeysBackfill: string[];
  endedBackfill: string[];
  /** Persisted jams not yet terminal, re-synced to catch state transitions. */
  stateResync: string[];
};

/** A jam marked missing stays in the buckets only while inside the retry window. */
function withinMissingWindow() {
  return or(
    isNull(itchJams.missingSince),
    gt(itchJams.missingSince, sql`now() - make_interval(days => ${config.MISSING_RETRY_DAYS})`),
  );
}

/** At least one entry still needs its rankings (missing entries don't count — they 404). */
function hasPendingResults() {
  return exists(
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
  );
}

async function collectSlugs(): Promise<SlugBuckets> {
  const [
    upcoming,
    inProgress,
    brackeysSearch,
    recentlyEnded,
    allPersisted,
    pendingResults,
    stateResync,
  ] = await Promise.all([
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
    // Finished jams still carrying unfetched rankings. These run FIRST, ahead
    // of all discovery, so the ratings backlog drains before anything else
    // competes for the request budget. They cost no metadata requests —
    // syncJam takes the results-only path for terminal jams.
    db
      .select({ slug: itchJams.slug })
      .from(itchJams)
      .where(and(withinMissingWindow(), eq(itchJams.status, "over"), hasPendingResults()))
      .then((rows) => rows.map((r) => r.slug)),
    // Persisted jams that aren't terminal yet — re-synced to catch state
    // transitions. Their rankings aren't scraped until voting closes, so
    // they carry no drain work and sit at the back of the queue.
    // Jams marked missing keep being retried for MISSING_RETRY_DAYS, then
    // drop out until manually reviewed (or until a successful scrape via
    // discovery clears the mark).
    db
      .select({ slug: itchJams.slug })
      .from(itchJams)
      .where(and(withinMissingWindow(), ne(itchJams.status, "over")))
      .then((rows) => rows.map((r) => r.slug)),
  ]);

  const brackeysBackfill = brackeysSearch.filter((s) => !allPersisted.has(s));
  // Ended jams already persisted are either fully done (skip) or carry pending
  // results and are in the pendingResults bucket anyway — only backfill unknown ones.
  const endedBackfill = recentlyEnded.filter((s) => !allPersisted.has(s));

  return { pendingResults, upcoming, inProgress, brackeysBackfill, endedBackfill, stateResync };
}

async function runScrape() {
  const started = Date.now();
  let hadFailure = false;

  const { pendingResults, upcoming, inProgress, brackeysBackfill, endedBackfill, stateResync } =
    await collectSlugs();
  // Order is deliberate and load-bearing: the ratings backlog runs to
  // completion before any discovery work. `new Set` keeps first insertion
  // position, so a slug appearing in several buckets is synced at its earliest
  // one — putting pendingResults first is what guarantees the drain leads.
  const slugs = [
    ...new Set([
      ...pendingResults,
      ...upcoming,
      ...inProgress,
      ...brackeysBackfill,
      ...endedBackfill,
      ...stateResync,
    ]),
  ];

  console.log(
    `[scrape] slugs: pending-results=${pendingResults.length} upcoming=${upcoming.length} in-progress=${inProgress.length} brackeys-backfill=${brackeysBackfill.length} ended-backfill=${endedBackfill.length} state-resync=${stateResync.length} total=${slugs.length}`,
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

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

export type SlugBuckets = {
  /** Persisted jams not yet terminal — where new submissions land. Synced first. */
  stateResync: string[];
  upcoming: string[];
  inProgress: string[];
  brackeysBackfill: string[];
  endedBackfill: string[];
  /** Finished jams with unfetched rankings. Drained after everything else. */
  pendingResults: string[];
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
    // Finished jams still carrying unfetched rankings. These run LAST: the
    // rankings are frozen — a jam that's over stays over — so nothing is lost
    // by collecting them after the time-sensitive work. They cost no metadata
    // requests; syncJam takes the results-only path for terminal jams.
    db
      .select({ slug: itchJams.slug })
      .from(itchJams)
      .where(and(withinMissingWindow(), eq(itchJams.status, "over"), hasPendingResults()))
      .then((rows) => rows.map((r) => r.slug)),
    // Persisted jams that aren't terminal yet — upcoming, running, or in
    // voting. These run FIRST: a live jam's entry list changes under us, and
    // an entries.json refresh is the only thing that captures submissions
    // added since the last tick. Miss a window here and the entries are
    // invisible until the jam is next synced.
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

  return { stateResync, upcoming, inProgress, brackeysBackfill, endedBackfill, pendingResults };
}

/**
 * Flattens the buckets into the order they're synced in. Deliberate and
 * load-bearing, so it's exported and tested rather than left inline.
 *
 * Perishable work runs first. Live jams — persisted ones via state-resync,
 * then discovery for jams we don't hold yet — lead because their entry lists
 * move under us: a submission added today is only captured by a sync that
 * happens while the jam is still open. Rankings are the opposite; a finished
 * jam's scores never change, so pendingResults trails everything and takes
 * whatever request budget is left.
 *
 * The tradeoff is which half a cut-short run drops (redeploy, platform
 * restart): now it's ranking collection rather than discovery. That's
 * recoverable — the next tick re-queues the same jams and `bun run drain`
 * catches up on demand — whereas a missed entries.json window is not.
 *
 * `new Set` keeps first insertion position, so a slug in several buckets is
 * synced at its earliest one.
 */
export function orderedSlugs(buckets: SlugBuckets): string[] {
  return [
    ...new Set([
      ...buckets.stateResync,
      ...buckets.upcoming,
      ...buckets.inProgress,
      ...buckets.brackeysBackfill,
      ...buckets.endedBackfill,
      ...buckets.pendingResults,
    ]),
  ];
}

async function runScrape() {
  const started = Date.now();
  let hadFailure = false;

  const buckets = await collectSlugs();
  const { stateResync, upcoming, inProgress, brackeysBackfill, endedBackfill, pendingResults } =
    buckets;
  const slugs = orderedSlugs(buckets);

  console.log(
    `[scrape] slugs: state-resync=${stateResync.length} upcoming=${upcoming.length} in-progress=${inProgress.length} brackeys-backfill=${brackeysBackfill.length} ended-backfill=${endedBackfill.length} pending-results=${pendingResults.length} total=${slugs.length}`,
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

// Guarded so the ordering helper can be imported (and tested) without booting
// a scrape. `bun run start` runs this file directly, so the cron is unaffected.
if (import.meta.main) {
  main().catch((err) => {
    console.error("[boot] fatal", err);
    process.exit(1);
  });
}

import { and, eq, exists, isNull, ne, or, sql } from "drizzle-orm";

import { itchJamEntries, itchJams } from "../../../src/db/schema.ts";
import { db, pool } from "./db/client.ts";
import { syncJam } from "./jobs/sync-jam.ts";
import { discoverBrackeysSearchSlugs, discoverUpcomingSlugs } from "./scrape/discover-listings.ts";

type SlugBuckets = {
  upcoming: string[];
  brackeysBackfill: string[];
  persistedResync: string[];
};

async function collectSlugs(): Promise<SlugBuckets> {
  const [upcoming, brackeysSearch, allPersisted, needsResync] = await Promise.all([
    discoverUpcomingSlugs().catch((err) => {
      console.error("[scrape] /jams/upcoming failed", err);
      return [] as string[];
    }),
    discoverBrackeysSearchSlugs().catch((err) => {
      console.error("[scrape] brackeys search failed", err);
      return [] as string[];
    }),
    db
      .select({ slug: itchJams.slug })
      .from(itchJams)
      .then((rows) => new Set(rows.map((r) => r.slug))),
    // Re-sync a persisted jam only if it isn't in a terminal state yet:
    //   - status isn't "over" (catches state transitions), OR
    //   - at least one entry still hasn't had its rate page scraped.
    db
      .select({ slug: itchJams.slug })
      .from(itchJams)
      .where(
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
                ),
              ),
          ),
        ),
      )
      .then((rows) => rows.map((r) => r.slug)),
  ]);

  const brackeysBackfill = brackeysSearch.filter((s) => !allPersisted.has(s));

  return { upcoming, brackeysBackfill, persistedResync: needsResync };
}

async function runScrape() {
  const started = Date.now();
  let hadFailure = false;

  const { upcoming, brackeysBackfill, persistedResync } = await collectSlugs();
  const slugs = [...new Set([...upcoming, ...brackeysBackfill, ...persistedResync])];

  console.log(
    `[scrape] slugs: upcoming=${upcoming.length} brackeys-backfill=${brackeysBackfill.length} persisted-resync=${persistedResync.length} total=${slugs.length}`,
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

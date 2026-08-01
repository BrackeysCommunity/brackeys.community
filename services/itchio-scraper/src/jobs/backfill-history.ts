import { sql } from "drizzle-orm";

import { itchJamEntries, itchJams, itchMissingJams } from "../../../../src/db/schema.ts";
import { db, pool } from "../db/client.ts";
import { isNotFound } from "../http.ts";
import { fetchPastSortDatePage } from "../scrape/discover-listings.ts";
import { fetchJamEntries } from "../scrape/entries.ts";
import { scrapeJamPage } from "../scrape/jam-page.ts";
import { markUnratableEntriesFetched, upsertEntries, upsertJam } from "./sync-jam.ts";

/**
 * One-off, resumable historical backfill: walks /jams/past/sort-date (end
 * date descending, ~420 pages back to 2014) and ingests every jam not yet in
 * `itch.jams` — jam metadata plus entries. Per-criterion rankings are left to
 * the nightly cron, which drains entries with `results_fetched_at IS NULL`
 * through its pending-results bucket; entries with zero ratings are pre-marked
 * here since they can't rank.
 *
 * Resumability comes from idempotence: already-persisted jams are skipped, so
 * re-running after an interruption continues where the previous run got to.
 * Listed jams whose page 404s (deleted on itch before we ever saw them) are
 * recorded in `itch.missing_jams` so later runs skip the known-dead fetch.
 *
 * Sizing and pacing rationale: docs/research/itch-scraper-browserless-deep-dive.md.
 *
 *   bun run backfill
 *
 * Env knobs (all optional):
 *   BACKFILL_MAX_JAMS   stop after ingesting this many jams (default: unlimited)
 *   BACKFILL_OLDEST     ISO date; skip jams that ended before it (default: none)
 *   BACKFILL_DELAY_MS   pause between jams (default: 400)
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PersistedJamRow = {
  status: string;
  entriesCount: number | null;
  hasEntries: boolean;
};

/**
 * A jam only counts as done for backfill purposes when its entries made it in
 * too — a run killed between the jam upsert and the entries upsert must
 * re-ingest on resume. Non-terminal jams are the nightly cron's job either
 * way, and jams reporting zero entries have nothing further to fetch.
 */
export function isIngestComplete(row: PersistedJamRow): boolean {
  return row.hasEntries || (row.entriesCount ?? 0) === 0 || row.status !== "over";
}

async function backfillJam(slug: string): Promise<"ok" | "gone"> {
  let jam;
  try {
    jam = await scrapeJamPage(slug);
  } catch (err) {
    if (isNotFound(err)) {
      await db.insert(itchMissingJams).values({ slug }).onConflictDoNothing();
      return "gone";
    }
    throw err;
  }
  await upsertJam(jam);

  const entries = (await fetchJamEntries(jam.jamId)) ?? [];
  await upsertEntries(jam.jamId, entries);
  await markUnratableEntriesFetched(jam.jamId);

  console.log(
    `[backfill] ok ${slug} id=${jam.jamId} status=${jam.status} entries=${entries.length}`,
  );
  return "ok";
}

async function main() {
  const MAX_JAMS = process.env.BACKFILL_MAX_JAMS
    ? Number.parseInt(process.env.BACKFILL_MAX_JAMS, 10)
    : Number.POSITIVE_INFINITY;
  const OLDEST = process.env.BACKFILL_OLDEST ? new Date(process.env.BACKFILL_OLDEST) : null;
  const DELAY_MS = process.env.BACKFILL_DELAY_MS
    ? Number.parseInt(process.env.BACKFILL_DELAY_MS, 10)
    : 400;

  const started = Date.now();
  const rows = await db
    .select({
      slug: itchJams.slug,
      status: itchJams.status,
      entriesCount: itchJams.entriesCount,
      hasEntries: sql<boolean>`exists (
        select 1 from ${itchJamEntries} e where e.jam_id = ${itchJams.jamId}
      )`,
    })
    .from(itchJams);
  const persisted = new Set(rows.filter(isIngestComplete).map((r) => r.slug));
  // Known-dead slugs from previous runs — no point re-fetching their 404s.
  const knownGone = await db
    .select({ slug: itchMissingJams.slug })
    .from(itchMissingJams)
    .then((r) => new Set(r.map((row) => row.slug)));
  const partial = rows.length - persisted.size;
  console.log(
    `[backfill] starting — ${rows.length} jams persisted, ${persisted.size} complete, ${partial} to re-ingest, ${knownGone.size} known gone`,
  );

  let ingested = 0;
  let skipped = 0;
  let gone = 0;
  let failed = 0;
  let reachedCutoff = false;

  outer: for (let page = 1; ; page++) {
    const { entries, hasNext } = await fetchPastSortDatePage(page);
    if (entries.length === 0) break;

    for (const { slug, endedAt } of entries) {
      if (OLDEST && endedAt && endedAt < OLDEST) {
        reachedCutoff = true;
        break outer;
      }
      if (persisted.has(slug) || knownGone.has(slug)) {
        skipped++;
        continue;
      }
      if (ingested >= MAX_JAMS) break outer;
      try {
        const outcome = await backfillJam(slug);
        if (outcome === "gone") gone++;
        else ingested++;
        persisted.add(slug);
      } catch (err) {
        failed++;
        console.error(`[backfill] FAIL ${slug}`, err instanceof Error ? err.message : err);
      }
      await sleep(DELAY_MS);
    }

    console.log(
      `[backfill] page ${page} done — ingested=${ingested} skipped=${skipped} gone=${gone} failed=${failed}`,
    );
    if (!hasNext) break;
    await sleep(DELAY_MS);
  }

  const mins = Math.round((Date.now() - started) / 60_000);
  console.log(
    `[backfill] finished in ${mins}m — ingested=${ingested} skipped=${skipped} gone=${gone} failed=${failed}${
      reachedCutoff ? " (stopped at BACKFILL_OLDEST cutoff)" : ""
    }${ingested >= MAX_JAMS ? " (stopped at BACKFILL_MAX_JAMS — re-run to continue)" : ""}`,
  );
  if (failed > 0) process.exitCode = 1;
}

if (import.meta.main) {
  try {
    await main();
  } finally {
    await pool.end().catch(() => {});
  }
}

import { eq, exists, sql } from "drizzle-orm";

import { itchJamEntries, itchJams, itchMissingJams } from "../../../../src/db/schema.ts";
import { createServiceTelemetry } from "../../../../src/lib/service-telemetry.ts";
import { db, pool } from "../db/client.ts";
import { sleep } from "../http.ts";
import { fetchPastSortDatePage } from "../scrape/discover-listings.ts";
import { runIdSweep } from "./sweep-ids.ts";
import { ingestJam } from "./sync-jam.ts";

/**
 * One-off, resumable historical backfill: walks /jams/past/sort-date (end
 * date descending, ~420 pages back to 2014) and ingests every jam not yet in
 * `itch.jams` — jam metadata plus entries. Per-criterion rankings are left to
 * the `results` cron tier, which drains entries with `results_fetched_at IS
 * NULL`; entries with zero ratings are pre-marked here since they can't rank.
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

export type PersistedJamRow = {
  status: string;
  entriesCount: number | null;
  hasEntries: boolean;
};

/**
 * A jam only counts as done for backfill purposes when its entries made it in
 * too — a run killed between the jam upsert and the entries upsert must
 * re-ingest on resume. Non-terminal jams are the live tier's job either
 * way, and jams reporting zero entries have nothing further to fetch.
 */
export function isIngestComplete(row: PersistedJamRow): boolean {
  return row.hasEntries || (row.entriesCount ?? 0) === 0 || row.status !== "over";
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
      // exists() rather than a raw sql`` subquery: an unqualified `jam_id`
      // inside the subquery binds to the *inner* table, making the predicate
      // `e.jam_id = e.jam_id` — true for every row. That silently reported
      // every persisted jam as having entries, so the resume guard below
      // (re-ingesting a jam whose entries never landed) never fired.
      hasEntries: sql<boolean>`${exists(
        db
          .select({ one: sql<number>`1` })
          .from(itchJamEntries)
          .where(eq(itchJamEntries.jamId, itchJams.jamId)),
      )}`,
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
  let reachedCutoff = false;
  const failedSlugs: string[] = [];

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
        const outcome = await ingestJam(slug);
        if (outcome === "gone") gone++;
        else ingested++;
        persisted.add(slug);
      } catch (err) {
        failedSlugs.push(slug);
        console.error(`[backfill] FAIL ${slug}`, err instanceof Error ? err.message : err);
      }
      await sleep(DELAY_MS);
    }

    console.log(
      `[backfill] page ${page} done — ingested=${ingested} skipped=${skipped} gone=${gone} failed=${failedSlugs.length}`,
    );
    if (!hasNext) break;
    await sleep(DELAY_MS);
  }

  // One more attempt at whatever failed, now that the walk is done and itch's
  // rate pacer has cooled off. Anything still failing is left for the next
  // tick, which re-derives the same set from `itch.jams`.
  let failed = failedSlugs.length;
  if (failed > 0) {
    console.log(`[backfill] retrying ${failed} failed jam(s)`);
    for (const slug of failedSlugs) {
      try {
        const outcome = await ingestJam(slug);
        if (outcome === "gone") gone++;
        else ingested++;
        failed--;
      } catch (err) {
        console.error(`[backfill] FAIL ${slug}`, err instanceof Error ? err.message : err);
      }
      await sleep(DELAY_MS);
    }
  }

  const mins = Math.round((Date.now() - started) / 60_000);
  console.log(
    `[backfill] finished in ${mins}m — ingested=${ingested} skipped=${skipped} gone=${gone} failed=${failed}${
      reachedCutoff ? " (stopped at BACKFILL_OLDEST cutoff)" : ""
    }${ingested >= MAX_JAMS ? " (stopped at BACKFILL_MAX_JAMS — re-run to continue)" : ""}`,
  );

  // Second phase of the same tick. The walk above can only ingest what itch
  // lists, and itch's listings are not a complete index of past jams — the id
  // sweep picks up where they stop. Its own deadline and cursor bound it, so a
  // tick that reaches here late simply sweeps less.
  await runIdSweep();
}

if (import.meta.main) {
  const telemetry = createServiceTelemetry("itchio-scraper");
  try {
    await main();
  } catch (err) {
    telemetry.captureException(err, { job: "backfill-history" });
    throw err;
  } finally {
    await pool.end().catch(() => {});
    await telemetry.shutdown();
  }
}

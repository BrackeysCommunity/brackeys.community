import { and, eq, isNull, sql } from "drizzle-orm";

import { type ItchJamStatus, itchJamEntries, itchJams } from "../../../../src/db/schema.ts";
import { config } from "../config.ts";
import { db, pool } from "../db/client.ts";
import { describeError } from "../http.ts";
import { syncEntryResults } from "./sync-jam.ts";

/**
 * One-off, resumable drain of pending per-criterion rankings — and nothing
 * else. No listing discovery, no jam-page or entries.json refetch: it walks
 * finished jams that still have entries with `results_fetched_at IS NULL` and
 * pulls their rankings off the bulk `/jam/{slug}/results` listing.
 *
 * Exists so a backlog can be worked through without retuning the nightly cron.
 * The nightly run syncs live jams and discovery first — correctly, since their
 * entry lists are perishable while finished jams' rankings are frozen — and
 * only reaches ranking collection at the end of the tick (see `orderedSlugs`
 * in index.ts). This job skips straight to the collection.
 *
 * Resumability is inherent: `results_fetched_at` is stamped per entry, so an
 * interrupted run loses nothing and a re-run continues where it stopped.
 * SIGINT/SIGTERM finish the current jam and exit cleanly.
 *
 *   bun run drain
 *
 * Env knobs (all optional):
 *   DRAIN_MAX_JAMS      stop after this many jams (default: unlimited)
 *   DRAIN_DEADLINE_MINS stop after this long, mid-list (default: unlimited)
 *   DRAIN_DELAY_MS      pause between jams (default: 250)
 *   DRAIN_ORDER         "newest" (default) or "smallest" — see below
 *
 * Ordering defaults to newest-jam-first, so the rankings users are most likely
 * to look at land first. `smallest` instead takes the jams with the fewest
 * pending entries, which clears the backlog *count* fastest.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type DrainCandidate = {
  jamId: number;
  slug: string;
  status: ItchJamStatus;
  pending: number;
};

/**
 * Finished jams still carrying unfetched rankings, most valuable first.
 *
 * Only `over` jams qualify: a jam still in voting has moving scores, and the
 * nightly sync owns it. Jams and entries stamped missing are excluded — their
 * pages 404.
 */
export async function pendingJams(order: "newest" | "smallest"): Promise<DrainCandidate[]> {
  const pending = sql<number>`count(*)::int`;
  return await db
    .select({
      jamId: itchJams.jamId,
      slug: itchJams.slug,
      status: itchJams.status,
      pending,
    })
    .from(itchJams)
    .innerJoin(itchJamEntries, eq(itchJamEntries.jamId, itchJams.jamId))
    .where(
      and(
        eq(itchJams.status, "over"),
        isNull(itchJams.missingSince),
        isNull(itchJamEntries.resultsFetchedAt),
        isNull(itchJamEntries.missingSince),
      ),
    )
    .groupBy(itchJams.jamId, itchJams.slug, itchJams.status, itchJams.endsAt)
    // `nulls last` matters: Postgres sorts NULLs first on DESC, which would put
    // undated jams ahead of the recent ones this ordering exists to prioritize.
    .orderBy(order === "smallest" ? pending : sql`${itchJams.endsAt} desc nulls last`);
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const maxJams = intEnv("DRAIN_MAX_JAMS", Number.POSITIVE_INFINITY);
  const deadlineMins = intEnv("DRAIN_DEADLINE_MINS", Number.POSITIVE_INFINITY);
  const delayMs = intEnv("DRAIN_DELAY_MS", 250);
  const order = process.env.DRAIN_ORDER === "smallest" ? "smallest" : "newest";

  if (config.SCRAPE_ENTRY_RESULTS === "never") {
    console.error("[drain] SCRAPE_ENTRY_RESULTS=never — nothing to do; unset it to run the drain");
    process.exitCode = 1;
    return;
  }

  // Finish the jam in flight rather than tearing down mid-transaction.
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) process.exit(130);
      stopping = true;
      console.log(`[drain] ${signal} — finishing current jam, then exiting (re-run to resume)`);
    });
  }

  const started = Date.now();
  const deadlineAt = started + deadlineMins * 60_000;

  const jams = await pendingJams(order);
  const totalEntries = jams.reduce((sum, j) => sum + j.pending, 0);
  console.log(
    `[drain] ${jams.length} jams with ${totalEntries} pending entries (order=${order}, pacing=${config.MIN_REQUEST_INTERVAL_MS}ms)`,
  );
  if (jams.length === 0) return;

  let done = 0;
  let ranked = 0;
  let drainedEntries = 0;
  let unratable = 0;
  let failed = 0;
  let stoppedEarly = "";

  for (const jam of jams) {
    if (stopping) {
      stoppedEarly = "interrupted";
      break;
    }
    if (done >= maxJams) {
      stoppedEarly = "DRAIN_MAX_JAMS";
      break;
    }
    if (Date.now() > deadlineAt) {
      stoppedEarly = "DRAIN_DEADLINE_MINS";
      break;
    }

    try {
      const out = await syncEntryResults(jam);
      done += 1;
      ranked += out.ranked;
      drainedEntries += out.succeeded;
      unratable += out.unratable;
      const unrated = out.unratable > 0 ? `, ${out.unratable} unrated (no fetch)` : "";
      console.log(
        `[drain] ${jam.slug} — ${out.succeeded}/${out.attempted} entries via ${out.source} (${out.ranked} ranked${unrated})`,
      );
    } catch (err) {
      failed += 1;
      console.error(`[drain] FAIL ${jam.slug}: ${describeError(err)}`);
    }

    // Progress + ETA off measured throughput, which swings a lot with itch's
    // rate limiting — worth reporting so a stalling run is obvious early.
    if ((done + failed) % 25 === 0) {
      const elapsedMin = (Date.now() - started) / 60_000;
      const remaining = jams.length - done - failed;
      const etaMin = (remaining / Math.max(done + failed, 1)) * elapsedMin;
      console.log(
        `[drain] progress ${done + failed}/${jams.length} jams, ${drainedEntries + unratable} entries resolved (${drainedEntries} fetched, ${unratable} unrated), ${elapsedMin.toFixed(1)}m elapsed, ~${etaMin.toFixed(0)}m remaining`,
      );
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  const mins = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(
    `[drain] finished in ${mins}m — jams=${done}/${jams.length} resolved=${drainedEntries + unratable} (fetched=${drainedEntries} unrated=${unratable}) ranked=${ranked} failed=${failed}${
      stoppedEarly ? ` (stopped early: ${stoppedEarly} — re-run to continue)` : ""
    }`,
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

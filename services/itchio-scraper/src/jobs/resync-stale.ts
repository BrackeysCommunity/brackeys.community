import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";

import { itchJamEntries, itchJams } from "../../../../src/db/schema.ts";
import { db, pool } from "../db/client.ts";
import { describeError } from "../http.ts";
import { syncJam } from "./sync-jam.ts";

/**
 * Re-syncs jams whose stored `status` says they're unfinished but whose dates
 * say otherwise, then lets `syncJam` drain their rankings in the same pass.
 *
 * `drain` only reads jams already at `status = 'over'` and never re-scrapes a
 * jam page, so a row carrying a stale status is invisible to it — the entries
 * show up in a `results_fetched_at IS NULL` count but nothing collects them.
 * This job is the other half: it re-scrapes the page (which corrects the
 * status) and, because `syncJam` calls `syncEntryResults` after the upsert,
 * pulls that jam's rankings immediately. `drain` stays the right tool once
 * statuses are trustworthy; this one unsticks the rows that aren't.
 *
 * Written for the mislabelling that `deriveStatus` caused before it was taught
 * itch's real phase classes (`during_submit` / `during_voting`), which parked
 * every unfinished jam at `upcoming`. It isn't specific to that bug: any jam
 * whose status lags reality — a sync interrupted mid-run, a phase class itch
 * renames later — lands in the same set.
 *
 * Scoped to jams that are genuinely finished (`voting_ends_at`, or `ends_at`
 * when the jam has no voting phase, already past). Jams still taking
 * submissions or still in voting have no final rankings to fetch, so
 * re-scraping them costs requests to learn nothing.
 *
 * Resumable and idempotent: progress is the persisted status and
 * `results_fetched_at`, so an interrupted run loses nothing and a re-run picks
 * up what's left. SIGINT/SIGTERM finish the current jam and exit.
 *
 *   bun run resync
 *
 * Env knobs (all optional):
 *   RESYNC_MAX_JAMS   stop after this many jams (default: unlimited)
 *   RESYNC_DELAY_MS   pause between jams (default: 400, matching backfill)
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type StaleJam = {
  jamId: number;
  slug: string;
  pending: number;
};

/**
 * Jams contradicting their own dates and still holding uncollected rankings,
 * largest backlog first.
 *
 * Missing jams are excluded — their pages 404. `coalesce` is what makes the
 * date check correct for both shapes of jam: most carry a voting deadline, but
 * a jam with no voting phase leaves `voting_ends_at` null and is finished when
 * submissions close.
 */
export async function staleJams(): Promise<StaleJam[]> {
  const pending = sql<number>`count(*)::int`;
  return await db
    .select({
      jamId: itchJams.jamId,
      slug: itchJams.slug,
      pending,
    })
    .from(itchJams)
    .innerJoin(itchJamEntries, eq(itchJamEntries.jamId, itchJams.jamId))
    .where(
      and(
        ne(itchJams.status, "over"),
        isNull(itchJams.missingSince),
        lt(sql`coalesce(${itchJams.votingEndsAt}, ${itchJams.endsAt})`, sql`now()`),
        isNull(itchJamEntries.resultsFetchedAt),
        isNull(itchJamEntries.missingSince),
      ),
    )
    .groupBy(itchJams.jamId, itchJams.slug)
    .orderBy(sql`${pending} desc`);
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const maxJams = intEnv("RESYNC_MAX_JAMS", Number.POSITIVE_INFINITY);
  const delayMs = intEnv("RESYNC_DELAY_MS", 400);

  // Finish the jam in flight rather than tearing down mid-transaction.
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) process.exit(130);
      stopping = true;
      console.log(`[resync] ${signal} — finishing current jam, then exiting (re-run to resume)`);
    });
  }

  const started = Date.now();
  const jams = await staleJams();
  const totalEntries = jams.reduce((sum, j) => sum + j.pending, 0);
  console.log(
    `[resync] ${jams.length} finished jams with a stale status, ${totalEntries} pending entries`,
  );
  if (jams.length === 0) return;

  let done = 0;
  let failed = 0;
  let stoppedEarly = "";

  for (const jam of jams) {
    if (stopping) {
      stoppedEarly = "interrupted";
      break;
    }
    if (done >= maxJams) {
      stoppedEarly = "RESYNC_MAX_JAMS";
      break;
    }

    try {
      // syncJam logs the per-jam detail (status, entry upserts, rankings).
      await syncJam(jam.slug);
      done += 1;
    } catch (err) {
      failed += 1;
      console.error(`[resync] FAIL ${jam.slug}: ${describeError(err)}`);
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  const mins = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(
    `[resync] finished in ${mins}m — jams=${done}/${jams.length} failed=${failed}${
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

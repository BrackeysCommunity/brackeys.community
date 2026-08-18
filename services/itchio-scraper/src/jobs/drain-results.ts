import { createServiceTelemetry } from "../../../../src/lib/service-telemetry.ts";
import { config } from "../config.ts";
import { pool } from "../db/client.ts";
import { describeError } from "../http.ts";
import { pendingJams } from "./selectors.ts";
import { syncEntryResults } from "./sync-jam.ts";

/**
 * Manual, resumable drain of pending per-criterion rankings — the on-demand
 * counterpart to the `results` cron tier, which works the same set on a
 * schedule ([collect-results.ts](./collect-results.ts)).
 *
 * Kept as a separate entrypoint because the two are used differently: the tier
 * runs unattended on a deadline, while this one is reached for interactively
 * when a backlog needs working through now, with a jam cap, a time box, and an
 * ordering chosen for the situation. Both share `pendingJams` and
 * `syncEntryResults`, so they can't disagree about what's pending.
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
  const telemetry = createServiceTelemetry("itchio-scraper");
  try {
    await main();
  } catch (err) {
    telemetry.captureException(err, { job: "drain-results" });
    throw err;
  } finally {
    await pool.end().catch(() => {});
    await telemetry.shutdown();
  }
}

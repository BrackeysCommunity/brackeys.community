import { config } from "../config.ts";
import { describeError } from "../http.ts";
import { createStopGate, runTier, sleep } from "./runner.ts";
import { pendingJams } from "./selectors.ts";
import { syncEntryResults } from "./sync-jam.ts";

/**
 * RESULTS tier — every 6 hours.
 *
 * Collects per-criterion rankings for finished jams that still have entries
 * with `results_fetched_at IS NULL`. No discovery, no jam-page or
 * entries.json refetch: a jam that is over is frozen, so the only thing worth
 * fetching is its rankings.
 *
 * This is the work that most deserved its own schedule. It is the least
 * urgent thing the scraper does — a finished jam's scores never change, so
 * collecting them six hours late is indistinguishable from collecting them
 * immediately — and simultaneously the only part whose size is unbounded: one
 * large jam ending adds thousands of pending entries at once. Sharing a tick
 * with the live jams meant an unbounded, worthless-to-hurry job sat in front
 * of the next hour's perishable work.
 *
 * Resumability is inherent: `results_fetched_at` is stamped per entry, so a
 * run cut short by the deadline or a redeploy loses nothing and the next tick
 * continues where it stopped. That is also why the deadline is safe to set
 * well below the worst-case backlog.
 *
 *   bun run results
 *
 * Env knobs (all optional):
 *   RESULTS_DELAY_MS       pause between jams (default: 250)
 *   RESULTS_DEADLINE_MINS  stop mid-list after this long (default: 240)
 *   RESULTS_ORDER          "newest" (default) or "smallest"
 */

export async function runResults(): Promise<number> {
  if (config.SCRAPE_ENTRY_RESULTS === "never") {
    console.warn("[results] SCRAPE_ENTRY_RESULTS=never — nothing to do");
    return 0;
  }

  const gate = createStopGate("results", config.RESULTS_DEADLINE_MINS);

  const jams = await pendingJams(config.RESULTS_ORDER);
  const totalEntries = jams.reduce((sum, j) => sum + j.pending, 0);
  console.log(
    `[results] ${jams.length} jams with ${totalEntries} pending entries (order=${config.RESULTS_ORDER})`,
  );
  if (jams.length === 0) return 0;

  let done = 0;
  let ranked = 0;
  let fetched = 0;
  let unratable = 0;

  // Same shape as the shared runner's syncSlugs: work the list counting
  // failures, then give whatever failed one more attempt at the end. A jam
  // that failed on a 429 an hour into the run usually goes through once the
  // pacer has cooled off, and the retry costs one request per failure.
  const pass = async (list: readonly (typeof jams)[number][]) => {
    const failed: (typeof jams)[number][] = [];
    let stoppedEarly = "";

    for (const jam of list) {
      const stop = gate.reason();
      if (stop) {
        stoppedEarly = stop;
        break;
      }

      try {
        const out = await syncEntryResults(jam);
        done += 1;
        ranked += out.ranked;
        fetched += out.succeeded;
        unratable += out.unratable;
        const unrated = out.unratable > 0 ? `, ${out.unratable} unrated (no fetch)` : "";
        console.log(
          `[results] ${jam.slug} — ${out.succeeded}/${out.attempted} entries via ${out.source} (${out.ranked} ranked${unrated})`,
        );
      } catch (err) {
        failed.push(jam);
        console.error(`[results] FAIL ${jam.slug}: ${describeError(err)}`);
      }

      if (config.RESULTS_DELAY_MS > 0) await sleep(config.RESULTS_DELAY_MS);
    }

    return { failed, stoppedEarly };
  };

  const first = await pass(jams);
  let failed = first.failed.length;
  let stoppedEarly = first.stoppedEarly;

  // No retry once the gate has tripped — no budget left, and results are
  // stamped per entry, so the next tick resumes from exactly here.
  if (failed > 0 && !stoppedEarly) {
    console.log(`[results] retrying ${failed} failed jam(s)`);
    const doneBefore = done;
    const retry = await pass(first.failed);
    failed -= done - doneBefore;
    stoppedEarly = retry.stoppedEarly;
  }

  console.log(
    `[results] jams=${done}/${jams.length} resolved=${fetched + unratable} (fetched=${fetched} unrated=${unratable}) ranked=${ranked} failed=${failed}${
      stoppedEarly ? ` (stopped early: ${stoppedEarly} — next tick resumes)` : ""
    }`,
  );
  return failed;
}

if (import.meta.main) {
  await runTier("results", runResults);
}

import { runResults } from "./jobs/collect-results.ts";
import { runDiscovery } from "./jobs/discover.ts";
import { runTier } from "./jobs/runner.ts";
import { runLive } from "./jobs/sync-live.ts";

/**
 * DEPRECATED combined entrypoint — runs all three cron tiers back to back in
 * one process.
 *
 * The scrape now runs as three independent Railway cron services with
 * different cadences (see the railway.*.toml files and the README):
 *
 *   live      hourly    open jams — the only perishable work
 *   discovery hourly    listing walks + new jams + upcoming refresh
 *   results   6-hourly  ranking collection for finished jams
 *
 * This file exists so the pre-split Railway service, whose start command is
 * `bun run start`, keeps doing the full job until it is retired. It is not the
 * way to run the scraper: everything here happens on one schedule, which is
 * precisely the coupling the split removed. Delete it once the old service is
 * gone.
 */

/**
 * The tiers in priority order. Load-bearing while this shim exists: a run cut
 * short by a redeploy or platform restart must drop ranking collection rather
 * than live jams. A finished jam's rankings are frozen and the next tick
 * re-queues them; a missed entries.json window is gone for good.
 *
 * Exported so the ordering is asserted by a test rather than left to a comment.
 */
export const TIERS: ReadonlyArray<{ label: string; run: () => Promise<number> }> = [
  { label: "live", run: runLive },
  { label: "discovery", run: runDiscovery },
  { label: "results", run: runResults },
];

async function main(): Promise<number> {
  console.warn(
    "[scrape] running the combined pre-split job — migrate to the live/discovery/results cron services (see README)",
  );

  let failures = 0;
  for (const tier of TIERS) {
    // Each tier already counts its own failures and logs its own summary; a
    // tier that throws outright must not take the remaining tiers down with
    // it, since they work disjoint sets.
    try {
      failures += await tier.run();
    } catch (err) {
      failures += 1;
      console.error(`[scrape] tier ${tier.label} failed outright`, err);
    }
  }
  return failures;
}

// Guarded so TIERS can be imported (and tested) without booting a scrape.
if (import.meta.main) {
  await runTier("scrape", main);
}

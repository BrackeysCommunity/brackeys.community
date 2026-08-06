import { config } from "../config.ts";
import { createStopGate, runTier, syncSlugs } from "./runner.ts";
import { openJamSlugs } from "./selectors.ts";

/**
 * LIVE tier — hourly. The only perishable work the scraper does.
 *
 * Re-syncs every jam that has started and hasn't finished: ~280 jams taking
 * submissions or in voting. Each costs a jam-page fetch plus an entries.json
 * fetch, and the entries fetch is the point — it is the only capture of
 * submissions added since the last tick. Miss the window while a jam is open
 * and those entries are invisible until something syncs the jam again.
 *
 * This tier does no discovery. It works the jams already in `itch.jams`, which
 * is what lets it run every hour on a bounded, predictable request budget
 * while the listing walks run on their own slower schedule.
 *
 * Flipping a jam to `over` is also this tier's job — the selector is keyed on
 * dates rather than status, so a jam whose deadline passed is re-scraped, its
 * status corrected, and it becomes visible to the results tier within an hour
 * of finishing rather than at the next midnight.
 *
 *   bun run live
 *
 * Env knobs (all optional):
 *   LIVE_DELAY_MS       pause between jams (default: 250)
 *   LIVE_DEADLINE_MINS  stop mid-list after this long (default: 45)
 */

export async function runLive(): Promise<number> {
  const gate = createStopGate("live", config.LIVE_DEADLINE_MINS);

  const slugs = await openJamSlugs();
  console.log(`[live] ${slugs.length} open jams to re-sync`);
  if (slugs.length === 0) return 0;

  const { done, failed, stoppedEarly } = await syncSlugs("live", slugs, {
    delayMs: config.LIVE_DELAY_MS,
    gate,
  });

  console.log(
    `[live] synced ${done}/${slugs.length} jams, failed=${failed}${
      stoppedEarly ? ` (stopped early: ${stoppedEarly} — next tick resumes)` : ""
    }`,
  );
  return failed;
}

if (import.meta.main) {
  await runTier("live", runLive);
}

import { config } from "../config.ts";
import {
  discoverBrackeysSearchSlugs,
  discoverInProgressSlugs,
  discoverRecentlyEndedSlugs,
  discoverUpcomingSlugs,
} from "../scrape/discover-listings.ts";
import { createStopGate, runTier, syncSlugs } from "./runner.ts";
import { persistedSlugs, scannedJamSlugs, upcomingJamSlugs } from "./selectors.ts";

/**
 * DISCOVERY tier — every 4 hours, offset from the live tier.
 *
 * Walks itch's jam listings and ingests every jam we don't already hold,
 * then spends a small fixed budget refreshing announced-but-not-started jams.
 *
 * Split out from the live tier because the two scale on different things. The
 * listing walks are a near-constant ~16 page fetches no matter how many jams
 * exist, and finding a jam a few hours late costs nothing — it hasn't started.
 * Re-syncing open jams scales with the number of open jams and *is* time
 * sensitive. Bundling them meant the cheap, tolerant half set the cadence for
 * the expensive, urgent half.
 *
 * Only slugs we don't hold are synced from the listings: persisted jams that
 * are open belong to the live tier, and persisted jams that are upcoming are
 * covered by the round-robin refresh below.
 *
 *   bun run discover
 *
 * Env knobs (all optional):
 *   DISCOVERY_DELAY_MS         pause between jams (default: 250)
 *   DISCOVERY_DEADLINE_MINS    stop mid-list after this long (default: 25)
 *   DISCOVERY_UPCOMING_LIMIT   upcoming jams refreshed per tick (default: 50)
 */

/** One listing walk, degraded to empty on failure rather than killing the tick. */
async function listing(label: string, walk: () => Promise<string[]>): Promise<string[] | null> {
  try {
    return await walk();
  } catch (err) {
    console.error(`[discover] ${label} failed`, err);
    return null;
  }
}

export async function runDiscovery(): Promise<number> {
  const gate = createStopGate("discover", config.DISCOVERY_DEADLINE_MINS);

  const walks: { label: string; run: () => Promise<string[]> }[] = [
    { label: "/jams/upcoming", run: discoverUpcomingSlugs },
    { label: "/jams/in-progress", run: discoverInProgressSlugs },
    { label: "brackeys search", run: discoverBrackeysSearchSlugs },
    // Not a walk of itch at all — jams read off members' own game pages by the
    // library sync, which is how a jam itch never lists gets in.
    { label: "member game scans", run: scannedJamSlugs },
    {
      label: "/jams/past/sort-date",
      run: () => discoverRecentlyEndedSlugs(config.ENDED_LOOKBACK_DAYS),
    },
  ];

  const [walked, held] = await Promise.all([
    Promise.all(walks.map((w) => listing(w.label, w.run))),
    persistedSlugs(),
  ]);

  // Retry a failed walk before anything is derived from it, rather than at the
  // end of the run like the per-jam retries: everything below is downstream of
  // these lists, so a walk recovered afterwards would have nothing left to
  // feed. They run concurrently, so by now they have all settled.
  for (const [i, result] of walked.entries()) {
    if (result !== null) continue;
    const walk = walks[i];
    if (!walk) continue;
    console.log(`[discover] retrying ${walk.label}`);
    walked[i] = await listing(walk.label, walk.run);
  }

  const [upcoming, inProgress, brackeys, scanned, recentlyEnded] = walked;

  // A listing still failing after its retry contributes no slugs and is worth
  // shouting about — a silently empty walk looks identical to "itch announced
  // nothing", and that is exactly how a discovery outage would go unnoticed.
  const listingFailures = walked.filter((r) => r === null).length;

  // In-progress ahead of upcoming: a jam we've never seen that is *already*
  // running is accruing submissions right now, so it should reach the live
  // tier's set this tick rather than next. Ended-backfill trails both — those
  // jams are finished, and nothing about them changes while they wait.
  const ordered = [
    ...new Set([
      ...(inProgress ?? []),
      ...(upcoming ?? []),
      ...(brackeys ?? []),
      ...(scanned ?? []),
      ...(recentlyEnded ?? []),
    ]),
  ];
  const fresh = ordered.filter((slug) => !held.has(slug));

  console.log(
    `[discover] listings: upcoming=${upcoming?.length ?? "FAILED"} in-progress=${
      inProgress?.length ?? "FAILED"
    } brackeys=${brackeys?.length ?? "FAILED"} member-scans=${
      scanned?.length ?? "FAILED"
    } recently-ended=${
      recentlyEnded?.length ?? "FAILED"
    } — ${fresh.length} new of ${ordered.length} listed`,
  );

  const newJams = await syncSlugs("discover", fresh, {
    delayMs: config.DISCOVERY_DELAY_MS,
    gate,
  });
  if (fresh.length > 0) {
    console.log(
      `[discover] ingested ${newJams.done}/${fresh.length} new jams, failed=${newJams.failed}${
        newJams.stoppedEarly ? ` (stopped early: ${newJams.stoppedEarly})` : ""
      }`,
    );
  }

  // Refresh trails ingestion: a jam we don't hold is invisible in the product,
  // while a stale upcoming jam is merely slightly wrong. If the deadline cuts
  // the tick short, this is the half that should be dropped — the round-robin
  // simply picks the same jams up next tick, since it orders by scraped_at.
  const stale = await upcomingJamSlugs(config.DISCOVERY_UPCOMING_LIMIT);
  const refreshed = await syncSlugs("discover", stale, {
    delayMs: config.DISCOVERY_DELAY_MS,
    gate,
  });
  if (stale.length > 0) {
    console.log(
      `[discover] refreshed ${refreshed.done}/${stale.length} upcoming jams, failed=${refreshed.failed}${
        refreshed.stoppedEarly ? ` (stopped early: ${refreshed.stoppedEarly})` : ""
      }`,
    );
  }

  return listingFailures + newJams.failed + refreshed.failed;
}

if (import.meta.main) {
  await runTier("discover", runDiscovery);
}

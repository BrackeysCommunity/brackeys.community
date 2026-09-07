import { itchTierHeartbeats } from "../../../src/db/schema.ts";
import { createServiceTelemetry } from "../../../src/lib/service-telemetry.ts";
import { config } from "./config.ts";
import { db, pool } from "./db/client.ts";
import { describeError } from "./http.ts";
import { runResults } from "./jobs/collect-results.ts";
import { runDiscovery } from "./jobs/discover.ts";
import { runJamBackfill, runLibrarySync } from "./jobs/library-sync.ts";
import { createStopGate } from "./jobs/runner.ts";
import { runIdSweep } from "./jobs/sweep-ids.ts";
import { runLive } from "./jobs/sync-live.ts";
import { runTierLoop, type Tier, type TierStatus } from "./jobs/tier-loop.ts";
import { closeQueue } from "./queue.ts";
import { disconnectRedis } from "./redis.ts";

/**
 * The crawler: every itch.io scrape tier in one resident process, run from
 * a priority loop (jobs/tier-loop.ts). Replaces five cron services that
 * coordinated their itch traffic by cron-minute stagger; every request now
 * rides the per-host pacer shared through Redis with the media-scan worker,
 * so the tiers can't collide however they interleave.
 *
 *   bun run start
 *
 * Each tier's schedule survives a redeploy in `itch.tier_heartbeats`, which
 * doubles as the liveness signal the crons never had: a stale `last_ok_at`
 * on any row is the alert.
 */

const MIN = 60_000;

const tiers: Tier[] = [
  { name: "live", priority: 1, intervalMs: config.LIVE_INTERVAL_MINS * MIN, run: runLive },
  {
    name: "jam-backfill",
    priority: 2,
    intervalMs: config.JAM_BACKFILL_INTERVAL_MINS * MIN,
    run: runJamBackfill,
  },
  {
    name: "discovery",
    priority: 3,
    intervalMs: config.DISCOVERY_INTERVAL_MINS * MIN,
    run: runDiscovery,
  },
  { name: "results", priority: 4, intervalMs: config.RESULTS_INTERVAL_MINS * MIN, run: runResults },
  {
    name: "library",
    priority: 5,
    intervalMs: config.LIBRARY_INTERVAL_MINS * MIN,
    run: runLibrarySync,
  },
  { name: "sweep", priority: 6, intervalMs: config.SWEEP_INTERVAL_MINS * MIN, run: runIdSweep },
];

async function loadSchedule(): Promise<Map<string, TierStatus>> {
  const rows = await db.select().from(itchTierHeartbeats);
  return new Map(rows.map((r) => [r.tier, { nextRunAt: r.nextRunAt }]));
}

async function saveStatus(tier: string, status: TierStatus): Promise<void> {
  const set = {
    nextRunAt: status.nextRunAt,
    lastStartedAt: status.lastStartedAt,
    ...(status.lastOkAt ? { lastOkAt: status.lastOkAt } : {}),
    ...(status.lastError !== undefined ? { lastError: status.lastError } : {}),
    updatedAt: new Date(),
  };
  await db
    .insert(itchTierHeartbeats)
    .values({ tier, ...set })
    .onConflictDoUpdate({ target: itchTierHeartbeats.tier, set });
}

const telemetry = createServiceTelemetry("itchio-scraper");

if (!config.REDIS_URL) {
  console.warn("[boot] REDIS_URL not set — pacing locally, no scan jobs emitted");
}
if (!config.LINKED_ACCOUNTS_ENC_KEY) {
  console.warn("[boot] LINKED_ACCOUNTS_ENC_KEY not set — the library tier will skip every account");
}
console.log(
  `[boot] crawler started — chunk ${config.CRAWLER_CHUNK_MINS}m, tiers: ${tiers.map((t) => `${t.name}/${t.intervalMs / MIN}m`).join(" ")}`,
);

// One signal-watching gate for the process; each turn adds its own deadline.
const stop = createStopGate("crawler", Number.MAX_SAFE_INTEGER / MIN);

try {
  await runTierLoop({
    tiers,
    chunkMs: config.CRAWLER_CHUNK_MINS * MIN,
    stop,
    load: loadSchedule,
    save: (tier, status) =>
      saveStatus(tier, status).catch((err: unknown) => {
        console.error(`[loop] heartbeat for ${tier} failed: ${describeError(err)}`);
      }),
    chunkGate: (ms) => createStopGate("turn", ms / MIN, { watchSignals: false }),
  });
  console.log("[boot] loop stopped — exiting");
} catch (err) {
  console.error(`[boot] fatal: ${describeError(err)}`);
  telemetry.captureException(err, { scope: "tier-loop" });
  process.exitCode = 1;
} finally {
  await closeQueue();
  disconnectRedis();
  await pool.end().catch(() => {});
  await telemetry.shutdown();
}

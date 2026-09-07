import { z } from "zod";

import { parseServiceConfig } from "../../../src/lib/service-config.ts";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // Optional: with it, the itch pacer is shared pool-wide (src/lib/itch-pacer.ts)
  // and every new entry, changed cover, and changed banner is handed to the
  // media-scan worker as a job. Without it the crawler paces itself and the
  // worker's hourly reconciler finds the same work in the DB.
  REDIS_URL: z.string().min(1).optional(),
  SCRAPE_ENTRY_RESULTS: z.enum(["always", "after-voting", "never"]).default("after-voting"),
  ENTRY_RESULTS_CONCURRENCY: z.coerce.number().int().positive().default(5),
  ENTRY_RESULTS_DELAY_MS: z.coerce.number().int().nonnegative().default(300),
  // How far back the /jams/past walk looks for jams that ended while we
  // weren't watching. Must comfortably exceed the longest plausible gap
  // between successful runs.
  ENDED_LOOKBACK_DAYS: z.coerce.number().int().positive().default(14),
  // Global pacing across ALL itch.io requests: minimum gap between any two
  // requests, and the base cooldown for repeated 429/503s without a
  // Retry-After header. An isolated 429 pauses the pool for a short jittered
  // interval instead (itch's limiter usually clears in seconds); from the
  // second consecutive 429 the pause starts here and doubles per strike.
  MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().nonnegative().default(350),
  // The image CDN and the authenticated API are separate budgets — neither
  // shares the HTML pages' limiter.
  IMAGE_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().nonnegative().default(150),
  API_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().nonnegative().default(500),
  RATE_LIMIT_COOLDOWN_MS: z.coerce.number().int().positive().default(60_000),
  // How long a jam whose page 404s keeps being retried before it drops out of
  // every tier's selector. Rows are never deleted — after this window they sit
  // with missing_since set, awaiting manual verification.
  MISSING_RETRY_DAYS: z.coerce.number().int().positive().default(3),
  // Forces the jam page + entries.json refetch for finished jams that are only
  // being visited to drain pending results. Off by default: an "over" jam's
  // metadata and entry list are frozen, so refetching thousands of them spends
  // two requests each to learn nothing. Turn on for a one-off full re-ingest.
  REFRESH_TERMINAL_JAMS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  USER_AGENT: z.string().default("brackeys-itchio-scraper/0.1 (+https://brackeys.community)"),

  // ── Tiers ──────────────────────────────────────────────────────────────────
  // The crawler is one resident process running every tier from a priority
  // loop (src/jobs/tier-loop.ts): each tier has an interval, and a turn runs
  // under a CRAWLER_CHUNK_MINS deadline rather than a cron slot — a tier
  // with a backlog resumes next turn unless something more urgent is due.
  // The *_DEADLINE_MINS knobs bound the one-shot dev entrypoints
  // (`bun run live` etc.) only.
  CRAWLER_CHUNK_MINS: z.coerce.number().int().positive().default(10),
  LIVE_INTERVAL_MINS: z.coerce.number().int().positive().default(15),
  DISCOVERY_INTERVAL_MINS: z.coerce.number().int().positive().default(240),
  RESULTS_INTERVAL_MINS: z.coerce.number().int().positive().default(360),
  LIBRARY_INTERVAL_MINS: z.coerce.number().int().positive().default(60),
  JAM_BACKFILL_INTERVAL_MINS: z.coerce.number().int().positive().default(15),
  // Re-armed only once the id sweep reaches the frontier; until then it
  // runs whenever nothing else is due.
  SWEEP_INTERVAL_MINS: z.coerce.number().int().positive().default(360),

  LIVE_DELAY_MS: z.coerce.number().int().nonnegative().default(250),
  LIVE_DEADLINE_MINS: z.coerce.number().int().positive().default(45),

  DISCOVERY_DELAY_MS: z.coerce.number().int().nonnegative().default(250),
  DISCOVERY_DEADLINE_MINS: z.coerce.number().int().positive().default(25),
  // Announced-but-not-started jams refreshed per discovery tick, staleest
  // first. Nothing about them is perishable, so the pool round-robins instead
  // of being refreshed wholesale.
  DISCOVERY_UPCOMING_LIMIT: z.coerce.number().int().nonnegative().default(50),

  RESULTS_DELAY_MS: z.coerce.number().int().nonnegative().default(250),
  // Generous because the backlog is unbounded (a large jam ending adds
  // thousands of pending entries at once) and stopping early is free —
  // `results_fetched_at` is per entry, so the next tick resumes.
  RESULTS_DEADLINE_MINS: z.coerce.number().int().positive().default(240),
  RESULTS_ORDER: z.enum(["newest", "smallest"]).default("newest"),

  // ── ID sweep ───────────────────────────────────────────────────────────────
  // Walks the jam id space directly, because itch's listings are not a
  // complete index of past jams (see src/jobs/sweep-ids.ts). Runs as a phase of
  // the temporary backfill service, resuming from a cursor each tick.
  SWEEP_DEADLINE_MINS: z.coerce.number().int().positive().default(45),
  // Where a fresh cursor starts, and the escape hatch for re-sweeping a range:
  // set it above the stored cursor to jump ahead, or run a one-off with it set
  // back to re-probe ids a bad stretch of 429s cost.
  SWEEP_FROM: z.coerce.number().int().nonnegative().default(1),
  // The barren middle of the id space, skipped by default — jam ids cluster
  // below 20k and above 240k, and we hold 3 rows across the 220k between them.
  // Set SWEEP_GAP_END equal to SWEEP_GAP_START to sweep it anyway.
  SWEEP_GAP_START: z.coerce.number().int().nonnegative().default(20_000),
  SWEEP_GAP_END: z.coerce.number().int().nonnegative().default(240_000),

  // ── Library sync (formerly services/itchio-library-sync) ───────────────────
  // Sleep between linked accounts on the API pass; the API rides its own
  // pacer host, this is the per-account courtesy on top.
  SYNC_DELAY_MS: z.coerce.number().int().nonnegative().default(500),
  // How long a game's "Submission to <jam>" scan stays good for. A game's jam
  // is fixed once it is submitted, so this is only about catching a *new*
  // submission on a game we already hold — and a jam running now is one the
  // discovery tier sees anyway.
  JAM_SCAN_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),
  // Seals linked_accounts.access_token at rest; must equal the Web service's.
  // Read by src/lib/token-crypto.ts from the environment directly; declared
  // here so a missing key is a boot-time warning rather than a silent
  // "0 accounts synced".
  LINKED_ACCOUNTS_ENC_KEY: z.string().min(1).optional(),
});

export const config = parseServiceConfig(schema);
export type Config = typeof config;

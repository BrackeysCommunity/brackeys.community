import { z } from "zod";

import { parseServiceConfig } from "../../../src/lib/service-config.ts";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
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

  // ── Cron tiers ─────────────────────────────────────────────────────────────
  // The scrape runs as three independent Railway cron services (live,
  // discovery, results) rather than one nightly tick. Each has its own pacing
  // and its own deadline; the deadlines are what keep a slow tier from
  // overrunning into another tier's slot, since the in-process rate pacer is
  // per-process and three concurrent services would otherwise triple the
  // request rate itch.io sees. Schedules are staggered to match (see the
  // railway.*.toml files).
  LIVE_DELAY_MS: z.coerce.number().int().nonnegative().default(250),
  LIVE_DEADLINE_MINS: z.coerce.number().int().positive().default(45),

  DISCOVERY_DELAY_MS: z.coerce.number().int().nonnegative().default(250),
  // Tighter than the other tiers: discovery starts at :20, so anything past
  // ~25 minutes runs into the live tier's :00/:30 slots and the results tier's
  // :40 slot. Stopping early is free — both halves resume next tick.
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

  // ── Entry scan ─────────────────────────────────────────────────────────────
  // The moderation scan tier (docs/plans/22): fetches covers, hashes them,
  // scores NSFW, and fills social.entry_flags for the /admin queue. Covers
  // come from itch's image CDN but share the global pacer anyway, so the
  // delay can sit below the page-scrape tiers'.
  SCAN_DELAY_MS: z.coerce.number().int().nonnegative().default(150),
  SCAN_DEADLINE_MINS: z.coerce.number().int().positive().default(45),
  // Entries fetched per tick. Newest-jam-first, so a running jam's fresh
  // submissions always beat backfill; stopping at the cap is free because
  // due-ness is per entry and the next tick resumes.
  SCAN_BATCH: z.coerce.number().int().positive().default(1500),
  // Minimum category score (sexual or gore, softmax contrast — see
  // scan/nsfw.ts) that opens a flag. Calibrated on real covers: benign art
  // tops out around 0.14, the weakest true positive measured 0.57.
  NSFW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.4),
  // Kill switch for the classifier only — hashing and theft matching keep
  // running without it.
  NSFW_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export const config = parseServiceConfig(schema);
export type Config = typeof config;

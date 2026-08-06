import { z } from "zod";

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
  // requests, and how long the whole pool pauses after a 429/503 when itch
  // doesn't send a Retry-After header.
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
  DISCOVERY_DEADLINE_MINS: z.coerce.number().int().positive().default(45),
  // Announced-but-not-started jams refreshed per discovery tick, staleest
  // first. Nothing about them is perishable, so the pool round-robins instead
  // of being refreshed wholesale.
  DISCOVERY_UPCOMING_LIMIT: z.coerce.number().int().nonnegative().default(25),

  RESULTS_DELAY_MS: z.coerce.number().int().nonnegative().default(250),
  // Generous because the backlog is unbounded (a large jam ending adds
  // thousands of pending entries at once) and stopping early is free —
  // `results_fetched_at` is per entry, so the next tick resumes.
  RESULTS_DEADLINE_MINS: z.coerce.number().int().positive().default(240),
  RESULTS_ORDER: z.enum(["newest", "smallest"]).default("newest"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;

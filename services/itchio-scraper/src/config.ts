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
  USER_AGENT: z.string().default("brackeys-itchio-scraper/0.1 (+https://brackeys.community)"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;

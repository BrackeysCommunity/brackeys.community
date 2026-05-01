import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BROWSERLESS_WS_ENDPOINT: z.string().min(1),
  SCRAPE_ENTRY_RESULTS: z.enum(["always", "after-voting", "never"]).default("after-voting"),
  ENTRY_RESULTS_CONCURRENCY: z.coerce.number().int().positive().default(5),
  ENTRY_RESULTS_DELAY_MS: z.coerce.number().int().nonnegative().default(300),
  USER_AGENT: z.string().default("brackeys-itchio-scraper/0.1 (+https://brackeys.community)"),
  // When true, discovery walks every page of /jams/upcoming and the brackeys
  // search. When false, it stops after page 1 — used by the lighter nightly
  // cron that only needs to catch newly-announced jams. Default is true so
  // the existing weekly cron keeps full coverage with no env change.
  DISCOVERY_PAGINATE: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;

import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BROWSERLESS_WS_ENDPOINT: z.string().min(1),
  SCRAPE_ENTRY_RESULTS: z.enum(["always", "after-voting", "never"]).default("after-voting"),
  ENTRY_RESULTS_CONCURRENCY: z.coerce.number().int().positive().default(3),
  ENTRY_RESULTS_DELAY_MS: z.coerce.number().int().nonnegative().default(500),
  USER_AGENT: z.string().default("brackeys-itchio-scraper/0.1 (+https://brackeys.community)"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;

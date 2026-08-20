import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SYNC_DELAY_MS: z.coerce.number().int().nonnegative().default(500),
  // How long a game's "Submission to <jam>" scan stays good for. A game's jam
  // is fixed once it is submitted, so this is only about catching a *new*
  // submission on a game we already hold — and a jam running now is one the
  // scraper's own discovery sees anyway.
  JAM_SCAN_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),
  USER_AGENT: z.string().default("brackeys-itchio-library-sync/0.1 (+https://brackeys.community)"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;

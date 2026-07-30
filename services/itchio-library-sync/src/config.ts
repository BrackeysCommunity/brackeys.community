import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SYNC_DELAY_MS: z.coerce.number().int().nonnegative().default(500),
  USER_AGENT: z.string().default("brackeys-itchio-library-sync/0.1 (+https://brackeys.community)"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;

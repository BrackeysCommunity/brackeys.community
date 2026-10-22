import { hostname } from "node:os";

import { z } from "zod";

import { parseServiceConfig } from "../../../src/lib/service-config.ts";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // Optional so one instance runs without it locally. In an environment with
  // more than one instance (a deploy overlaps two for a few seconds) it is
  // what relays live edits between them and holds the per-user cap.
  REDIS_URL: z.string().min(1).optional(),
  // The same value as the web app's: it signs the tokens this verifies.
  CANVAS_SYNC_SECRET: z.string().min(16),
  PORT: z.coerce.number().int().nonnegative().default(1234),
  RAILWAY_ENVIRONMENT_NAME: z.string().min(1).optional(),
  INSTANCE_ID: z.string().min(1).default(`${hostname()}-${process.pid}`),
  STORE_DEBOUNCE_MS: z.coerce.number().int().positive().optional(),
  // Shutdown waits this long for stores to land; Railway's drainingSeconds is 30.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
});

export const config = parseServiceConfig(schema);
export type Config = typeof config;

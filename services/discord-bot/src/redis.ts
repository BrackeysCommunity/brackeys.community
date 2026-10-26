import IORedis from "ioredis";

import { config } from "./config.ts";

/**
 * Fail-fast on purpose: a command issued while Redis is down must reject at
 * once, so a summary degrades to uncached instead of hanging the
 * interaction behind a promise that never settles.
 */
export const redis = config.REDIS_URL
  ? new IORedis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 500, 30_000),
    })
  : null;

let lastError = "";
redis?.on("error", (err) => {
  if (err.message === lastError) return;
  lastError = err.message;
  console.warn(`[redis] ${err.message}`);
});

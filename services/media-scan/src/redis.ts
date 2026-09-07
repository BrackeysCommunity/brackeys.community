import IORedis from "ioredis";

import { config } from "./config.ts";

/**
 * Two connections on purpose. bullmq's worker needs blocking commands to
 * retry forever (`maxRetriesPerRequest: null`); the pacer needs the
 * opposite — a command issued while Redis is down must reject at once so
 * the pacer can degrade to local pacing instead of hanging every fetch
 * behind a promise that never settles.
 */
export const queueRedis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const pacerRedis = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: 2000,
  retryStrategy: (times) => Math.min(times * 500, 30_000),
});

for (const [name, client] of [
  ["queue", queueRedis],
  ["pacer", pacerRedis],
] as const) {
  let last = "";
  client.on("error", (err) => {
    if (err.message === last) return;
    last = err.message;
    console.warn(`[redis:${name}] ${err.message}`);
  });
}

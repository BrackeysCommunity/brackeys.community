import IORedis, { type RedisOptions } from "ioredis";

import { config } from "./config.ts";

/**
 * Two connections, both optional — the crawler runs without Redis, it just
 * paces itself and emits no scan jobs.
 *
 * The pacer's connection fails fast: a command issued while Redis is down
 * must reject at once so the pacer can degrade to local pacing instead of
 * hanging every fetch behind a promise that never settles. bullmq's needs
 * the opposite (`maxRetriesPerRequest: null`), so the queue gets its own.
 */
function connect(name: string, options: RedisOptions) {
  if (!config.REDIS_URL) return null;
  const client = new IORedis(config.REDIS_URL, options);
  let last = "";
  client.on("error", (err) => {
    if (err.message === last) return;
    last = err.message;
    console.warn(`[redis:${name}] ${err.message}`);
  });
  return client;
}

export const pacerRedis = connect("pacer", {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: 2000,
  retryStrategy: (times) => Math.min(times * 500, 30_000),
});

export const queueRedis = connect("queue", { maxRetriesPerRequest: null });

export function disconnectRedis(): void {
  pacerRedis?.disconnect();
  queueRedis?.disconnect();
}

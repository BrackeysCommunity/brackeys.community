import IORedis from "ioredis";

/**
 * An ioredis connection configured for bullmq: blocking commands must be
 * allowed to retry indefinitely, so `maxRetriesPerRequest` is null — the
 * option (and this explanation) used to be copy-pasted beside every
 * service-side `new IORedis(...)`. The app side has its own wrapper
 * (`src/lib/redis.ts` + `src/lib/queue.ts`) with different retry needs.
 *
 * Import-graph neutral — services reach it by relative path and their
 * Dockerfiles COPY it.
 */
export function createBullRedis(url: string): IORedis {
  return new IORedis(url, { maxRetriesPerRequest: null });
}

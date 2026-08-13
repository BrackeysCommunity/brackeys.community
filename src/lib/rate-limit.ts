import type IORedis from "ioredis";

import { createRedisClient } from "@/lib/redis";

declare global {
  // eslint-disable-next-line no-var
  var __brackeysRateLimitRedis: IORedis | undefined;
}

async function getRedis(): Promise<IORedis | null> {
  if (globalThis.__brackeysRateLimitRedis) return globalThis.__brackeysRateLimitRedis;
  if (!process.env.REDIS_URL) return null;
  globalThis.__brackeysRateLimitRedis = await createRedisClient("rate-limit");
  return globalThis.__brackeysRateLimitRedis;
}

/**
 * Fixed-window counter: allows `limit` hits per `windowSeconds` per
 * (bucket, userId). Degrades open — Redis absent or unreachable means the
 * action is allowed rather than the surface going down with it.
 */
export async function checkRateLimit(
  bucket: string,
  userId: string,
  limit: number,
  windowSeconds = 3600,
): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return true;
    const key = `social:rate:${bucket}:${userId}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count <= limit;
  } catch {
    return true;
  }
}

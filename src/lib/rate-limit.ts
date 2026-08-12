import type IORedis from "ioredis";

declare global {
  // eslint-disable-next-line no-var
  var __brackeysRateLimitRedis: IORedis | undefined;
}

async function getRedis(): Promise<IORedis | null> {
  if (globalThis.__brackeysRateLimitRedis) return globalThis.__brackeysRateLimitRedis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const { default: IORedisCtor } = await import("ioredis");
  // Fail fast when Redis is unreachable: with the offline queue on, commands
  // buffer and never settle, hanging the request instead of degrading open.
  globalThis.__brackeysRateLimitRedis = new IORedisCtor(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });
  let lastError = "";
  globalThis.__brackeysRateLimitRedis.on("error", (err) => {
    if (err.message === lastError) return;
    lastError = err.message;
    console.warn("[rate-limit] redis error", err.message);
  });
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

import { ORPCError } from "@orpc/client";
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

function rateKey(bucket: string, userId: string): string {
  return `social:rate:${bucket}:${userId}`;
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
    const key = rateKey(bucket, userId);
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count <= limit;
  } catch {
    return true;
  }
}

/**
 * Hand back one hit, for a limiter spent *before* an action that then
 * failed. A long window is priced for the thing the user actually did —
 * so when the action didn't happen, charging them for it is a bug, not a
 * conservative default: the Discord mirror's six-hour cooldown buys an
 * announcement, and a Discord outage announces nothing.
 *
 * Only for the failure path, and only where the action is genuinely
 * un-done. Deletes the key rather than leaving it at zero so the next
 * attempt starts a fresh window instead of inheriting the failed one's
 * remaining TTL. Best-effort, like the counter itself.
 */
export async function refundRateLimit(bucket: string, userId: string): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    const key = rateKey(bucket, userId);
    const remaining = await redis.decr(key);
    if (remaining <= 0) await redis.del(key);
  } catch {
    // The window expires on its own; a lost refund costs one wait.
  }
}

/**
 * The router-side guard: `checkRateLimit` plus the TOO_MANY_REQUESTS the
 * seven write paths used to hand-roll around it. `message` is the
 * user-facing copy — keep it specific to the action being limited.
 */
export async function assertRateLimit(
  bucket: string,
  userId: string,
  limit: number,
  message: string,
  windowSeconds?: number,
): Promise<void> {
  if (!(await checkRateLimit(bucket, userId, limit, windowSeconds))) {
    throw new ORPCError("TOO_MANY_REQUESTS", { message });
  }
}

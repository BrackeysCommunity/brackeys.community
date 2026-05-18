/**
 * Tracks which users currently have an open SSE connection. Used by the
 * worker's `notification-side-effects` task to suppress transactional
 * email when the user is already seeing the bell update live.
 *
 * Storage model: a Redis set per user, members are unique connection ids
 * (so multi-tab is supported). Each registration also refreshes the set's
 * TTL so dead/abandoned connections eventually drop out without our
 * needing a janitor.
 *
 * We export *both* a getter (lazy redis import — keeps client bundles
 * clean) and a few raw helpers used by the SSE route.
 */
import type IORedis from "ioredis";

declare global {
  // eslint-disable-next-line no-var
  var __brackeysPresenceRedis: IORedis | undefined;
}

const TTL_SECONDS = 60;

async function getRedis(): Promise<IORedis> {
  if (globalThis.__brackeysPresenceRedis) return globalThis.__brackeysPresenceRedis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  const { default: IORedisCtor } = await import("ioredis");
  globalThis.__brackeysPresenceRedis = new IORedisCtor(url, {
    maxRetriesPerRequest: null,
  });
  return globalThis.__brackeysPresenceRedis;
}

function key(userId: string): string {
  return `sse:online:${userId}`;
}

export async function registerConnection(userId: string, connectionId: string): Promise<void> {
  const redis = await getRedis();
  await redis.sadd(key(userId), connectionId);
  await redis.expire(key(userId), TTL_SECONDS);
}

/** Called from the SSE heartbeat tick so the set stays alive. */
export async function refreshConnection(userId: string, connectionId: string): Promise<void> {
  const redis = await getRedis();
  // SADD is idempotent so this also re-adds the member if it had been
  // dropped from a previous TTL expiry — keeps long-lived clients sticky.
  await redis.sadd(key(userId), connectionId);
  await redis.expire(key(userId), TTL_SECONDS);
}

export async function unregisterConnection(userId: string, connectionId: string): Promise<void> {
  const redis = await getRedis();
  await redis.srem(key(userId), connectionId);
}

/** Returns true if the user has at least one live SSE connection. */
export async function isUserOnline(userId: string): Promise<boolean> {
  const redis = await getRedis();
  const n = await redis.scard(key(userId));
  return n > 0;
}

export const presenceChannel = (userId: string) => `notifications:user:${userId}`;

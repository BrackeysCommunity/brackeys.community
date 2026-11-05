import type IORedis from "ioredis";

import { auth } from "@/lib/auth";
import { createRedisClient } from "@/lib/redis";

declare global {
  // eslint-disable-next-line no-var
  var __appOAuthRefreshRedis: IORedis | undefined;
}

/** Longer than a token endpoint round trip, short enough that a crashed
 *  holder doesn't stall the next caller for long. */
const LOCK_TTL_MS = 10_000;
const LOCK_POLL_MS = 150;

const RELEASE_IF_OURS = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

const inFlight = new Map<string, Promise<string | null>>();

async function getRedis(): Promise<IORedis> {
  globalThis.__appOAuthRefreshRedis ??= await createRedisClient("oauth-refresh");
  return globalThis.__appOAuthRefreshRedis;
}

/**
 * Runs `fn` while holding the refresh lock for one member's grant.
 *
 * Refresh tokens are single-use: two requests that both see an expired
 * token and both spend the same refresh token leave one of them with a
 * rejection, and providers are free to revoke the whole grant on reuse.
 * A loser waits for the holder to finish, then reads the row it rotated.
 * Redis being down degrades to unlocked rather than to no token at all.
 */
async function withRefreshLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let redis: IORedis;
  try {
    redis = await getRedis();
  } catch {
    return fn();
  }
  const owner = crypto.randomUUID();
  const deadline = Date.now() + LOCK_TTL_MS;
  for (;;) {
    let won: string | null;
    try {
      won = await redis.set(key, owner, "PX", LOCK_TTL_MS, "NX");
    } catch {
      return fn();
    }
    if (won === "OK") break;
    if (Date.now() >= deadline) return fn();
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_IF_OURS, 1, key, owner).catch(() => {});
  }
}

async function readToken(providerId: string, userId: string): Promise<string | null> {
  try {
    const { accessToken, accessTokenExpiresAt } = await auth.api.getAccessToken({
      body: { providerId, userId },
    });
    if (!accessToken) return null;
    if (accessTokenExpiresAt && accessTokenExpiresAt.getTime() <= Date.now()) {
      console.error(`[${providerId}] token for ${userId} is expired and could not be refreshed`);
      return null;
    }
    return accessToken;
  } catch (err) {
    console.error(`[${providerId}] no refreshable token for ${userId}:`, err);
    return null;
  }
}

/**
 * A provider access token that hasn't expired yet, or null when there's
 * nothing usable left.
 *
 * better-auth owns the refresh. Called with no request attached it
 * authorises off `userId` alone, swaps a token at or past its expiry for a
 * fresh pair, and writes the rotation back to `account`. The stored copy is
 * sealed (`encryptOAuthTokens`); this hands back the opened token.
 *
 * Calls for the same grant share one refresh: concurrent callers in this
 * process share the promise, and other replicas wait on a Redis lock.
 *
 * Some providers answer a spent refresh token with a 200 and an error body,
 * which better-auth reads as "no new tokens" and answers by handing back the
 * stored token unchanged. An expiry still in the past is that case: the token
 * behind it is already dead, so say so here rather than spend a request
 * finding out.
 */
export function freshOAuthToken(providerId: string, userId: string): Promise<string | null> {
  const key = `oauth-refresh:${providerId}:${userId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = withRefreshLock(key, () => readToken(providerId, userId)).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, run);
  return run;
}

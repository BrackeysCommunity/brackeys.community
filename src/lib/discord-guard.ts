// Copied into the discord-bot image: relative imports only, never `@/`.

/**
 * The Discord rate-limit backoff shared by every process that calls
 * discord.com from our egress: the web app and the Discord bot.
 *
 * Railway egress IPs are shared across tenants, and a Cloudflare 1015 ban
 * on discord.com takes OAuth sign-in down with it (better-auth's token
 * exchange hits the same zone). So a 429 that speaks for the IP opens a
 * Redis-backed backoff window that every caller in every process honours.
 * A 429 from one route's own bucket does not: it says nothing about the IP,
 * and the caller that ran its bucket dry is the one to wait. Redis being down
 * must never hurt more than Discord being down: the plumbing swallows its
 * own errors.
 *
 * Redis is typed structurally so the web app and the bot can each pass
 * their own ioredis client.
 */

export interface GuardRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
}

const BACKOFF_KEY = "discord:backoff-until";
const DEFAULT_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 900;

/** Thrown when we refuse to call discord.com because a rate-limit backoff window is active. */
export class DiscordBackoffError extends Error {
  constructor(untilEpochMs: number) {
    super(
      `Discord requests suspended until ${new Date(untilEpochMs).toISOString()} (rate limited)`,
    );
    this.name = "DiscordBackoffError";
  }
}

/**
 * A 429 from one route's bucket (`user`) or a shared resource (`shared`),
 * as opposed to the global limit or a Cloudflare 429, which carries no
 * scope at all.
 */
export function isRouteLimit(response: Response): boolean {
  const scope = response.headers.get("x-ratelimit-scope");
  return scope === "user" || scope === "shared";
}

function parseRetryAfter(response: Response): number {
  const header = Number(response.headers.get("retry-after"));
  return Number.isFinite(header) && header > 0 ? header : DEFAULT_BACKOFF_SECONDS;
}

/**
 * A fetch for discord.com that fails fast while the shared backoff window
 * is active, and opens or extends that window on a global or Cloudflare
 * 429, whichever caller provoked it: the thing being protected is the
 * shared egress IP, not a per-route budget.
 */
export function createDiscordGuard(getRedis: () => Promise<GuardRedis>) {
  async function backoffUntil(): Promise<number | null> {
    try {
      const raw = await (await getRedis()).get(BACKOFF_KEY);
      if (!raw) return null;
      const until = Number(raw);
      return Number.isFinite(until) && until > Date.now() ? until : null;
    } catch {
      return null;
    }
  }

  async function openBackoffWindow(retryAfterSeconds: number): Promise<void> {
    const seconds = Math.min(
      Math.max(retryAfterSeconds, DEFAULT_BACKOFF_SECONDS),
      MAX_BACKOFF_SECONDS,
    );
    try {
      const redis = await getRedis();
      const until = Date.now() + seconds * 1000;
      // Keep the furthest-out window if two callers hit 429 concurrently.
      const existing = Number((await redis.get(BACKOFF_KEY)) ?? 0);
      if (until > existing) await redis.set(BACKOFF_KEY, String(until), "EX", seconds);
    } catch {
      // Best-effort: never let a Redis failure mask the 429 itself.
    }
  }

  return async function guardedFetch(url: string, init: RequestInit): Promise<Response> {
    const until = await backoffUntil();
    if (until) throw new DiscordBackoffError(until);
    const response = await fetch(url, init);
    if (response.status === 429 && !isRouteLimit(response))
      await openBackoffWindow(parseRetryAfter(response));
    return response;
  };
}

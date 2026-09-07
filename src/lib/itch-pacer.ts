/**
 * The itch politeness gate: at most one request per interval to a host,
 * plus a pool-wide cooldown once that host starts rate limiting.
 *
 * Two implementations behind one interface. The local pacer is in-process
 * state — what every scraper tier ran on when each was its own cron
 * service, kept apart from the others only by cron-minute stagger. The
 * shared pacer keeps the same state in Redis, keyed by host, so any number
 * of processes (the crawler, the media-scan worker, a laptop draining a
 * backfill) draw on one budget for `itch.io`, one for `img.itch.zone`, and
 * one for `api.itch.io`. If Redis is unreachable the shared pacer degrades
 * to the local one for a while and logs once: the failure mode is "as good
 * as one process used to be", never "unpaced".
 *
 * Import-graph neutral on purpose — relative imports only, and the Redis
 * client is typed structurally (`PacerRedis`) so every service can hand in
 * its own ioredis instance without a module-identity clash. Services reach
 * this file by relative path and their Dockerfiles COPY it.
 */

export type Pacer = {
  /** Resolves when the caller may issue its request. */
  acquire(): Promise<void>;
  /** Pauses the whole pool; null falls back to the escalating cooldown. */
  reportRateLimit(retryAfterSeconds: number | null): void;
  /** Any non-throttled response — ends the current rate-limit streak. */
  reportSuccess(): void;
};

type Clock = {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export type LocalPacerOptions = Clock & {
  minIntervalMs: number;
  cooldownMs: number;
};

// itch's limiter scores short per-IP bursts, and an isolated 429 usually
// clears within seconds — so the first strike takes a short jittered pause
// instead of the full cooldown. Consecutive strikes escalate by doubling from
// the configured cooldown: continuing to hit the limiter while throttled
// worsens the IP's standing with it, which is the opposite of what a retry
// wants.
export const FIRST_STRIKE_MIN_MS = 10_000;
export const FIRST_STRIKE_JITTER_MS = 20_000;
export const MAX_COOLDOWN_MS = 600_000;

/** How long a strike streak is remembered without a success clearing it. */
const STRIKES_TTL_MS = MAX_COOLDOWN_MS;

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The slot arithmetic both pacers share: the earliest moment a request may
 * fire given the last reservation and any active cooldown, and the
 * reservation that leaves behind. Pure so it can be tested without either
 * clock; the Lua script below spells out the same thing in Redis.
 */
export function nextSlot(
  now: number,
  next: number,
  cooldown: number,
  intervalMs: number,
): { at: number; next: number } {
  const at = Math.max(now, next, cooldown);
  return { at, next: at + intervalMs };
}

/** The pause a rate-limit report earns, given how many strikes precede it. */
export function cooldownForStrike(
  strikes: number,
  retryAfterSeconds: number | null,
  cooldownMs: number,
  random: () => number,
): number {
  if (retryAfterSeconds != null) return retryAfterSeconds * 1000;
  if (strikes <= 1) return FIRST_STRIKE_MIN_MS + random() * FIRST_STRIKE_JITTER_MS;
  return Math.min(cooldownMs * 2 ** (strikes - 2), MAX_COOLDOWN_MS);
}

export function createLocalPacer(opts: LocalPacerOptions, label = "pacer"): Pacer {
  const now = opts.now ?? Date.now;
  const doSleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  let nextSlotAt = 0;
  let cooldownUntil = 0;
  // Rate-limit reports since the last non-throttled response.
  let strikes = 0;

  return {
    async acquire() {
      for (;;) {
        const t = now();
        const slot = nextSlot(t, nextSlotAt, cooldownUntil, opts.minIntervalMs);
        if (slot.at <= t) {
          nextSlotAt = slot.next;
          return;
        }
        await doSleep(slot.at - t);
      }
    },
    reportRateLimit(retryAfterSeconds) {
      strikes += 1;
      const waitMs = cooldownForStrike(strikes, retryAfterSeconds, opts.cooldownMs, random);
      const until = now() + waitMs;
      if (until > cooldownUntil) {
        cooldownUntil = until;
        console.warn(
          `[${label}] rate limited (strike ${strikes}) — pausing all requests for ${Math.round(waitMs / 1000)}s`,
        );
      }
    },
    reportSuccess() {
      strikes = 0;
    },
  };
}

/**
 * The slice of ioredis the shared pacer uses. Structural rather than the
 * ioredis type so each service's own client — resolved from its own
 * node_modules — satisfies it without a `paths` mapping.
 */
export interface PacerRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

// Reserve the next slot: fire at max(now, next, cooldown), leave `next`
// pointing one interval past that. The reservation key outlives its slot by
// a margin so a long cooldown can't expire it early. Returns how long the
// caller waits before firing. Atomic across processes — that is the point.
const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local nextAt = tonumber(redis.call('GET', KEYS[1]) or '0')
local cooldown = tonumber(redis.call('GET', KEYS[2]) or '0')
local at = math.max(now, nextAt, cooldown)
redis.call('SET', KEYS[1], at + interval, 'PX', (at - now) + interval + 60000)
return at - now
`;

// A rate-limit report: count the strike pool-wide, then extend the cooldown
// if this report's pause reaches further than the one already armed. The
// jittered first-strike pause is computed by the caller (Lua has no seeded
// randomness worth relying on) and passed in.
const STRIKE_SCRIPT = `
local now = tonumber(ARGV[1])
local retryAfterMs = tonumber(ARGV[2])
local firstWaitMs = tonumber(ARGV[3])
local baseMs = tonumber(ARGV[4])
local maxMs = tonumber(ARGV[5])
local strikes = redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[6]))
local wait
if retryAfterMs > 0 then
  wait = retryAfterMs
elseif strikes <= 1 then
  wait = firstWaitMs
else
  wait = math.min(baseMs * 2 ^ (strikes - 2), maxMs)
end
wait = math.floor(wait)
local until_ = now + wait
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if until_ > current then
  redis.call('SET', KEYS[1], until_, 'PX', wait + 60000)
  return {wait, strikes, 1}
end
return {wait, strikes, 0}
`;

const COOLDOWN_SCRIPT = `return tonumber(redis.call('GET', KEYS[1]) or '0')`;

export type SharedPacerOptions = LocalPacerOptions & {
  /** Key namespace: one budget per host (`itch.io`, `img.itch.zone`, …). */
  host: string;
  redis: PacerRedis;
  /** How long to pace locally after a Redis failure before trying it again. */
  degradeMs?: number;
};

/** Redis key layout, exported for the integration test's cleanup. */
export function pacerKeys(host: string) {
  return {
    next: `pacer:${host}:next`,
    cooldown: `pacer:${host}:cooldown`,
    strikes: `pacer:${host}:strikes`,
  };
}

export function createSharedPacer(opts: SharedPacerOptions): Pacer {
  const now = opts.now ?? Date.now;
  const doSleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const degradeMs = opts.degradeMs ?? 30_000;
  const label = `pacer:${opts.host}`;
  const keys = pacerKeys(opts.host);
  const local = createLocalPacer(opts, label);

  // While set, every call goes to the local pacer; cleared once the window
  // passes so the next call tries Redis again.
  let degradedUntil = 0;
  // Whether this process has any reason to believe the pool-wide strike
  // counter is non-zero — the only time a success needs to clear it.
  let strikesSuspected = false;
  let lastClearAt = 0;

  function degrade(err: unknown): void {
    const t = now();
    if (t >= degradedUntil) {
      console.warn(
        `[${label}] redis unavailable (${err instanceof Error ? err.message : String(err)}) — pacing locally for ${Math.round(degradeMs / 1000)}s`,
      );
    }
    degradedUntil = t + degradeMs;
  }

  function degraded(): boolean {
    return now() < degradedUntil;
  }

  async function cooldownRemaining(): Promise<number> {
    const until = Number(await opts.redis.eval(COOLDOWN_SCRIPT, 1, keys.cooldown));
    return Math.max(0, until - now());
  }

  return {
    async acquire() {
      if (degraded()) return local.acquire();
      let waitMs: number;
      try {
        waitMs = Number(
          await opts.redis.eval(
            ACQUIRE_SCRIPT,
            2,
            keys.next,
            keys.cooldown,
            now(),
            opts.minIntervalMs,
          ),
        );
      } catch (err) {
        degrade(err);
        return local.acquire();
      }
      if (waitMs > 0) {
        strikesSuspected ||= waitMs > opts.minIntervalMs * 4;
        await doSleep(waitMs);
      }
      // A cooldown armed by another process while this one slept still
      // applies: the slot was reserved, the pause was not.
      try {
        for (;;) {
          const remaining = await cooldownRemaining();
          if (remaining <= 0) return;
          strikesSuspected = true;
          await doSleep(remaining);
        }
      } catch (err) {
        degrade(err);
      }
    },
    reportRateLimit(retryAfterSeconds) {
      strikesSuspected = true;
      if (degraded()) {
        local.reportRateLimit(retryAfterSeconds);
        return;
      }
      const firstWaitMs = cooldownForStrike(1, null, opts.cooldownMs, random);
      opts.redis
        .eval(
          STRIKE_SCRIPT,
          2,
          keys.cooldown,
          keys.strikes,
          now(),
          retryAfterSeconds != null ? retryAfterSeconds * 1000 : 0,
          Math.round(firstWaitMs),
          opts.cooldownMs,
          MAX_COOLDOWN_MS,
          STRIKES_TTL_MS,
        )
        .then((reply) => {
          const [wait, strikes, extended] = Array.isArray(reply) ? reply.map(Number) : [0, 0, 0];
          if (extended) {
            console.warn(
              `[${label}] rate limited (strike ${strikes}, pool-wide) — pausing all requests for ${Math.round((wait ?? 0) / 1000)}s`,
            );
          }
        })
        .catch((err: unknown) => {
          degrade(err);
          local.reportRateLimit(retryAfterSeconds);
        });
    },
    reportSuccess() {
      local.reportSuccess();
      if (!strikesSuspected || degraded()) return;
      // One clear per second at most: every paced request reports success,
      // and the counter only needs resetting once per streak.
      const t = now();
      if (t - lastClearAt < 1000) return;
      lastClearAt = t;
      strikesSuspected = false;
      opts.redis.del(keys.strikes).catch((err: unknown) => degrade(err));
    },
  };
}

/**
 * One pacer per itch host budget, built lazily on first use. With a Redis
 * client the budgets are pool-wide; without one (local dev, a test) each
 * process paces itself, which is what every crawler tier did until now.
 */
export function createHostPacers<Host extends string>(opts: {
  redis: PacerRedis | null;
  intervalsMs: Record<Host, number>;
  cooldownMs: number;
}): (host: Host) => Pacer {
  const pacers = new Map<Host, Pacer>();
  return (host) => {
    let pacer = pacers.get(host);
    if (!pacer) {
      const base = { minIntervalMs: opts.intervalsMs[host], cooldownMs: opts.cooldownMs };
      pacer = opts.redis
        ? createSharedPacer({ ...base, host, redis: opts.redis })
        : createLocalPacer(base, `pacer:${host}`);
      pacers.set(host, pacer);
    }
    return pacer;
  };
}

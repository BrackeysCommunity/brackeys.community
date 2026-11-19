import type IORedis from "ioredis";

import { createCooldown } from "../../../packages/discord-kit/src/index.ts";

/**
 * The game's own cooldown budget (GDD 17.5): sized for many cheap presses,
 * kept in Dragonfly under its own keys so it shares nothing with any other
 * bot. Without Redis it falls back to an in-process window.
 */
export interface Budget {
  readonly limit: number;
  readonly windowMs: number;
  take(user: string): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

export const PRESSES = { limit: 30, windowMs: 10_000 } as const;
const PREFIX = "mmo-bot:cd:";

export function redisBudget(
  redis: IORedis,
  rule: { limit: number; windowMs: number } = PRESSES,
): Budget {
  return {
    ...rule,
    async take(user) {
      const key = PREFIX + user;
      try {
        const [[, n], [, ttl]] = (await redis.multi().incr(key).pttl(key).exec()) as [
          [null, number],
          [null, number],
        ];
        if (ttl < 0) await redis.pexpire(key, rule.windowMs);
        return n > rule.limit
          ? { allowed: false, retryAfterMs: Math.max(ttl, 0) }
          : { allowed: true, retryAfterMs: 0 };
      } catch {
        // Redis down: never block play on the limiter.
        return { allowed: true, retryAfterMs: 0 };
      }
    },
  };
}

export function localBudget(rule: { limit: number; windowMs: number } = PRESSES): Budget {
  const c = createCooldown(rule);
  return { ...rule, take: async (user) => c.check(user) };
}

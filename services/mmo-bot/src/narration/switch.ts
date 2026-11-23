import type { Redis } from "ioredis";

import { KEY_PREFIX, type Switch, type UseId } from "../../../../packages/mmo-narrate/src/index.ts";

/** The Redis hash the switch's levels live in, set by scripts/narration-switch.ts. */
export const SWITCH_KEY = `${KEY_PREFIX}switch`;

/** How long one read of the switch is trusted, so a flip takes effect within it. */
export const SWITCH_CACHE_MS = 30_000;

export type SwitchLevels = Record<string, string>;

/**
 * Whether a use may run, given the switch's levels: on only if every level
 * is on. The world-wide and per-use levels are on unless set "off"; a
 * server's is off unless set "on", so a server opts in deliberately. A
 * call that names no server (an offline job) has no server level.
 */
export function switchOn(
  master: boolean,
  levels: SwitchLevels,
  use: UseId,
  server?: string,
): boolean {
  if (!master) return false;
  if (levels.all === "off") return false;
  if (levels[`use:${use}`] === "off") return false;
  if (server === undefined) return true;
  return server !== "" && levels[`server:${server}`] === "on";
}

/**
 * The switch read from Redis (`mmo-narr:switch`), cached for
 * SWITCH_CACHE_MS. With Redis unreachable it is off.
 */
export function redisSwitch(
  redis: Pick<Redis, "hgetall">,
  master: boolean,
  now: () => number = Date.now,
): Switch {
  let cached: { at: number; levels: SwitchLevels } | null = null;
  const levels = async (): Promise<SwitchLevels | null> => {
    const t = now();
    if (cached && t - cached.at < SWITCH_CACHE_MS) return cached.levels;
    try {
      cached = { at: t, levels: await redis.hgetall(SWITCH_KEY) };
      return cached.levels;
    } catch {
      return null;
    }
  };
  return {
    async on(use, server) {
      if (!master) return false;
      const l = await levels();
      return l !== null && switchOn(master, l, use, server);
    },
  };
}

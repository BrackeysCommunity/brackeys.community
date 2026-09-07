/**
 * Per-user sliding window over command invocations. In-process on purpose:
 * one gateway connection sees every interaction, so there is nothing to
 * share, and a restart forgetting the windows is harmless.
 */
export interface Cooldown {
  /** Records the hit when allowed. */
  check(userId: string, now?: number): { allowed: boolean; retryAfterMs: number };
  size(): number;
}

export function createCooldown({ limit, windowMs }: { limit: number; windowMs: number }): Cooldown {
  const hits = new Map<string, number[]>();
  let calls = 0;

  function sweep(now: number) {
    for (const [user, times] of hits) {
      if (times.length === 0 || times[times.length - 1]! <= now - windowMs) hits.delete(user);
    }
  }

  return {
    check(userId, now = Date.now()) {
      // A full sweep every so often keeps the map bounded by active users
      // rather than by everyone who ever ran a command.
      if (++calls % 256 === 0) sweep(now);

      const recent = (hits.get(userId) ?? []).filter((t) => t > now - windowMs);
      if (recent.length >= limit) {
        hits.set(userId, recent);
        return { allowed: false, retryAfterMs: recent[0]! + windowMs - now };
      }
      recent.push(now);
      hits.set(userId, recent);
      return { allowed: true, retryAfterMs: 0 };
    },
    size: () => hits.size,
  };
}

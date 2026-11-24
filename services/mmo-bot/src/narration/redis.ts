import type { Redis } from "ioredis";

import type { NarrationStore } from "../../../../packages/mmo-narrate/src/index.ts";

/**
 * The narration store over the bot's Redis. It is fail-fast: any error
 * reaches the narrator, which falls back to the template as `store`.
 */
export function redisNarrationStore(redis: Redis): NarrationStore {
  const exec = async (m: ReturnType<Redis["multi"]>): Promise<unknown[]> => {
    const results = await m.exec();
    if (!results) throw new Error("redis transaction aborted");
    return results.map(([err, v]) => {
      if (err) throw err;
      return v;
    });
  };
  return {
    get: (key) => redis.get(key),
    async set(key, value, ttlSeconds) {
      if (ttlSeconds === null) await redis.set(key, value);
      else await redis.set(key, value, "EX", ttlSeconds);
    },
    async claim(key, ttlSeconds) {
      return (await redis.set(key, "1", "EX", ttlSeconds, "NX")) === "OK";
    },
    async incr(key, ttlSeconds) {
      const [n] = await exec(redis.multi().incr(key).expire(key, ttlSeconds));
      return Number(n);
    },
    async hincr(key, fields, ttlSeconds) {
      const m = redis.multi();
      for (const [f, by] of Object.entries(fields)) m.hincrby(key, f, by);
      m.expire(key, ttlSeconds);
      await exec(m);
    },
    hgetall: (key) => redis.hgetall(key),
    async push(key, value, keep) {
      await exec(
        redis
          .multi()
          .lpush(key, value)
          .ltrim(key, 0, keep - 1),
      );
    },
  };
}

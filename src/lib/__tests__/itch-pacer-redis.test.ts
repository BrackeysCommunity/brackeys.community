import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { createSharedPacer, pacerKeys } from "@/lib/itch-pacer";

/**
 * The multi-process property against a real Redis: the Lua scripts, not the
 * JS stand-in the unit tests use. Gated on REDIS_URL so CI without one
 * skips; run locally with `REDIS_URL=redis://localhost:6379 vp test run
 * itch-pacer-redis`.
 */
const url = process.env.REDIS_URL;
const HOST = `itch-pacer-test-${process.pid}`;

describe.skipIf(!url)("createSharedPacer over Redis", () => {
  let redis: import("ioredis").default;

  beforeAll(async () => {
    const { default: IORedis } = await import("ioredis");
    redis = new IORedis(url!, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    await new Promise<void>((resolve, reject) => {
      redis.once("ready", () => resolve());
      redis.once("error", reject);
    });
    const keys = pacerKeys(HOST);
    await redis.del(keys.next, keys.cooldown, keys.strikes);
  });

  afterAll(async () => {
    const keys = pacerKeys(HOST);
    await redis.del(keys.next, keys.cooldown, keys.strikes);
    await redis.quit();
  });

  it("N clients over one host never fire closer than the interval", async () => {
    const interval = 40;
    const make = () =>
      createSharedPacer({ host: HOST, redis, minIntervalMs: interval, cooldownMs: 60_000 });
    const clients = [make(), make(), make()];
    const fired: number[] = [];
    await Promise.all(
      clients.map(async (pacer) => {
        for (let i = 0; i < 4; i++) {
          await pacer.acquire();
          fired.push(Date.now());
        }
      }),
    );
    fired.sort((a, b) => a - b);
    for (let i = 1; i < fired.length; i++) {
      // Timers round; allow a couple of ms of slop, never a whole slot.
      expect(fired[i]! - fired[i - 1]!).toBeGreaterThanOrEqual(interval - 3);
    }
  });

  it("a strike from one client pauses the pool for the others", async () => {
    const a = createSharedPacer({ host: HOST, redis, minIntervalMs: 5, cooldownMs: 60_000 });
    const b = createSharedPacer({ host: HOST, redis, minIntervalMs: 5, cooldownMs: 60_000 });
    await a.acquire();
    a.reportRateLimit(1); // Retry-After: 1s
    await new Promise((r) => setTimeout(r, 50));
    const before = Date.now();
    await b.acquire();
    expect(Date.now() - before).toBeGreaterThanOrEqual(900);
    expect(Number(await redis.get(pacerKeys(HOST).strikes))).toBe(1);
    b.reportSuccess();
    await new Promise((r) => setTimeout(r, 50));
    expect(await redis.get(pacerKeys(HOST).strikes)).toBeNull();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { touchViewers, VIEWER_TTL_MS, type ViewerStore, viewersKey } from "../sync-channels";

/** A sorted set per key, as much of one as `touchViewers` uses. */
function memoryStore(): ViewerStore {
  const sets = new Map<string, Map<string, number>>();
  const set = (key: string) => {
    let found = sets.get(key);
    if (!found) sets.set(key, (found = new Map()));
    return found;
  };
  return {
    async zadd(key, score, member) {
      set(key).set(member, score);
    },
    async zremrangebyrank(key, start, stop) {
      const ranked = [...set(key)].sort((a, b) => a[1] - b[1]);
      const end = stop < 0 ? ranked.length + stop : stop;
      if (end < start) return;
      for (const [member] of ranked.slice(start, end + 1)) set(key).delete(member);
    },
    async zremrangebyscore(key, _min, max) {
      for (const [member, score] of set(key)) if (score <= Number(max)) set(key).delete(member);
    },
    async zcard(key) {
      return set(key).size;
    },
    async pexpire() {},
  };
}

function behaves(store: () => ViewerStore, prefix: string) {
  it("counts each tab once, never the caller, and forgets tabs that stop polling", async () => {
    const client = store();
    const t = 1_000_000;
    expect(await touchViewers(client, prefix, "canvas:a", "tab-1", t)).toBe(0);
    expect(await touchViewers(client, prefix, "canvas:a", "tab-1", t + 1)).toBe(0);
    expect(await touchViewers(client, prefix, "canvas:a", "tab-2", t + 2)).toBe(1);
    expect(await touchViewers(client, prefix, "canvas:a", null, t + 3)).toBe(2);
    expect(await touchViewers(client, prefix, "canvas:b", null, t + 3)).toBe(0);

    expect(await touchViewers(client, prefix, "canvas:a", "tab-2", t + VIEWER_TTL_MS + 1)).toBe(0);
  });

  it("keeps only the newest viewers once there are too many", async () => {
    const client = store();
    for (let i = 0; i < 520; i++)
      await touchViewers(client, prefix, "canvas:c", `tab-${i}`, 2_000 + i);
    expect(await touchViewers(client, prefix, "canvas:c", null, 2_600)).toBe(500);
  });
}

describe("touchViewers", () => behaves(memoryStore, "test"));

/**
 * The same against a real Redis. Gated on REDIS_URL; run locally with
 * `REDIS_URL=redis://localhost:6379 vp test run sync-viewers`.
 */
const url = process.env.REDIS_URL;
const PREFIX = `sync-viewers-test-${process.pid}`;

describe.skipIf(!url)("touchViewers over Redis", () => {
  let redis: import("ioredis").default;

  beforeAll(async () => {
    const { default: IORedis } = await import("ioredis");
    redis = new IORedis(url!, { maxRetriesPerRequest: 1 });
  });

  afterAll(async () => {
    await redis.del(...["a", "b", "c"].map((d) => viewersKey(PREFIX, `canvas:${d}`)));
    await redis.quit();
  });

  behaves(() => redis, PREFIX);
});

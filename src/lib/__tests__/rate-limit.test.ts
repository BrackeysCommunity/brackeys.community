import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/** A Redis stand-in with just the four commands the limiter uses. */
const store = new Map<string, number>();
const ttls = new Map<string, number>();
const fakeRedis = {
  incr: async (key: string) => {
    const next = (store.get(key) ?? 0) + 1;
    store.set(key, next);
    return next;
  },
  decr: async (key: string) => {
    const next = (store.get(key) ?? 0) - 1;
    store.set(key, next);
    return next;
  },
  expire: async (key: string, seconds: number) => {
    ttls.set(key, seconds);
    return 1;
  },
  del: async (key: string) => {
    store.delete(key);
    ttls.delete(key);
    return 1;
  },
};

vi.mock("@/lib/redis", () => ({ createRedisClient: async () => fakeRedis }));

const { checkRateLimit, refundRateLimit } = await import("@/lib/rate-limit");

beforeEach(() => {
  store.clear();
  ttls.clear();
  process.env.REDIS_URL = "redis://test";
});

describe("refundRateLimit", () => {
  it("charges the second press when the first one stuck", async () => {
    expect(await checkRateLimit("collab-discord-share", "ada", 1, 21600)).toBe(true);
    expect(await checkRateLimit("collab-discord-share", "ada", 1, 21600)).toBe(false);
  });

  it("gives back the hit a failed action spent, so the retry is free", async () => {
    // The press that reached Discord and got a 500 back.
    expect(await checkRateLimit("collab-discord-share", "ada", 1, 21600)).toBe(true);
    await refundRateLimit("collab-discord-share", "ada");

    // Their next press is their first, not their second.
    expect(await checkRateLimit("collab-discord-share", "ada", 1, 21600)).toBe(true);
  });

  it("clears the key so the retry starts a fresh window, not the old one's tail", async () => {
    await checkRateLimit("collab-discord-share", "ada", 1, 21600);
    await refundRateLimit("collab-discord-share", "ada");
    expect(store.has("social:rate:collab-discord-share:ada")).toBe(false);

    await checkRateLimit("collab-discord-share", "ada", 1, 999);
    expect(ttls.get("social:rate:collab-discord-share:ada")).toBe(999);
  });

  it("refunds one hit, not the whole budget", async () => {
    for (let i = 0; i < 3; i++) await checkRateLimit("collab-discord-update", "ada", 10, 3600);
    await refundRateLimit("collab-discord-update", "ada");
    expect(store.get("social:rate:collab-discord-update:ada")).toBe(2);
  });

  it("leaves other people's budgets alone", async () => {
    await checkRateLimit("collab-discord-share", "ada", 1, 21600);
    await checkRateLimit("collab-discord-share", "bo", 1, 21600);
    await refundRateLimit("collab-discord-share", "ada");
    expect(store.get("social:rate:collab-discord-share:bo")).toBe(1);
  });
});

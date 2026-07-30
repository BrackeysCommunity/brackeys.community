import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DiscordBackoffError, fetchGuildMember, isGuildMember } from "@/lib/discord";

// In-memory stand-in for Redis. `set` supports the ("EX", seconds) form the
// lib uses; TTLs are ignored since tests never advance far enough to expire.
const fakeRedis = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    failing: false,
    async get(key: string): Promise<string | null> {
      if (this.failing) throw new Error("redis down");
      return store.get(key) ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      if (this.failing) throw new Error("redis down");
      store.set(key, value);
    },
  };
});

vi.mock("ioredis", () => ({
  default: class {
    get = fakeRedis.get.bind(fakeRedis);
    set = fakeRedis.set.bind(fakeRedis);
  },
}));

const MEMBER_KEY = "discord:guild-member:user-1";
const BACKOFF_KEY = "discord:backoff-until";

function mockFetchResponse(status: number, headers: Record<string, string> = {}) {
  const response = new Response(status === 200 ? "{}" : null, { status, headers });
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  fakeRedis.store.clear();
  fakeRedis.failing = false;
  globalThis.__brackeysDiscordRedis = undefined;
  process.env.REDIS_URL = "redis://test";
  process.env.DISCORD_GUILD_ID = "guild-1";
  process.env.DISCORD_BOT_TOKEN = "bot-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isGuildMember", () => {
  it("answers from the cache without calling Discord", async () => {
    fakeRedis.store.set(MEMBER_KEY, "1");
    const fetchMock = mockFetchResponse(200);

    await expect(isGuildMember("user-1")).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches a definitive yes so the next check skips Discord", async () => {
    const fetchMock = mockFetchResponse(200);

    await expect(isGuildMember("user-1")).resolves.toBe(true);
    await expect(isGuildMember("user-1")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fakeRedis.store.get(MEMBER_KEY)).toBe("1");
  });

  it("caches a definitive no (404)", async () => {
    mockFetchResponse(404);

    await expect(isGuildMember("user-1")).resolves.toBe(false);
    expect(fakeRedis.store.get(MEMBER_KEY)).toBe("0");
  });

  it("denies on 429 without caching, and opens the backoff window", async () => {
    const fetchMock = mockFetchResponse(429, { "retry-after": "120" });

    await expect(isGuildMember("user-1")).resolves.toBe(false);
    expect(fakeRedis.store.has(MEMBER_KEY)).toBe(false);
    expect(Number(fakeRedis.store.get(BACKOFF_KEY))).toBeGreaterThan(Date.now());

    // While the window is open, cache misses fail fast instead of fetching.
    await expect(isGuildMember("user-2")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still answers when Redis is down", async () => {
    fakeRedis.failing = true;
    const fetchMock = mockFetchResponse(200);

    await expect(isGuildMember("user-1")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchGuildMember", () => {
  it("throws DiscordBackoffError while the backoff window is open", async () => {
    fakeRedis.store.set(BACKOFF_KEY, String(Date.now() + 30_000));
    const fetchMock = mockFetchResponse(200);

    await expect(fetchGuildMember("token")).rejects.toBeInstanceOf(DiscordBackoffError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces non-ok responses as errors after recording a 429", async () => {
    mockFetchResponse(429, { "retry-after": "45" });

    await expect(fetchGuildMember("token")).rejects.toThrow("429");
    expect(Number(fakeRedis.store.get(BACKOFF_KEY))).toBeGreaterThan(Date.now());
  });
});

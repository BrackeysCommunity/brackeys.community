import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DiscordBackoffError,
  discordAvatarUrl,
  fetchDiscordUser,
  fetchGuildMember,
  isDiscordAvatarUrl,
  isGuildMember,
  purgeGuildMemberCache,
} from "@/lib/discord";

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
    async del(key: string): Promise<void> {
      if (this.failing) throw new Error("redis down");
      store.delete(key);
    },
  };
});

vi.mock("ioredis", () => ({
  default: class {
    // createRedisClient wires error/ready listeners and checks `status`
    // before resolving; "ready" skips its wait-for-connection path.
    status = "ready";
    on = () => this;
    once = () => this;
    off = () => this;
    get = fakeRedis.get.bind(fakeRedis);
    set = fakeRedis.set.bind(fakeRedis);
    del = fakeRedis.del.bind(fakeRedis);
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

describe("purgeGuildMemberCache", () => {
  it("removes the cached membership so the next check hits Discord again", async () => {
    fakeRedis.store.set(MEMBER_KEY, "1");
    const fetchMock = mockFetchResponse(404);

    await purgeGuildMemberCache("user-1");
    expect(fakeRedis.store.has(MEMBER_KEY)).toBe(false);

    await expect(isGuildMember("user-1")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates Redis failures instead of reporting a clean purge", async () => {
    fakeRedis.failing = true;

    await expect(purgeGuildMemberCache("user-1")).rejects.toThrow("redis down");
  });
});

describe("isDiscordAvatarUrl", () => {
  it("accepts Discord CDN urls", () => {
    expect(isDiscordAvatarUrl("https://cdn.discordapp.com/avatars/123/abc.png")).toBe(true);
    expect(isDiscordAvatarUrl("https://cdn.discordapp.com/embed/avatars/2.png")).toBe(true);
  });

  it("rejects non-Discord and missing urls", () => {
    expect(isDiscordAvatarUrl("https://avatars.githubusercontent.com/u/1?v=4")).toBe(false);
    expect(isDiscordAvatarUrl(null)).toBe(false);
    expect(isDiscordAvatarUrl(undefined)).toBe(false);
  });
});

describe("discordAvatarUrl", () => {
  it("builds png urls for static avatar hashes", () => {
    expect(discordAvatarUrl({ id: "123", avatar: "abc" })).toBe(
      "https://cdn.discordapp.com/avatars/123/abc.png",
    );
  });

  it("builds gif urls for animated avatar hashes", () => {
    expect(discordAvatarUrl({ id: "123", avatar: "a_abc" })).toBe(
      "https://cdn.discordapp.com/avatars/123/a_abc.gif",
    );
  });

  it("falls back to the default embed avatar when the user has none", () => {
    // (id >> 22) % 6 with id = 5 << 22 → index 5
    expect(discordAvatarUrl({ id: String(5n << 22n), avatar: null })).toBe(
      "https://cdn.discordapp.com/embed/avatars/5.png",
    );
  });
});

describe("fetchDiscordUser", () => {
  it("returns the user payload", async () => {
    const response = new Response(JSON.stringify({ id: "123", avatar: "abc" }), { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );

    await expect(fetchDiscordUser("token")).resolves.toEqual({ id: "123", avatar: "abc" });
  });

  it("fails fast while the backoff window is open", async () => {
    fakeRedis.store.set(BACKOFF_KEY, String(Date.now() + 30_000));
    const fetchMock = mockFetchResponse(200);

    await expect(fetchDiscordUser("token")).rejects.toBeInstanceOf(DiscordBackoffError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces non-ok responses as errors after recording a 429", async () => {
    mockFetchResponse(429, { "retry-after": "45" });

    await expect(fetchDiscordUser("token")).rejects.toThrow("429");
    expect(Number(fakeRedis.store.get(BACKOFF_KEY))).toBeGreaterThan(Date.now());
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

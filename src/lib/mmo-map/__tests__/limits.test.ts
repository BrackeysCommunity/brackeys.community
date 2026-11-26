import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  allowed: true,
  calls: [] as [string, string, number, number | undefined][],
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (bucket: string, key: string, limit: number, window?: number) => {
    state.calls.push([bucket, key, limit, window]);
    return state.allowed;
  },
}));

import { clientKey, MAP_LIMITS, mapLimit } from "../limits";

const request = (headers: Record<string, string> = {}) =>
  new Request("https://example.test/api/public/mmo/map/tick", { headers });

beforeEach(() => {
  state.allowed = true;
  state.calls = [];
});

describe("clientKey", () => {
  it("keys a signed-in caller by user", () => {
    expect(clientKey(request({ "cf-connecting-ip": "1.2.3.4" }), "u1")).toBe("user:u1");
  });

  it("prefers Cloudflare's client address", () => {
    const headers = { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" };
    expect(clientKey(request(headers))).toBe("ip:1.2.3.4");
  });

  it("falls back to the first forwarded address, then unknown", () => {
    expect(clientKey(request({ "x-forwarded-for": " 5.6.7.8 , 9.9.9.9" }))).toBe("ip:5.6.7.8");
    expect(clientKey(request())).toBe("ip:unknown");
  });
});

describe("mapLimit", () => {
  const now = Date.UTC(2026, 10, 25, 12, 0, 45, 200);
  const minute = Math.floor(now / 60_000);

  it("lets a caller under the limit through", async () => {
    expect(await mapLimit("mmo-map-read", "ip:1.2.3.4", now)).toBeNull();
    expect(state.calls).toEqual([["mmo-map-read", `ip:1.2.3.4:${minute}`, 600, 60]]);
  });

  it("gives a signed-in overlay 120 a minute and an anonymous one 30", async () => {
    await mapLimit("mmo-map-overlay", "user:u1", now);
    await mapLimit("mmo-map-overlay", "ip:1.2.3.4", now);
    expect(state.calls.map((call) => call[2])).toEqual([120, 30]);
    expect(MAP_LIMITS["mmo-map-read"]).toEqual({ user: 600, ip: 600 });
  });

  it("refuses past the limit with the seconds left in the window", async () => {
    state.allowed = false;
    const response = await mapLimit("mmo-map-read", "user:u1", now);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("15");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("cdn-cache-control")).toBe("no-store");
    expect(await response?.json()).toMatchObject({ code: "busy" });
  });

  it("starts a fresh count each minute", async () => {
    await mapLimit("mmo-map-read", "ip:a", now);
    await mapLimit("mmo-map-read", "ip:a", now + 60_000);
    expect(state.calls[0][1]).not.toBe(state.calls[1][1]);
  });
});

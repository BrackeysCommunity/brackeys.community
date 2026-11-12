import { describe, expect, it, vi } from "vite-plus/test";

import { NOT_CONFIGURED, purgeShell, purgeUrls, shellUrls } from "../cloudflare-purge";

const RELEASE = "a".repeat(64);
const PLAY = "https://play.example.test";

function fakeFetch(answer: { status?: number; body?: unknown } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return new Response(JSON.stringify(answer.body ?? { success: true, errors: [] }), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe("shellUrls", () => {
  it("names the five shell files under the release's public frame directory", () => {
    expect(shellUrls(RELEASE, PLAY)).toEqual([
      `${PLAY}/frames/${RELEASE}/index.html`,
      `${PLAY}/frames/${RELEASE}/release.json`,
      `${PLAY}/frames/${RELEASE}/credits.html`,
      `${PLAY}/frames/${RELEASE}/sw.js`,
      `${PLAY}/frames/${RELEASE}/app.webmanifest`,
    ]);
  });
});

describe("purgeShell", () => {
  it("posts the five shell URLs to the zone's purge endpoint", async () => {
    const { fetch, calls } = fakeFetch();
    const log = vi.fn();
    const result = await purgeShell(RELEASE, {
      zoneId: "zone-1",
      token: "secret-token",
      fetch,
      log,
      origin: PLAY,
    });

    expect(result).toEqual({ purged: true, urls: 5 });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache");
    expect(call?.init.method).toBe("POST");
    expect(new Headers(call?.init.headers).get("authorization")).toBe("Bearer secret-token");
    expect(JSON.parse(call?.init.body as string)).toEqual({ files: shellUrls(RELEASE, PLAY) });
    expect(log).toHaveBeenCalledWith("[cloudflare-purge] purged", { urls: 5 });
  });

  it("is a no-op that says so when the zone or token is unset", async () => {
    const { fetch, calls } = fakeFetch();
    const log = vi.fn();
    for (const config of [
      { zoneId: null, token: "secret-token" },
      { zoneId: "zone-1", token: null },
    ]) {
      const result = await purgeShell(RELEASE, { ...config, fetch, log, origin: PLAY });
      expect(result).toEqual({ purged: false, reason: NOT_CONFIGURED });
    }
    expect(calls).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(`[cloudflare-purge] ${NOT_CONFIGURED}`, { urls: 5 });
  });

  it("reads the zone and token from the environment by default", async () => {
    vi.stubEnv("CLOUDFLARE_ZONE_ID", "");
    vi.stubEnv("CLOUDFLARE_PURGE_TOKEN", "");
    try {
      const { fetch, calls } = fakeFetch();
      const result = await purgeShell(RELEASE, { fetch, log: () => {}, origin: PLAY });
      expect(result.purged).toBe(false);
      expect(calls).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("purgeUrls", () => {
  it("reports a refusal without throwing", async () => {
    const { fetch } = fakeFetch({
      status: 403,
      body: { success: false, errors: [{ message: "Authentication error" }] },
    });
    const log = vi.fn();
    const result = await purgeUrls(["https://play.example.test/frames/x/index.html"], {
      zoneId: "zone-1",
      token: "secret-token",
      fetch,
      log,
    });
    expect(result).toEqual({
      purged: false,
      reason: "Cloudflare refused the purge: Authentication error",
    });
    expect(log).toHaveBeenCalledWith(
      "[cloudflare-purge] purge refused",
      expect.objectContaining({ status: 403 }),
    );
  });

  it("reports an unreachable API without throwing", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    const result = await purgeUrls(["https://play.example.test/frames/x/index.html"], {
      zoneId: "zone-1",
      token: "secret-token",
      fetch,
      log: () => {},
    });
    expect(result).toEqual({ purged: false, reason: "Cloudflare couldn't be reached." });
  });

  it("sends at most 30 URLs a request", async () => {
    const { fetch, calls } = fakeFetch();
    const urls = Array.from({ length: 65 }, (_, i) => `${PLAY}/frames/${i}/index.html`);
    const result = await purgeUrls(urls, {
      zoneId: "zone-1",
      token: "secret-token",
      fetch,
      log: () => {},
    });
    expect(result).toEqual({ purged: true, urls: 65 });
    expect(calls.map((c) => JSON.parse(c.init.body as string).files.length)).toEqual([30, 30, 5]);
  });
});

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  describeItchError,
  fetchCredentialsInfo,
  fetchGames,
  ItchApiError,
  validateToken,
} from "@/lib/itchio";

function mockFetchOnce(response: { ok: boolean; status?: number; json?: unknown; text?: string }) {
  const fn = vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? 200,
    json: async () => response.json,
    text: async () => response.text ?? "",
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("itchApiFetch plumbing", () => {
  it("sends the Authorization and default User-Agent headers", async () => {
    const fn = mockFetchOnce({ ok: true, json: { games: [] } });
    await fetchGames("tok");

    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.itch.io/profile/games");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["User-Agent"]).toContain("brackeys");
  });

  it("uses the caller's User-Agent when provided", async () => {
    const fn = mockFetchOnce({ ok: true, json: { games: [] } });
    await fetchGames("tok", { userAgent: "sweep/1.0" });

    const [, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("sweep/1.0");
  });

  it("throws ItchApiError with status and body on non-2xx", async () => {
    mockFetchOnce({ ok: false, status: 401, text: "unauthorized" });

    const err = await fetchGames("tok").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ItchApiError);
    expect((err as ItchApiError).status).toBe(401);
    expect((err as ItchApiError).body).toBe("unauthorized");
  });

  it("propagates network failures as-is, not as ItchApiError", async () => {
    const boom = new TypeError("fetch failed");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw boom;
      }),
    );

    const err = await fetchGames("tok").catch((e: unknown) => e);
    expect(err).toBe(boom);
  });

  it("aborts via AbortSignal.timeout and the abort is not an ItchApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(init.signal.reason));
          }),
      ),
    );

    const err = await fetchGames("tok", { timeoutMs: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect((err as DOMException).name).toBe("TimeoutError");
  });
});

describe("endpoint wrappers", () => {
  it("fetchGames passes traits and stats through and defaults missing games to []", async () => {
    mockFetchOnce({
      ok: true,
      json: {
        games: [
          {
            id: 1,
            title: "A",
            published: true,
            traits: ["p_windows", "can_be_bought"],
            downloads_count: 42,
          },
        ],
      },
    });
    const games = await fetchGames("tok");
    expect(games[0].traits).toEqual(["p_windows", "can_be_bought"]);
    expect(games[0].downloads_count).toBe(42);

    mockFetchOnce({ ok: true, json: {} });
    expect(await fetchGames("tok")).toEqual([]);
  });

  it("validateToken unwraps the user object", async () => {
    mockFetchOnce({ ok: true, json: { user: { id: 7, username: "dev" } } });
    const user = await validateToken("tok");
    expect(user.username).toBe("dev");
  });

  it("fetchCredentialsInfo defaults type to key and scopes to []", async () => {
    mockFetchOnce({ ok: true, json: {} });
    expect(await fetchCredentialsInfo("tok")).toEqual({ type: "key", scopes: [] });

    mockFetchOnce({
      ok: true,
      json: { type: "jwt", scopes: ["profile:me"], expires_at: "2026-09-01" },
    });
    expect(await fetchCredentialsInfo("tok")).toEqual({
      type: "jwt",
      scopes: ["profile:me"],
      expires_at: "2026-09-01",
    });
  });
});

describe("describeItchError", () => {
  it("maps 401/403 to re-link copy", () => {
    expect(describeItchError(new ItchApiError(401, ""))).toContain("re-link");
    expect(describeItchError(new ItchApiError(403, ""))).toContain("re-link");
  });

  it("maps 429 and 5xx to transient-trouble copy", () => {
    expect(describeItchError(new ItchApiError(429, ""))).toContain("try again in a few minutes");
    expect(describeItchError(new ItchApiError(503, ""))).toContain("try again in a few minutes");
  });

  it("maps everything else to couldn't-reach copy", () => {
    expect(describeItchError(new TypeError("fetch failed"))).toContain("Couldn't reach itch.io");
    expect(describeItchError(new ItchApiError(404, ""))).toContain("Couldn't reach itch.io");
  });
});

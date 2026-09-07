import { describe, expect, test } from "bun:test";

import { ApiUnavailableError, createPublicApi } from "./api.ts";

/** An oRPC RPC-format success body. */
const rpcOk = (json: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ json, meta: [] }), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });

describe("public API client", () => {
  test("calls the public mount over GET and logs the cache status", async () => {
    const lines: string[] = [];
    let seen: Request | undefined;
    const api = createPublicApi("https://brackeys.test", {
      log: (l) => lines.push(l),
      fetchImpl: async (input) => {
        seen = input as Request;
        return rpcOk({ active: 3, recruiting: 1 }, { "cf-cache-status": "HIT" });
      },
    });
    const stats = await api.getTeamStats();
    expect(stats).toEqual({ active: 3, recruiting: 1 });
    expect(seen?.method).toBe("GET");
    expect(seen?.url.startsWith("https://brackeys.test/api/public/rpc/getTeamStats")).toBe(true);
    expect(lines[0]).toMatch(/^\[api\] getTeamStats 200 \d+ms cf=HIT$/);
  });

  test("a hung origin becomes a timeout outage inside the budget", async () => {
    const api = createPublicApi("https://brackeys.test", {
      timeoutMs: 20,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    });
    const error = await api.getTeamStats().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiUnavailableError);
    expect((error as ApiUnavailableError).outcome).toBe("timeout");
  });

  test("a network failure and a 5xx both become the error outcome", async () => {
    const down = createPublicApi("https://brackeys.test", {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const downError = await down.getTeamStats().catch((e: unknown) => e);
    expect(downError).toBeInstanceOf(ApiUnavailableError);
    expect((downError as ApiUnavailableError).outcome).toBe("error");

    const broken = createPublicApi("https://brackeys.test", {
      fetchImpl: async () => new Response("boom", { status: 502 }),
    });
    const brokenError = await broken.getTeamStats().catch((e: unknown) => e);
    expect(brokenError).toBeInstanceOf(ApiUnavailableError);
    expect((brokenError as ApiUnavailableError).outcome).toBe("error");
  });

  test("a null answer is a null, not an error", async () => {
    const api = createPublicApi("https://brackeys.test", { fetchImpl: async () => rpcOk(null) });
    expect(await api.getJam({ idOrSlug: "nope" })).toBeNull();
  });
});

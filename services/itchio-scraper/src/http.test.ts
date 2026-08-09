import { afterAll, describe, expect, test } from "bun:test";

import {
  createPacer,
  HttpStatusError,
  isNotFound,
  describeError,
  isTransient,
  pacedFetch,
  parseRetryAfter,
  resetCookieJar,
} from "./http.ts";

/**
 * Virtual clock: sleep advances time instantly so pacer tests are
 * deterministic and take no wall time.
 */
function virtualClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("createPacer", () => {
  test("spaces sequential requests by the minimum interval", async () => {
    const clock = virtualClock();
    const pacer = createPacer({ minIntervalMs: 350, cooldownMs: 60_000, ...clock });

    await pacer.acquire();
    expect(clock.now()).toBe(0);
    await pacer.acquire();
    expect(clock.now()).toBe(350);
    await pacer.acquire();
    expect(clock.now()).toBe(700);
  });

  test("an isolated rate limit pauses the pool for a short jittered interval", async () => {
    const clock = virtualClock();
    const pacer = createPacer({
      minIntervalMs: 350,
      cooldownMs: 60_000,
      ...clock,
      random: () => 0.5,
    });

    await pacer.acquire();
    pacer.reportRateLimit(null);
    await pacer.acquire();
    // 10s floor + 0.5 * 20s jitter.
    expect(clock.now()).toBe(20_000);
  });

  test("consecutive rate limits escalate from the base cooldown, doubling per strike", async () => {
    const clock = virtualClock();
    const pacer = createPacer({
      minIntervalMs: 350,
      cooldownMs: 60_000,
      ...clock,
      random: () => 0,
    });

    await pacer.acquire();
    pacer.reportRateLimit(null); // strike 1: 10s jittered
    await pacer.acquire();
    expect(clock.now()).toBe(10_000);
    pacer.reportRateLimit(null); // strike 2: base cooldown
    await pacer.acquire();
    expect(clock.now()).toBe(70_000);
    pacer.reportRateLimit(null); // strike 3: doubled
    await pacer.acquire();
    expect(clock.now()).toBe(190_000);
  });

  test("escalation is capped at ten minutes", async () => {
    const clock = virtualClock();
    const pacer = createPacer({
      minIntervalMs: 350,
      cooldownMs: 60_000,
      ...clock,
      random: () => 0,
    });

    for (let i = 0; i < 10; i++) pacer.reportRateLimit(null);
    const before = clock.now();
    await pacer.acquire();
    expect(clock.now() - before).toBe(600_000);
  });

  test("a successful response resets the strike streak", async () => {
    const clock = virtualClock();
    const pacer = createPacer({
      minIntervalMs: 350,
      cooldownMs: 60_000,
      ...clock,
      random: () => 0,
    });

    await pacer.acquire();
    pacer.reportRateLimit(null);
    await pacer.acquire();
    pacer.reportSuccess();
    pacer.reportRateLimit(null);
    await pacer.acquire();
    // Back to the short first-strike pause, not the 60s second strike.
    expect(clock.now()).toBe(10_000 + 10_000);
  });

  test("honors Retry-After over the fallback cooldown", async () => {
    const clock = virtualClock();
    const pacer = createPacer({ minIntervalMs: 350, cooldownMs: 60_000, ...clock });

    await pacer.acquire();
    pacer.reportRateLimit(120);
    await pacer.acquire();
    expect(clock.now()).toBe(120_000);
  });

  test("a shorter report never shrinks an active cooldown", async () => {
    const clock = virtualClock();
    const pacer = createPacer({ minIntervalMs: 350, cooldownMs: 60_000, ...clock });

    await pacer.acquire();
    pacer.reportRateLimit(120);
    pacer.reportRateLimit(1);
    await pacer.acquire();
    expect(clock.now()).toBe(120_000);
  });

  test("concurrent acquirers each get their own slot", async () => {
    const clock = virtualClock();
    const pacer = createPacer({ minIntervalMs: 350, cooldownMs: 60_000, ...clock });

    await Promise.all([pacer.acquire(), pacer.acquire(), pacer.acquire()]);
    // Third caller had to wait out two full intervals.
    expect(clock.now()).toBe(700);
  });
});

describe("parseRetryAfter", () => {
  const res = (headers: Record<string, string>) => new Response(null, { status: 429, headers });

  test("parses the delta-seconds form", () => {
    expect(parseRetryAfter(res({ "retry-after": "120" }))).toBe(120);
  });

  test("caps runaway values at 10 minutes", () => {
    expect(parseRetryAfter(res({ "retry-after": "86400" }))).toBe(600);
  });

  test("returns null when the header is absent", () => {
    expect(parseRetryAfter(res({}))).toBeNull();
  });

  test("returns null for zero, negative, and non-numeric values", () => {
    expect(parseRetryAfter(res({ "retry-after": "0" }))).toBeNull();
    expect(parseRetryAfter(res({ "retry-after": "-5" }))).toBeNull();
    // HTTP-date form is unsupported and falls back to the configured cooldown.
    expect(parseRetryAfter(res({ "retry-after": "Fri, 01 Aug 2026 12:00:00 GMT" }))).toBeNull();
  });
});

describe("pacedFetch request timeout", () => {
  const realFetch = globalThis.fetch;
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  /**
   * Regression: the abort signal used to be armed at the call site and passed
   * into pacedFetch, so its clock ran while the caller waited at the gate.
   * A 429 arming the pool cooldown meant every queued request's signal expired
   * before its fetch was issued — the pool failed with TimeoutError without
   * sending anything. The signal must be created after the gate releases.
   */
  test("the timeout clock starts after the gate, not before", async () => {
    const seen: Array<{ aborted: boolean }> = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      seen.push({ aborted: signal.aborted });
      // First call arms a 1s pool-wide cooldown; later calls wait it out.
      return new Response(null, {
        status: seen.length === 1 ? 429 : 200,
        headers: seen.length === 1 ? { "retry-after": "1" } : {},
      });
    }) as typeof fetch;

    await pacedFetch("https://itch.io/a", {}, 300);
    // The gate now holds for ~1s — far longer than this 300ms timeout. With
    // the old pre-armed signal this call threw TimeoutError instead.
    const res = await pacedFetch("https://itch.io/b", {}, 300);

    expect(res.status).toBe(200);
    expect(seen).toHaveLength(2);
    expect(seen.every((s) => !s.aborted)).toBe(true);
  });
});

describe("cookie jar", () => {
  const realFetch = globalThis.fetch;
  afterAll(() => {
    globalThis.fetch = realFetch;
    resetCookieJar();
  });

  test("replays cookies set by earlier responses", async () => {
    resetCookieJar();
    const seen: Array<string | null> = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("cookie"));
      return new Response(null, {
        status: 200,
        headers: { "set-cookie": "itchio_token=abc123; Path=/; HttpOnly" },
      });
    }) as typeof fetch;

    await pacedFetch("https://itch.io/a", {}, 5_000);
    await pacedFetch("https://itch.io/b", { headers: { accept: "text/html" } }, 5_000);

    expect(seen[0]).toBeNull();
    expect(seen[1]).toBe("itchio_token=abc123");
  });

  test("a cleared cookie stops being sent", async () => {
    resetCookieJar();
    let call = 0;
    const seen: Array<string | null> = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      call += 1;
      seen.push(new Headers(init.headers).get("cookie"));
      return new Response(null, {
        status: 200,
        headers: { "set-cookie": call === 1 ? "itchio_token=abc" : "itchio_token=; Max-Age=0" },
      });
    }) as typeof fetch;

    await pacedFetch("https://itch.io/a", {}, 5_000);
    await pacedFetch("https://itch.io/b", {}, 5_000);
    await pacedFetch("https://itch.io/c", {}, 5_000);

    expect(seen).toEqual([null, "itchio_token=abc", null]);
  });
});

describe("describeError", () => {
  test("keeps a single-line summary for a plain error", () => {
    expect(describeError(new Error("boom\nstack line"))).toBe("boom");
  });

  test("surfaces the underlying cause of a wrapper error", () => {
    // drizzle buries the real Postgres error under the full SQL statement.
    const wrapped = new Error("Failed query: insert into ...", {
      cause: new Error("duplicate key value violates unique constraint"),
    });
    expect(describeError(wrapped)).toBe(
      "Failed query: insert into ... — caused by: duplicate key value violates unique constraint",
    );
  });

  test("does not repeat an identical cause", () => {
    expect(describeError(new Error("same", { cause: new Error("same") }))).toBe("same");
  });
});

describe("error classification", () => {
  test("isNotFound matches only 404 status errors", () => {
    expect(isNotFound(new HttpStatusError(404, "https://itch.io/jam/x"))).toBe(true);
    expect(isNotFound(new HttpStatusError(500, "https://itch.io/jam/x"))).toBe(false);
    expect(isNotFound(new Error("failed with status 404"))).toBe(false);
  });

  test("transient statuses are retried, 404 is not", () => {
    for (const status of [429, 500, 502, 503, 504, 521]) {
      expect(isTransient(new HttpStatusError(status, "u"))).toBe(true);
    }
    expect(isTransient(new HttpStatusError(404, "u"))).toBe(false);
    expect(isTransient(new HttpStatusError(403, "u"))).toBe(false);
  });

  test("network flakes are transient, everything else is not", () => {
    expect(isTransient(new Error("read ECONNRESET"))).toBe(true);
    expect(isTransient(new Error("The operation timed out"))).toBe(true);
    expect(isTransient(new Error("fetch failed: socket hang up"))).toBe(true);
    expect(isTransient(new Error("unexpected token < in JSON"))).toBe(false);
  });
});

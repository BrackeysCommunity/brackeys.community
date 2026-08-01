import { describe, expect, test } from "bun:test";

import { createPacer, HttpStatusError, isNotFound, isTransient, parseRetryAfter } from "./http.ts";

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

  test("a rate limit pauses the whole pool for the fallback cooldown", async () => {
    const clock = virtualClock();
    const pacer = createPacer({ minIntervalMs: 350, cooldownMs: 60_000, ...clock });

    await pacer.acquire();
    pacer.reportRateLimit(null);
    await pacer.acquire();
    expect(clock.now()).toBe(60_000);
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

import { describe, expect, it } from "vite-plus/test";

import {
  cooldownForStrike,
  createLocalPacer,
  createSharedPacer,
  nextSlot,
  type PacerRedis,
  pacerKeys,
} from "@/lib/itch-pacer";

/** Virtual clock: sleep advances time instantly so tests take no wall time. */
function virtualClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/**
 * A Redis stand-in that implements the two scripts' semantics in JS over a
 * shared map, so N shared pacers over one instance exercise the same
 * cross-process arithmetic the Lua runs. Script identity is by content.
 */
function fakeRedis(): PacerRedis & { store: Map<string, number> } {
  const store = new Map<string, number>();
  return {
    store,
    async eval(script, _numKeys, ...args) {
      const a = args.map(Number);
      if (script.includes("INCR")) {
        const [cooldownKey, strikesKey] = [String(args[0]), String(args[1])];
        const [t, retryAfterMs, firstWaitMs, baseMs, maxMs] = a.slice(2);
        const strikes = (store.get(strikesKey) ?? 0) + 1;
        store.set(strikesKey, strikes);
        const wait =
          retryAfterMs! > 0
            ? retryAfterMs!
            : strikes <= 1
              ? firstWaitMs!
              : Math.min(baseMs! * 2 ** (strikes - 2), maxMs!);
        const until = t! + Math.floor(wait);
        const current = store.get(cooldownKey) ?? 0;
        if (until > current) {
          store.set(cooldownKey, until);
          return [Math.floor(wait), strikes, 1];
        }
        return [Math.floor(wait), strikes, 0];
      }
      if (script.includes("interval")) {
        const [nextKey, cooldownKey] = [String(args[0]), String(args[1])];
        const [t, interval] = a.slice(2);
        const slot = nextSlot(t!, store.get(nextKey) ?? 0, store.get(cooldownKey) ?? 0, interval!);
        store.set(nextKey, slot.next);
        return slot.at - t!;
      }
      // cooldown read
      return store.get(String(args[0])) ?? 0;
    },
    async del(...keys) {
      let n = 0;
      for (const key of keys) if (store.delete(key)) n++;
      return n;
    },
  };
}

describe("nextSlot", () => {
  it("fires now when nothing is reserved and reserves one interval ahead", () => {
    expect(nextSlot(1000, 0, 0, 350)).toEqual({ at: 1000, next: 1350 });
  });

  it("waits for the later of the reservation and the cooldown", () => {
    expect(nextSlot(1000, 1200, 0, 350)).toEqual({ at: 1200, next: 1550 });
    expect(nextSlot(1000, 1200, 5000, 350)).toEqual({ at: 5000, next: 5350 });
  });
});

describe("cooldownForStrike", () => {
  it("prefers Retry-After, then a jittered first strike, then doubling from the base", () => {
    expect(cooldownForStrike(3, 120, 60_000, () => 0)).toBe(120_000);
    expect(cooldownForStrike(1, null, 60_000, () => 0.5)).toBe(20_000);
    expect(cooldownForStrike(2, null, 60_000, () => 0)).toBe(60_000);
    expect(cooldownForStrike(3, null, 60_000, () => 0)).toBe(120_000);
    expect(cooldownForStrike(12, null, 60_000, () => 0)).toBe(600_000);
  });
});

describe("createLocalPacer", () => {
  it("spaces sequential requests by the minimum interval", async () => {
    const clock = virtualClock();
    const pacer = createLocalPacer({ minIntervalMs: 350, cooldownMs: 60_000, ...clock });

    await pacer.acquire();
    expect(clock.now()).toBe(0);
    await pacer.acquire();
    expect(clock.now()).toBe(350);
    await pacer.acquire();
    expect(clock.now()).toBe(700);
  });

  it("escalates consecutive strikes and resets on success", async () => {
    const clock = virtualClock();
    const pacer = createLocalPacer({
      minIntervalMs: 350,
      cooldownMs: 60_000,
      ...clock,
      random: () => 0,
    });

    await pacer.acquire();
    pacer.reportRateLimit(null); // strike 1: 10s
    await pacer.acquire();
    expect(clock.now()).toBe(10_000);
    pacer.reportRateLimit(null); // strike 2: base
    await pacer.acquire();
    expect(clock.now()).toBe(70_000);
    pacer.reportSuccess();
    pacer.reportRateLimit(null); // back to a first strike
    await pacer.acquire();
    expect(clock.now()).toBe(80_000);
  });

  it("a shorter report never shrinks an active cooldown", async () => {
    const clock = virtualClock();
    const pacer = createLocalPacer({ minIntervalMs: 350, cooldownMs: 60_000, ...clock });

    await pacer.acquire();
    pacer.reportRateLimit(120);
    pacer.reportRateLimit(1);
    await pacer.acquire();
    expect(clock.now()).toBe(120_000);
  });
});

describe("createSharedPacer", () => {
  it("shares one budget across processes: observed gaps are at least the interval", async () => {
    const clock = virtualClock();
    const redis = fakeRedis();
    const make = () =>
      createSharedPacer({
        host: "itch.io",
        redis,
        minIntervalMs: 350,
        cooldownMs: 60_000,
        ...clock,
      });
    const pacers = [make(), make(), make()];

    const fired: number[] = [];
    for (let i = 0; i < 9; i++) {
      await pacers[i % 3]!.acquire();
      fired.push(clock.now());
    }
    for (let i = 1; i < fired.length; i++) {
      expect(fired[i]! - fired[i - 1]!).toBeGreaterThanOrEqual(350);
    }
    expect(fired[8]).toBe(8 * 350);
  });

  it("a strike reported by one process pauses the others", async () => {
    const clock = virtualClock();
    const redis = fakeRedis();
    const opts = { redis, minIntervalMs: 350, cooldownMs: 60_000, random: () => 0, ...clock };
    const a = createSharedPacer({ host: "itch.io", ...opts });
    const b = createSharedPacer({ host: "itch.io", ...opts });

    await a.acquire();
    a.reportRateLimit(null);
    // The report is fire-and-forget; let it land.
    await Promise.resolve();
    await Promise.resolve();
    await b.acquire();
    expect(clock.now()).toBe(10_000);
    expect(redis.store.get(pacerKeys("itch.io").strikes)).toBe(1);
  });

  it("hosts are separate budgets", async () => {
    const clock = virtualClock();
    const redis = fakeRedis();
    const opts = { redis, minIntervalMs: 350, cooldownMs: 60_000, ...clock };
    const site = createSharedPacer({ host: "itch.io", ...opts });
    const cdn = createSharedPacer({ host: "img.itch.zone", ...opts });

    await site.acquire();
    await cdn.acquire();
    expect(clock.now()).toBe(0);
  });

  it("degrades to local pacing when Redis fails, and tries again after the window", async () => {
    const clock = virtualClock();
    let failing = true;
    let calls = 0;
    const redis: PacerRedis = {
      async eval() {
        calls++;
        if (failing) throw new Error("ECONNREFUSED");
        return 0;
      },
      async del() {
        return 0;
      },
    };
    const pacer = createSharedPacer({
      host: "itch.io",
      redis,
      minIntervalMs: 350,
      cooldownMs: 60_000,
      degradeMs: 30_000,
      ...clock,
    });

    await pacer.acquire();
    await pacer.acquire();
    // One failed eval, then the local pacer took over and paced the second call.
    expect(calls).toBe(1);
    expect(clock.now()).toBe(350);

    // Still inside the degrade window: Redis is not retried.
    await pacer.acquire();
    expect(calls).toBe(1);

    failing = false;
    clock.advance(30_000);
    await pacer.acquire();
    expect(calls).toBeGreaterThan(1);
  });
});

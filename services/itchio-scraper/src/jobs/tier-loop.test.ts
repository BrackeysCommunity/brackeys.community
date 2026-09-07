import { describe, expect, test } from "bun:test";

import { createStopGate, type StopGate } from "./runner.ts";
import { combineGates, pickDueTier, runTierLoop, type Tier, type TierStatus } from "./tier-loop.ts";

/**
 * Virtual clock: sleeps advance time instantly, and each fake tier "takes"
 * a declared amount of time per run so chunk preemption is observable.
 */
function harness() {
  let t = 0;
  const log: string[] = [];
  const saved = new Map<string, TierStatus>();
  let stopAfterTurns = Number.POSITIVE_INFINITY;
  let turns = 0;
  const stop: StopGate = { reason: () => (turns >= stopAfterTurns ? "interrupted" : null) };

  function tier(
    name: string,
    priority: number,
    intervalMs: number,
    behaviour: (gate: StopGate) => { tookMs: number; complete: boolean },
  ): Tier {
    return {
      name,
      priority,
      intervalMs,
      async run(gate) {
        turns++;
        const { tookMs, complete } = behaviour(gate);
        t += tookMs;
        log.push(`${name}@${t - tookMs}${complete ? "" : " (cut)"}`);
        return { failed: 0, complete };
      },
    };
  }

  return {
    log,
    saved,
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    stop,
    tier,
    stopAfter(n: number) {
      stopAfterTurns = n;
    },
    async run(tiers: Tier[], chunkMs = 10 * 60_000) {
      await runTierLoop({
        tiers,
        chunkMs,
        stop,
        load: async () => saved,
        save: async (name, status) => {
          saved.set(name, status);
        },
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
        chunkGate: (ms) =>
          createStopGate("chunk", ms / 60_000, { now: () => t, watchSignals: false }),
        maxIdleMs: 60_000,
      });
    },
  };
}

const MIN = 60_000;

describe("pickDueTier", () => {
  test("picks the highest-priority due tier and nothing when none is due", () => {
    const tiers: Tier[] = [
      {
        name: "results",
        priority: 3,
        intervalMs: 0,
        run: async () => ({ failed: 0, complete: true }),
      },
      {
        name: "live",
        priority: 1,
        intervalMs: 0,
        run: async () => ({ failed: 0, complete: true }),
      },
    ];
    const due = new Map([
      ["results", 0],
      ["live", 0],
    ]);
    expect(pickDueTier(tiers, due, 100)?.name).toBe("live");
    due.set("live", 500);
    expect(pickDueTier(tiers, due, 100)?.name).toBe("results");
    due.set("results", 500);
    expect(pickDueTier(tiers, due, 100)).toBeNull();
  });
});

describe("combineGates", () => {
  test("the first tripped gate's reason wins", () => {
    const a: StopGate = { reason: () => null };
    const b: StopGate = { reason: () => "deadline (10m)" };
    expect(combineGates(a, b).reason()).toBe("deadline (10m)");
    expect(combineGates(a, a).reason()).toBeNull();
  });
});

describe("runTierLoop", () => {
  test("runs every tier once at boot, highest priority first, then re-arms each on its interval", async () => {
    const h = harness();
    const live = h.tier("live", 1, 15 * MIN, () => ({ tookMs: 2 * MIN, complete: true }));
    const results = h.tier("results", 3, 6 * 60 * MIN, () => ({ tookMs: 1 * MIN, complete: true }));
    const discovery = h.tier("discovery", 2, 4 * 60 * MIN, () => ({
      tookMs: 1 * MIN,
      complete: true,
    }));
    h.stopAfter(4);

    await h.run([results, live, discovery]);

    // Boot: live, discovery, results. Then live is the first due again, at
    // 15 minutes after it finished.
    expect(h.log).toEqual(["live@0", "discovery@120000", "results@180000", "live@1020000"]);
    expect(h.saved.get("live")?.nextRunAt?.getTime()).toBe(1020000 + 2 * MIN + 15 * MIN);
    expect(h.saved.get("live")?.lastOkAt?.getTime()).toBe(1020000 + 2 * MIN);
  });

  test("a tier cut at the chunk stays due and continues next turn unless something higher is due", async () => {
    const h = harness();
    // Results holds a backlog: it never completes within a chunk.
    const results = h.tier("results", 3, 6 * 60 * MIN, (gate) => ({
      tookMs: 10 * MIN,
      complete: gate.reason() != null ? false : false,
    }));
    const live = h.tier("live", 1, 15 * MIN, () => ({ tookMs: 1 * MIN, complete: true }));
    h.stopAfter(5);

    await h.run([results, live]);

    // live@0 (done, due again at 16m), results@1m (cut at 11m), results@11m
    // (cut at 21m) — by then live is due, and it preempts results at 21m.
    expect(h.log).toEqual([
      "live@0",
      "results@60000 (cut)",
      "results@660000 (cut)",
      "live@1260000",
      "results@1320000 (cut)",
    ]);
  });

  test("resumes the persisted schedule instead of firing everything at boot", async () => {
    const h = harness();
    h.saved.set("discovery", { nextRunAt: new Date(50 * MIN) });
    const live = h.tier("live", 1, 15 * MIN, () => ({ tookMs: 1 * MIN, complete: true }));
    const discovery = h.tier("discovery", 2, 4 * 60 * MIN, () => ({
      tookMs: 1 * MIN,
      complete: true,
    }));
    h.stopAfter(3);

    await h.run([live, discovery]);

    expect(h.log).toEqual(["live@0", "live@960000", "live@1920000"]);
    expect(h.saved.get("discovery")?.nextRunAt?.getTime()).toBe(50 * MIN);
  });

  test("a tier that throws is backed off and recorded, and the loop goes on", async () => {
    const h = harness();
    let calls = 0;
    const flaky: Tier = {
      name: "flaky",
      priority: 1,
      intervalMs: 5 * MIN,
      async run() {
        calls++;
        if (calls === 1) throw new Error("itch is down");
        h.log.push(`flaky@${h.now()}`);
        return { failed: 0, complete: true };
      },
    };
    let stopAt = 0;
    const stop: StopGate = {
      reason: () => (calls >= 2 && h.now() > stopAt ? "interrupted" : null),
    };

    await runTierLoop({
      tiers: [flaky],
      chunkMs: 10 * MIN,
      stop,
      load: async () => h.saved,
      save: async (name, status) => {
        h.saved.set(name, status);
        stopAt = h.now();
      },
      now: h.now,
      sleep: async (ms) => {
        h.advance(ms);
      },
      chunkGate: () => ({ reason: () => null }),
      errorBackoffMs: 7 * MIN,
    });

    expect(calls).toBe(2);
    // Retried after the backoff, not the interval, and recorded on the way.
    expect(h.log).toEqual([`flaky@${7 * MIN}`]);
    expect(h.saved.get("flaky")?.lastError).toBeNull();
  });

  test("the signal stops the loop after the tier in flight returns", async () => {
    const h = harness();
    const live = h.tier("live", 1, 15 * MIN, () => ({ tookMs: 1 * MIN, complete: true }));
    h.stopAfter(1);

    await h.run([live]);

    expect(h.log).toEqual(["live@0"]);
  });
});

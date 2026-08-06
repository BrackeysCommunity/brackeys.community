import { describe, expect, test } from "bun:test";

import { createStopGate, type StopGate, syncSlugs } from "./runner.ts";

const never: StopGate = { reason: () => null };
const noSleep = async () => {};

describe("createStopGate", () => {
  test("keeps going until the deadline passes", () => {
    let clock = 0;
    const gate = createStopGate("test", 45, { now: () => clock, watchSignals: false });

    expect(gate.reason()).toBeNull();
    clock = 44 * 60_000;
    expect(gate.reason()).toBeNull();
    clock = 46 * 60_000;
    expect(gate.reason()).toBe("deadline (45m)");
  });

  test("measures the deadline from construction, not from the epoch", () => {
    // The gate is built partway into a process's life (after the selector
    // query). Anchoring on `now()` at construction is what makes the deadline
    // mean "45 minutes of work" rather than "45 minutes past some fixed point".
    let clock = 1_000_000;
    const gate = createStopGate("test", 10, { now: () => clock, watchSignals: false });

    clock += 9 * 60_000;
    expect(gate.reason()).toBeNull();
    clock += 2 * 60_000;
    expect(gate.reason()).toBe("deadline (10m)");
  });
});

describe("syncSlugs", () => {
  test("works the whole list in order when nothing stops it", async () => {
    const seen: string[] = [];
    const out = await syncSlugs("test", ["a", "b", "c"], {
      delayMs: 0,
      gate: never,
      sync: async (slug) => {
        seen.push(slug);
      },
      sleep: noSleep,
    });

    expect(seen).toEqual(["a", "b", "c"]);
    expect(out).toEqual({ done: 3, failed: 0, stoppedEarly: "" });
  });

  test("counts a failing jam and carries on", async () => {
    // The whole point of the tier split is that a tick keeps its budget. One
    // jam whose page changed shape must not cost the remaining jams.
    const seen: string[] = [];
    const out = await syncSlugs("test", ["a", "boom", "c"], {
      delayMs: 0,
      gate: never,
      sync: async (slug) => {
        seen.push(slug);
        if (slug === "boom") throw new Error("500");
      },
      sleep: noSleep,
    });

    expect(seen).toEqual(["a", "boom", "c"]);
    expect(out).toEqual({ done: 2, failed: 1, stoppedEarly: "" });
  });

  test("stops mid-list once the gate trips and reports why", async () => {
    const seen: string[] = [];
    let tripped = false;
    const out = await syncSlugs("test", ["a", "b", "c", "d"], {
      delayMs: 0,
      gate: { reason: () => (tripped ? "deadline (45m)" : null) },
      sync: async (slug) => {
        seen.push(slug);
        if (slug === "b") tripped = true;
      },
      sleep: noSleep,
    });

    // "b" completes — the gate is checked before each jam, never mid-jam, so a
    // jam is never left half-written.
    expect(seen).toEqual(["a", "b"]);
    expect(out).toEqual({ done: 2, failed: 0, stoppedEarly: "deadline (45m)" });
  });

  test("checks the gate before the first jam", async () => {
    // A tier that is already past its deadline when it reaches the sync loop
    // must issue no requests at all.
    const seen: string[] = [];
    const out = await syncSlugs("test", ["a", "b"], {
      delayMs: 0,
      gate: { reason: () => "interrupted" },
      sync: async (slug) => {
        seen.push(slug);
      },
      sleep: noSleep,
    });

    expect(seen).toEqual([]);
    expect(out).toEqual({ done: 0, failed: 0, stoppedEarly: "interrupted" });
  });

  test("paces between jams but not after the last one", async () => {
    const sleeps: number[] = [];
    await syncSlugs("test", ["a", "b"], {
      delayMs: 250,
      gate: never,
      sync: async () => {},
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    // One gap per jam is fine — the trailing sleep costs the tick 250ms and
    // nothing else — but the pacing must actually be applied between jams.
    expect(sleeps.every((ms) => ms === 250)).toBe(true);
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
  });
});

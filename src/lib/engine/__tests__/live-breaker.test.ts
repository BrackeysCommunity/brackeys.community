import { describe, expect, it } from "vite-plus/test";

import { LIVE_BLOCK } from "../limits";
import { type LiveReportRow, shouldBlock } from "../live-breaker";
import { isFailedOutcome, LIVE_OUTCOMES } from "../live-outcomes";

const since = new Date("2026-11-01T12:00:00Z");
const minutes = (n: number) => new Date(since.getTime() + n * 60_000);
const now = minutes(60);

function rows(failing: number, ok: number, at = minutes(5)): LiveReportRow[] {
  return [
    ...Array.from({ length: failing }, (_, i) => ({
      userId: `bad-${i}`,
      outcome: i % 2 ? "crashed" : "failed",
      at,
    })),
    ...Array.from({ length: ok }, (_, i) => ({ userId: `ok-${i}`, outcome: "applied", at })),
  ];
}

describe("shouldBlock", () => {
  it("reads its thresholds from the limits", () => {
    expect(LIVE_BLOCK).toEqual({ players: 5, ratio: 0.25, windowMinutes: 30 });
  });

  it("doesn't block on 4 failing players, however high their share", () => {
    expect(shouldBlock(rows(4, 0), since, now)).toEqual({ block: false, failed: 4, total: 4 });
  });

  it("blocks 5 failing players at 25%", () => {
    expect(shouldBlock(rows(5, 15), since, now)).toEqual({ block: true, failed: 5, total: 20 });
  });

  it("doesn't block 5 failing players at 20%", () => {
    expect(shouldBlock(rows(5, 20), since, now)).toEqual({ block: false, failed: 5, total: 25 });
  });

  it("doesn't count reports after the 30-minute window", () => {
    const late = rows(5, 0, minutes(31));
    expect(shouldBlock(late, since, now)).toEqual({ block: false, failed: 0, total: 0 });
    const edge = rows(5, 0, minutes(30));
    expect(shouldBlock(edge, since, now).block).toBe(true);
  });

  it("doesn't count reports from before the window", () => {
    expect(shouldBlock(rows(5, 0, minutes(-1)), since, now).block).toBe(false);
  });

  it("never counts anonymous reports: only rows count, and they aren't rows", () => {
    // Anonymous reports only bump counters; with 4 signed-in failures the
    // breaker holds however many anonymous players failed.
    expect(shouldBlock(rows(4, 0), since, now).block).toBe(false);
    expect(shouldBlock([], since, now)).toEqual({ block: false, failed: 0, total: 0 });
  });

  it("counts each player once", () => {
    const repeated = [...rows(4, 0), ...rows(4, 0, minutes(6))];
    expect(shouldBlock(repeated, since, now)).toEqual({ block: false, failed: 4, total: 4 });
  });

  it("restarts the window on unblock (a later since)", () => {
    const before = rows(5, 0, minutes(5));
    expect(shouldBlock(before, since, now).block).toBe(true);
    const unblocked = minutes(10);
    const after = new Date(unblocked.getTime() + 60 * 60_000);
    expect(shouldBlock(before, unblocked, after)).toEqual({ block: false, failed: 0, total: 0 });
    const again = rows(5, 0, minutes(20));
    expect(shouldBlock([...before, ...again], unblocked, after)).toEqual({
      block: true,
      failed: 5,
      total: 5,
    });
  });

  it("ignores rows stamped after now", () => {
    expect(shouldBlock(rows(5, 0, minutes(20)), since, minutes(10)).block).toBe(false);
  });
});

describe("isFailedOutcome", () => {
  it("counts failed and crashed games, not a refused or applied version", () => {
    expect(LIVE_OUTCOMES.filter(isFailedOutcome)).toEqual(["failed", "crashed"]);
  });

  it("doesn't count refused players toward a block", () => {
    const refused = rows(5, 0).map((r) => ({ ...r, outcome: "refused" }));
    expect(shouldBlock(refused, since, now)).toEqual({ block: false, failed: 0, total: 5 });
  });
});

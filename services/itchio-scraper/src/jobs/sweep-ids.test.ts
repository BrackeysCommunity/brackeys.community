import { describe, expect, test } from "bun:test";

import { nextSweepId, type SweepRange, slugFromRateUrl } from "./sweep-ids.ts";

describe("slugFromRateUrl", () => {
  test("reads the slug an id-keyed probe has no other way to learn", () => {
    expect(slugFromRateUrl("/jam/candyjam/rate/1287")).toBe("candyjam");
    expect(slugFromRateUrl("https://itch.io/jam/gmtk-2026/rate/999")).toBe("gmtk-2026");
  });

  test("returns null for anything that isn't a rate URL", () => {
    expect(slugFromRateUrl("/jam/candyjam")).toBeNull();
    expect(slugFromRateUrl("")).toBeNull();
  });
});

describe("nextSweepId", () => {
  const range = (over: Partial<SweepRange> = {}): SweepRange => ({
    from: 1,
    to: 1000,
    gapStart: 100,
    gapEnd: 200,
    ...over,
  });

  test("skips ids already held, which cost no request", () => {
    expect(nextSweepId(1, new Set([1, 2, 3]), range())).toBe(4);
  });

  test("jumps the barren band in one step instead of probing through it", () => {
    expect(nextSweepId(99, new Set(), range())).toBe(99);
    expect(nextSweepId(100, new Set(), range())).toBe(200);
    expect(nextSweepId(150, new Set(), range())).toBe(200);
  });

  test("sweeps the band when the gap is closed", () => {
    expect(nextSweepId(100, new Set(), range({ gapStart: 0, gapEnd: 0 }))).toBe(100);
  });

  test("stops at the frontier", () => {
    expect(nextSweepId(1000, new Set(), range())).toBe(1000);
    expect(nextSweepId(1001, new Set(), range())).toBeNull();
    // A tail of held ids ends the sweep rather than running past the frontier.
    expect(nextSweepId(999, new Set([999, 1000]), range())).toBeNull();
  });

  test("never resumes before the configured start", () => {
    expect(nextSweepId(1, new Set(), range({ from: 500 }))).toBe(500);
  });
});

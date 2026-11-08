import { describe, expect, it } from "vite-plus/test";

import { buildAtFrom, stampWins } from "../build-stamp";

describe("buildAtFrom", () => {
  it("reads digits, dates and positive numbers, and anything else as 0", () => {
    expect(buildAtFrom("1700000000000")).toBe(1_700_000_000_000);
    expect(buildAtFrom(" 1700000000000 ")).toBe(1_700_000_000_000);
    expect(buildAtFrom("2026-11-07T00:00:00Z")).toBe(Date.parse("2026-11-07T00:00:00Z"));
    expect(buildAtFrom(" 2026-11-07T00:00:00Z\n")).toBe(Date.parse("2026-11-07T00:00:00Z"));
    expect(buildAtFrom(42)).toBe(42);
    const junk = [undefined, null, "", "  ", "soon", -5, 0, Number.NaN, Infinity, {}];
    expect(junk.map(buildAtFrom)).toEqual(junk.map(() => 0));
  });
});

describe("stampWins", () => {
  const stamp = { hash: "b".repeat(64), buildAt: 100, engine: "0.0.0" };
  it("lets the later build win, then the larger hash", () => {
    expect(stampWins(101, "a".repeat(64), stamp)).toBe(true);
    expect(stampWins(99, "f".repeat(64), stamp)).toBe(false);
    expect(stampWins(100, "c".repeat(64), stamp)).toBe(true);
    expect(stampWins(100, "a".repeat(64), stamp)).toBe(false);
    expect(stampWins(100, stamp.hash, stamp), "a stamp never beats itself").toBe(false);
  });
});

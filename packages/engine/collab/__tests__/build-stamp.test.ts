import { describe, expect, it } from "vite-plus/test";

import { buildAtFrom, devPageBuildAt, stampWins } from "../build-stamp";

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

describe("devPageBuildAt", () => {
  const server = 1_700_000_000_000;
  const hash = (c: string) => c.repeat(64);

  it("is the page's load time, never earlier than the server's build", () => {
    expect(devPageBuildAt(String(server), server + 5_000)).toBe(server + 5_000);
    expect(devPageBuildAt(String(server), server - 5_000)).toBe(server);
    expect(devPageBuildAt(undefined, server)).toBe(server);
    expect(devPageBuildAt("junk", 0)).toBe(0);
  });

  it("lets a tab loaded later outrank an older tab of the same server, whatever the hashes", () => {
    const older = {
      hash: hash("f"),
      buildAt: devPageBuildAt(String(server), server + 1_000),
      engine: "0.0.0",
    };
    const fresh = devPageBuildAt(String(server), server + 60_000);
    expect(stampWins(fresh, hash("0"), older)).toBe(true);
    const freshStamp = { hash: hash("0"), buildAt: fresh, engine: "0.0.0" };
    expect(stampWins(older.buildAt, older.hash, freshStamp)).toBe(false);
    const reloaded = devPageBuildAt(String(server), server + 120_000);
    expect(
      stampWins(reloaded, hash("f"), freshStamp),
      "reloading the older tab brings it level",
    ).toBe(true);
  });

  it("still outranks the dev server's own stamp, one ms before its build", () => {
    const serverStamp = { hash: hash("f"), buildAt: server - 1, engine: "0.0.0" };
    expect(stampWins(devPageBuildAt(String(server), server), hash("0"), serverStamp)).toBe(true);
  });
});

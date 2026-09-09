import { describe, expect, it } from "vite-plus/test";

import { FP_ONE } from "../fixed.ts";
import { Rng, seedFromString } from "../rng.ts";

describe("Rng", () => {
  it("is reproducible from the same seed", () => {
    const a = Array.from({ length: 64 }, () => Rng.from("en-prison:2026-09-07").nextU32());
    const b = Array.from({ length: 64 }, () => Rng.from("en-prison:2026-09-07").nextU32());
    expect(a).toEqual(b);
  });

  it("diverges on a one-character seed change", () => {
    const a = Rng.from("seed-a");
    const b = Rng.from("seed-b");
    const left = Array.from({ length: 16 }, () => a.nextU32());
    const right = Array.from({ length: 16 }, () => b.nextU32());
    expect(left).not.toEqual(right);
  });

  it("emits uint32 values only", () => {
    const rng = Rng.from(1);
    for (let i = 0; i < 5000; i++) {
      const v = rng.nextU32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffff_ffff);
    }
  });

  it("resumes exactly from a snapshot", () => {
    const rng = Rng.from("resume");
    for (let i = 0; i < 40; i++) rng.nextU32();
    const state = rng.snapshot();
    const expected = Array.from({ length: 20 }, () => rng.nextU32());
    const resumed = Rng.restore(state);
    expect(Array.from({ length: 20 }, () => resumed.nextU32())).toEqual(expected);
  });

  it("clones without sharing state", () => {
    const rng = Rng.from("clone");
    const copy = rng.clone();
    rng.nextU32();
    expect(copy.snapshot()).not.toEqual(rng.snapshot());
  });

  it("gives each fork label its own stream", () => {
    const rng = Rng.from("fork");
    const scatter = rng.fork("scatter:ball-1").nextU32();
    const settle = rng.fork("settle:ball-1").nextU32();
    expect(scatter).not.toEqual(settle);
  });

  it("forks from the same parent state deterministically", () => {
    const one = Rng.from("fork").fork("drop:ball-1");
    const two = Rng.from("fork").fork("drop:ball-1");
    expect(one.nextU32()).toEqual(two.nextU32());
  });

  it("does not let a fork advance the parent", () => {
    const rng = Rng.from("fork");
    const before = rng.snapshot();
    rng.fork("anything").nextU32();
    expect(rng.snapshot()).toEqual(before);
  });

  describe("below", () => {
    it("stays inside the bound", () => {
      const rng = Rng.from("below");
      for (let i = 0; i < 2000; i++) {
        const v = rng.below(37);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(37);
      }
    });

    it("covers every value of a 37-pocket wheel", () => {
      const rng = Rng.from("coverage");
      const seen = new Set<number>();
      for (let i = 0; i < 5000; i++) seen.add(rng.below(37));
      expect(seen.size).toBe(37);
    });

    it("is roughly uniform", () => {
      const rng = Rng.from("uniform");
      const counts = new Array<number>(37).fill(0);
      const draws = 37 * 4000;
      for (let i = 0; i < draws; i++) counts[rng.below(37)]! += 1;
      const expected = draws / 37;
      for (const count of counts) {
        expect(Math.abs(count - expected)).toBeLessThan(expected * 0.15);
      }
    });

    it("refuses a non-positive or fractional bound", () => {
      const rng = Rng.from(1);
      expect(() => rng.below(0)).toThrow(RangeError);
      expect(() => rng.below(-4)).toThrow(RangeError);
      expect(() => rng.below(2.5)).toThrow(RangeError);
    });
  });

  describe("range", () => {
    it("includes both ends", () => {
      const rng = Rng.from("range");
      const seen = new Set<number>();
      for (let i = 0; i < 400; i++) seen.add(rng.range(-2, 2));
      expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
    });

    it("handles a single-value range", () => {
      expect(Rng.from("one").range(7, 7)).toBe(7);
    });

    it("refuses an inverted range", () => {
      expect(() => Rng.from(1).range(5, 1)).toThrow(RangeError);
    });
  });

  describe("chance", () => {
    it("short-circuits at both ends without drawing", () => {
      const rng = Rng.from("chance");
      const before = rng.snapshot();
      expect(rng.chance(0, FP_ONE)).toBe(false);
      expect(rng.chance(FP_ONE, FP_ONE)).toBe(true);
      expect(rng.chance(-1, FP_ONE)).toBe(false);
      expect(rng.chance(FP_ONE * 2, FP_ONE)).toBe(true);
      expect(rng.snapshot()).toEqual(before);
    });

    it("lands near its stated probability", () => {
      const rng = Rng.from("chance-rate");
      let hits = 0;
      for (let i = 0; i < 20_000; i++) if (rng.chance(FP_ONE / 4, FP_ONE)) hits += 1;
      expect(hits / 20_000).toBeGreaterThan(0.23);
      expect(hits / 20_000).toBeLessThan(0.27);
    });
  });

  describe("weighted", () => {
    it("never picks a zero weight", () => {
      const rng = Rng.from("weighted");
      for (let i = 0; i < 1000; i++) expect(rng.weighted([3, 0, 5])).not.toBe(1);
    });

    it("respects the weights", () => {
      const rng = Rng.from("weighted-rate");
      const counts = [0, 0, 0];
      for (let i = 0; i < 30_000; i++) counts[rng.weighted([1, 2, 7])]! += 1;
      expect(counts[2]! / 30_000).toBeGreaterThan(0.66);
      expect(counts[2]! / 30_000).toBeLessThan(0.74);
    });

    it("refuses an all-zero or negative table", () => {
      const rng = Rng.from(1);
      expect(() => rng.weighted([0, 0])).toThrow(RangeError);
      expect(() => rng.weighted([1, -1])).toThrow(RangeError);
      expect(() => rng.weighted([1, 0.5])).toThrow(RangeError);
    });
  });

  it("picks from a non-empty array and refuses an empty one", () => {
    const rng = Rng.from("pick");
    expect(["a", "b"]).toContain(rng.pick(["a", "b"]));
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});

describe("seedFromString", () => {
  it("is stable and distinguishes near-identical seeds", () => {
    expect(seedFromString("2026-09-07")).toBe(seedFromString("2026-09-07"));
    expect(seedFromString("2026-09-07")).not.toBe(seedFromString("2026-09-08"));
  });

  it("returns a uint32", () => {
    const h = seedFromString("en-prison");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffff_ffff);
  });

  it("does not collapse strings that differ only above the low byte", () => {
    // U+0100 and U+0000 share a low byte; only the high-byte round of the
    // hash separates them, and dropping it would collide seeds silently.
    expect(seedFromString(String.fromCharCode(0x0100))).not.toBe(
      seedFromString(String.fromCharCode(0x0000)),
    );
  });
});

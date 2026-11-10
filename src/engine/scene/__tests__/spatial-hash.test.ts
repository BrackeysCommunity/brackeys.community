import { describe, expect, it } from "vite-plus/test";

import { createSpatialHash } from "../spatial-hash";
import type { Aabb } from "../types";

const box = (minX: number, minY: number, maxX: number, maxY: number): Aabb => ({
  minX,
  minY,
  maxX,
  maxY,
});

const overlaps = (a: Aabb, b: Aabb) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** A seeded LCG, so the random cases are the same every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("createSpatialHash", () => {
  it("finds boxes that overlap the query, touching included", () => {
    const hash = createSpatialHash<string>();
    hash.insert("a", box(0, 0, 10, 10));
    hash.insert("b", box(300, 300, 320, 320));
    hash.insert("c", box(10, 10, 20, 20));
    expect(hash.query(box(5, 5, 6, 6))).toEqual(["a"]);
    expect(hash.query(box(10, 10, 10, 10))).toEqual(["a", "c"]);
    expect(hash.query(box(21, 21, 299, 299))).toEqual([]);
    expect(hash.query(box(-1000, -1000, 1000, 1000))).toEqual(["a", "b", "c"]);
    expect(hash.size).toBe(3);
  });

  it("answers in insertion order, whichever cells the hits come from", () => {
    const hash = createSpatialHash<number>(16);
    const order = [7, 3, 9, 1, 5];
    order.forEach((k, i) => hash.insert(k, box(100 - i * 20, 0, 104 - i * 20, 4)));
    expect(hash.query(box(0, 0, 200, 4))).toEqual(order);
    expect(hash.query(box(19, 0, 61, 4))).toEqual([9, 1, 5]);
  });

  it("keeps a key's place in the order when it moves", () => {
    const hash = createSpatialHash<string>(32);
    hash.insert("a", box(0, 0, 1, 1));
    hash.insert("b", box(100, 0, 101, 1));
    hash.update("a", box(200, 0, 201, 1));
    expect(hash.query(box(0, 0, 1, 1))).toEqual([]);
    expect(hash.query(box(0, 0, 300, 1))).toEqual(["a", "b"]);
    hash.insert("a", box(400, 0, 401, 1));
    expect(hash.query(box(0, 0, 500, 1))).toEqual(["a", "b"]);
    expect(hash.size).toBe(2);
  });

  it("removes, re-adds at the end of the order, and clears", () => {
    const hash = createSpatialHash<string>();
    hash.insert("a", box(0, 0, 1, 1));
    hash.insert("b", box(0, 0, 1, 1));
    hash.remove("a");
    hash.remove("missing");
    expect(hash.query(box(0, 0, 1, 1))).toEqual(["b"]);
    hash.insert("a", box(0, 0, 1, 1));
    expect(hash.query(box(0, 0, 1, 1))).toEqual(["b", "a"]);
    expect(hash.size).toBe(2);
    hash.clear();
    expect(hash.size).toBe(0);
    expect(hash.query(box(-1e9, -1e9, 1e9, 1e9))).toEqual([]);
  });

  it("does not keep a reference to the caller's box", () => {
    const hash = createSpatialHash<string>();
    const b = box(0, 0, 1, 1);
    hash.insert("a", b);
    b.minX = b.maxX = 5000;
    expect(hash.query(box(0, 0, 1, 1))).toEqual(["a"]);
  });

  it("keeps boxes too big for the grid on a list every query scans", () => {
    const hash = createSpatialHash<string>(1);
    hash.insert("huge", box(-1e6, -1e6, 1e6, 1e6));
    hash.insert("unbounded", box(-Infinity, 0, Infinity, 0));
    hash.insert("small", box(3, 3, 4, 4));
    expect(hash.query(box(3.5, 3.5, 3.5, 3.5))).toEqual(["huge", "small"]);
    expect(hash.query(box(-5e5, 0, -5e5, 0))).toEqual(["huge", "unbounded"]);
    hash.update("huge", box(10, 10, 11, 11));
    expect(hash.query(box(3.5, 3.5, 3.5, 3.5))).toEqual(["small"]);
    hash.remove("unbounded");
    expect(hash.query(box(-5e5, 0, -5e5, 0))).toEqual([]);
  });

  it("treats negative coordinates and cell edges like any other", () => {
    const hash = createSpatialHash<string>(256);
    hash.insert("neg", box(-300, -300, -257, -257));
    hash.insert("edge", box(256, 256, 256, 256));
    expect(hash.query(box(-257, -257, -256, -256))).toEqual(["neg"]);
    expect(hash.query(box(255, 255, 256, 256))).toEqual(["edge"]);
    expect(hash.query(box(-256, -256, 255, 255))).toEqual([]);
  });

  it("rejects a cell that isn't a positive number", () => {
    for (const cell of [0, -4, Number.NaN, Infinity])
      expect(() => createSpatialHash(cell)).toThrow(RangeError);
  });

  it("agrees with a brute-force scan through random inserts, moves and removals", () => {
    const rand = rng(76);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const randomBox = () => {
      const x = int(-2000, 2000);
      const y = int(-2000, 2000);
      const w = rand() < 0.05 ? int(20_000, 60_000) : int(0, 600);
      return box(x, y, x + w, y + int(0, 600));
    };
    for (const cell of [16, 64, 256]) {
      const hash = createSpatialHash<number>(cell);
      const model = new Map<number, Aabb>();
      for (let step = 0; step < 600; step++) {
        const roll = rand();
        const key = int(0, 80);
        if (roll < 0.5) {
          const b = randomBox();
          hash.insert(key, b);
          model.set(key, b);
        } else if (roll < 0.75) {
          if (!model.has(key)) continue;
          const b = randomBox();
          hash.update(key, b);
          model.set(key, b);
        } else {
          hash.remove(key);
          model.delete(key);
        }
        if (step % 10 !== 0) continue;
        const q = rand() < 0.1 ? box(-1e5, -1e5, 1e5, 1e5) : randomBox();
        const expected = [...model].filter(([, b]) => overlaps(b, q)).map(([k]) => k);
        expect(hash.query(q)).toEqual(expected);
        expect(hash.size).toBe(model.size);
      }
    }
  });
});

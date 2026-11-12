// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { flowField } from "../flow";
import { cellKey, gridGeometry, type Cell, type GridGeometry } from "../geometry";
import { findPath, type GridPathOptions } from "../path";

const SQUARE = gridGeometry({ kind: "square", cell: [16, 16] });
const HEX = gridGeometry({ kind: "hex", cell: [32, 28], side: 14, stagger: "y", index: "odd" });

/** A seeded generator (mulberry32), so a failure reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Walks `next` from `c` to a goal, checking that each step lowers the cost by what it costs. */
function descend(
  grid: GridGeometry,
  field: ReturnType<typeof flowField>,
  c: Cell,
  opts: GridPathOptions,
) {
  const walk: Cell[] = [c];
  let here = c;
  for (let guard = 0; guard < 10_000; guard++) {
    const next = field.next(here);
    if (next === undefined) break;
    expect(grid.neighbors(here, opts.diagonals).map(cellKey)).toContain(cellKey(next));
    const step = grid.stepCost(here, next) + (opts.cost?.(here, next) ?? 0);
    expect(field.cost(next)).toBe(field.cost(here)! - step);
    here = next;
    walk.push(here);
  }
  expect(field.cost(here)).toBe(0);
  return walk;
}

describe("flowField", () => {
  it("costs the nearest of several goals and leads downhill to it", () => {
    const bounds = { c0: 0, r0: 0, c1: 9, r1: 9 };
    const field = flowField(
      SQUARE,
      [
        [0, 0],
        [9, 9],
      ],
      { bounds },
    );
    expect(field.bounds).toEqual(bounds);
    expect(field.cost([0, 0])).toBe(0);
    expect(field.cost([9, 9])).toBe(0);
    expect(field.cost([2, 3])).toBe(50);
    expect(field.cost([8, 6])).toBe(40);
    expect(field.next([0, 0])).toBeUndefined();
    for (let c = 0; c <= 9; c++)
      for (let r = 0; r <= 9; r++) descend(SQUARE, field, [c, r], { bounds });
  });

  it("matches findPath's cost to the goal, with walls, tolls, diagonals and hexes", () => {
    const r = rng(9);
    for (let i = 0; i < 60; i++) {
      const grid = i % 3 === 2 ? HEX : SQUARE;
      const bounds = { c0: 0, r0: 0, c1: 8, r1: 7 };
      const walls = new Set<number>();
      for (let c = 0; c <= 8; c++)
        for (let rr = 0; rr <= 7; rr++) if (r() < 0.25) walls.add(cellKey([c, rr]));
      const goal: Cell = [Math.floor(r() * 9), Math.floor(r() * 8)];
      walls.delete(cellKey(goal));
      const opts: GridPathOptions = {
        bounds,
        passable: (c) => !walls.has(cellKey(c)),
        diagonals: r() < 0.5,
        cutCorners: r() < 0.5,
        cost: r() < 0.5 ? (a, b) => (a[0] + 2 * b[1]) % 5 : undefined,
      };
      const field = flowField(grid, [goal], opts);
      for (let c = 0; c <= 8; c++)
        for (let rr = 0; rr <= 7; rr++) {
          const p = findPath(grid, [c, rr], goal, opts);
          if (walls.has(cellKey([c, rr]))) {
            expect(field.cost([c, rr])).toBeUndefined();
            continue;
          }
          expect(field.cost([c, rr]), `map ${i} cell ${c},${rr}`).toBe(p?.cost);
          if (p !== null) descend(grid, field, [c, rr], opts);
          else expect(field.next([c, rr])).toBeUndefined();
        }
    }
  });

  it("leaves walled-off, out-of-bounds and too-dear cells unreachable", () => {
    const bounds = { c0: 0, r0: 0, c1: 6, r1: 2 };
    const passable = ([c]: Cell) => c !== 3;
    const field = flowField(SQUARE, [[0, 1]], { bounds, passable });
    expect(field.cost([2, 1])).toBe(20);
    for (const c of [
      [3, 1],
      [4, 1],
      [6, 0],
      [-1, 1],
      [0, 3],
    ] as Cell[]) {
      expect(field.cost(c)).toBeUndefined();
      expect(field.next(c)).toBeUndefined();
    }

    const near = flowField(SQUARE, [[0, 0]], { maxCost: 30 });
    expect(near.cost([3, 0])).toBe(30);
    expect(near.cost([4, 0])).toBeUndefined();
    expect(near.cost([2, 2])).toBeUndefined();
    expect(near.bounds).toEqual({ c0: -3, r0: -3, c1: 3, r1: 3 });

    const none = flowField(SQUARE, [[1, 1]], { passable: () => false });
    expect(none.cost([1, 1])).toBeUndefined();
    expect(none.bounds).toEqual({ c0: 0, r0: 0, c1: -1, r1: -1 });
  });

  it("breaks ties by neighbour order", () => {
    // From [2, 2] to [0, 0] without diagonals, north and west cost the same: north comes first.
    const field = flowField(SQUARE, [[0, 0]], { bounds: { c0: 0, r0: 0, c1: 4, r1: 4 } });
    expect(field.next([2, 2])).toEqual([2, 1]);
    const diag = flowField(SQUARE, [[0, 0]], {
      bounds: { c0: 0, r0: 0, c1: 4, r1: 4 },
      diagonals: true,
    });
    expect(diag.next([2, 2])).toEqual([1, 1]);
    expect(flowField(SQUARE, [[0, 0]], { maxExpanded: 5 }).cost([0, 3])).toBeUndefined();
  });
});

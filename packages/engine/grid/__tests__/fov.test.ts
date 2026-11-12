// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import type { GridSettings } from "../../scene/types";
import { fieldOfView, lineOfSight } from "../fov";
import { cellKey, gridGeometry, type Cell, type CellKey } from "../geometry";

const SQUARE: GridSettings = { kind: "square", cell: [16, 16] };
const HEXES: Record<string, GridSettings> = {
  "y odd": { kind: "hex", cell: [32, 28], side: 14, stagger: "y", index: "odd" },
  "y even": { kind: "hex", cell: [56, 64], side: 32, stagger: "y", index: "even" },
  "x odd": { kind: "hex", cell: [28, 32], side: 12, stagger: "x", index: "odd" },
  "x even": { kind: "hex", cell: [64, 56], side: 32, stagger: "x", index: "even" },
};

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

/** A `size` × `size` map with walls at `density`; everything outside it is a wall. */
function randomMap(seed: number, size: number, density: number) {
  const r = rng(seed);
  const walls = new Set<number>();
  const cells: Cell[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      cells.push([x, y]);
      if (r() < density) walls.add(cellKey([x, y]));
    }
  const opaque = ([x, y]: Cell) =>
    x < 0 || y < 0 || x >= size || y >= size || walls.has(cellKey([x, y]));
  return { cells, floors: cells.filter((c) => !opaque(c)), opaque };
}

const open = () => false;
const wallsAt =
  (...cells: Cell[]) =>
  (c: Cell) =>
    cells.some(([x, y]) => x === c[0] && y === c[1]);

describe("fieldOfView on squares", () => {
  const grid = gridGeometry(SQUARE);

  it("is symmetric between floor cells on random maps", () => {
    const broken: string[] = [];
    let seen = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { floors, opaque } = randomMap(seed, 17, 0.1 + (seed % 4) * 0.08);
      const fov = new Map(floors.map((c) => [cellKey(c), fieldOfView(grid, c, 9, opaque)]));
      for (const a of floors)
        for (const b of floors)
          if (fov.get(cellKey(a))!.has(cellKey(b)) !== fov.get(cellKey(b))!.has(cellKey(a)))
            broken.push(`seed ${seed}: ${a.join()} ↔ ${b.join()}`);
      seen += [...fov.values()].reduce((n, f) => n + f.size, 0);
    }
    expect(broken).toEqual([]);
    expect(seen).toBeGreaterThan(1000);
  });

  // ~0.3s alone; the explicit timeout covers a loaded CI runner sharing the suite.
  it("agrees with lineOfSight, which is symmetric between floors", { timeout: 30_000 }, () => {
    const broken: string[] = [];
    for (let seed = 20; seed <= 26; seed++) {
      const { cells, floors, opaque } = randomMap(seed, 15, 0.25);
      const lines = new Map<CellKey, Set<CellKey>>();
      for (const a of floors) {
        const fov = fieldOfView(grid, a, 15, opaque);
        const seen = new Set<CellKey>();
        for (const b of cells) {
          const sees = lineOfSight(grid, a, b, opaque);
          if (sees) seen.add(cellKey(b));
          if (sees !== fov.has(cellKey(b)))
            broken.push(`seed ${seed}: fov ${a.join()} → ${b.join()}`);
        }
        lines.set(cellKey(a), seen);
      }
      for (const a of floors)
        for (const b of floors)
          if (lines.get(cellKey(a))!.has(cellKey(b)) !== lines.get(cellKey(b))!.has(cellKey(a)))
            broken.push(`seed ${seed}: line ${a.join()} ↔ ${b.join()}`);
    }
    expect(broken).toEqual([]);
  });

  it("shows a wall and hides the cells behind it", () => {
    const fov = fieldOfView(grid, [0, 0], 8, wallsAt([3, 0]));
    expect(fov.has(cellKey([3, 0]))).toBe(true);
    for (const c of [
      [4, 0],
      [5, 0],
      [8, 0],
    ] as Cell[])
      expect(fov.has(cellKey(c)), `${c.join()}`).toBe(false);
    expect(fov.has(cellKey([2, 0]))).toBe(true);
    expect(lineOfSight(grid, [0, 0], [3, 0], wallsAt([3, 0]))).toBe(true);
    expect(lineOfSight(grid, [0, 0], [6, 0], wallsAt([3, 0]))).toBe(false);
  });

  it("sees a closed room's walls and nothing beyond", () => {
    const ring = (c: Cell) => Math.max(Math.abs(c[0]), Math.abs(c[1])) === 2;
    const fov = fieldOfView(grid, [0, 0], 10, ring);
    expect(fov.size).toBe(25);
    for (let y = -2; y <= 2; y++)
      for (let x = -2; x <= 2; x++) expect(fov.has(cellKey([x, y]))).toBe(true);
  });

  it("limits the view to radius steps", () => {
    expect([...fieldOfView(grid, [4, -3], 0, open)]).toEqual([cellKey([4, -3])]);
    const fov = fieldOfView(grid, [4, -3], 3, open);
    expect(fov.size).toBe(49);
    for (let y = -7; y <= 1; y++)
      for (let x = 0; x <= 8; x++)
        expect(fov.has(cellKey([x, y]))).toBe(grid.distance([4, -3], [x, y], true) <= 3);
    expect(fieldOfView(grid, [0, 0], 2.9, open).size).toBe(25);
  });

  it("sees out of an opaque origin", () => {
    expect(fieldOfView(grid, [0, 0], 1, wallsAt([0, 0])).size).toBe(9);
  });

  it("gives one answer, in one order", () => {
    const { opaque } = randomMap(99, 20, 0.3);
    expect([...fieldOfView(grid, [9, 9], 12, opaque)]).toEqual([
      ...fieldOfView(grid, [9, 9], 12, opaque),
    ]);
  });

  it("refuses a radius that isn't finite and non-negative", () => {
    for (const r of [-1, Number.NaN, Infinity])
      expect(() => fieldOfView(grid, [0, 0], r, open)).toThrow(RangeError);
  });
});

describe.each(Object.entries(HEXES))("fieldOfView on hexes (%s)", (_name, settings) => {
  const grid = gridGeometry(settings);

  it("is symmetric on random maps, and agrees with lineOfSight", () => {
    const broken: string[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const { cells, opaque } = randomMap(seed, 13, 0.25);
      const fov = new Map(cells.map((c) => [cellKey(c), fieldOfView(grid, c, 7, opaque)]));
      for (const a of cells)
        for (const b of cells) {
          const sees = fov.get(cellKey(a))!.has(cellKey(b));
          if (sees !== fov.get(cellKey(b))!.has(cellKey(a)))
            broken.push(`seed ${seed}: ${a.join()} ↔ ${b.join()}`);
          if (grid.distance(a, b) <= 7 && lineOfSight(grid, a, b, opaque) !== sees)
            broken.push(`seed ${seed}: line ${a.join()} → ${b.join()}`);
        }
    }
    expect(broken).toEqual([]);
  });

  it("shows a wall and hides the cells behind it", () => {
    const origin: Cell = [4, 4];
    let far = origin;
    const line: Cell[] = [origin];
    for (let i = 0; i < 5; i++) line.push((far = grid.neighbors(far)[1]!));
    const wall = line[2]!;
    const fov = fieldOfView(grid, origin, 6, wallsAt(wall));
    expect(fov.has(cellKey(line[1]!))).toBe(true);
    expect(fov.has(cellKey(wall))).toBe(true);
    for (const c of line.slice(3)) expect(fov.has(cellKey(c)), `${c.join()}`).toBe(false);
  });

  it("limits the view to radius steps", () => {
    const origin: Cell = [3, 5];
    expect(fieldOfView(grid, origin, 0, open).size).toBe(1);
    const fov = fieldOfView(grid, origin, 3, open);
    expect(fov.size).toBe(37);
    for (let y = -2; y <= 12; y++)
      for (let x = -4; x <= 10; x++)
        expect(fov.has(cellKey([x, y]))).toBe(grid.distance(origin, [x, y]) <= 3);
  });
});

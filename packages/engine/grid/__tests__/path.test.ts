// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import type { GridSettings } from "../../scene/types";
import { cellKey, gridGeometry, type Cell, type CellBounds, type GridGeometry } from "../geometry";
import { findPath, type GridPathOptions } from "../path";

const SQUARE = gridGeometry({ kind: "square", cell: [16, 16] });
const HEX_SETTINGS: GridSettings[] = [
  { kind: "hex", cell: [32, 28], side: 14, stagger: "y", index: "odd" },
  { kind: "hex", cell: [28, 32], side: 12, stagger: "x", index: "even" },
];

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

type Map2 = { bounds: CellBounds; passable: (c: Cell) => boolean; find(ch: string): Cell };

/** Rows of text: `#` is a wall, anything else open; letters mark cells to look up. */
function parse(rows: string[]): Map2 {
  const bounds = { c0: 0, r0: 0, c1: rows[0]!.length - 1, r1: rows.length - 1 };
  return {
    bounds,
    passable: ([c, r]) => rows[r]?.[c] !== undefined && rows[r]![c] !== "#",
    find(ch) {
      const r = rows.findIndex((row) => row.includes(ch));
      return [rows[r]!.indexOf(ch), r];
    },
  };
}

/**
 * The cheapest cost from `from` to `to` by plain Dijkstra with a linear scan,
 * written from the step rules rather than from `grid/path.ts`.
 */
function dijkstra(
  grid: GridGeometry,
  from: Cell,
  to: Cell,
  bounds: CellBounds,
  passable: (c: Cell) => boolean,
  diagonals: boolean,
  cutCorners: boolean,
  extra: (a: Cell, b: Cell) => number | null,
): number | null {
  const inside = (c: Cell) =>
    c[0] >= bounds.c0 && c[0] <= bounds.c1 && c[1] >= bounds.r0 && c[1] <= bounds.r1;
  const ok = (c: Cell) => inside(c) && passable(c);
  if (!ok(to) && cellKey(from) !== cellKey(to)) return null;
  const dist = new Map<number, number>([[cellKey(from), 0]]);
  const at = new Map<number, Cell>([[cellKey(from), from]]);
  const done = new Set<number>();
  for (;;) {
    let k = -1;
    let d = Infinity;
    for (const [key, v] of dist) if (!done.has(key) && v < d) [k, d] = [key, v];
    if (k === -1) return null;
    if (k === cellKey(to)) return d;
    done.add(k);
    const a = at.get(k)!;
    for (const b of grid.neighbors(a, diagonals)) {
      if (!ok(b)) continue;
      const diag = grid.settings.kind === "square" && a[0] !== b[0] && a[1] !== b[1];
      if (diag && !cutCorners && !(ok([b[0], a[1]]) && ok([a[0], b[1]]))) continue;
      const e = extra(a, b);
      if (e === null) continue;
      const nd = d + (diag ? 14 : 10) + e;
      const kb = cellKey(b);
      if (nd < (dist.get(kb) ?? Infinity)) {
        dist.set(kb, nd);
        at.set(kb, b);
      }
    }
  }
}

/** Every step joins neighbours, obeys the map, and the steps add up to the reported cost. */
function expectValid(
  grid: GridGeometry,
  cells: readonly Cell[],
  cost: number,
  opts: GridPathOptions & { bounds: CellBounds; passable: (c: Cell) => boolean },
) {
  let total = 0;
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1]!;
    const b = cells[i]!;
    expect(grid.neighbors(a, opts.diagonals).map(cellKey)).toContain(cellKey(b));
    expect(opts.passable(b)).toBe(true);
    total += grid.stepCost(a, b) + (opts.cost?.(a, b) ?? 0);
  }
  expect(total).toBe(cost);
}

describe("findPath", () => {
  it("crosses an open field at the octile distance, the same way every time", () => {
    const bounds = { c0: 0, r0: 0, c1: 9, r1: 9 };
    const straight = findPath(SQUARE, [0, 0], [9, 0], { bounds });
    expect(straight?.cost).toBe(90);
    expect(straight?.cells).toHaveLength(10);

    const opts = { bounds, diagonals: true };
    const p = findPath(SQUARE, [0, 0], [7, 3], opts)!;
    expect(p.cost).toBe(3 * 14 + 4 * 10);
    expectValid(SQUARE, p.cells, p.cost, { ...opts, passable: () => true });
    expect(p.cells[0]).toEqual([0, 0]);
    expect(p.cells.at(-1)).toEqual([7, 3]);
    expect(findPath(SQUARE, [0, 0], [7, 3], opts)).toEqual(p);
    // A straight heuristic line: (f, h) ties expand toward the goal, so few cells open.
    expect(p.expanded).toBeLessThan(20);
  });

  it("is unbounded without bounds or passable, and a cell to itself costs nothing", () => {
    expect(findPath(SQUARE, [-50, 3], [50, 3])?.cost).toBe(1000);
    expect(findPath(SQUARE, [4, 4], [4, 4])).toEqual({ cells: [[4, 4]], cost: 0, expanded: 0 });
  });

  it("threads a maze", () => {
    const maze = parse([
      "S..#......",
      "##.#.####.",
      "...#.#....",
      ".###.#.###",
      "...#.#...G",
      "##.#.###.#",
      "...#.....#",
      ".#######.#",
      "..........",
    ]);
    const opts = { bounds: maze.bounds, passable: maze.passable };
    const from = maze.find("S");
    const to = maze.find("G");
    const p = findPath(SQUARE, from, to, opts)!;
    expect(p).not.toBeNull();
    expectValid(SQUARE, p.cells, p.cost, opts);
    expect(p.cost).toBe(
      dijkstra(SQUARE, from, to, maze.bounds, maze.passable, false, false, () => 0),
    );
  });

  it("returns null with no path, an impassable goal or too few expansions", () => {
    const walled = parse(["S.#..", "..#.G", "..#.."]);
    const opts = { bounds: walled.bounds, passable: walled.passable };
    expect(findPath(SQUARE, walled.find("S"), walled.find("G"), opts)).toBeNull();
    expect(findPath(SQUARE, [0, 0], [2, 0], opts)).toBeNull();
    expect(findPath(SQUARE, [0, 0], [9, 0], opts)).toBeNull();
    expect(findPath(SQUARE, [0, 0], [40, 0], { maxExpanded: 10 })).toBeNull();
    expect(findPath(SQUARE, [0, 0], [40, 0], { maxExpanded: 40 })?.cost).toBe(400);
  });

  it("treats a null cost as impassable and adds the rest to each step", () => {
    const bounds = { c0: 0, r0: 0, c1: 4, r1: 2 };
    const toll = (_: Cell, [c, r]: Cell) => (r === 1 && c === 2 ? null : r === 0 ? 5 : 0);
    const p = findPath(SQUARE, [0, 1], [4, 1], { bounds, cost: toll })!;
    // Around the closed cell through row 2, which carries no toll: 6 steps.
    expect(p.cost).toBe(60);
    expect(p.cells.map(cellKey)).not.toContain(cellKey([2, 1]));
    expect(() => findPath(SQUARE, [0, 0], [3, 0], { cost: () => 0.5 })).toThrow(RangeError);
    expect(() => findPath(SQUARE, [0, 0], [3, 0], { cost: () => -1 })).toThrow(RangeError);
  });

  it("cuts corners only when asked", () => {
    const pinch = parse(["S#", "#G"]);
    const base = { bounds: pinch.bounds, passable: pinch.passable, diagonals: true };
    expect(findPath(SQUARE, [0, 0], [1, 1], base)).toBeNull();
    expect(findPath(SQUARE, [0, 0], [1, 1], { ...base, cutCorners: true })?.cost).toBe(14);

    const corner = parse(["S#", ".G"]);
    const one = { bounds: corner.bounds, passable: corner.passable, diagonals: true };
    expect(findPath(SQUARE, [0, 0], [1, 1], one)?.cells).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(findPath(SQUARE, [0, 0], [1, 1], { ...one, cutCorners: true })?.cells).toEqual([
      [0, 0],
      [1, 1],
    ]);
    // Without diagonals the option changes nothing.
    expect(
      findPath(SQUARE, [0, 0], [1, 1], { ...one, diagonals: false, cutCorners: true })?.cost,
    ).toBe(20);
  });

  it.each(HEX_SETTINGS.map((s) => [`stagger ${s.kind === "hex" ? s.stagger : ""}`, s] as const))(
    "walks hexes at ten per step (%s)",
    (_, settings) => {
      const hex = gridGeometry(settings);
      const bounds = { c0: -6, r0: -6, c1: 6, r1: 6 };
      for (const to of [
        [5, 0],
        [0, 5],
        [-4, 3],
        [3, -5],
      ] as Cell[]) {
        const p = findPath(hex, [0, 0], to, { bounds })!;
        expect(p.cost).toBe(10 * hex.distance([0, 0], to));
        expectValid(hex, p.cells, p.cost, { bounds, passable: () => true });
      }
      // A wall across column 2 but its last cell forces the long way round.
      const passable = ([c, r]: Cell) => c !== 2 || r === 6;
      const p = findPath(hex, [0, 0], [4, 0], { bounds, passable })!;
      expectValid(hex, p.cells, p.cost, { bounds, passable });
      expect(p.cost).toBe(dijkstra(hex, [0, 0], [4, 0], bounds, passable, false, false, () => 0));
      expect(p.cost).toBeGreaterThan(40);
    },
  );

  it("matches Dijkstra's optimal cost on 1,000 random maps", () => {
    const r = rng(54);
    const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
    const hexes = HEX_SETTINGS.map(gridGeometry);
    for (let i = 0; i < 1000; i++) {
      const grid = i % 4 === 3 ? hexes[i % 2]! : SQUARE;
      const w = int(3, 12);
      const h = int(3, 12);
      const bounds = { c0: 0, r0: 0, c1: w - 1, r1: h - 1 };
      const density = r() * 0.4;
      const walls = new Set<number>();
      for (let c = 0; c < w; c++)
        for (let rr = 0; rr < h; rr++) if (r() < density) walls.add(cellKey([c, rr]));
      const passable = (c: Cell) => !walls.has(cellKey(c));
      const tolls = new Map<number, number | null>();
      const weighted = r() < 0.5;
      const extra = (_: Cell, b: Cell) => {
        if (!weighted) return 0;
        const k = cellKey(b);
        if (!tolls.has(k))
          tolls.set(k, ((k * 2654435761) >>> 0) % 13 === 0 ? null : ((k * 40503) >>> 0) % 7);
        return tolls.get(k)!;
      };
      const diagonals = r() < 0.5;
      const cutCorners = r() < 0.5;
      const from: Cell = [int(0, w - 1), int(0, h - 1)];
      const to: Cell = [int(0, w - 1), int(0, h - 1)];
      walls.delete(cellKey(from));
      if (r() < 0.9) walls.delete(cellKey(to));
      const opts = { bounds, passable, diagonals, cutCorners, cost: weighted ? extra : undefined };
      const p = findPath(grid, from, to, opts);
      const want = dijkstra(grid, from, to, bounds, passable, diagonals, cutCorners, extra);
      expect(p?.cost ?? null, `map ${i}`).toBe(want);
      if (p !== null) {
        expectValid(grid, p.cells, p.cost, opts);
        expect(findPath(grid, from, to, opts)).toEqual(p);
      }
    }
  });

  it("gives one answer per input, whatever the call order", () => {
    const bounds = { c0: 0, r0: 0, c1: 7, r1: 7 };
    const opts = { bounds, diagonals: true };
    const first = findPath(SQUARE, [0, 0], [7, 5], opts);
    for (let i = 0; i < 5; i++) findPath(SQUARE, [i, 7], [7 - i, 0], opts);
    expect(findPath(SQUARE, [0, 0], [7, 5], { ...opts })).toEqual(first);
    // Ties are broken by (f, h, insertion) in neighbour order: this is the pinned answer.
    expect(findPath(SQUARE, [0, 0], [3, 2], { bounds })).toEqual({
      cells: [
        [0, 0],
        [1, 0],
        [2, 0],
        [2, 1],
        [3, 1],
        [3, 2],
      ],
      cost: 50,
      expanded: 7,
    });
  });
});

import { describe, expect, test } from "vite-plus/test";

import type { CellBounds } from "../../grid/geometry";
import { encodeRow, GRID_CHUNK, type GridCells } from "../../scene/grid";
import type { Pt } from "../../scene/types";
import { decodeChunks, DEFAULT_TILE_COST, dirtyChunks, mergesAsBox, tileTraits } from "../chunks";
import { chunkRects, greedyBoxes, outlineChains } from "../colliders";

type Solid = (c: number, r: number) => boolean;

/** A seeded LCG, so every run sees the same fields. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomField(seed: number, w: number, h: number, density = 0.45): Solid {
  const next = rng(seed);
  const cells = new Set<number>();
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) if (next() < density) cells.add(r * w + c);
  return (c, r) => c >= 0 && r >= 0 && c < w && r < h && cells.has(r * w + c);
}

const chunkOf = (n: number) => Math.floor(n / GRID_CHUNK);

function coverCount(boxes: readonly CellBounds[], c: number, r: number) {
  return boxes.filter((b) => c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1).length;
}

/** Even-odd test at the cell's centre, on doubled coordinates so it stays integer. */
function insideChains(chains: readonly Pt[][], c: number, r: number): boolean {
  const px = 2 * c + 1;
  const py = 2 * r + 1;
  let inside = false;
  for (const chain of chains)
    for (let i = 0; i < chain.length; i++) {
      const a = chain[i]!;
      const b = chain[(i + 1) % chain.length]!;
      const ay = 2 * a[1];
      const by = 2 * b[1];
      if (ay > py === by > py) continue;
      const x = 2 * a[0] + ((py - ay) * (2 * b[0] - 2 * a[0])) / (by - ay);
      if (px < x) inside = !inside;
    }
  return inside;
}

/** A maze of `cell`-tile cells with `wall`-tile walls on their top and left sides, carved by DFS. */
function maze(size: number, cell: number, wall: number): Solid {
  const n = Math.ceil(size / cell);
  const next = rng(7);
  const openE = new Set<number>();
  const openS = new Set<number>();
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length > 0) {
    const at = stack[stack.length - 1]!;
    const x = at % n;
    const y = (at - x) / n;
    const options = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ].filter(([nx, ny]) => nx! >= 0 && ny! >= 0 && nx! < n && ny! < n && !seen.has(ny! * n + nx!));
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const [nx, ny] = options[Math.floor(next() * options.length)]!;
    const to = ny! * n + nx!;
    if (nx !== x) openE.add(Math.min(at, to));
    else openS.add(Math.min(at, to));
    seen.add(to);
    stack.push(to);
  }
  return (c, r) => {
    if (c < 0 || r < 0 || c >= size || r >= size) return false;
    if (c >= size - wall || r >= size - wall) return true;
    const x = Math.floor(c / cell);
    const y = Math.floor(r / cell);
    const lc = c - x * cell;
    const lr = r - y * cell;
    if (lc < wall && lr < wall) return true;
    if (lr < wall) return y === 0 || !openS.has((y - 1) * n + x);
    if (lc < wall) return x === 0 || !openE.has(y * n + x - 1);
    return false;
  };
}

describe("tileTraits", () => {
  test("empty and undefined tiles are open at the default cost", () => {
    expect(tileTraits(undefined)).toEqual({
      solid: false,
      oneWay: null,
      cost: DEFAULT_TILE_COST,
      shapes: null,
    });
    expect(tileTraits({ id: 3, cost: 25 }).cost).toBe(25);
  });
  test("solid tiles wall the grid and keep their one-way side and shapes", () => {
    const wall = tileTraits({ id: 1, solid: true, cost: 40 });
    expect(wall).toEqual({ solid: true, oneWay: null, cost: null, shapes: null });
    expect(mergesAsBox(wall)).toBe(true);
    const ledge = tileTraits({ id: 2, solid: true, oneWay: "up" });
    expect(ledge.oneWay).toBe("up");
    expect(mergesAsBox(ledge)).toBe(false);
    const slope = tileTraits({ id: 4, solid: true, shapes: [["poly", 0, 16, 16, 0, 16, 16]] });
    expect(slope.shapes).toEqual([["poly", 0, 16, 16, 0, 16, 16]]);
    expect(mergesAsBox(slope)).toBe(false);
    expect(tileTraits({ id: 5, oneWay: "up" }).oneWay).toBeNull();
  });
});

describe("chunks", () => {
  const row = (values: number[]) => encodeRow(values);
  test("decodeChunks skips empty chunks and orders row-major", () => {
    const cells: GridCells = {
      "1,0": [row([0, 2])],
      "0,1": [row([5])],
      "0,0": [],
      "-1,0": ["", row([1])],
    };
    const decoded = decodeChunks(cells);
    expect(decoded.map((c) => c.key)).toEqual(["-1,0", "1,0", "0,1"]);
    expect(decoded[0]!.values[GRID_CHUNK]).toBe(1);
    expect(decoded[1]!.values[1]).toBe(2);
  });
  test("dirtyChunks finds changed chunks, ignoring trailing empty rows", () => {
    const prev: GridCells = { "0,0": [row([1])], "1,0": [row([2])], "2,0": [row([3])] };
    const next: GridCells = { "0,0": [row([1]), ""], "1,0": [row([4])], "3,3": [row([1])] };
    expect(dirtyChunks(prev, next)).toEqual(["1,0", "2,0", "3,3"]);
    expect(dirtyChunks(prev, prev)).toEqual([]);
  });
});

describe("greedyBoxes", () => {
  const rect: CellBounds = { c0: -20, r0: -10, c1: 90, r1: 70 };
  test.each([1, 2, 3, 4])(
    "cover exactly the solid cells and never span chunks (seed %i)",
    (seed) => {
      const solid = randomField(seed, 80, 70);
      const boxes = greedyBoxes(solid, rect);
      for (const b of boxes) {
        expect(chunkOf(b.c0)).toBe(chunkOf(b.c1));
        expect(chunkOf(b.r0)).toBe(chunkOf(b.r1));
      }
      for (let r = rect.r0; r <= rect.r1; r++)
        for (let c = rect.c0; c <= rect.c1; c++)
          expect(coverCount(boxes, c, r)).toBe(solid(c, r) ? 1 : 0);
    },
  );
  test("a solid square inside one chunk is one box; across chunks one per chunk", () => {
    expect(greedyBoxes(() => true, { c0: 0, r0: 0, c1: 31, r1: 31 })).toEqual([
      { c0: 0, r0: 0, c1: 31, r1: 31 },
    ]);
    expect(greedyBoxes(() => true, { c0: 16, r0: 16, c1: 47, r1: 47 })).toHaveLength(4);
    expect(chunkRects({ c0: 16, r0: 16, c1: 47, r1: 47 })[1]).toEqual({
      c0: 32,
      r0: 16,
      c1: 47,
      r1: 31,
    });
  });
  test("results are deterministic", () => {
    const solid = randomField(9, 64, 64);
    const rect64 = { c0: 0, r0: 0, c1: 63, r1: 63 };
    expect(JSON.stringify(greedyBoxes(solid, rect64))).toBe(
      JSON.stringify(greedyBoxes(solid, rect64)),
    );
    expect(JSON.stringify(outlineChains(solid, rect64))).toBe(
      JSON.stringify(outlineChains(solid, rect64)),
    );
  });
  // Walls off chunk edges split at every chunk they cross, so finer mazes earn a looser bound.
  test.each([
    [32, 4, 4],
    [12, 2, 8],
    [7, 1, 20],
  ])(
    "a 512 × 512 maze of %i-tile cells and %i-tile walls averages at most %i colliders per chunk",
    (cell, wall, bound) => {
      const size = 512;
      const boxes = greedyBoxes(maze(size, cell, wall), {
        c0: 0,
        r0: 0,
        c1: size - 1,
        r1: size - 1,
      });
      const chunks = (size / GRID_CHUNK) ** 2;
      expect(boxes.length / chunks).toBeLessThanOrEqual(bound);
      expect(boxes.length).toBeGreaterThan(chunks);
    },
  );
});

describe("outlineChains", () => {
  test.each([1, 2, 3])("enclose exactly the solid regions (seed %i)", (seed) => {
    const solid = randomField(seed, 70, 60, 0.5);
    const rect: CellBounds = { c0: -4, r0: -4, c1: 70, r1: 64 };
    const chains = outlineChains(solid, rect);
    for (const chain of chains) {
      expect(chain.length).toBeGreaterThanOrEqual(4);
      for (const p of chain) expect(Number.isInteger(p[0]) && Number.isInteger(p[1])).toBe(true);
    }
    for (const b of chunkRects(rect)) {
      const own = chains.filter((ch) =>
        ch.every((p) => p[0] >= b.c0 && p[0] <= b.c1 + 1 && p[1] >= b.r0 && p[1] <= b.r1 + 1),
      );
      for (let r = b.r0; r <= b.r1; r++)
        for (let c = b.c0; c <= b.c1; c++) expect(insideChains(own, c, r)).toBe(solid(c, r));
    }
  });
  test("a ring is an outer chain and a hole; corner-touching cells stay separate", () => {
    const ring: Solid = (c, r) =>
      c >= 0 && c < 5 && r >= 0 && r < 5 && !(c >= 1 && c <= 3 && r >= 1 && r <= 3);
    expect(outlineChains(ring, { c0: 0, r0: 0, c1: 4, r1: 4 })).toEqual([
      [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 5],
      ],
      [
        [1, 1],
        [1, 4],
        [4, 4],
        [4, 1],
      ],
    ]);
    const diag: Solid = (c, r) => (c === 0 && r === 0) || (c === 1 && r === 1);
    expect(outlineChains(diag, { c0: 0, r0: 0, c1: 1, r1: 1 })).toHaveLength(2);
  });
});

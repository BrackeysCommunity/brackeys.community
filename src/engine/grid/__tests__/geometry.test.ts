// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { gridCellOutline } from "../../scene/render-geometry";
import type { GridSettings, Pt, ShapeObj } from "../../scene/types";
import { cellKey, cellOf, gridGeometry, type Cell } from "../geometry";

const SQUARE: GridSettings = { kind: "square", cell: [32, 24], origin: [-40, 16] };
const HEXES: Record<string, GridSettings> = {
  "y odd": { kind: "hex", cell: [32, 28], side: 14, stagger: "y", index: "odd", origin: [8, -4] },
  "y even": { kind: "hex", cell: [56, 64], side: 32, stagger: "y", index: "even" },
  "x odd": { kind: "hex", cell: [28, 32], side: 12, stagger: "x", index: "odd", origin: [-6, 10] },
  "x even": { kind: "hex", cell: [64, 56], side: 32, stagger: "x", index: "even" },
};
const ALL: Record<string, GridSettings> = { square: SQUARE, ...HEXES };

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
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

/**
 * Where Tiled draws a tile's centre, written from its renderers and not from
 * `grid/geometry.ts`: `OrthogonalRenderer::tileToScreenCoords` is
 * (x · tileWidth, y · tileHeight); `HexagonalRenderer::tileToScreenCoords`
 * (src/libtiled/hexagonalrenderer.cpp) uses its `RenderParams`
 * (sideLengthX/Y is hexSideLength along the stagger axis, else 0;
 * sideOffsetX/Y = (tileWidth/Height − sideLengthX/Y) / 2; columnWidth =
 * sideOffsetX + sideLengthX; rowHeight = sideOffsetY + sideLengthY) and
 * `doStaggerX/Y(i)` = (i & 1) XOR staggerEven:
 *
 *   staggerX: px = x · columnWidth;  py = y · (tileHeight + sideLengthY) + (doStaggerX(x) ? rowHeight : 0)
 *   staggerY: px = x · (tileWidth + sideLengthX) + (doStaggerY(y) ? columnWidth : 0);  py = y · rowHeight
 *
 * That is the tile's top-left; its centre is half a tile in, and the map's
 * origin shifts it all.
 */
function tiledCentre(s: GridSettings, [x, y]: Cell): Pt {
  const [tileWidth, tileHeight] = s.cell;
  const [ox, oy] = s.origin ?? [0, 0];
  if (s.kind === "square")
    return [ox + x * tileWidth + tileWidth / 2, oy + y * tileHeight + tileHeight / 2];
  const staggerX = s.stagger === "x";
  const staggerEven = s.index === "even" ? 1 : 0;
  const sideLengthX = staggerX ? s.side : 0;
  const sideLengthY = staggerX ? 0 : s.side;
  const sideOffsetX = Math.trunc((tileWidth - sideLengthX) / 2);
  const sideOffsetY = Math.trunc((tileHeight - sideLengthY) / 2);
  const columnWidth = sideOffsetX + sideLengthX;
  const rowHeight = sideOffsetY + sideLengthY;
  const doStagger = (i: number) => ((i & 1) ^ staggerEven) === 1;
  let px: number;
  let py: number;
  if (staggerX) {
    py = y * (tileHeight + sideLengthY) + (doStagger(x) ? rowHeight : 0);
    px = x * columnWidth;
  } else {
    px = x * (tileWidth + sideLengthX) + (doStagger(y) ? columnWidth : 0);
    py = y * rowHeight;
  }
  return [ox + px + tileWidth / 2, oy + py + tileHeight / 2];
}

/** The cell whose Tiled centre is nearest `p`, searched over a wide window: how Tiled's hexagonal renderer picks a tile. */
function nearestTiled(s: GridSettings, [px, py]: Pt): Cell {
  const [w, h] = s.cell;
  const [ox, oy] = s.origin ?? [0, 0];
  const c = Math.floor((px - ox) / w);
  const r = Math.floor((py - oy) / h);
  let best: Cell = [c, r];
  let bestD = Infinity;
  for (let dc = -16; dc <= 16; dc++)
    for (let dr = -16; dr <= 16; dr++) {
      const cell: Cell = [c + dc, r + dr];
      const [x, y] = tiledCentre(s, cell);
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = cell;
      }
    }
  return best;
}

describe("cell keys", () => {
  it("packs a cell into one number and back, to the edges of the range", () => {
    const lim = 2 ** 20;
    for (const c of [
      [0, 0],
      [-1, 1],
      [7, -3],
      [-lim, -lim],
      [lim - 1, lim - 1],
      [-lim, lim - 1],
    ] as Cell[]) {
      expect(cellOf(cellKey(c))).toEqual(c);
    }
    expect(cellKey([0, 0])).toBe(2 ** 20 * 2 ** 21 + 2 ** 20);
    expect(new Set([cellKey([1, 0]), cellKey([0, 1]), cellKey([0, -1])]).size).toBe(3);
    for (const c of [
      [lim, 0],
      [0, -lim - 1],
      [0.5, 0],
      [Number.NaN, 0],
    ] as Cell[])
      expect(() => cellKey(c)).toThrow(RangeError);
  });
});

describe("centres and cellAt against Tiled's renderers", () => {
  for (const [name, settings] of Object.entries(ALL)) {
    it(`${name}: every centre in a block around the origin is where Tiled draws it`, () => {
      const g = gridGeometry(settings);
      for (let col = -5; col <= 5; col++)
        for (let row = -5; row <= 5; row++) {
          expect(g.center([col, row]), `${col},${row}`).toEqual(tiledCentre(settings, [col, row]));
          expect(g.cellAt(tiledCentre(settings, [col, row]))).toEqual([col, row]);
        }
    });

    it(`${name}: cellAt picks the cell whose centre is nearest, as Tiled does`, () => {
      const g = gridGeometry(settings);
      const r = rng(17);
      const [w, h] = settings.cell;
      for (let i = 0; i < 2000; i++) {
        const p: Pt = [(r() - 0.5) * 40 * w, (r() - 0.5) * 40 * h];
        const got = g.cellAt(p);
        if (settings.kind === "square") {
          const [ox, oy] = settings.origin ?? [0, 0];
          expect(got).toEqual([Math.floor((p[0] - ox) / w), Math.floor((p[1] - oy) / h)]);
        } else expect(got, p.join(",")).toEqual(nearestTiled(settings, p));
      }
    });
  }

  it("cellAt(center(c)) is c for 10,000 random cells on each grid", () => {
    for (const settings of Object.values(ALL)) {
      const g = gridGeometry(settings);
      const r = rng(5);
      for (let i = 0; i < 10_000; i++) {
        const span = i % 10 === 0 ? 2 ** 19 : 3000;
        const c: Cell = [int(r, -span, span), int(r, -span, span)];
        const back = g.cellAt(g.center(c));
        if (back[0] !== c[0] || back[1] !== c[1]) expect(back).toEqual(c);
      }
    }
  });

  it("puts a point on a square's edge in the higher cell, and never answers -0", () => {
    const g = gridGeometry({ kind: "square", cell: [10, 10] });
    expect(g.cellAt([10, 0])).toEqual([1, 0]);
    expect(g.cellAt([-0.5, -0])).toEqual([-1, 0]);
    expect(Object.is(g.cellAt([-0, 3])[0], 0)).toBe(true);
  });

  it("outlines a cell exactly as the editor's grid overlay does", () => {
    for (const settings of Object.values(ALL)) {
      const g = gridGeometry(settings);
      for (const c of [
        [0, 0],
        [3, -2],
        [-1, 5],
        [2, 7],
      ] as Cell[]) {
        expect(g.corners(c)).toEqual(
          gridCellOutline(settings, settings.origin ?? [0, 0], c[0], c[1]),
        );
        const [cx, cy] = g.center(c);
        const pts = g.corners(c);
        const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        expect([mx, my]).toEqual([cx, cy]);
      }
    }
  });
});

describe("neighbours", () => {
  it("lists a square's edges N, E, S, W, then the diagonals NE, SE, SW, NW", () => {
    const g = gridGeometry(SQUARE);
    expect(g.neighbors([3, 4])).toEqual([
      [3, 3],
      [4, 4],
      [3, 5],
      [2, 4],
    ]);
    expect(g.neighbors([3, 4], true)).toEqual([
      [3, 3],
      [4, 4],
      [3, 5],
      [2, 4],
      [4, 3],
      [4, 5],
      [2, 5],
      [2, 3],
    ]);
  });

  const expected: Record<string, [Cell, Cell[]][]> = {
    "y odd": [
      [
        [2, 2],
        [
          [2, 1],
          [3, 2],
          [2, 3],
          [1, 3],
          [1, 2],
          [1, 1],
        ],
      ],
      [
        [2, 3],
        [
          [3, 2],
          [3, 3],
          [3, 4],
          [2, 4],
          [1, 3],
          [2, 2],
        ],
      ],
    ],
    "y even": [
      [
        [2, 2],
        [
          [3, 1],
          [3, 2],
          [3, 3],
          [2, 3],
          [1, 2],
          [2, 1],
        ],
      ],
      [
        [2, 3],
        [
          [2, 2],
          [3, 3],
          [2, 4],
          [1, 4],
          [1, 3],
          [1, 2],
        ],
      ],
    ],
    "x odd": [
      [
        [2, 2],
        [
          [2, 1],
          [3, 1],
          [3, 2],
          [2, 3],
          [1, 2],
          [1, 1],
        ],
      ],
      [
        [3, 2],
        [
          [3, 1],
          [4, 2],
          [4, 3],
          [3, 3],
          [2, 3],
          [2, 2],
        ],
      ],
    ],
    "x even": [
      [
        [2, 2],
        [
          [2, 1],
          [3, 2],
          [3, 3],
          [2, 3],
          [1, 3],
          [1, 2],
        ],
      ],
      [
        [3, 2],
        [
          [3, 1],
          [4, 1],
          [4, 2],
          [3, 3],
          [2, 2],
          [2, 1],
        ],
      ],
    ],
  };

  for (const [name, settings] of Object.entries(HEXES)) {
    it(`${name}: the six edges clockwise from the top (or top-right), on both parities`, () => {
      const g = gridGeometry(settings);
      for (const [cell, around] of expected[name]!) {
        expect(g.neighbors(cell)).toEqual(around);
        expect(g.neighbors(cell, true)).toEqual(around);
      }
    });

    it(`${name}: the neighbours are the six nearest centres, clockwise on screen`, () => {
      const g = gridGeometry(settings);
      for (const cell of [
        [0, 0],
        [1, 0],
        [0, 1],
        [-3, -5],
        [4, -1],
      ] as Cell[]) {
        const [cx, cy] = tiledCentre(settings, cell);
        const around = g.neighbors(cell);
        // Screen angle clockwise from straight up, in [0, 360).
        const angles = around.map((n) => {
          const [x, y] = tiledCentre(settings, n);
          return ((Math.atan2(x - cx, cy - y) * 180) / Math.PI + 360) % 360;
        });
        if (settings.kind === "hex" && settings.stagger === "x") expect(angles[0]).toBe(0);
        else {
          expect(angles[0]).toBeGreaterThan(0);
          expect(angles[0]).toBeLessThan(90);
        }
        for (let i = 1; i < angles.length; i++) expect(angles[i]!).toBeGreaterThan(angles[i - 1]!);
        for (const n of around) expect(g.distance(cell, n)).toBe(1);
        const ring: Cell[] = [];
        for (let dc = -2; dc <= 2; dc++)
          for (let dr = -2; dr <= 2; dr++) if (dc || dr) ring.push([cell[0] + dc, cell[1] + dr]);
        const d2 = (c: Cell) => {
          const [x, y] = tiledCentre(settings, c);
          return (x - cx) ** 2 + (y - cy) ** 2;
        };
        const nearest = ring.sort((a, b) => d2(a) - d2(b)).slice(0, 6);
        expect(new Set(nearest.map(cellKey))).toEqual(new Set(around.map(cellKey)));
      }
    });
  }
});

describe("costs and distances", () => {
  it("costs 10 an edge and 14 a diagonal, with an octile heuristic on squares", () => {
    const g = gridGeometry(SQUARE);
    expect(g.stepCost([0, 0], [1, 0])).toBe(10);
    expect(g.stepCost([0, 0], [0, -1])).toBe(10);
    expect(g.stepCost([0, 0], [1, 1])).toBe(14);
    expect(g.heuristic([0, 0], [5, 2])).toBe(5 * 10 + 2 * 4);
    expect(g.heuristic([0, 0], [-2, -5])).toBe(5 * 10 + 2 * 4);
    expect(g.heuristic([1, 1], [1, 1])).toBe(0);
    expect(g.distance([0, 0], [5, -2])).toBe(7);
    expect(g.distance([0, 0], [5, -2], true)).toBe(5);
  });

  it("costs 10 a hex step, and its heuristic is 10 × the hex distance", () => {
    for (const settings of Object.values(HEXES)) {
      const g = gridGeometry(settings);
      for (const n of g.neighbors([4, 4])) expect(g.stepCost([4, 4], n)).toBe(10);
      // Walking each neighbour ring outward: the distance grows by one per ring.
      let ring = new Set([cellKey([0, 0])]);
      const seen = new Set(ring);
      for (let d = 1; d <= 6; d++) {
        const next = new Set<number>();
        for (const k of ring)
          for (const n of g.neighbors(cellOf(k)))
            if (!seen.has(cellKey(n))) {
              seen.add(cellKey(n));
              next.add(cellKey(n));
            }
        for (const k of next) {
          expect(g.distance([0, 0], cellOf(k))).toBe(d);
          expect(g.heuristic([0, 0], cellOf(k))).toBe(10 * d);
          expect(g.distance(cellOf(k), [0, 0])).toBe(d);
        }
        expect(next.size).toBe(6 * d);
        ring = next;
      }
    }
  });
});

describe("line", () => {
  it("is a supercover on squares, taking both cells beside a corner it passes through", () => {
    const g = gridGeometry(SQUARE);
    expect(g.line([0, 0], [3, 1])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(g.line([0, 0], [2, 2])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]);
    expect(g.line([0, 0], [3, 0])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(g.line([2, 2], [2, 2])).toEqual([[2, 2]]);
  });

  it("steps one edge or corner at a time on squares and one neighbour at a time on hexes", () => {
    for (const settings of Object.values(ALL)) {
      const g = gridGeometry(settings);
      const r = rng(9);
      for (let i = 0; i < 300; i++) {
        const a: Cell = [int(r, -30, 30), int(r, -30, 30)];
        const b: Cell = [int(r, -30, 30), int(r, -30, 30)];
        const cells = g.line(a, b);
        expect(cells[0]).toEqual(a);
        expect(cells.at(-1)).toEqual(b);
        if (settings.kind === "hex") expect(cells).toHaveLength(g.distance(a, b) + 1);
        for (let j = 1; j < cells.length; j++) {
          const [p, q] = [cells[j - 1]!, cells[j]!];
          if (settings.kind === "hex") expect(g.distance(p, q)).toBe(1);
          else expect(g.distance(p, q, true)).toBe(1);
        }
      }
    }
  });

  it("is symmetric: line(b, a) is line(a, b) reversed", () => {
    for (const settings of Object.values(ALL)) {
      const g = gridGeometry(settings);
      const r = rng(23);
      for (let i = 0; i < 1000; i++) {
        const span = i % 4 === 0 ? 6 : 200;
        const a: Cell = [int(r, -span, span), int(r, -span, span)];
        const b: Cell = [int(r, -span, span), int(r, -span, span)];
        expect(g.line(b, a)).toEqual(g.line(a, b).reverse());
      }
    }
  });

  it("follows the straight segment between hex centres", () => {
    for (const settings of Object.values(HEXES)) {
      const g = gridGeometry(settings);
      const a: Cell = [0, 0];
      const b: Cell = [9, 4];
      const [ax, ay] = g.center(a);
      const [bx, by] = g.center(b);
      const cells = g.line(a, b);
      const n = cells.length - 1;
      cells.forEach((c, i) => {
        const p: Pt = [ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n];
        expect(g.distance(c, g.cellAt(p))).toBeLessThanOrEqual(1);
      });
    }
  });
});

describe("cellsIn and rect", () => {
  /** Every cell in a wide window whose centre `inside` holds: the brute-force answer. */
  function bruteForce(settings: GridSettings, inside: (p: Pt) => boolean): string[] {
    const g = gridGeometry(settings);
    const out: string[] = [];
    for (let r = -30; r <= 30; r++)
      for (let c = -30; c <= 30; c++) if (inside(g.center([c, r]))) out.push(`${c},${r}`);
    return out;
  }
  const keys = (cells: Cell[]) => cells.map(([c, r]) => `${c},${r}`);

  it("takes the cells whose centre a box holds, edges included, row by row", () => {
    const g = gridGeometry({ kind: "square", cell: [10, 10] });
    const box: ShapeObj = { type: "box", cx: 20, cy: 10, hw: 15, hh: 5, rotDeg: 0 };
    expect(g.cellsIn(box)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(g.cellsIn({ ...box, rotDeg: 90 })).toEqual(
      g.cellsIn({ type: "box", cx: 20, cy: 10, hw: 5, hh: 15, rotDeg: 0 }),
    );
    expect(g.cellsIn({ type: "box", cx: 3, cy: 3, hw: 1, hh: 1, rotDeg: 0 })).toEqual([]);
  });

  const shapes: [string, ShapeObj, (p: Pt) => boolean][] = [
    [
      "circle",
      { type: "circle", cx: 37, cy: -12, r: 70 },
      ([x, y]) => (x - 37) ** 2 + (y + 12) ** 2 <= 70 ** 2,
    ],
    [
      "box turned 30°",
      { type: "box", cx: -20, cy: 15, hw: 80, hh: 30, rotDeg: 30 },
      ([x, y]) => {
        const a = (-30 * Math.PI) / 180;
        const dx = x + 20;
        const dy = y - 15;
        return (
          Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= 80 &&
          Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= 30
        );
      },
    ],
    [
      "triangle",
      {
        type: "poly",
        pts: [
          [0, -90],
          [120, 60],
          [-100, 40],
        ],
      },
      ([x, y]) => {
        const s = (ax: number, ay: number, bx: number, by: number) =>
          (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        const d1 = s(0, -90, 120, 60);
        const d2 = s(120, 60, -100, 40);
        const d3 = s(-100, 40, 0, -90);
        return (d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0);
      },
    ],
  ];

  for (const [name, settings] of Object.entries(ALL))
    for (const [shapeName, shape, inside] of shapes)
      it(`${name}: a ${shapeName} covers the cells a brute-force search finds`, () => {
        expect(keys(gridGeometry(settings).cellsIn(shape))).toEqual(bruteForce(settings, inside));
      });

  it("gives a chain no inside", () => {
    const g = gridGeometry({ kind: "square", cell: [10, 10] });
    const chain: ShapeObj = {
      type: "chain",
      pts: [
        [1, 1],
        [9, 9],
        [40, 2],
      ],
    };
    expect(g.cellsIn(chain)).toEqual([[0, 0]]);
  });

  it("covers a world rectangle with every cell it overlaps", () => {
    const g = gridGeometry({ kind: "square", cell: [32, 32] });
    expect(g.rect([0, 0, 640, 320])).toEqual({ c0: 0, r0: 0, c1: 19, r1: 9 });
    expect(g.rect([-1, 5, 33, 64])).toEqual({ c0: -1, r0: 0, c1: 1, r1: 1 });
    expect(g.rect([10, 10, 10, 10])).toEqual({ c0: 0, r0: 0, c1: 0, r1: 0 });
    for (const settings of Object.values(HEXES)) {
      const h = gridGeometry(settings);
      const bounds: [number, number, number, number] = [-100, -60, 300, 200];
      const { c0, r0, c1, r1 } = h.rect(bounds);
      // Every cell whose centre is inside lies in the range.
      for (let r = -30; r <= 30; r++)
        for (let c = -30; c <= 30; c++) {
          const [x, y] = h.center([c, r]);
          if (x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3]) {
            expect(c >= c0 && c <= c1 && r >= r0 && r <= r1, `${c},${r}`).toBe(true);
          }
        }
    }
  });
});

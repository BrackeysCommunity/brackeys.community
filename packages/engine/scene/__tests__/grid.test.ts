import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { formatScene } from "../format";
import {
  canonicalGrid,
  compareChunkKeys,
  decodeRow,
  encodeRow,
  GRID_ROW_PATTERN,
  gridCellBounds,
  gridProblems,
  isGridValue,
  paintGrid,
  parseChunkKey,
  readCell,
  transformGrid,
  type CellEdit,
  type CellRect,
  type GridCells,
} from "../grid";
import { parseScene } from "../parse";
import type { Dihedral } from "../transform";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../types";

/** A seeded generator, so a failing case reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A dense model: cell values by "col,row", zeros absent. */
type Dense = Map<string, number>;

function denseOf(grid: GridCells): Dense {
  const out: Dense = new Map();
  for (const [key, rows] of Object.entries(grid)) {
    const [cx, cy] = parseChunkKey(key)!;
    rows.forEach((row, r) => {
      decodeRow(row)!.forEach((v, c) => {
        if (v !== 0) out.set(`${cx * 32 + c},${cy * 32 + r}`, v);
      });
    });
  }
  return out;
}

/** Keys whose values differ between two dense models; cheaper than a deep Map equality. */
function denseDiff(a: Dense, b: Dense): string[] {
  const out: string[] = [];
  for (const [k, v] of a) if (b.get(k) !== v) out.push(k);
  for (const k of b.keys()) if (!a.has(k)) out.push(k);
  return out;
}

function gridOf(dense: Dense): GridCells {
  const cells: CellEdit[] = [...dense].map(([k, v]) => {
    const [c, r] = k.split(",").map(Number) as [number, number];
    return [c, r, v];
  });
  return paintGrid({}, { cells }).grid;
}

describe("rows", () => {
  it("decodes the row grammar and refuses everything else", () => {
    expect([...decodeRow("")!]).toEqual(Array(32).fill(0));
    expect([...decodeRow("0*4,3*6,7")!].slice(0, 12)).toEqual([0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 7, 0]);
    expect([...decodeRow("65535*32")!]).toEqual(Array(32).fill(65535));
    for (const bad of [
      "65536",
      "1*33",
      "1*1",
      "1*0",
      "01",
      "1*02",
      "1*16,2*17",
      ",",
      "1,",
      " 1",
      "-1",
      "1*",
      "a",
    ])
      expect(decodeRow(bad), bad).toBeNull();
  });

  it("encodes canonically: maximal runs, singles without '*', trailing zeros dropped", () => {
    expect(encodeRow([])).toBe("");
    expect(encodeRow(Array(32).fill(0))).toBe("");
    expect(encodeRow([0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 7])).toBe("0*4,3*6,7");
    expect(encodeRow([1, 1, 0, 2, 0, 0])).toBe("1*2,0,2");
    expect(() => encodeRow(Array(33).fill(1))).toThrow(RangeError);
    expect(() => encodeRow([1.5])).toThrow(RangeError);
    expect(() => encodeRow([65536])).toThrow(RangeError);
  });

  it("round-trips every canonical row (fuzzed)", () => {
    const next = rng(7);
    const values = [0, 1, 2, 3, 9, 10, 99, 65535];
    for (let n = 0; n < 3000; n++) {
      const cells = Array.from({ length: 32 }, () =>
        next() < 0.4 ? 0 : values[Math.floor(next() * (next() < 0.5 ? 3 : values.length))]!,
      );
      // Long runs as well as noise.
      if (n % 3 === 0) cells.fill(cells[0]!, 0, Math.floor(next() * 32));
      const row = encodeRow(cells);
      expect(GRID_ROW_PATTERN.test(row)).toBe(true);
      expect([...decodeRow(row)!]).toEqual(cells);
      expect(encodeRow(decodeRow(row)!)).toBe(row);
    }
  });
});

describe("chunk keys", () => {
  it("parses integers, negatives included, and refuses other spellings", () => {
    expect(parseChunkKey("0,0")).toEqual([0, 0]);
    expect(parseChunkKey("-1,3")).toEqual([-1, 3]);
    expect(parseChunkKey("12,-40")).toEqual([12, -40]);
    for (const bad of ["-0,0", "0,-0", "01,0", "0, 0", "0", "0,0,0", "+1,0", "1.5,0", ""])
      expect(parseChunkKey(bad), bad).toBeNull();
  });

  it("orders keys row-major by (cy, cx) numerically", () => {
    expect(["1,0", "0,1", "-1,0", "0,0", "-2,1", "10,0", "2,0"].sort(compareChunkKeys)).toEqual([
      "-1,0",
      "0,0",
      "1,0",
      "2,0",
      "10,0",
      "-2,1",
      "0,1",
    ]);
  });
});

describe("readCell and paintGrid", () => {
  it("maps negative cells into negative chunks", () => {
    const { grid } = paintGrid(
      {},
      {
        cells: [
          [-1, -1, 5],
          [-32, 0, 6],
          [-33, 31, 7],
        ],
      },
    );
    expect(Object.keys(grid)).toEqual(["-1,-1", "-2,0", "-1,0"]);
    expect(grid["-1,-1"]![31]).toBe("0*31,5");
    expect(grid["-1,0"]).toEqual(["6"]);
    expect(grid["-2,0"]![31]).toBe("0*31,7");
    expect(readCell(grid, -1, -1)).toBe(5);
    expect(readCell(grid, -32, 0)).toBe(6);
    expect(readCell(grid, -33, 31)).toBe(7);
    expect(readCell(grid, 0, 0)).toBe(0);
    expect(gridCellBounds(grid)).toEqual({ c0: -33, r0: -1, c1: -1, r1: 31 });
  });

  it("matches a dense reference model, reports the rows it changed and an exact inverse", () => {
    const next = rng(42);
    const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
    let grid: GridCells = {};
    const model: Dense = new Map();
    for (let step = 0; step < 60; step++) {
      const rects: CellRect[] = Array.from({ length: int(0, 2) }, () => {
        const c = int(-70, 70);
        const r = int(-70, 70);
        return [c, r, c + int(-20, 20), r + int(-20, 20), int(0, 4)];
      });
      const cells: CellEdit[] = Array.from({ length: int(0, 20) }, () => [
        int(-70, 70),
        int(-70, 70),
        int(0, 4),
      ]);
      const before = new Map(model);
      for (const [a0, b0, a1, b1, v] of rects) {
        for (let r = Math.min(b0, b1); r <= Math.max(b0, b1); r++)
          for (let c = Math.min(a0, a1); c <= Math.max(a0, a1); c++) {
            if (v === 0) model.delete(`${c},${r}`);
            else model.set(`${c},${r}`, v);
          }
      }
      for (const [c, r, v] of cells) {
        if (v === 0) model.delete(`${c},${r}`);
        else model.set(`${c},${r}`, v);
      }

      const result = paintGrid(grid, { cells, rects });
      expect(denseDiff(denseOf(result.grid), model)).toEqual([]);
      expect(canonicalGrid(result.grid)).toEqual(result.grid);
      expect(Object.keys(result.grid)).toEqual(Object.keys(result.grid).sort(compareChunkKeys));
      const misread: string[] = [];
      for (const [k, v] of model) {
        const [c, r] = k.split(",").map(Number) as [number, number];
        if (readCell(result.grid, c, r) !== v) misread.push(k);
      }
      expect(misread).toEqual([]);

      const changed = new Set<string>();
      for (const k of new Set([...before.keys(), ...model.keys()])) {
        if (before.get(k) === model.get(k)) continue;
        const [c, r] = k.split(",").map(Number) as [number, number];
        changed.add(`${Math.floor(c / 32)},${Math.floor(r / 32)}/${((r % 32) + 32) % 32}`);
      }
      expect(new Set(result.rows.map((x) => `${x.chunk}/${x.row}`))).toEqual(changed);
      expect(result.rows).toHaveLength(changed.size);

      expect(new Set(result.inverse.map(([c, r]) => `${c},${r}`)).size).toBe(result.inverse.length);
      const undone = paintGrid(result.grid, { cells: result.inverse });
      expect(undone.grid).toEqual(grid);
      expect(denseDiff(denseOf(undone.grid), before)).toEqual([]);
      grid = result.grid;
    }
  });

  it("paints rects before cells, and a no-op edit changes nothing", () => {
    const { grid } = paintGrid({}, { rects: [[0, 0, 3, 0, 2]], cells: [[1, 0, 9]] });
    expect(grid).toEqual({ "0,0": ["2,9,2*2"] });
    const same = paintGrid(grid, { cells: [[1, 0, 9]], rects: [[40, 40, 41, 41, 0]] });
    expect(same.rows).toEqual([]);
    expect(same.inverse).toEqual([]);
    expect(same.grid).toBe(grid);
  });

  it("erases with 0 and drops emptied chunks and rows", () => {
    const { grid } = paintGrid(
      {},
      {
        cells: [
          [0, 5, 1],
          [40, 0, 2],
        ],
      },
    );
    const erased = paintGrid(grid, { rects: [[0, 0, 31, 31, 0]] });
    expect(erased.grid).toEqual({ "1,0": ["0*8,2"] });
    expect(erased.rows).toEqual([{ chunk: "0,0", row: 5 }]);
    expect(erased.inverse).toEqual([[0, 5, 1]]);
  });

  it("refuses values and coordinates outside the codec", () => {
    expect(() => paintGrid({}, { cells: [[0, 0, 65536]] })).toThrow(RangeError);
    expect(() => paintGrid({}, { cells: [[0.5, 0, 1]] })).toThrow(RangeError);
    expect(() => paintGrid({}, { rects: [[0, 0, 1, Number.NaN, 1]] })).toThrow(RangeError);
  });
});

describe("canonicalGrid, isGridValue, gridProblems", () => {
  it("rewrites rows canonically, drops trailing empty rows and empty chunks, sorts keys", () => {
    expect(
      canonicalGrid({
        "1,0": ["1,1,1", "0*32", ""],
        "0,0": ["0*2,0"],
        "-1,0": ["3*2,3,0*4"],
        "0,-1": [],
      }),
    ).toEqual({ "-1,0": ["3*3"], "1,0": ["1*3"] });
    expect(Object.keys(canonicalGrid({ "0,1": ["1"], "5,0": ["1"], "-5,1": ["1"] }))).toEqual([
      "5,0",
      "-5,1",
      "0,1",
    ]);
    expect(() => canonicalGrid({ "0,0": ["1*33"] })).toThrow();
    expect(() => canonicalGrid({ x: ["1"] })).toThrow();
  });

  it("recognises grid values", () => {
    expect(isGridValue({ "0,0": ["1"] })).toBe(true);
    expect(isGridValue({ "-3,2": [] })).toBe(true);
    expect(isGridValue({})).toBe(false);
    expect(isGridValue([])).toBe(false);
    expect(isGridValue(null)).toBe(false);
    expect(isGridValue({ "0,0": [1] })).toBe(false);
    expect(isGridValue({ "0,0": ["1"], speed: ["1"] })).toBe(false);
    expect(isGridValue({ "a.z": ["1"] })).toBe(false);
  });

  it("names bad keys, row counts, rows and values past the field's largest", () => {
    expect(gridProblems({ "0,0": ["1*4"] })).toEqual([]);
    const problems = gridProblems(
      { "-0,1": ["1"], "0,0": Array(33).fill(""), "1,0": ["1*16,1*17", 4, "9"] },
      8,
    );
    expect(problems.map((p) => p.path)).toEqual([
      ["-0,1"],
      ["0,0"],
      ["1,0", 0],
      ["1,0", 1],
      ["1,0", 2],
    ]);
    expect(problems[4]!.message).toMatch(/9 is past this field's largest, 8/);
  });
});

describe("transformGrid", () => {
  const ALL: Dihedral[] = [0, 1, 2, 3].flatMap((rot) =>
    [false, true].map((flip) => ({ rot: rot as Dihedral["rot"], flip })),
  );

  /** Where cell (c, r) lands: its unit square mirrored in x, then turned clockwise, about the origin. */
  function moveCell(c: number, r: number, d: Dihedral): [number, number] {
    let [x0, y0, x1, y1] = [c, r, c + 1, r + 1];
    if (d.flip) [x0, x1] = [-x1, -x0];
    for (let i = 0; i < d.rot; i++) [x0, y0, x1, y1] = [-y1, x0, -y0, x1];
    return [Math.min(x0, x1), Math.min(y0, y1)];
  }

  it("matches a per-cell transform for every turn and flip, across negative chunks", () => {
    const next = rng(3);
    const dense: Dense = new Map();
    for (let n = 0; n < 400; n++)
      dense.set(
        `${Math.floor(next() * 140) - 70},${Math.floor(next() * 140) - 70}`,
        1 + Math.floor(next() * 5),
      );
    const grid = gridOf(dense);
    for (const d of ALL) {
      const expected: Dense = new Map();
      for (const [k, v] of dense) {
        const [c, r] = k.split(",").map(Number) as [number, number];
        expected.set(moveCell(c, r, d).join(","), v);
      }
      const out = transformGrid(grid, d);
      expect(denseOf(out), JSON.stringify(d)).toEqual(expected);
      expect(canonicalGrid(out)).toEqual(out);
    }
    expect(transformGrid(grid, { rot: 0, flip: false })).toEqual(grid);
  });

  it("turns cell (0, 0) about its top-left corner", () => {
    const one = { "0,0": ["1"] };
    expect(transformGrid(one, { rot: 1, flip: false })).toEqual({ "-1,0": ["0*31,1"] });
    expect(transformGrid(one, { rot: 0, flip: true })).toEqual({ "-1,0": ["0*31,1"] });
    expect(transformGrid(one, { rot: 2, flip: false })).toEqual({
      "-1,-1": [...Array(31).fill(""), "0*31,1"],
    });
    expect(
      transformGrid(transformGrid(one, { rot: 1, flip: false }), { rot: 3, flip: false }),
    ).toEqual(one);
  });
});

describe("a 512×512 painted grid", () => {
  it("formats, parses and round-trips byte-identically", { timeout: 60_000 }, () => {
    const registry = createRegistry(testGame);
    const next = rng(512);
    const rects: CellRect[] = [];
    for (let r = 0; r < 512; r += 8)
      for (let c = 0; c < 512; c += 8)
        rects.push([
          c,
          r,
          c + Math.floor(next() * 8),
          r + Math.floor(next() * 8),
          Math.floor(next() * 4),
        ]);
    const cells: CellEdit[] = Array.from({ length: 4000 }, () => [
      Math.floor(next() * 512) - 256,
      Math.floor(next() * 512) - 256,
      Math.floor(next() * 4),
    ]);
    const painted = paintGrid({}, { rects, cells });
    expect(painted.rows.length).toBeGreaterThan(8000);
    expect(paintGrid(painted.grid, { cells: painted.inverse }).grid).toEqual({});

    const def: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      game: "test-game",
      name: "big",
      bounds: [0, 0, 8192, 8192],
      settings: { grid: { kind: "square", cell: [16, 16] } },
      entities: [{ id: "floor", type: "paint", at: [0, 0], cells: painted.grid }],
    };
    const { text } = formatScene(def);
    expect(text.split("\n").length).toBeGreaterThan(Object.keys(painted.grid).length);
    const parsed = parseScene(text, registry);
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
    if (!parsed.ok) return;
    expect(parsed.def.entities![0]!.cells).toEqual(painted.grid);
    expect(formatScene(parsed.def).text).toBe(text);
  });
});

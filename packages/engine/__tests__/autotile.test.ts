// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { decodeCell } from "../game/tile-cell";
import { pxPerMetreOf } from "../game/units";
import type { AutotileRule, TilesetFile } from "../project/kinds/tileset";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { createSceneRuntime } from "../runtime/runtime";
import { paintGrid, readCell, type CellEdit, type GridCells } from "../scene/grid";
import type { ExpandedScene, RuntimeEntity } from "../scene/types";
import {
  applyAutotile,
  MASK_E,
  MASK_N,
  MASK_NE,
  MASK_NW,
  MASK_S,
  MASK_SE,
  MASK_SW,
  MASK_W,
  terrainMask,
} from "../tiles/autotile";
import type { RapierModule } from "../types";
import { testGame } from "./fixtures/test-game";

const EDGES = [MASK_N, MASK_E, MASK_S, MASK_W];
const CORNERS: [number, number, number][] = [
  [MASK_NE, MASK_N, MASK_E],
  [MASK_SE, MASK_S, MASK_E],
  [MASK_SW, MASK_S, MASK_W],
  [MASK_NW, MASK_N, MASK_W],
];
/** Neighbour offsets by bit. */
const OFFSETS: [number, number, number][] = [
  [MASK_N, 0, -1],
  [MASK_NE, 1, -1],
  [MASK_E, 1, 0],
  [MASK_SE, 1, 1],
  [MASK_S, 0, 1],
  [MASK_SW, -1, 1],
  [MASK_W, -1, 0],
  [MASK_NW, -1, -1],
];

const reduced = (raw: number) => {
  let m = raw & (MASK_N | MASK_E | MASK_S | MASK_W);
  for (const [c, a, b] of CORNERS) if (raw & c && raw & a && raw & b) m |= c;
  return m;
};
const BLOB = [...new Set(Array.from({ length: 256 }, (_, i) => reduced(i)))].sort((a, b) => a - b);
const EDGE = Array.from({ length: 16 }, (_, i) =>
  EDGES.reduce((m, bit, k) => (i & (1 << k) ? m | bit : m), 0),
).sort((a, b) => a - b);

/** Tile ids: 0 is the plain terrain tile; blob tiles start at 100, edge tiles at 200. */
const ruleOf = (kind: AutotileRule["kind"], masks: number[], base: number): AutotileRule => ({
  id: kind,
  kind,
  terrain: "ground",
  tiles: Object.fromEntries(masks.map((m, i) => [String(m), base + i])),
  fallback: 0,
});
const blob = ruleOf("blob47", BLOB, 100);
const edge = ruleOf("edge16", EDGE, 200);
const TERRAIN_IDS = new Set([0, ...BLOB.map((_, i) => 100 + i), ...EDGE.map((_, i) => 200 + i)]);
const tileset = (tile: [number, number]): TilesetFile => ({
  kind: "tileset",
  v: 1,
  image: "texture-tiles",
  tile,
  columns: 16,
  tiles: [...TERRAIN_IDS].map((id) => ({ id, tags: ["ground"] })),
  rules: [blob, edge],
});
const SET = tileset([32, 32]);
const GROUND = 1;
const ROCK = 301;
const isTerrain = (v: number) => {
  const t = decodeCell(v);
  return t !== null && TERRAIN_IDS.has(t.id);
};
const grid = (cells: CellEdit[]): GridCells => paintGrid({}, { cells }).grid;
const tileOf = (v: number) => decodeCell(v)!.id;

describe("terrainMask", () => {
  it("drops a corner unless both its edges are set, and ignores corners for edge16", () => {
    const all = () => true;
    expect(terrainMask(all, 0, 0, "blob47")).toBe(255);
    expect(terrainMask(all, 0, 0, "edge16")).toBe(MASK_N | MASK_E | MASK_S | MASK_W);
    const onlyNE = (c: number, r: number) => (c === 1 && r === -1) || (c === 0 && r === -1);
    expect(terrainMask(onlyNE, 0, 0, "blob47")).toBe(MASK_N);
  });

  it("reduces the 256 neighbourhoods to 47 blob masks and 16 edge masks", () => {
    expect(BLOB).toHaveLength(47);
    expect(EDGE).toHaveLength(16);
  });
});

describe("applyAutotile", () => {
  /** A centre cell at (5,5) with the neighbours `raw` names, all terrain. */
  const around = (raw: number): CellEdit[] => [
    [5, 5, GROUND],
    ...OFFSETS.filter(([bit]) => raw & bit).map(([, dc, dr]): CellEdit => [5 + dc, 5 + dr, GROUND]),
  ];
  const centre = (rule: AutotileRule, raw: number) => {
    const g = grid(around(raw));
    const edits = applyAutotile(g, SET, rule, { c0: 5, r0: 5, c1: 5, r1: 5 }, isTerrain);
    const hit = edits.find(([c, r]) => c === 5 && r === 5);
    return hit ? tileOf(hit[2]) : tileOf(readCell(g, 5, 5));
  };

  it("maps each of the 47 blob masks to its tile", () => {
    const seen = new Set<number>();
    for (let raw = 0; raw < 256; raw++) {
      const want = 100 + BLOB.indexOf(reduced(raw));
      expect(centre(blob, raw)).toBe(want);
      seen.add(want);
    }
    expect(seen.size).toBe(47);
  });

  it("maps each of the 16 edge masks to its tile", () => {
    const seen = new Set<number>();
    for (let raw = 0; raw < 256; raw++) {
      const m = raw & (MASK_N | MASK_E | MASK_S | MASK_W);
      expect(centre(edge, raw)).toBe(200 + EDGE.indexOf(m));
      seen.add(m);
    }
    expect(seen.size).toBe(16);
  });

  it("uses the fallback for a mask the rule doesn't name and leaves other terrain alone", () => {
    const sparse: AutotileRule = { ...blob, tiles: { "0": 7 }, fallback: 9 };
    const g = grid([
      [0, 0, GROUND],
      [1, 0, GROUND],
      [3, 0, ROCK],
    ]);
    const edits = applyAutotile(g, SET, sparse, { c0: 0, r0: 0, c1: 3, r1: 0 }, isTerrain);
    expect(edits).toEqual([
      [0, 0, 10],
      [1, 0, 10],
    ]);
  });

  it("is deterministic over runs and over the order the same cells were painted", () => {
    const cells: CellEdit[] = [];
    for (let r = 0; r < 12; r++)
      for (let c = 0; c < 12; c++) if ((c * 7 + r * 13) % 5 !== 0) cells.push([c, r, GROUND]);
    const a = grid(cells);
    const b = grid([...cells].reverse());
    const rect = { c0: 1, r0: 1, c1: 10, r1: 10 };
    const first = applyAutotile(a, SET, blob, rect, isTerrain);
    expect(applyAutotile(a, SET, blob, rect, isTerrain)).toEqual(first);
    expect(applyAutotile(b, SET, blob, rect, isTerrain)).toEqual(first);
    const order = first.map(([c, r]) => r * 1000 + c);
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });

  it("reads masks from the grid before the pass", () => {
    const g = grid([
      [0, 0, GROUND],
      [1, 0, GROUND],
    ]);
    const edits = applyAutotile(g, SET, blob, { c0: 0, r0: 0, c1: 1, r1: 0 }, isTerrain);
    expect(edits.map(([, , v]) => tileOf(v))).toEqual([
      100 + BLOB.indexOf(MASK_E),
      100 + BLOB.indexOf(MASK_W),
    ]);
  });

  it("updates the one-cell border and nothing beyond it", () => {
    const g = grid([
      [3, 3, GROUND],
      [4, 3, GROUND],
      [5, 3, GROUND],
      [6, 3, GROUND],
    ]);
    const edits = applyAutotile(g, SET, edge, { c0: 4, r0: 3, c1: 4, r1: 3 }, isTerrain);
    expect(edits.map(([c, r]) => [c, r])).toEqual([
      [3, 3],
      [4, 3],
      [5, 3],
    ]);
  });
});

describe("ctx.tiles.autotile", () => {
  let rapier: RapierModule;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
  });

  const PPM = pxPerMetreOf(createRegistry(testGame));
  const CELL = 0.32;
  const TILE_PX = Math.round(CELL * PPM);
  const set = tileset([TILE_PX, TILE_PX]);
  const project: ProjectRuntimeView = {
    settings: {},
    engine: {},
    table: () => [],
    asset: (id) =>
      id === "texture-tiles"
        ? { id, kind: "texture", sha256: "a".repeat(64), size: [TILE_PX * 16, TILE_PX * 16] }
        : undefined,
    inputMap: null,
    doc: (<T>(kind: string, id: string) =>
      kind === "tileset" && id === "tileset-test"
        ? (set as T)
        : undefined) as ProjectRuntimeView["doc"],
    docs: () => [],
  };
  const scene = (entities: RuntimeEntity[]): ExpandedScene => ({
    name: "tiles",
    game: testGame.id,
    bounds: [-20, -20, 40, 40],
    settings: {
      gravity: [0, 20],
      physics: "none",
      grid: { kind: "square", cell: [CELL, CELL] },
      view: { projection: "orthogonal" },
    },
    entities,
  });

  it("paints what applyAutotile gives, in grid cells", () => {
    const cells: CellEdit[] = [];
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 8; c++) if ((c + r) % 4 !== 0) cells.push([c, r, GROUND]);
    const local = grid(cells);
    const rt = createSceneRuntime({ rapier, view: null, game: testGame, project });
    const report = rt.load(
      scene([
        {
          id: "m",
          type: "tilemap",
          at: [2 * CELL, CELL],
          tileset: "tileset-test",
          cells: local,
        },
      ]),
    );
    if (!report.ok) throw new Error(report.error);
    rt.ctx.tiles.autotile("m", "blob47", { c0: 3, r0: 2, c1: 8, r1: 5 });
    const want = paintGrid(local, {
      cells: applyAutotile(local, set, blob, { c0: 1, r0: 1, c1: 6, r1: 4 }, isTerrain),
    }).grid;
    for (let r = -1; r < 8; r++)
      for (let c = -1; c < 10; c++)
        expect(rt.ctx.tiles.get("m", [c + 2, r + 1])).toBe(readCell(want, c, r));
    expect(() => rt.ctx.tiles.autotile("m", "nope", { c0: 0, r0: 0, c1: 0, r1: 0 })).toThrow(
      RangeError,
    );
    rt.destroy();
  });
});

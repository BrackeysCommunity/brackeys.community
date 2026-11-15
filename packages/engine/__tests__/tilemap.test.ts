// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createRegistry } from "../game/define";
import {
  decodeCell,
  encodeCell,
  FLIP_D,
  FLIP_X,
  FLIP_Y,
  MAX_TILES,
  TILE_ID_BITS,
  transformCell,
  type TileTurn,
} from "../game/tile-cell";
import { pxPerMetreOf } from "../game/units";
import {
  createKindRegistry,
  docKindJsonSchema,
  formatAssetDoc,
  parseAssetDoc,
  validateAssetDoc,
  type KindEnv,
} from "../project/kinds";
import { docLookup } from "../project/kinds/define";
import { ENGINE_ASSET_KINDS } from "../project/kinds/index";
import { sceneKind } from "../project/kinds/scene";
import {
  tilemapIssues,
  tilesetIssues,
  tilesetTileCount,
  TILESET_KIND,
  type TilesetFile,
} from "../project/kinds/tileset";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { AssetEntry, ProjectState } from "../project/types";
import { projectView } from "../project/view";
import { createSceneRuntime, saveHostOf } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { AGENT_SURFACE_KEYWORD, AGENT_SURFACE_VERSION } from "../scene/agent-surface";
import { formatScene } from "../scene/format";
import { encodeRow, paintGrid, type CellEdit, type CellRect, type GridCells } from "../scene/grid";
import { undescribedProperties } from "../scene/json-schema";
import { parseScene } from "../scene/parse";
import type { ExpandedScene, RuntimeEntity, SceneDefinition } from "../scene/types";
import { validateScene } from "../scene/validate";
import type { TilemapSystem } from "../systems/tilemap";
import type { RapierModule } from "../types";
import { runDigest, swapped } from "./fixtures/live-version";
import { testGame } from "./fixtures/test-game";

const H = FLIP_X;
const V = FLIP_Y;
const D = FLIP_D;
const FLAG_SETS = [0, H, V, H | V, D, H | D, V | D, H | V | D];

/**
 * Tiled's flags under one clockwise quarter turn and under a horizontal
 * mirror, worked out by hand from how Tiled draws a flagged tile (diagonal
 * flip, then horizontal, then vertical): a turn of a plain tile is H|D,
 * half a turn H|V, three quarters V|D.
 */
const TURN_CW: Readonly<Record<number, number>> = {
  [0]: H | D,
  [H]: H | V | D,
  [V]: D,
  [H | V]: V | D,
  [D]: H,
  [H | D]: H | V,
  [V | D]: 0,
  [H | V | D]: V,
};
const MIRROR: Readonly<Record<number, number>> = {
  [0]: H,
  [H]: 0,
  [V]: H | V,
  [H | V]: V,
  [D]: H | D,
  [H | D]: D,
  [V | D]: H | V | D,
  [H | V | D]: V | D,
};

const TURNS: TileTurn[] = [0, 1, 2, 3].flatMap((rot) =>
  [false, true].map((flip) => ({ rot: rot as TileTurn["rot"], flip })),
);

/** A turn as Tiled's own operations: mirror first, then quarter turns. */
function byTable(flags: number, d: TileTurn): number {
  let f = d.flip ? MIRROR[flags]! : flags;
  for (let i = 0; i < d.rot; i++) f = TURN_CW[f]!;
  return f;
}

describe("the tile cell codec", () => {
  it("packs 13 id bits under Tiled's three flags", () => {
    expect(TILE_ID_BITS).toBe(13);
    expect(MAX_TILES).toBe(8191);
    expect([FLIP_X, FLIP_Y, FLIP_D]).toEqual([0x2000, 0x4000, 0x8000]);
  });

  it("reads 0 as the empty cell and writes it back as 0", () => {
    expect(decodeCell(0)).toBeNull();
    expect(encodeCell(null)).toBe(0);
  });

  it("round-trips every flag combination", () => {
    for (const flags of FLAG_SETS) {
      for (const id of [0, 1, 37, MAX_TILES - 1]) {
        const cell = {
          id,
          flipX: (flags & H) !== 0,
          flipY: (flags & V) !== 0,
          flipD: (flags & D) !== 0,
        };
        const value = encodeCell(cell);
        expect(value).toBe((id + 1) | flags);
        expect(decodeCell(value)).toEqual(cell);
      }
    }
  });

  it("round-trips ids 0 to 8190", () => {
    for (let id = 0; id < MAX_TILES; id++) {
      const value = encodeCell({ id, flipX: false, flipY: false, flipD: false });
      expect(value).toBe(id + 1);
      expect(decodeCell(value)?.id).toBe(id);
    }
  });

  it("refuses ids and values out of range", () => {
    expect(() => encodeCell({ id: MAX_TILES, flipX: false, flipY: false, flipD: false })).toThrow(
      RangeError,
    );
    expect(() => encodeCell({ id: -1, flipX: false, flipY: false, flipD: false })).toThrow(
      RangeError,
    );
    expect(() => decodeCell(0x10000)).toThrow(RangeError);
    expect(() => decodeCell(1.5)).toThrow(RangeError);
  });

  it("reads flags with no tile as empty", () => {
    expect(decodeCell(H | V | D)).toBeNull();
  });
});

describe("transformCell", () => {
  it("turns a plain tile as Tiled's rotate and flip commands do", () => {
    const plain = 5;
    expect(transformCell(plain, { rot: 1, flip: false })).toBe(plain | H | D);
    expect(transformCell(plain, { rot: 2, flip: false })).toBe(plain | H | V);
    expect(transformCell(plain, { rot: 3, flip: false })).toBe(plain | V | D);
    expect(transformCell(plain, { rot: 0, flip: true })).toBe(plain | H);
  });

  it("matches Tiled's flag table over the eight dihedral elements, from every flag combination", () => {
    for (const d of TURNS)
      for (const flags of FLAG_SETS)
        for (const id of [0, 812, MAX_TILES - 1])
          expect(transformCell((id + 1) | flags, d), `${JSON.stringify(d)} ${flags}`).toBe(
            (id + 1) | byTable(flags, d),
          );
  });

  it("is the identity for no turn and comes back after four quarter turns or two mirrors", () => {
    for (const flags of FLAG_SETS) {
      const v = 9 | flags;
      expect(transformCell(v, { rot: 0, flip: false })).toBe(v);
      let turned = v;
      for (let i = 0; i < 4; i++) turned = transformCell(turned, { rot: 1, flip: false });
      expect(turned).toBe(v);
      expect(transformCell(transformCell(v, { rot: 0, flip: true }), { rot: 0, flip: true })).toBe(
        v,
      );
    }
  });

  it("leaves the empty cell empty", () => {
    for (const d of TURNS) expect(transformCell(0, d)).toBe(0);
  });
});

// ─── The tileset kind and the tile rule ─────────────────

const created = { at: 0, by: "test" };

function texture(id: string, width: number, height: number): AssetEntry {
  return {
    key: id,
    id,
    kind: "texture",
    path: `art/${id}.png`,
    sha256: "a".repeat(64),
    bytes: 10,
    meta: { format: "png", width, height },
    created,
  };
}

const atlasOver = (id: string, tex: string): AssetEntry => ({
  key: id,
  id,
  kind: "atlas",
  path: `art/${id}.json`,
  sha256: "b".repeat(64),
  bytes: 10,
  import: { texture: tex },
  created,
});

function viewOf(...entries: AssetEntry[]) {
  const state: ProjectState = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: Object.fromEntries(entries.map((e) => [e.key, e])),
    history: {},
    code: {},
    build: {},
  };
  return projectView(state);
}

const sheet: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: "sheet",
  tile: [25, 25],
  columns: 2,
};

const engineEnv: KindEnv = { registry: createRegistry(), project: null };
const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code);

describe("the tileset kind", () => {
  it("is one of the engine's kinds, found by its jsonKind", () => {
    expect(ENGINE_ASSET_KINDS).toContain(TILESET_KIND);
    expect(createKindRegistry().get("tileset")).toBe(TILESET_KIND);
    expect(TILESET_KIND.limits).toEqual({ maxStateBytes: 1_048_576, maxItems: MAX_TILES });
    expect(TILESET_KIND.runtime).toBe("sim");
  });

  it("matches the committed tileset.schema.json (UPDATE_SCHEMAS=1 regenerates)", () => {
    const file = new URL("../project/tileset.schema.json", import.meta.url);
    const schema = docKindJsonSchema(TILESET_KIND, engineEnv);
    if (process.env.UPDATE_SCHEMAS) writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(schema);
    expect(schema.$id).toBe("urn:jams-engine:tileset:v1");
    expect(schema[AGENT_SURFACE_KEYWORD]).toBe(AGENT_SURFACE_VERSION);
    expect(undescribedProperties(schema)).toEqual([]);
  });

  it("reads the format's example, shapes as the scene's flat tuples, and its own empty file", () => {
    const example = {
      kind: "tileset",
      v: 1,
      image: "dungeon-tiles",
      tile: [16, 16],
      margin: 0,
      spacing: 0,
      columns: 16,
      tiles: [
        { id: 0, solid: true, tags: ["wall"] },
        { id: 1, solid: true, oneWay: "up", material: "wood" },
        { id: 2, cost: 30, tags: ["mud"] },
        {
          id: 7,
          shapes: [["poly", 0, 16, 16, 0, 16, 16]],
        },
        {
          id: 40,
          animation: [
            { tile: 40, ms: 150 },
            { tile: 41, ms: 150 },
          ],
        },
        { id: 12, data: { damage: 1 } },
      ],
      rules: [
        {
          id: "walls",
          kind: "blob47",
          terrain: "wall",
          tiles: { "0": 0, "2": 3, "8": 4, "255": 0 },
          fallback: 0,
        },
      ],
    };
    expect(validateAssetDoc(TILESET_KIND, example, engineEnv)).toEqual([]);
    expect(
      validateAssetDoc(TILESET_KIND, TILESET_KIND.empty(engineEnv, { id: "x" }), engineEnv),
    ).toEqual([]);
  });

  it("round-trips the kitchen sink's tileset", () => {
    const text = readFileSync(
      new URL("../scenes/art/kitchen.tileset.json", import.meta.url),
      "utf8",
    );
    const read = parseAssetDoc(TILESET_KIND, text, engineEnv);
    if (!read.ok) throw new Error(JSON.stringify(read.issues));
    expect(read.issues).toEqual([]);
    expect(formatAssetDoc(TILESET_KIND, read.value)).toBe(text);
    const env = { ...engineEnv, project: viewOf(texture("kitchen-tiles", 50, 25)) };
    expect(validateAssetDoc(TILESET_KIND, read.value, env)).toEqual([]);
  });

  it("names its image as a texture or atlas, and tiles' materials as materials", () => {
    const refs = TILESET_KIND.refs!({ ...sheet, tiles: [{ id: 0 }, { id: 1, material: "wood" }] });
    expect(refs).toEqual([
      { pointer: "/image", id: "sheet", kinds: ["texture", "atlas"] },
      { pointer: "/tiles/1/material", id: "wood", kinds: ["material"] },
    ]);
  });

  it("refuses a repeated rule id", () => {
    const file = {
      ...sheet,
      rules: [
        { id: "walls", kind: "edge16", terrain: "stone", tiles: {}, fallback: 0 },
        { id: "walls", kind: "edge16", terrain: "stone", tiles: {}, fallback: 0 },
      ],
      tiles: [{ id: 0 }, { id: 0 }],
    };
    expect(codes(validateAssetDoc(TILESET_KIND, file, engineEnv))).toEqual(["dup-id", "dup-id"]);
  });

  it("judges each tile's data by the game's tileData", () => {
    const game = { ...testGame, tileData: { damage: z.number().int().min(0).optional() } };
    const env: KindEnv = { registry: createRegistry(game), project: null };
    const withData = (data: Record<string, unknown>) => ({ ...sheet, tiles: [{ id: 0, data }] });
    expect(validateAssetDoc(TILESET_KIND, withData({ damage: 1 }), env)).toEqual([]);
    const bad = validateAssetDoc(TILESET_KIND, withData({ damage: "lots" }), env);
    expect(codes(bad)).toEqual(["schema"]);
    expect(bad[0]?.path).toBe("/tiles/0/data/damage");
    expect(codes(validateAssetDoc(TILESET_KIND, withData({ heal: 1 }), env))).toEqual([
      "unknown-key",
    ]);
    expect(validateAssetDoc(TILESET_KIND, withData({ heal: 1 }), engineEnv)).toEqual([]);
  });

  it("counts the image's tiles from its height, margin and spacing", () => {
    expect(tilesetTileCount(sheet, { size: [50, 25] })).toBe(2);
    expect(tilesetTileCount(sheet, { size: [50, 49] })).toBe(2);
    expect(tilesetTileCount(sheet, { size: [50, 50] })).toBe(4);
    expect(tilesetTileCount({ ...sheet, margin: 1, spacing: 2 }, { size: [55, 54] })).toBe(4);
    expect(tilesetTileCount({ ...sheet, margin: 1, spacing: 2 }, { size: [55, 53] })).toBe(2);
    expect(tilesetTileCount(sheet, null)).toBeNull();
    expect(tilesetTileCount(sheet, {})).toBeNull();
  });

  it("raises tile-unknown for a tile, frame or rule tile beyond the image", () => {
    const file: TilesetFile = {
      ...sheet,
      tiles: [
        {
          id: 1,
          animation: [
            { tile: 0, ms: 100 },
            { tile: 2, ms: 100 },
          ],
        },
        { id: 4 },
      ],
      rules: [
        { id: "walls", kind: "edge16", terrain: "stone", tiles: { "3": 1, "5": 7 }, fallback: 9 },
      ],
    };
    const issues = tilesetIssues(file, { size: [50, 25] });
    expect(issues.map((i) => [i.code, i.path, i.got])).toEqual([
      ["tile-unknown", "/tiles/0/animation/1/tile", "2"],
      ["tile-unknown", "/tiles/1/id", "4"],
      ["tile-unknown", "/rules/0/tiles/5", "7"],
      ["tile-unknown", "/rules/0/fallback", "9"],
    ]);
    expect(issues[0]?.severity).toBe("error");
    expect(tilesetIssues(file, null)).toEqual([]);
    const env = { ...engineEnv, project: viewOf(texture("sheet", 50, 25)) };
    expect(codes(validateAssetDoc(TILESET_KIND, file, env))).toEqual(codes(issues));
  });

  it("reads an atlas image's size from its texture", () => {
    const env = {
      ...engineEnv,
      project: viewOf(texture("sheet-art", 50, 50), atlasOver("sheet", "sheet-art")),
    };
    const file: TilesetFile = { ...sheet, tiles: [{ id: 3 }, { id: 4 }] };
    expect(validateAssetDoc(TILESET_KIND, file, env).map((i) => i.got)).toEqual(["4"]);
  });
});

const strip = (rows: number[][]): GridCells => ({ "0,0": rows.map((r) => encodeRow(r)) });
const grid = (cell: [number, number], pxPerMetre = 100) => ({
  settings: { kind: "square" as const, cell },
  pxPerMetre,
});

describe("tilemapIssues", () => {
  const map = { id: "floor", tileset: "sheet", cells: strip([[1, 2, 0, 3]]) };

  it("passes a map whose cells, tileset and grid agree", () => {
    const ok = { ...map, cells: strip([[1, 2 | FLIP_X | FLIP_D, 0, 1 | FLIP_Y]]) };
    expect(tilemapIssues(ok, sheet, { size: [50, 25] }, grid([0.25, 0.25]))).toEqual([]);
  });

  it("raises tileset-missing for a map naming no tileset, or one it can't read", () => {
    expect(codes(tilemapIssues({ id: "floor" }, undefined, null, null))).toEqual([
      "tileset-missing",
    ]);
    const unread = tilemapIssues(map, undefined, null, null, "/entities/2");
    expect(unread.map((i) => [i.code, i.path, i.entityIds])).toEqual([
      ["tileset-missing", "/entities/2/tileset", ["floor"]],
    ]);
    expect(unread[0]?.message).toContain('"sheet"');
  });

  it("raises tileset-grid-mismatch with the px the grid's cell expects", () => {
    const [issue, ...rest] = tilemapIssues(
      { ...map, cells: {} },
      { ...sheet, tile: [16, 16] },
      null,
      grid([0.25, 0.5]),
    );
    expect(rest).toEqual([]);
    expect(issue).toMatchObject({
      code: "tileset-grid-mismatch",
      severity: "error",
      expected: "[25, 50]",
      got: "[16, 16]",
    });
    expect(issue?.message).toContain("25×50 px at 100 px per metre");
    expect(
      tilemapIssues(
        { ...map, cells: {} },
        { ...sheet, tile: [16, 16] },
        null,
        grid([0.5, 0.5], 32),
      ),
    ).toEqual([]);
    expect(tilemapIssues({ ...map, cells: {} }, sheet, null, grid([0.251, 0.25]))).toEqual([]);
  });

  it("raises tile-unknown once per tile id, at its first cell row-major", () => {
    const cells: GridCells = {
      "-1,0": [encodeRow([...Array<number>(31).fill(0), 5])],
      "0,0": [encodeRow([1, 5, 9 | FLIP_X])],
    };
    const issues = tilemapIssues({ ...map, cells }, sheet, { size: [50, 25] }, null, "/entities/0");
    expect(issues.map((i) => [i.code, i.path, i.got])).toEqual([
      ["tile-unknown", "/entities/0/cells", "4"],
      ["tile-unknown", "/entities/0/cells", "8"],
    ]);
    expect(issues[0]?.message).toContain("cell (-1, 0)");
    expect(issues[1]?.message).toContain("cell (2, 0)");
    expect(tilemapIssues({ ...map, cells }, sheet, null, null)).toEqual([]);
  });
});

const tilemapScene = (over: Partial<SceneDefinition> = {}): SceneDefinition => ({
  v: 5,
  name: "tiles",
  bounds: [0, 0, 10, 10],
  settings: { grid: { kind: "square", cell: [0.25, 0.25] } },
  entities: [
    { id: "floor", type: "tilemap", at: [1, 1], tileset: "sheet", cells: strip([[1, 2]]) },
  ],
  ...over,
});

describe("a tilemap in a scene", () => {
  const engine = createRegistry();
  /** The issues a scene's text gets: parsing (structure, fields), then the scene's own checks. */
  const judged = (def: SceneDefinition) => {
    const read = parseScene(JSON.parse(formatScene(def).text), engine);
    return read.ok ? [...read.issues, ...validateScene(read.def, engine)] : read.issues;
  };

  it("validates structurally, at the root and under a turned node", () => {
    expect(judged(tilemapScene())).toEqual([]);
    const nested = tilemapScene({
      entities: [
        { id: "room", type: "node", at: [2, 2], rot: 90, flip: true },
        {
          id: "floor",
          type: "tilemap",
          parent: "room",
          at: [0.5, 0],
          tileset: "sheet",
          cells: strip([[1, 2]]),
          collision: "outline",
          tint: 0x88ccff,
          alpha: 0.5,
        },
      ],
    });
    expect(judged(nested)).toEqual([]);
  });

  it("refuses a tilemap without a grid, a tileset or valid fields", () => {
    expect(codes(judged(tilemapScene({ settings: {} })))).toContain("grid-invalid");
    const bare = tilemapScene({
      entities: [{ id: "floor", type: "tilemap", at: [1, 1], cells: {} }],
    });
    expect(codes(judged(bare))).toContain("schema");
    const odd = tilemapScene({
      entities: [
        {
          id: "floor",
          type: "tilemap",
          at: [1, 1],
          tileset: "sheet",
          cells: {},
          collision: "mesh",
        },
      ],
    });
    expect(codes(judged(odd)).length).toBeGreaterThan(0);
  });

  it("is judged by the tile rule in the scene kind's cross-validation", () => {
    const env = { ...engineEnv, project: viewOf(texture("sheet", 50, 25)) };
    const lookup = (tileset?: TilesetFile) =>
      docLookup(new Map(tileset ? [["tileset", new Map([["sheet", tileset]])]] : []));
    const cross = (def: SceneDefinition, tileset?: TilesetFile) =>
      sceneKind.crossValidate!(def, lookup(tileset), env);
    expect(cross(tilemapScene(), sheet)).toEqual([]);
    expect(codes(cross(tilemapScene()))).toEqual(["tileset-missing"]);
    const mismatch = cross(
      tilemapScene({ settings: { grid: { kind: "square", cell: [0.5, 0.25] } } }),
      sheet,
    );
    expect(mismatch.map((i) => [i.code, i.path])).toEqual([
      ["tileset-grid-mismatch", "/entities/0/tileset"],
    ]);
    const unknown = cross(
      tilemapScene({ entities: [{ ...tilemapScene().entities![0]!, cells: strip([[7]]) }] }),
      sheet,
    );
    expect(unknown.map((i) => [i.code, i.path, i.entityIds])).toEqual([
      ["tile-unknown", "/entities/0/cells", ["floor"]],
    ]);
    expect(cross(tilemapScene({ game: "other" }), sheet)).toEqual([]);
  });
});

describe("ctx.tiles and runtime writes", () => {
  let rapier: RapierModule;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
  });

  const DT = 1000 / 60;
  const PPM = pxPerMetreOf(createRegistry(testGame));
  const CELL = 0.32;
  const TILE_PX = Math.round(CELL * PPM);
  const ROCK = 1;
  const MUD = 2;
  const ROCK_ID = 0;

  const tileset: TilesetFile = {
    kind: "tileset",
    v: 1,
    image: "texture-tiles",
    tile: [TILE_PX, TILE_PX],
    columns: 4,
    tiles: [
      { id: 0, solid: true, tags: ["rock"] },
      { id: 1, tags: ["mud"] },
    ],
  };
  const project: ProjectRuntimeView = {
    settings: {},
    engine: {},
    table: () => [],
    asset: (id) =>
      id === "texture-tiles"
        ? { id, kind: "texture", sha256: "a".repeat(64), size: [TILE_PX * 4, TILE_PX] }
        : undefined,
    inputMap: null,
    doc: (<T>(kind: string, id: string) =>
      kind === "tileset" && id === "tileset-test"
        ? (tileset as T)
        : undefined) as ProjectRuntimeView["doc"],
    docs: () => [],
  };

  const grid = (edit: { cells?: CellEdit[]; rects?: CellRect[] }): GridCells =>
    paintGrid({}, edit).grid;
  const map = (
    id: string,
    cells: GridCells,
    extra: Partial<RuntimeEntity> = {},
  ): RuntimeEntity => ({
    id,
    type: "tilemap",
    at: [0, 0],
    tileset: "tileset-test",
    cells,
    ...extra,
  });
  const expanded = (entities: RuntimeEntity[]): ExpandedScene => ({
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
  function load(entities: RuntimeEntity[], view: unknown = null) {
    const rt = createSceneRuntime({ rapier, view: view as never, game: testGame, project });
    const report = rt.load(expanded(entities));
    if (!report.ok) throw new Error(report.error);
    return { rt, system: rt.ctx.system<TilemapSystem>("tilemap")! };
  }
  const hitAt = (rt: SceneRuntimeHandle, col: number, row: number) =>
    rt.ctx.space.pointAt({ x: (col + 0.5) * CELL, y: (row + 0.5) * CELL }).length > 0;

  const floor = grid({ rects: [[0, 10, 9, 10, ROCK]] });

  it("lists every map's tile at a cell, top first by z, then later in scene order", () => {
    const { rt } = load([
      map("low", grid({ cells: [[3, 3, ROCK]] }), { z: -1 }),
      map("mid", grid({ cells: [[3, 3, MUD]] })),
      map("top", grid({ cells: [[3, 3, MUD]] })),
      map("high", grid({ cells: [[3, 3, ROCK]] }), { z: 2 }),
      map("other", grid({ cells: [[4, 3, ROCK]] })),
    ]);
    const at = rt.ctx.tiles.at([3, 3]);
    expect(at.map((t) => t.map)).toEqual(["high", "top", "mid", "low"]);
    expect(at[0]).toMatchObject({ value: ROCK, tile: { id: ROCK_ID }, def: { solid: true } });
    expect(rt.ctx.tiles.at([0, 0])).toEqual([]);
    expect(rt.ctx.tiles.get("mid", [3, 3])).toBe(MUD);
    expect(rt.ctx.tiles.get("missing", [3, 3])).toBe(0);
    rt.destroy();
  });

  it("finds a map's cells by tag, row-major, in grid cells", () => {
    const cells = grid({
      cells: [
        [5, 1, MUD],
        [2, 4, MUD],
        [1, 1, MUD],
        [0, 0, ROCK],
      ],
    });
    const { rt } = load([map("m", cells, { at: [2 * CELL, CELL] })]);
    expect(rt.ctx.tiles.find("m", "mud")).toEqual([
      [3, 2],
      [7, 2],
      [4, 5],
    ]);
    expect(rt.ctx.tiles.find("m", "rock")).toEqual([[2, 1]]);
    expect(rt.ctx.tiles.find("m", "lava")).toEqual([]);
    expect(rt.ctx.tiles.get("m", [2, 1])).toBe(ROCK);
    rt.destroy();
  });

  it("shows a paint to reads at once and rebuilds the colliders once, at the flush", () => {
    const { rt, system } = load([map("m", floor)]);
    const rebuilt: [string, readonly string[]][] = [];
    system.watchCells((id, chunks) => rebuilt.push([id, chunks]));
    rt.ctx.tiles.paint("m", { cells: [[4, 10, 0]] });
    rt.ctx.tiles.paint("m", { rects: [[0, 5, 2, 5, ROCK]], cells: [[40, 10, ROCK]] });
    expect(rt.ctx.tiles.get("m", [4, 10])).toBe(0);
    expect(rt.ctx.tiles.get("m", [1, 5])).toBe(ROCK);
    expect(hitAt(rt, 4, 10)).toBe(true);
    expect(rebuilt).toEqual([]);
    expect(system.inspect!("m")).toMatchObject({ dirty: ["0,0", "1,0"], writeCount: 5 });

    rt.step(DT, []);
    expect(rebuilt).toEqual([["m", ["0,0", "1,0"]]]);
    expect(hitAt(rt, 4, 10)).toBe(false);
    expect(hitAt(rt, 1, 5)).toBe(true);
    expect(hitAt(rt, 40, 10)).toBe(true);
    expect(Object.fromEntries(system.chunkColliders("m"))).toEqual({ "0,0": 3, "1,0": 1 });
    expect(system.inspect!("m")).toMatchObject({ dirty: [], writeCount: 5 });

    rt.step(DT, []);
    expect(rebuilt).toHaveLength(1);
    rt.destroy();
  });

  it("refuses a paint naming a tile the tileset's image doesn't hold", () => {
    const { rt } = load([map("m", floor)]);
    expect(() => rt.ctx.tiles.paint("m", { cells: [[0, 0, 9]] })).toThrow(
      expect.objectContaining({ code: "tile-unknown" }),
    );
    expect(rt.ctx.tiles.get("m", [0, 0])).toBe(0);
    rt.destroy();
  });

  it("saves writes as a sorted sparse diff from the scene's cells", () => {
    const { rt, system } = load([map("m", floor)]);
    expect(system.save!("m")).toBeUndefined();
    rt.ctx.tiles.paint("m", {
      cells: [
        [7, 3, MUD],
        [2, 3, MUD],
        [4, 10, 0],
        [5, 10, ROCK],
      ],
    });
    expect(system.save!("m")).toEqual([
      [2, 3, MUD],
      [7, 3, MUD],
      [4, 10, 0],
    ]);
    // Painting a cell back to the scene's value drops its write.
    rt.ctx.tiles.paint("m", { cells: [[4, 10, ROCK]] });
    expect(system.save!("m")).toEqual([
      [2, 3, MUD],
      [7, 3, MUD],
    ]);
    rt.destroy();
  });

  it("restores the cells from a world save, and the digest continues", () => {
    const entities = [map("m", floor)];
    const a = load(entities);
    a.rt.ctx.tiles.paint("m", { cells: [[4, 10, 0]], rects: [[0, 4, 3, 4, MUD]] });
    a.rt.step(DT, []);
    const world = saveHostOf(a.rt.ctx)!.captureWorld();
    const ahead = runDigest(a.rt, 30);

    const b = load(entities);
    expect(saveHostOf(b.rt.ctx)!.restoreWorld(world, [])).toBeNull();
    expect(b.rt.ctx.tiles.get("m", [4, 10])).toBe(0);
    expect(b.rt.ctx.tiles.get("m", [2, 4])).toBe(MUD);
    expect(hitAt(b.rt, 4, 10)).toBe(false);
    expect(hitAt(b.rt, 5, 10)).toBe(true);
    expect(b.system.save!("m")).toEqual(world.systems.m?.tilemap);
    expect(runDigest(b.rt, 30)).toBe(ahead);
    a.rt.destroy();
    b.rt.destroy();
  });

  it("keeps runtime writes over the new cells through a live swap of the map", () => {
    const { rt, system } = load([map("m", floor)]);
    rt.ctx.tiles.paint("m", { cells: [[4, 10, 0]] });
    rt.step(DT, []);

    const edited = paintGrid(floor, {
      cells: [
        [4, 10, MUD],
        [0, 0, ROCK],
      ],
    }).grid;
    swapped(rt.swap(expanded([map("m", edited)]), { prefabs: new Map() }));
    expect(rt.ctx.tiles.get("m", [4, 10])).toBe(0);
    expect(rt.ctx.tiles.get("m", [0, 0])).toBe(ROCK);
    expect(hitAt(rt, 0, 0)).toBe(true);
    expect(hitAt(rt, 4, 10)).toBe(false);

    // A change the fast path can't take respawns the map, and the swap puts the writes back.
    swapped(rt.swap(expanded([map("m", edited, { collision: "tiles" })]), { prefabs: new Map() }));
    expect(rt.ctx.tiles.get("m", [4, 10])).toBe(0);
    expect(system.save!("m")).toEqual([[4, 10, 0]]);
    expect(hitAt(rt, 4, 10)).toBe(false);
    expect(hitAt(rt, 3, 10)).toBe(true);
    rt.destroy();
  });

  it("rebuilds only the chunks an editor update changed, writes kept", () => {
    const two = grid({
      rects: [
        [0, 10, 9, 10, ROCK],
        [40, 10, 49, 10, ROCK],
        [80, 10, 89, 10, ROCK],
      ],
    });
    const calls: unknown[][] = [];
    const view = new Proxy(
      {},
      {
        get:
          (_t, key: string) =>
          (...args: unknown[]) => {
            if (key === "layer") return { setVisible() {} };
            calls.push([key, ...args]);
          },
      },
    );
    const { rt, system } = load([map("m", two)], view);
    rt.ctx.tiles.paint("m", { cells: [[85, 10, 0]] });
    rt.step(DT, []);
    const far = rt.ctx.space.pointAt({ x: 45.5 * CELL, y: 10.5 * CELL })[0]!.handle;
    calls.length = 0;

    expect(rt.update([map("m", paintGrid(two, { cells: [[5, 10, 0]] }).grid)])).toEqual({
      ok: true,
    });
    const chunks = calls.filter(([k]) => k === "tileChunks").map(([, , , dirty]) => dirty);
    expect(chunks).toEqual([["0,0"]]);
    expect(rt.ctx.space.pointAt({ x: 45.5 * CELL, y: 10.5 * CELL })[0]!.handle).toBe(far);
    expect(hitAt(rt, 5, 10)).toBe(false);
    expect(hitAt(rt, 85, 10)).toBe(false);
    expect(system.save!("m")).toEqual([[85, 10, 0]]);
    rt.destroy();
  });
});

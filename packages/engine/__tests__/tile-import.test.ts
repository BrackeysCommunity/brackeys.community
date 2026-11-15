import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { decodeCell } from "../game/tile-cell";
import { gridGeometry } from "../grid/geometry";
import { tilemapIssues, tilesetSchemaFor, type TilesetFile } from "../project/kinds/tileset";
import type { ProjectOp } from "../project/ops";
import { projectView } from "../project/view";
import { readCell, type GridCells } from "../scene/grid";
import type { EntityInput, GridSettings } from "../scene/types";
import { importLdtk } from "../tiles/import-ldtk";
import { importTiled, type TiledImportOptions } from "../tiles/import-tiled";
import { fixtureText, TILED_FIXTURES } from "./fixtures/tiled/generate";

const DIR = join(import.meta.dirname, "fixtures/tiled");
const read = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), "utf8"));
const TILESETS = new Map([["terrain.tsj", read("terrain.tsj")]]);
const SHA = (c: string) => c.repeat(64);

const empty = projectView({
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: {},
  history: {},
  code: {},
  build: {},
});

const opts = (over: Partial<TiledImportOptions> = {}): TiledImportOptions => ({
  scene: "level",
  project: empty,
  pxPerMetre: 16,
  images: new Map([
    ["terrain.png", { sha256: SHA("a"), bytes: 120 }],
    ["props.png", { sha256: SHA("b"), bytes: 80 }],
    ["hexes.png", { sha256: SHA("c"), bytes: 90 }],
  ]),
  ...over,
});

const sceneOps = (ops: readonly ProjectOp[]) => {
  const last = ops.at(-1);
  if (last?.op !== "editScene") throw new Error("the batch doesn't end in an editScene");
  return last.ops;
};
const added = (ops: readonly ProjectOp[]): EntityInput[] =>
  sceneOps(ops).flatMap((o) => (o.op === "add" ? [o.entity] : []));
const gridOf = (ops: readonly ProjectOp[]): GridSettings => {
  const s = sceneOps(ops)[0];
  if (s?.op !== "setSettings") throw new Error("no grid");
  return s.set!.grid as GridSettings;
};
const tilesetDoc = (ops: readonly ProjectOp[], id: string): TilesetFile => {
  const op = ops.find((o) => o.op === "createAsset" && o.id === id);
  if (op?.op !== "createAsset") throw new Error(`no tileset ${id}`);
  return op.content as TilesetFile;
};
const cellAt = (e: EntityInput, col: number, row: number) =>
  decodeCell(readCell(e.cells as GridCells, col, row));

describe("importTiled", () => {
  it("keeps the committed fixtures equal to their generator's output", () => {
    for (const [name, value] of Object.entries(TILED_FIXTURES))
      expect(readFileSync(join(DIR, name), "utf8"), name).toBe(fixtureText(value));
  });

  it("imports a sample to the same cells, flags and per-tile data", () => {
    const { ops, notes } = importTiled(read("sample.tmj"), TILESETS, opts());
    expect(notes.every((n) => n.severity === "warn")).toBe(true);
    expect(ops.map((o) => o.op)).toEqual([
      "importAsset",
      "createAsset",
      "importAsset",
      "createAsset",
      "createAsset",
      "editScene",
    ]);
    expect(ops[0]).toMatchObject({
      path: "tilesets/terrain.png",
      id: "terrain-image",
      kind: "texture",
    });
    expect(ops[4]).toMatchObject({ kind: "scene", id: "level" });

    const terrain = tilesetDoc(ops, "terrain");
    expect(tilesetSchemaFor().parse(terrain)).toEqual(terrain);
    expect(terrain).toMatchObject({ image: "terrain-image", tile: [16, 16], columns: 4 });
    expect(terrain.tiles).toEqual([
      {
        id: 1,
        tags: ["ground"],
        solid: true,
        shapes: [["box", 8, 12, 8, 4]],
        data: { friction: 0.5, label: "stone" },
      },
      {
        id: 2,
        animation: [
          { tile: 2, ms: 100 },
          { tile: 3, ms: 150 },
        ],
      },
      { id: 5, solid: true, shapes: [["poly", 0, 16, 16, 0, 16, 16]] },
    ]);
    const props = tilesetDoc(ops, "props");
    expect(tilesetSchemaFor().parse(props)).toEqual(props);
    expect(props.tiles).toEqual([{ id: 1, data: { pickup: true } }]);

    expect(gridOf(ops)).toEqual({ kind: "square", cell: [1, 1] });
    const entities = added(ops);
    const [ground, groundProps, detail] = entities;
    expect(ground).toMatchObject({ type: "tilemap", name: "Ground (Terrain)", tileset: "terrain" });
    expect(groundProps).toMatchObject({ name: "Ground (Props)", tileset: "props", z: 0 });
    const plain = { flipX: false, flipY: false, flipD: false };
    expect(cellAt(ground!, 0, 0)).toBeNull();
    expect(cellAt(ground!, 2, 0)).toEqual({ id: 2, ...plain });
    expect(cellAt(ground!, 0, 1)).toEqual({ id: 1, ...plain, flipX: true });
    expect(cellAt(ground!, 1, 1)).toEqual({ id: 1, ...plain, flipY: true });
    expect(cellAt(ground!, 2, 1)).toEqual({ id: 1, ...plain, flipD: true });
    expect(cellAt(ground!, 3, 1)).toEqual({ id: 1, flipX: true, flipY: true, flipD: true });
    expect(cellAt(ground!, 2, 2)).toEqual({ id: 5, ...plain });
    expect(cellAt(ground!, 3, 2)).toBeNull();
    expect(cellAt(groundProps!, 3, 2)).toEqual({ id: 1, ...plain });

    expect(detail).toMatchObject({ name: "Back/Detail", at: [1, 0], alpha: 0.5, off: true, z: 1 });
    expect(cellAt(detail!, 0, 0)).toEqual({ id: 0, ...plain });
    expect(cellAt(detail!, 3, 2)).toEqual({ id: 3, ...plain, flipX: true });

    expect(entities.slice(3)).toEqual([
      {
        type: "marker",
        at: [1.5, 0.5],
        name: "start",
        tags: ["spawn"],
        extra: { facing: "left" },
      },
      {
        type: "sensor",
        shape: ["box", 2.5, 2, 0.5, 1],
        name: "goal",
        tags: ["exit"],
        extra: { next: "two", score: 3 },
      },
    ]);
    expect(notes.map((n) => n.message)).toEqual([
      'round in layer "Things" is a Tiled "ellipse" object, which doesn\'t import',
      'layer "Sky" is a Tiled "imagelayer" layer, which doesn\'t import',
    ]);
  });

  it("divides map px by the game's px per metre and leaves tile shapes in px", () => {
    const { ops } = importTiled(read("sample.tmj"), TILESETS, opts({ pxPerMetre: 32 }));
    expect(gridOf(ops)).toEqual({ kind: "square", cell: [0.5, 0.5] });
    expect(added(ops)[3]).toMatchObject({ at: [0.75, 0.25] });
    expect(tilesetDoc(ops, "terrain").tiles?.[0]?.shapes).toEqual([["box", 8, 12, 8, 4]]);
  });

  it("reuses an image already in the project and keeps new ids clear of taken ones", () => {
    const at = { at: 0, by: "t" };
    const project = projectView({
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {
        t: { key: "t", id: "terrain", kind: "texture", path: "tilesets/terrain.png", created: at },
        l: { key: "l", id: "level", kind: "scene", path: "scenes/level.json", created: at },
      },
      history: {},
      code: {},
      build: {},
    });
    const { ops } = importTiled(
      read("sample.tmj"),
      TILESETS,
      opts({ project, images: new Map([["props.png", { sha256: SHA("b"), bytes: 80 }]]) }),
    );
    expect(ops.map((o) => o.op)).toEqual([
      "createAsset",
      "importAsset",
      "createAsset",
      "editScene",
    ]);
    expect(ops[0]).toMatchObject({ id: "terrain-2", content: { image: "terrain" } });
  });

  it("maps an infinite map's chunks to grid chunks", () => {
    const { ops, notes } = importTiled(read("infinite.tmj"), TILESETS, opts());
    expect(notes).toEqual([]);
    const [ground] = added(ops);
    const cells = ground!.cells as GridCells;
    expect(Object.keys(cells)).toEqual(["-1,-1", "0,0"]);
    expect(cellAt(ground!, -16, -16)).toEqual({ id: 2, flipX: true, flipY: false, flipD: false });
    expect(cellAt(ground!, -1, -1)).toEqual({ id: 1, flipX: false, flipY: false, flipD: false });
    for (let i = 0; i < 16; i++) expect(cellAt(ground!, i, i)?.id).toBe(0);
    expect(cellAt(ground!, 1, 0)).toBeNull();
  });

  it("imports hex maps whose centres agree with Tiled's hexagonal renderer", () => {
    for (const [name, axis, index] of [
      ["hex-y-odd.tmj", "y", "odd"],
      ["hex-x-even.tmj", "x", "even"],
    ] as const) {
      const { ops, notes } = importTiled(read(name), new Map(), opts());
      const grid = gridOf(ops);
      expect(grid).toEqual({
        kind: "hex",
        cell: [1.75, 2],
        side: 1,
        stagger: axis,
        index,
      });
      const geo = gridGeometry(grid);
      const [tw, th, side] = [28, 32, 16];
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++) {
          const staggered = (n: number) => ((n & 1) === 1) !== (index === "even");
          const x =
            axis === "y" ? col * tw + (staggered(row) ? tw / 2 : 0) : (col * (tw + side)) / 2;
          const y =
            axis === "y" ? (row * (th + side)) / 2 : row * th + (staggered(col) ? th / 2 : 0);
          expect(geo.center([col, row]), `${name} ${col},${row}`).toEqual([
            (x + tw / 2) / 16,
            (y + th / 2) / 16,
          ]);
        }
      const [floor] = added(ops);
      expect(cellAt(floor!, 1, 1)).toEqual({ id: 0, flipX: true, flipY: false, flipD: false });
      expect(cellAt(floor!, 2, 2)).toEqual({ id: 0, flipX: false, flipY: false, flipD: false });
      expect(notes.map((n) => [n.severity, n.code])).toEqual([["warn", "import-failed"]]);
    }
  });

  it("refuses isometric and staggered maps with import-failed", () => {
    for (const orientation of ["isometric", "staggered"]) {
      const map = { ...(read("isometric.tmj") as object), orientation };
      const { ops, notes } = importTiled(map, new Map(), opts());
      expect(ops).toEqual([]);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ code: "import-failed", severity: "error" });
      expect(notes[0]!.message).toContain(
        "isometric and staggered maps don't import yet; only orthogonal and hexagonal maps do",
      );
    }
  });

  it("notes a parallax on either axis, through its groups, apart from a whole-cell offset", () => {
    const map = read("sample.tmj") as { layers: Record<string, unknown>[] };
    const back = map.layers[1] as { layers: Record<string, unknown>[] };
    map.layers[0] = { ...map.layers[0], parallaxy: 0.5, offsetx: 32 };
    map.layers[1] = { ...back, parallaxx: 0.5 };
    back.layers[0] = { ...back.layers[0], parallaxx: 0.5 };
    const { ops, notes } = importTiled(map, TILESETS, opts());
    const messages = notes.map((n) => n.message);
    expect(messages).toContain(
      `layer "Ground"'s parallax (1 × 0.5) isn't imported; it scrolls with the map`,
    );
    expect(messages).toContain(
      `layer "Back/Detail"'s parallax (0.25 × 1) isn't imported; it scrolls with the map`,
    );
    expect(messages.some((m) => m.includes("offset"))).toBe(false);
    const ground = added(ops).find((e) => String(e.name).startsWith("Ground"));
    expect(ground?.at).toEqual([2, 0]);
  });

  it("notes an offset that isn't a whole number of cells, without naming parallax", () => {
    const map = read("sample.tmj") as { layers: Record<string, unknown>[] };
    map.layers[0] = { ...map.layers[0], offsetx: 5 };
    const { notes } = importTiled(map, TILESETS, opts());
    expect(notes.map((n) => n.message)).toContain(
      `layer "Ground"'s offset isn't a whole number of cells; it's dropped`,
    );
    expect(notes.some((n) => n.message.includes("parallax"))).toBe(false);
  });

  it("drops a tileset whose tiles aren't the map's cell size, and its cells, so the scene loads", () => {
    const map = read("sample.tmj") as { tilesets: Record<string, unknown>[] };
    map.tilesets[1] = { ...map.tilesets[1], tileheight: 32, imageheight: 32 };
    const { ops, notes } = importTiled(map, TILESETS, opts());
    expect(notes.every((n) => n.severity === "warn")).toBe(true);
    expect(notes.map((n) => n.message)).toEqual(
      expect.arrayContaining([
        "tileset \"Props\"'s tiles are 16×32 px but the map's cells are 16×16 px; it and the cells that use it are dropped",
        "layer \"Ground\" drops 1 cell(s) from tilesets whose tiles aren't the map's cell size",
      ]),
    );
    expect(ops.some((o) => "id" in o && (o.id === "props" || o.id === "props-image"))).toBe(false);

    const tilemaps = added(ops).filter((e) => e.type === "tilemap");
    expect(tilemaps.map((e) => [e.name, e.tileset])).toEqual([
      ["Ground", "terrain"],
      ["Back/Detail", "terrain"],
    ]);
    expect(cellAt(tilemaps[0]!, 3, 2)).toBeNull();
    const terrain = tilesetDoc(ops, "terrain");
    const grid = { settings: gridOf(ops), pxPerMetre: 16 };
    for (const e of tilemaps)
      expect(
        tilemapIssues(
          { id: "t", tileset: e.tileset as string, cells: e.cells as GridCells },
          terrain,
          null,
          grid,
        ),
      ).toEqual([]);
  });

  it("reads Tiled's #aarrggbb layer tint as 0xRRGGBB", () => {
    const map = read("infinite.tmj") as { layers: Record<string, unknown>[] };
    map.layers[0] = { ...map.layers[0], tintcolor: "#80ff8000" };
    expect(added(importTiled(map, TILESETS, opts()).ops)[0]).toMatchObject({ tint: 0xff8000 });
    map.layers[0] = { ...map.layers[0], tintcolor: "#123abc" };
    expect(added(importTiled(map, TILESETS, opts()).ops)[0]).toMatchObject({ tint: 0x123abc });
  });

  it("refuses the whole import on a missing tileset, image or compressed data", () => {
    const missing = importTiled(read("sample.tmj"), new Map(), opts());
    expect(missing.ops).toEqual([]);
    expect(missing.notes.find((n) => n.severity === "error")?.message).toContain("terrain.tsj");

    const noImage = importTiled(read("sample.tmj"), TILESETS, opts({ images: new Map() }));
    expect(noImage.ops).toEqual([]);

    const map = read("infinite.tmj") as { layers: Record<string, unknown>[] };
    map.layers[0] = {
      ...map.layers[0],
      encoding: "base64",
      compression: "zlib",
      chunks: [{ data: "AAAA" }],
    };
    const zipped = importTiled(map, TILESETS, opts());
    expect(zipped.ops).toEqual([]);
    expect(zipped.notes[0]?.message).toContain("zlib-compressed");
  });
});

describe("importLdtk notes", () => {
  it("names a layer type it doesn't import in quotes", () => {
    const ldtk = join(import.meta.dirname, "fixtures/ldtk");
    const world = JSON.parse(readFileSync(join(ldtk, "sample.ldtk"), "utf8")) as {
      levels: { identifier: string; layerInstances: { __type: string }[] }[];
    };
    const level = world.levels.find((l) => l.identifier === "Level_1")!;
    level.layerInstances[0]!.__type = "Mystery";
    const { notes } = importLdtk(world, {
      project: empty,
      pxPerMetre: 8,
      hash: () => SHA("b"),
      files: new Map([["tiles.png", new Uint8Array(readFileSync(join(ldtk, "tiles.png")))]]),
      levels: ["Level_1"],
    });
    expect(notes.map((n) => n.message)).toContain(
      "level Level_1's layer Collisions is an LDtk \"Mystery\" layer, which doesn't import",
    );
  });
});

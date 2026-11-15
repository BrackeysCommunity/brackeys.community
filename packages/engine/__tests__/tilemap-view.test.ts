// @vitest-environment node
import { Container, Texture, TextureSource } from "pixi.js";
import { describe, expect, it } from "vite-plus/test";

import type { TilemapVisual } from "../context";
import { encodeCell, FLIP_D, FLIP_X, FLIP_Y } from "../game/tile-cell";
import { gridGeometry } from "../grid/geometry";
import type { TilesetFile } from "../project/kinds/tileset";
import type { Sha256 } from "../project/types";
import { createPixiView } from "../render/pixi-view";
import { createTilemapView } from "../render/tilemap-view";
import { paintGrid, type GridCells } from "../scene/grid";
import type { CellEdit, GridSettings } from "../scene/types";

const IMAGE = "a".repeat(64) as Sha256;
const PPM = 16;

/** A 4 × 4 sheet of 16 px tiles; tile 1 animates through 1, 2, 3 at 100 ms each. */
const TILESET: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: "tiles" as TilesetFile["image"],
  tile: [16, 16],
  columns: 4,
  tiles: [
    {
      id: 1,
      animation: [
        { tile: 1, ms: 100 },
        { tile: 2, ms: 100 },
        { tile: 3, ms: 100 },
      ],
    },
  ],
};

function textures(loaded = true) {
  const texture = new Texture({ source: new TextureSource({ width: 64, height: 64 }) });
  const listeners = new Set<(hash: Sha256) => void>();
  let ready = loaded;
  return {
    source: {
      get: (hash: Sha256) => (ready && hash === IMAGE ? texture : null),
      onLoad(cb: (hash: Sha256) => void) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    load() {
      ready = true;
      for (const cb of listeners) cb(IMAGE);
    },
  };
}

const square: GridSettings = { kind: "square", cell: [1, 1] };

function visual(grid: GridSettings = square): TilemapVisual {
  return {
    at: [0, 0],
    cell: [grid.cell[0] * PPM, grid.cell[1] * PPM],
    grid,
    tileset: TILESET,
    image: IMAGE,
    layer: "terrain",
  };
}

const paint = (cells: GridCells, edits: CellEdit[]) => paintGrid(cells, { cells: edits }).grid;
const tile = (id: number, flags = 0) =>
  encodeCell({
    id,
    flipX: (flags & FLIP_X) !== 0,
    flipY: (flags & FLIP_Y) !== 0,
    flipD: (flags & FLIP_D) !== 0,
  });

function setup(grid?: GridSettings) {
  const root = new Container();
  const tex = textures();
  const view = createTilemapView(root, tex.source);
  view.set("map", visual(grid));
  return { root, view, tex };
}

const uvsOf = (view: ReturnType<typeof setup>["view"], key: string) =>
  Array.from(view.meshes("map").get(key)!.geometry.uvs).map((n) => Math.round(n * 64));

describe("the tilemap view", () => {
  it("makes one mesh per non-empty chunk", () => {
    const { view } = setup();
    const cells = paint({}, [
      [0, 0, tile(0)],
      [5, 3, tile(0)],
      [40, 0, tile(0)],
      [-1, -1, tile(0)],
    ]);
    const withEmpty = { ...cells, "9,9": [] };
    view.chunks("map", withEmpty, Object.keys(withEmpty));
    expect([...view.meshes("map").keys()].sort()).toEqual(["-1,-1", "0,0", "1,0"]);
    expect(view.meshes("map").get("0,0")!.geometry.indices.length).toBe(12);
  });

  it("rebuilds only the chunks a paint dirties", () => {
    const { view } = setup();
    const cells = paint({}, [
      [0, 0, tile(0)],
      [40, 0, tile(0)],
    ]);
    view.chunks("map", cells, Object.keys(cells));
    const before = new Map(view.meshes("map"));
    view.chunks("map", paint(cells, [[1, 0, tile(2)]]), ["0,0"]);
    const after = view.meshes("map");
    expect(after.get("1,0")).toBe(before.get("1,0"));
    expect(after.get("0,0")).not.toBe(before.get("0,0"));
    expect(before.get("0,0")!.destroyed).toBe(true);
    expect(after.get("0,0")!.geometry.indices.length).toBe(12);
  });

  it("drops a chunk painted empty", () => {
    const { view } = setup();
    const cells = paint({}, [[0, 0, tile(0)]]);
    view.chunks("map", cells, ["0,0"]);
    view.chunks("map", paint(cells, [[0, 0, 0]]), ["0,0"]);
    expect(view.meshes("map").size).toBe(0);
  });

  it("maps flip flags to the UV order: diagonal, then horizontal, then vertical", () => {
    const { view } = setup();
    // Tile 5 is the sheet's (16, 16)–(32, 32) square; corners TL, TR, BR, BL.
    const check = (flags: number, uv: number[]) => {
      view.chunks("map", paint({}, [[0, 0, tile(5, flags)]]), ["0,0"]);
      expect(uvsOf(view, "0,0")).toEqual(uv);
    };
    check(0, [16, 16, 32, 16, 32, 32, 16, 32]);
    check(FLIP_X, [32, 16, 16, 16, 16, 32, 32, 32]);
    check(FLIP_Y, [16, 32, 32, 32, 32, 16, 16, 16]);
    check(FLIP_D, [16, 16, 16, 32, 32, 32, 32, 16]);
    check(FLIP_D | FLIP_X, [16, 32, 16, 16, 32, 16, 32, 32]);
  });

  it("swaps animated tiles' UVs on frames", () => {
    const { view } = setup();
    view.chunks("map", paint({}, [[0, 0, tile(1)]]), ["0,0"]);
    const u0 = () => uvsOf(view, "0,0")[0];
    expect(u0()).toBe(16);
    view.frame({ nowMs: 150, views: [] });
    expect(u0()).toBe(32);
    view.frame({ nowMs: 250, views: [] });
    expect(u0()).toBe(48);
    view.frame({ nowMs: 310, views: [] });
    expect(u0()).toBe(16);
  });

  it("places hex quads at the grid's cell centres", () => {
    const hex: GridSettings = { kind: "hex", cell: [1, 1], side: 0.5, stagger: "y", index: "odd" };
    const { view } = setup(hex);
    view.chunks("map", paint({}, [[2, 1, tile(0)]]), ["0,0"]);
    const pos = view.meshes("map").get("0,0")!.geometry.positions;
    const [cx, cy] = gridGeometry(hex).center([2, 1]);
    expect((pos[0]! + pos[2]!) / 2).toBeCloseTo(cx * PPM, 5);
    expect((pos[1]! + pos[5]!) / 2).toBeCloseTo(cy * PPM, 5);
  });

  it("draws once the tileset's texture arrives", () => {
    const root = new Container();
    const tex = textures(false);
    const view = createTilemapView(root, tex.source);
    view.set("map", visual());
    view.chunks("map", paint({}, [[0, 0, tile(0)]]), ["0,0"]);
    expect(view.meshes("map").size).toBe(0);
    tex.load();
    expect(view.meshes("map").size).toBe(1);
  });

  it("is drawn through the scene view's data-only members, posed and removed by id", () => {
    const root = new Container();
    const pixi = createPixiView(root, { pxPerMetre: PPM, textures: textures().source });
    pixi.tilemap!("map", visual());
    pixi.tileChunks!("map", paint({}, [[0, 0, tile(0)]]), ["0,0"]);
    pixi.pose("map", 2, 0, 0, true);
    pixi.frame({ alpha: 1, camera: { x: 0, y: 0, zoom: 1 } });
    const layer = root.children.find((c) => c.label === "layer:" + 10) ?? root.children[0]!;
    const display = layer.children.find((c) => c.label === "map")!;
    expect(display.position.x).toBe(2 * PPM);
    expect(display.children).toHaveLength(1);
    pixi.removeTilemap!("map");
    expect(display.destroyed).toBe(true);
    pixi.removeTilemap!("map");
  });
});

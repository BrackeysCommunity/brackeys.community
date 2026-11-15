// @vitest-environment node
import {
  Container,
  Mesh,
  RendererType,
  Sprite,
  Texture,
  TextureSource,
  type Renderer,
} from "pixi.js";
import { describe, expect, it } from "vite-plus/test";

import type { TilemapVisual } from "../../context";
import { encodeCell, FLIP_D, FLIP_X, FLIP_Y } from "../../game/tile-cell";
import type { TilesetFile } from "../../project/kinds/tileset";
import type { Sha256 } from "../../project/types";
import { paintGrid, type GridCells } from "../../scene/grid";
import type { CellEdit } from "../../scene/types";
import { createTilemapView } from "../tilemap-view";

const IMAGE = "b".repeat(64) as Sha256;
const PPM = 16;
const SHEET = 64;

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

const VISUAL: TilemapVisual = {
  at: [0, 0],
  cell: [PPM * 2, PPM],
  grid: { kind: "square", cell: [2, 1] },
  tileset: TILESET,
  image: IMAGE,
  layer: "terrain",
};

const tile = (id: number, flags = 0) =>
  encodeCell({
    id,
    flipX: (flags & FLIP_X) !== 0,
    flipY: (flags & FLIP_Y) !== 0,
    flipD: (flags & FLIP_D) !== 0,
  });
const paint = (edits: CellEdit[]): GridCells => paintGrid({}, { cells: edits }).grid;

function setup(renderer: RendererType | null) {
  const texture = new Texture({ source: new TextureSource({ width: SHEET, height: SHEET }) });
  const view = createTilemapView(new Container(), {
    get: (hash) => (hash === IMAGE ? texture : null),
    onLoad: () => () => {},
  });
  view.set("map", VISUAL);
  if (renderer !== null) view.display("map")!.onRender!({ type: renderer } as Renderer);
  return view;
}

/** The chunk's sprites, as the Canvas renderer draws them. */
const spritesOf = (view: ReturnType<typeof setup>, key = "0,0") =>
  view.display("map")!.children.find((c) => c.label === `chunk:${key}`)!.children as Sprite[];

describe("the tilemap view on Pixi's Canvas renderer", () => {
  it("draws sprites instead of meshes, and rebuilds meshes drawn before the first render", () => {
    const texture = new Texture({ source: new TextureSource({ width: SHEET, height: SHEET }) });
    const view = createTilemapView(new Container(), {
      get: () => texture,
      onLoad: () => () => {},
    });
    view.set("map", VISUAL);
    view.chunks(
      "map",
      paint([
        [0, 0, tile(0)],
        [40, 0, tile(3)],
      ]),
      ["0,0", "1,0"],
    );
    expect(view.meshes("map").size).toBe(2);
    view.display("map")!.onRender!({ type: RendererType.CANVAS } as Renderer);
    expect(view.meshes("map").size).toBe(0);
    expect(spritesOf(view, "0,0")).toHaveLength(1);
    expect(spritesOf(view, "1,0")[0]!.texture.frame).toMatchObject({ x: 48, y: 0, width: 16 });
  });

  it("keeps meshes on WebGL", () => {
    const view = setup(RendererType.WEBGL);
    view.chunks("map", paint([[0, 0, tile(0)]]), ["0,0"]);
    expect(view.meshes("map").get("0,0")).toBeInstanceOf(Mesh);
  });

  it("puts each texel where the mesh's UVs put it, for every flip", () => {
    for (let flags = 0; flags < 8; flags++) {
      const bits = (flags & 1 ? FLIP_X : 0) | (flags & 2 ? FLIP_Y : 0) | (flags & 4 ? FLIP_D : 0);
      const cells = paint([[1, 2, tile(5, bits)]]);
      const mesh = setup(RendererType.WEBGL);
      mesh.chunks("map", cells, ["0,0"]);
      const { positions, uvs } = mesh.meshes("map").get("0,0")!.geometry;
      const canvas = setup(RendererType.CANVAS);
      canvas.chunks("map", cells, ["0,0"]);
      const [sprite] = spritesOf(canvas);
      sprite!.updateLocalTransform();
      const { frame } = sprite!.texture;
      for (let k = 0; k < 4; k++) {
        const texel = {
          x: uvs[k * 2]! * SHEET - frame.x - frame.width / 2,
          y: uvs[k * 2 + 1]! * SHEET - frame.y - frame.height / 2,
        };
        const at = sprite!.localTransform.apply(texel);
        expect(at.x, `flags ${bits} corner ${k}`).toBeCloseTo(positions[k * 2]!, 5);
        expect(at.y, `flags ${bits} corner ${k}`).toBeCloseTo(positions[k * 2 + 1]!, 5);
      }
    }
  });

  it("swaps animated tiles' textures on frames", () => {
    const view = setup(RendererType.CANVAS);
    view.chunks("map", paint([[0, 0, tile(1)]]), ["0,0"]);
    const x = () => spritesOf(view)[0]!.texture.frame.x;
    expect(x()).toBe(16);
    view.frame({ nowMs: 150, views: [] });
    expect(x()).toBe(32);
    view.frame({ nowMs: 250, views: [] });
    expect(x()).toBe(48);
  });

  it("culls sprite chunks outside every view", () => {
    const view = setup(RendererType.CANVAS);
    view.chunks(
      "map",
      paint([
        [0, 0, tile(0)],
        [40, 0, tile(0)],
      ]),
      ["0,0", "1,0"],
    );
    view.frame({ nowMs: 0, views: [[0, 0, 100, 100]] });
    const chunk = (key: string) =>
      view.display("map")!.children.find((c) => c.label === `chunk:${key}`)!;
    expect(chunk("0,0").culled).toBe(false);
    expect(chunk("1,0").culled).toBe(true);
  });
});

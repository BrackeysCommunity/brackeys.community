// @vitest-environment node
import { Container, Texture, TextureSource } from "pixi.js";
import { describe, expect, it } from "vite-plus/test";

import type { TilemapVisual } from "../context";
import { encodeCell } from "../game/tile-cell";
import type { Sha256 } from "../project/types";
import { createPixiView } from "../render/pixi-view";
import { paintGrid } from "../scene/grid";
import type { Bounds } from "../scene/types";

const PPM = 10;
const camera = { x: 0, y: 0, zoom: 1 };
const box = { type: "box" as const, cx: 0, cy: 0, hw: 0.5, hh: 0.5, rotDeg: 0 };
const style = { fill: 0xffffff };

function view() {
  const root = new Container();
  const image = "b".repeat(64) as Sha256;
  const texture = new Texture({ source: new TextureSource({ width: 16, height: 16 }) });
  const pixi = createPixiView(root, {
    pxPerMetre: PPM,
    textures: { get: (h) => (h === image ? texture : null), onLoad: () => () => {} },
  });
  const find = (id: string): Container => {
    for (const layer of root.children) {
      const hit = layer.children.find((c) => c.label === id);
      if (hit) return hit;
    }
    throw new Error(`no display ${id}`);
  };
  return { pixi, find, image };
}

describe("view culling", () => {
  it("culls a shape outside every view and keeps one inside any", () => {
    const { pixi, find } = view();
    pixi.draw("near", box, style, "body");
    pixi.draw("far", box, style, "body");
    pixi.pose("near", 1, 1, 0, true);
    pixi.pose("far", 50, 50, 0, true);
    const views: Bounds[] = [[0, 0, 10, 10]];
    pixi.frame({ alpha: 1, camera, views });
    expect(find("near").culled).toBe(false);
    expect(find("far").culled).toBe(true);
    expect(find("far").cullable).toBe(true);
    expect(find("far").cullArea).toBeDefined();

    pixi.frame({ alpha: 1, camera, views: [...views, [45, 45, 55, 55]] });
    expect(find("far").culled).toBe(false);

    pixi.frame({ alpha: 1, camera });
    expect(find("near").culled).toBe(false);
    expect(find("far").culled).toBe(false);
  });

  it("culls by the visual's turned bounds", () => {
    const { pixi, find } = view();
    const long = { ...box, hw: 5, hh: 0.1 };
    pixi.draw("bar", long, style, "body");
    pixi.pose("bar", 0, -3, Math.PI / 2, true);
    pixi.frame({ alpha: 1, camera, views: [[-1, 0, 1, 1]] });
    expect(find("bar").culled).toBe(false);
    pixi.pose("bar", 0, -3, 0, true);
    pixi.frame({ alpha: 1, camera, views: [[-1, 0, 1, 1]] });
    expect(find("bar").culled).toBe(true);
  });

  it("culls sprites too", () => {
    const { pixi, find, image } = view();
    pixi.sprite!(
      "decor",
      {
        texture: image,
        size: [1, 1],
        anchor: [0.5, 0.5],
        sampling: "linear",
        fallback: { shape: box, style },
      },
      "body",
    );
    pixi.pose("decor", 100, 0, 0, true);
    pixi.frame({ alpha: 1, camera, views: [[0, 0, 10, 10]] });
    expect(find("decor").culled).toBe(true);
  });

  it("culls a tilemap's chunks by chunk bounds, not the whole map", () => {
    const { pixi, find, image } = view();
    const map: TilemapVisual = {
      at: [0, 0],
      cell: [PPM, PPM],
      grid: { kind: "square", cell: [1, 1] },
      tileset: { kind: "tileset", v: 1, image: "t" as never, tile: [16, 16], columns: 1 },
      image,
      layer: "terrain",
    };
    pixi.tilemap!("map", map);
    const t = encodeCell({ id: 0, flipX: false, flipY: false, flipD: false });
    const cells = paintGrid(
      {},
      {
        cells: [
          [0, 0, t],
          [70, 0, t],
        ],
      },
    ).grid;
    pixi.tileChunks!("map", cells, Object.keys(cells));
    pixi.frame({ alpha: 1, camera, views: [[0, 0, 20, 20]], nowMs: 0 });
    const chunks = find("map").children;
    expect(chunks.map((c) => [c.label, c.culled])).toEqual([
      ["chunk:0,0", false],
      ["chunk:2,0", true],
    ]);
    expect(find("map").culled).toBe(false);
  });
});

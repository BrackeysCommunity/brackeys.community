// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { createRegistry, gridGeometry, withProject } from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import { createKindRegistry, projectView, runtimeView } from "@jams/engine/project";
import { expandScene, readCell, type GridCells } from "@jams/engine/scene";
import { decodeCell } from "@jams/engine/tiles";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { loadSinkProject, type SinkProject } from "../browser/project";
import { loadRapier } from "../browser/run";
import { SINK_SCENE } from "../browser/sink";
import { parseSinkScene, sinkPrefabs, withoutCameraRig } from "../browser/sink-prefabs";
import {
  EMPTY_CELL,
  HEX_GRID,
  TILE_CELL,
  TILE_COLOURS,
  TILEMAP_ENTITY,
  tilemapPoints,
  tilemapScene,
} from "../browser/tilemaps";
import { smokeGame } from "../game";
import { REPO } from "../pack";

const SCENES = join(REPO, "packages/engine/scenes");

let sink: SinkProject;

beforeAll(async () => {
  sink = await loadSinkProject(SCENES);
});

afterAll(() => sink?.close());

function pageSide() {
  const kinds = createKindRegistry(smokeGame);
  const view = projectView(sink.data.state, kinds);
  const values = new Map(Object.entries(sink.data.values));
  const registry = withProject(createRegistry(smokeGame), view, values);
  const prefabs = sinkPrefabs(view, values, registry);
  const scene = withoutCameraRig(
    parseSinkScene(values.get(SINK_SCENE), registry, prefabs),
    registry,
    prefabs,
  );
  return { kinds, view, values, registry, prefabs, scene };
}

/** An 8-bit RGB PNG's pixel, for the unfiltered rows the art generator writes. */
async function rgbPixel(path: string, x: number, y: number): Promise<number> {
  const file = await readFile(path);
  let at = 8;
  let width = 0;
  const idat: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString("latin1", at + 4, at + 8);
    const data = file.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      expect([data[8], data[9]]).toEqual([8, 2]);
    }
    if (type === "IDAT") idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const row = 1 + width * 3;
  expect(raw[y * row]).toBe(0);
  const p = y * row + 1 + x * 3;
  return (raw[p]! << 16) | (raw[p + 1]! << 8) | raw[p + 2]!;
}

describe("the tilemap run's maps", () => {
  it("keep only the sink's tilemap, on the sink's square grid and on the hex grid at its origin", () => {
    const { scene } = pageSide();
    const square = tilemapScene(scene, undefined);
    const hex = tilemapScene(scene, HEX_GRID, [0, 0]);
    const authored = scene.entities!.find((e) => e.id === TILEMAP_ENTITY)!;
    expect(square.entities).toEqual([authored]);
    expect(square.settings?.grid).toEqual(scene.settings?.grid);
    expect(square.settings?.grid?.kind).toBe("square");
    expect(hex.entities).toEqual([{ ...authored, at: [0, 0] }]);
    expect(hex.settings?.grid).toEqual(HEX_GRID);
    for (const cut of [square, hex]) expect([cut.instances, cut.solid]).toEqual([[], []]);
  });

  it("read a painted cell whose tile is one of the pinned colours, and an empty one", async () => {
    const { view, values, scene } = pageSide();
    const map = scene.entities!.find((e) => e.id === TILEMAP_ENTITY)! as unknown as {
      cells: GridCells;
    };
    const painted = readCell(map.cells, TILE_CELL[0], TILE_CELL[1]);
    expect(painted).toBeGreaterThan(0);
    expect(readCell(map.cells, EMPTY_CELL[0], EMPTY_CELL[1])).toBe(0);

    const tileset = values.get("kitchen-tileset") as {
      columns: number;
      tile: [number, number];
      image: string;
    };
    const image = join(SCENES, view.byId.get(tileset.image)!.path);
    const colours = [];
    for (let id = 0; id < TILE_COLOURS.length; id++) {
      const [w, h] = tileset.tile;
      const x = (id % tileset.columns) * w + Math.floor(w / 2);
      const y = Math.floor(id / tileset.columns) * h + Math.floor(h / 2);
      colours.push(await rgbPixel(image, x, y));
    }
    expect(colours).toEqual([...TILE_COLOURS]);
    expect(TILE_COLOURS).toContain(colours[decodeCell(painted)!.id]);
  });

  it("place the painted and empty cells apart on both grids", () => {
    const { scene } = pageSide();
    const square = tilemapScene(scene, undefined);
    const hex = tilemapScene(scene, HEX_GRID, [0, 0]);
    expect(tilemapPoints(square)).toEqual([
      [25.875, 10.125],
      [25.875, 11.125],
    ]);
    const [tile, empty] = tilemapPoints(hex);
    expect(Math.hypot(tile[0] - empty[0], tile[1] - empty[1])).toBeGreaterThan(0.5);
    expect(gridGeometry(HEX_GRID).cellAt(tile)).toEqual(TILE_CELL);
    expect(gridGeometry(HEX_GRID).cellAt(empty)).toEqual(EMPTY_CELL);
  });

  it("load headless with the project's tileset", async () => {
    const { kinds, view, values, registry, prefabs, scene } = pageSide();
    const rapier = await loadRapier();
    for (const cut of [tilemapScene(scene, undefined), tilemapScene(scene, HEX_GRID, [0, 0])]) {
      const runtime = createHeadlessRuntime({
        rapier,
        game: smokeGame,
        registry,
        project: runtimeView(view, values, registry, kinds),
        scene: expandScene(cut, registry, { prefabs }),
      });
      try {
        runtime.step(1000 / 60, []);
      } finally {
        runtime.destroy();
      }
    }
  });
});

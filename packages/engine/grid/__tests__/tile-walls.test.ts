// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { pxPerMetreOf } from "../../game/units";
import type { TilesetFile } from "../../project/kinds/tileset";
import type { ProjectRuntimeView } from "../../project/runtime-view";
import { gridRoute } from "../../runtime/grid";
import { createSceneRuntime, saveHostOf } from "../../runtime/runtime";
import { paintGrid, type CellEdit, type CellRect, type GridCells } from "../../scene/grid";
import type { ExpandedScene, RuntimeEntity } from "../../scene/types";
import { flowField } from "../flow";
import type { Cell } from "../geometry";
import { findPath } from "../path";

const registry = createRegistry(testGame);
const PPM = pxPerMetreOf(registry);
/** m: one cell. */
const CELL = 0.32;
const TILE_PX = Math.round(CELL * PPM);

/** Tile values (id + 1). */
const WALL = 1;
const MUD = 2;
const ROAD = 3;

const TILESET: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: "texture-tiles",
  tile: [TILE_PX, TILE_PX],
  columns: 4,
  tiles: [
    { id: 0, solid: true },
    { id: 1, cost: 60 },
    { id: 2, cost: 10 },
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
      ? (TILESET as T)
      : undefined) as ProjectRuntimeView["doc"],
  docs: () => [],
};

const cells = (edit: { cells?: readonly CellEdit[]; rects?: readonly CellRect[] }): GridCells =>
  paintGrid({}, edit).grid;

const tilemap = (id: string, grid: GridCells): RuntimeEntity => ({
  id,
  type: "tilemap",
  at: [0, 0],
  tileset: "tileset-test",
  cells: grid,
});

function load(entities: RuntimeEntity[]) {
  const scene: ExpandedScene = {
    name: "tile-walls",
    game: testGame.id,
    bounds: [0, 0, 10 * CELL, 10 * CELL],
    settings: {
      gravity: [0, 0],
      physics: "none",
      grid: { kind: "square", cell: [CELL, CELL] },
      view: { projection: "orthogonal" },
    },
    entities,
  };
  const rt = createSceneRuntime({ rapier: null, view: null, game: testGame, project });
  const report = rt.load(scene);
  if (!report.ok) throw new Error(report.error);
  const grid = rt.ctx.grid!;
  return { rt, grid };
}

/** A wall down column 5 from row 0 to row 8, leaving row 9 open. */
const WALL_COLUMN: CellRect = [5, 0, 5, 8, WALL];

describe("tiles on the grid", () => {
  it("walls the cells solid tiles cover", () => {
    const { grid } = load([tilemap("map", cells({ rects: [WALL_COLUMN] }))]);
    expect(grid.occupancy.wall([5, 3])).toBe(true);
    expect(grid.passable([5, 3])).toBe(false);
    expect(grid.passable([5, 9])).toBe(true);
    expect(grid.passable([4, 3])).toBe(true);
    const path = gridRoute(grid, [0, 0], [9, 0], false)!;
    expect(path.cells.some(([c, r]) => c === 5 && r < 9)).toBe(false);
    expect(path.cells).toContainEqual([5, 9]);
  });

  it("routes around a dear tile, through a plain one", () => {
    const mudRow: CellRect = [1, 0, 8, 0, MUD];
    const plain = load([tilemap("map", cells({ rects: [[1, 0, 8, 0, ROAD]] }))]).grid;
    expect(gridRoute(plain, [0, 0], [9, 0], false)!.cells.every(([, r]) => r === 0)).toBe(true);

    const { grid } = load([tilemap("map", cells({ rects: [mudRow] }))]);
    expect(grid.cost?.([0, 0], [1, 0])).toBe(50);
    expect(grid.cost?.([0, 0], [0, 1])).toBe(0);
    const path = gridRoute(grid, [0, 0], [9, 0], false)!;
    expect(path.cells.some(([c, r]) => r === 0 && c > 0 && c < 9)).toBe(false);
    expect(path.cost).toBe(110);

    const cost = (f: Cell, t: Cell) => grid.cost?.(f, t) ?? 0;
    const passable = (c: Cell) => grid.passable(c);
    const field = flowField(grid.geometry, [[9, 0]], { passable, cost, bounds: grid.bounds });
    expect(field.cost([0, 0])).toBe(110);
    expect(findPath(grid.geometry, [0, 0], [9, 0], { passable, bounds: grid.bounds })!.cost).toBe(
      90,
    );
  });

  it("opens a corridor a runtime write paints, for the next tick's path", () => {
    const { rt, grid } = load([tilemap("map", cells({ rects: [[5, 0, 5, 9, WALL]] }))]);
    expect(gridRoute(grid, [0, 0], [9, 0], false)).toBeNull();
    rt.ctx.tiles.paint("map", { cells: [[5, 4, 0]] });
    rt.step(1000 / 60, []);
    const path = gridRoute(rt.ctx.grid!, [0, 0], [9, 0], false)!;
    expect(path.cells).toContainEqual([5, 4]);
    expect(rt.ctx.grid!.occupancy.wall([5, 3])).toBe(true);
  });

  it("walls a map spawned at runtime, follows its writes, and reopens when it's destroyed", () => {
    const { rt } = load([]);
    rt.ctx.spawn(tilemap("tilemap#spawned", cells({ rects: [WALL_COLUMN] })));
    rt.step(1000 / 60, []);
    const grid = rt.ctx.grid!;
    expect(grid.passable([5, 3])).toBe(false);
    expect(grid.passable([5, 9])).toBe(true);

    rt.ctx.tiles.paint("tilemap#spawned", { cells: [[5, 4, 0]] });
    rt.step(1000 / 60, []);
    expect(grid.passable([5, 4])).toBe(true);
    expect(grid.passable([5, 3])).toBe(false);

    rt.ctx.destroy("tilemap#spawned");
    rt.step(1000 / 60, []);
    expect(grid.passable([5, 3])).toBe(true);
    expect(grid.occupancy.wall([5, 0])).toBe(false);
  });

  it("walls a map spawned or destroyed outside a step at once", () => {
    const { rt } = load([tilemap("map", cells({ rects: [[1, 1, 1, 1, WALL]] }))]);
    rt.ctx.destroy("map");
    rt.ctx.spawn(tilemap("tilemap#other", cells({ rects: [WALL_COLUMN] })));
    const grid = rt.ctx.grid!;
    expect(grid.passable([1, 1])).toBe(true);
    expect(grid.passable([5, 3])).toBe(false);
  });

  it("walls a spawned map a world save puts back", () => {
    const { rt } = load([]);
    rt.ctx.spawn(tilemap("tilemap#spawned", cells({ rects: [WALL_COLUMN] })));
    rt.ctx.tiles.paint("tilemap#spawned", { cells: [[5, 4, 0]] });
    rt.step(1000 / 60, []);
    const world = saveHostOf(rt.ctx)!.captureWorld();

    const fresh = load([]).rt;
    expect(fresh.ctx.grid!.passable([5, 3])).toBe(true);
    expect(saveHostOf(fresh.ctx)!.restoreWorld(world, [])).toBeNull();
    const grid = fresh.ctx.grid!;
    expect(grid.passable([5, 3])).toBe(false);
    expect(grid.passable([5, 4])).toBe(true);
  });
});

// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { TilemapVisual } from "../context";
import { createRegistry } from "../game/define";
import { pxPerMetreOf } from "../game/units";
import type { TilesetFile } from "../project/kinds/tileset";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { createSceneRuntime } from "../runtime/runtime";
import {
  paintGrid,
  type CellEdit,
  type CellRect,
  type ChunkKey,
  type GridCells,
} from "../scene/grid";
import type { ExpandedScene, RuntimeEntity, ShapeObj } from "../scene/types";
import { oneWayPasses } from "../systems/bodies";
import type { TilemapSystem } from "../systems/tilemap";
import type { RapierModule } from "../types";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;
const BOUNCY_MATERIAL = "material-bouncy";
const registry = createRegistry(testGame);
const withMaterial = createRegistry(testGame, {
  materials: {
    [BOUNCY_MATERIAL]: {
      description: "Springy.",
      physics: { friction: 0.25, restitution: 0.8 },
    },
  },
});
const PPM = pxPerMetreOf(registry);
/** m: one cell. */
const CELL = 0.32;
const TILE_PX = Math.round(CELL * PPM);

const SOLID = 1;
const UP = 2;
const DOWN = 3;
const BOUNCY = 4;

const TILESET: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: "texture-tiles",
  tile: [TILE_PX, TILE_PX],
  columns: 4,
  tiles: [
    { id: 0, solid: true },
    { id: 1, solid: true, oneWay: "up" },
    { id: 2, solid: true, oneWay: "down" },
    { id: 3, solid: true, material: BOUNCY_MATERIAL },
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

function cells(edit: { cells?: readonly CellEdit[]; rects?: readonly CellRect[] }): GridCells {
  return paintGrid({}, edit).grid;
}

function tilemap(id: string, grid: GridCells, extra: Partial<RuntimeEntity> = {}): RuntimeEntity {
  return { id, type: "tilemap", at: [0, 0], tileset: "tileset-test", cells: grid, ...extra };
}

function scene(physics: "rapier" | "none", entities: RuntimeEntity[]): ExpandedScene {
  return {
    name: "tiles",
    game: testGame.id,
    bounds: [-20, -20, 40, 40],
    settings: {
      gravity: [0, 20],
      physics,
      grid: { kind: "square", cell: [CELL, CELL] },
      view: { projection: "orthogonal" },
    },
    entities,
  };
}

function load(
  physics: "rapier" | "none",
  entities: RuntimeEntity[],
  view: unknown = null,
  reg = registry,
) {
  const rt = createSceneRuntime({
    rapier,
    view: view as never,
    game: testGame,
    registry: reg,
    project,
  });
  const report = rt.load(scene(physics, entities));
  if (!report.ok) throw new Error(report.error);
  const tiles = rt.ctx.system<TilemapSystem>("tilemap")!;
  return { rt, tiles };
}

/** A floor 10 cells wide at row 10, and a one-way ledge of each side above it. */
const floor = cells({
  rects: [[0, 10, 9, 10, SOLID]],
  cells: [
    [2, 5, UP],
    [6, 5, DOWN],
  ],
});

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

describe("tilemap colliders", () => {
  it("tags each collider with its map, tile and first cell, and merges a row into one box", () => {
    for (const physics of ["rapier", "none"] as const) {
      const { rt } = load(physics, [tilemap("map", floor)]);
      const hits = rt.ctx.space.overlaps(box(5 * CELL, 10.5 * CELL, 0.01, 0.01));
      expect(hits.map((h) => h.tag.tile)).toEqual([{ map: "map", tile: 0, cell: [0, 10] }]);
      expect(rt.ctx.tags.handlesOf("map")).toHaveLength(3);
      rt.destroy();
    }
  });

  it("gives a tile's collider its material's surface and tag", () => {
    const row = cells({ rects: [[0, 10, 3, 10, BOUNCY]] });
    for (const physics of ["rapier", "none"] as const) {
      const { rt } = load(physics, [tilemap("map", row)], null, withMaterial);
      const hits = rt.ctx.space.pointAt({ x: 1.5 * CELL, y: 10.5 * CELL });
      expect(
        hits.map((h) => h.tag.material),
        physics,
      ).toEqual([BOUNCY_MATERIAL]);
      if (physics === "rapier") {
        const collider = rt.ctx.physics!.world.getCollider(hits[0]!.handle)!;
        expect(collider.restitution()).toBeCloseTo(0.8);
        expect(collider.friction()).toBeCloseTo(0.25);
      }
      rt.destroy();
    }
  });

  it("builds per collision mode", () => {
    const row = cells({ rects: [[0, 10, 9, 10, SOLID]] });
    const count = (collision: string) => {
      const { rt, tiles } = load("none", [tilemap("map", row, { collision })]);
      const n = tiles.chunkColliders("map").get("0,0") ?? 0;
      const onFloor = rt.ctx.space.pointAt({ x: 5.5 * CELL, y: 10.5 * CELL }).length;
      const onEdge = rt.ctx.space.overlaps(box(5.5 * CELL, 10 * CELL, 0.01, 0.01)).length;
      rt.destroy();
      return { n, onFloor: onFloor > 0, onEdge: onEdge > 0 };
    };
    expect(count("boxes")).toEqual({ n: 1, onFloor: true, onEdge: true });
    expect(count("tiles")).toEqual({ n: 10, onFloor: true, onEdge: true });
    expect(count("outline")).toMatchObject({ n: 1, onEdge: true });
    expect(count("none")).toEqual({ n: 0, onFloor: false, onEdge: false });
  });

  it("closes an outline, so every side of a row stops a probe on both backends", () => {
    const row = cells({ rects: [[2, 10, 6, 10, SOLID]] });
    for (const physics of ["rapier", "none"] as const) {
      const { rt, tiles } = load(physics, [tilemap("map", row, { collision: "outline" })]);
      expect(tiles.chunkColliders("map").get("0,0")).toBe(1);
      const touches = (x: number, y: number) =>
        rt.ctx.space.overlaps(box(x, y, 0.01, 0.01)).length > 0;
      expect(touches(4.5 * CELL, 10 * CELL), `${physics} top`).toBe(true);
      expect(touches(7 * CELL, 10.5 * CELL), `${physics} right`).toBe(true);
      expect(touches(4.5 * CELL, 11 * CELL), `${physics} bottom`).toBe(true);
      expect(touches(2 * CELL, 10.5 * CELL), `${physics} left`).toBe(true);
      expect(touches(1 * CELL, 10.5 * CELL), `${physics} outside`).toBe(false);
      rt.destroy();
    }
  });

  it("gates one-way tiles by side", () => {
    for (const physics of ["rapier", "none"] as const) {
      const { rt, tiles } = load(physics, [tilemap("map", floor)]);
      const upHandle = rt.ctx.space.pointAt({ x: 2.5 * CELL, y: 5.5 * CELL })[0]!;
      const downHandle = rt.ctx.space.pointAt({ x: 6.5 * CELL, y: 5.5 * CELL })[0]!;
      expect(upHandle.tag).toMatchObject({ oneWay: true, oneWaySide: "up" });
      expect(downHandle.tag).toMatchObject({ oneWay: true, oneWaySide: "down" });

      // Above both ledges: the "up" one holds, the "down" one lets the actor through.
      const above = { minX: 0, minY: 4 * CELL, maxX: 10 * CELL, maxY: 5 * CELL };
      tiles.passesOneWay("hero", above, false);
      expect([...oneWayPasses(rt.ctx, "hero")]).toEqual([downHandle.handle]);

      const below = { minX: 0, minY: 6 * CELL, maxX: 10 * CELL, maxY: 7 * CELL };
      tiles.passesOneWay("hero", below, false);
      expect([...oneWayPasses(rt.ctx, "hero")]).toEqual([upHandle.handle]);

      // Dropping through: an "up" ledge passes even from above.
      tiles.passesOneWay("hero", above, true);
      expect(new Set(oneWayPasses(rt.ctx, "hero"))).toEqual(
        new Set([upHandle.handle, downHandle.handle]),
      );
      rt.destroy();
    }
  });

  it("lands a probe body on a tile floor", () => {
    const probe: RuntimeEntity = {
      id: "probe",
      type: "prop",
      shape: box(5 * CELL, 2, 0.1, 0.1),
      density: 1,
      restitution: 0,
    };
    const { rt } = load("rapier", [tilemap("map", floor), probe]);
    for (let i = 0; i < 180; i++) rt.step(DT, []);
    const at = rt.ctx.poses.get("probe")!;
    expect(at.y).toBeCloseTo(10 * CELL - 0.1, 2);
    expect(at.x).toBeCloseTo(5 * CELL, 3);
    rt.destroy();
  });

  it("meets a falling box on the same tick on both backends", () => {
    const contactTick = (physics: "rapier" | "none") => {
      const { rt } = load(physics, [tilemap("map", floor)]);
      let y = 2 * CELL;
      for (let tick = 0; tick < 200; tick++) {
        rt.step(DT, []);
        y += 0.013;
        const hits = rt.ctx.space.overlaps(box(4.5 * CELL, y, 0.1, 0.1));
        if (hits.some((h) => h.tag.tile?.tile === 0)) {
          rt.destroy();
          return tick;
        }
      }
      rt.destroy();
      return -1;
    };
    const onRapier = contactTick("rapier");
    expect(onRapier).toBeGreaterThan(0);
    expect(contactTick("none")).toBe(onRapier);
  });

  it("rebuilds only the chunk an editor update changed", () => {
    const twoChunks = cells({
      rects: [
        [0, 10, 9, 10, SOLID],
        [40, 10, 49, 10, SOLID],
      ],
    });
    for (const physics of ["rapier", "none"] as const) {
      const map = tilemap("map", twoChunks);
      const { rt, tiles } = load(physics, [map]);
      expect(Object.fromEntries(tiles.chunkColliders("map"))).toEqual({ "0,0": 1, "1,0": 1 });
      const right = rt.ctx.space.pointAt({ x: 45.5 * CELL, y: 10.5 * CELL })[0]!.handle;
      const left = rt.ctx.space.pointAt({ x: 5.5 * CELL, y: 10.5 * CELL })[0]!.handle;

      const next = paintGrid(twoChunks, { cells: [[5, 10, 0]] }).grid;
      expect(rt.update([{ ...map, cells: next }])).toEqual({ ok: true });
      expect(Object.fromEntries(tiles.chunkColliders("map"))).toEqual({ "0,0": 2, "1,0": 1 });
      expect(rt.ctx.space.pointAt({ x: 45.5 * CELL, y: 10.5 * CELL })[0]!.handle).toBe(right);
      expect(rt.ctx.space.pointAt({ x: 5.5 * CELL, y: 10.5 * CELL })).toEqual([]);
      expect(rt.ctx.tags.get(left)).toBeUndefined();
      rt.destroy();
    }
  });

  it("collides at its world pose under a moved and turned parent", () => {
    const pivot: RuntimeEntity = { id: "pivot", type: "node", at: [0, 0] };
    const child = tilemap("map", cells({ cells: [[3, 0, SOLID]] }), { parent: "pivot" });
    for (const physics of ["rapier", "none"] as const) {
      const { rt } = load(physics, [pivot, child]);
      expect(rt.ctx.space.pointAt({ x: 3.5 * CELL, y: 0.5 * CELL })).toHaveLength(1);

      rt.ctx.setPose("pivot", 2, 1, 0);
      rt.step(DT, []);
      expect(rt.ctx.space.pointAt({ x: 3.5 * CELL, y: 0.5 * CELL })).toEqual([]);
      expect(rt.ctx.space.pointAt({ x: 2 + 3.5 * CELL, y: 1 + 0.5 * CELL })).toHaveLength(1);

      // A quarter turn clockwise about the pivot carries cell (3, 0) below it.
      rt.ctx.setPose("pivot", 2, 1, Math.PI / 2);
      rt.step(DT, []);
      expect(rt.ctx.space.pointAt({ x: 2 - 0.5 * CELL, y: 1 + 3.5 * CELL })).toHaveLength(1);
      expect(rt.ctx.query.inArea(box(2 - 0.5 * CELL, 1 + 3.5 * CELL, 0.01, 0.01))).toContain("map");
      rt.destroy();
    }
  });

  it("sees the tilemap as one entity over its cells' bounds in area queries", () => {
    const { rt } = load("none", [tilemap("map", floor)]);
    expect(rt.ctx.query.inArea(box(9.5 * CELL, 10.5 * CELL, 0.01, 0.01))).toEqual(["map"]);
    expect(rt.ctx.query.inArea(box(11 * CELL, 10.5 * CELL, 0.01, 0.01))).toEqual([]);
    rt.destroy();
  });

  it("refuses a cell naming a tile the tileset's image doesn't hold", () => {
    const rt = createSceneRuntime({ rapier, view: null, game: testGame, project });
    const report = rt.load(scene("none", [tilemap("map", cells({ cells: [[0, 0, 9]] }))]));
    expect(report).toMatchObject({ ok: false, entityId: "map" });
    rt.destroy();
  });

  it("hands its chunks to the view as data", () => {
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
    const map = tilemap("map", floor);
    const { rt } = load("none", [map], view);
    const tileCalls = () => calls.filter(([k]) => String(k).toLowerCase().includes("til"));
    const first = tileCalls();
    expect(first.map(([k]) => k)).toEqual(["tilemap", "tileChunks"]);
    expect((first[0]![2] as TilemapVisual).cell).toEqual([TILE_PX, TILE_PX]);
    expect(first[1]![3]).toEqual(["0,0"] satisfies ChunkKey[]);
    for (const [, ...args] of first) for (const a of args) expect(typeof a).not.toBe("function");

    calls.length = 0;
    rt.update([{ ...map, cells: paintGrid(floor, { cells: [[40, 0, SOLID]] }).grid }]);
    expect(tileCalls().map(([k, , , dirty]) => [k, dirty])).toEqual([["tileChunks", ["1,0"]]]);
    rt.destroy();
  });
});

import { describe, expect, it } from "vite-plus/test";

import { OCCUPANT } from "../../game/behaviors/occupant";
import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { EngineContext, GameDefinition, SceneSystem } from "../../game/types";
import type { Cell } from "../../grid/geometry";
import { createGridStepper, type GridStepper } from "../../motion/grid-step";
import { expandScene } from "../../scene/expand";
import type { EntityDef, Pt, SceneDefinition } from "../../scene/types";
import { gridWallTypes, sceneGrid } from "../grid";
import { createSceneRuntime } from "../runtime";

/** What each type system's spawn found on `ctx.grid`, by entity id. */
const seenAtSpawn = new Map<string, { grid: boolean; wall: boolean }>();

const piece = defineEntityType({
  type: "piece",
  description: "A point on the board.",
  fields: { at: pointField("Its cell's centre.") },
  system: (ctx): SceneSystem => {
    const live = new Set<string>();
    return {
      spawn(e) {
        if (e.id === "boom") throw new Error("boom");
        live.add(e.id);
        seenAtSpawn.set(e.id, {
          grid: ctx.grid !== null,
          wall: ctx.grid?.occupancy.wall([2, 0]) ?? false,
        });
      },
      despawn: (id) => void live.delete(id),
      clear: () => live.clear(),
      size: () => live.size,
    };
  },
});

type Seen = {
  grid: boolean;
  wall: boolean;
  bounds: unknown;
  occupied: readonly string[];
  stepperCell: Cell | null;
};

let atLoad: Seen | null = null;
let stepper: GridStepper | null = null;

const game: GameDefinition = defineGame({
  id: "grid-load",
  types: [piece],
  time: { kind: "turns" },
  world: { physics: "none" },
  actions: [],
  createRuntime: (ctx: EngineContext) => ({
    onLoad(scene) {
      const grid = ctx.grid;
      const hero = scene.entities.find((e) => e.id === "hero");
      stepper =
        grid && hero
          ? createGridStepper(ctx, hero.id, {
              start: grid.geometry.cellAt(hero.at as Pt),
              msPerStep: 100,
              occupy: true,
            })
          : null;
      atLoad = {
        grid: grid !== null,
        wall: grid?.occupancy.wall([2, 0]) ?? false,
        bounds: grid?.bounds ?? null,
        occupied: grid?.occupancy.at([0, 0]) ?? [],
        stepperCell: stepper?.cell() ?? null,
      };
    },
    snapshot: () => null,
  }),
});
const registry = createRegistry(game);

const entities = [
  { id: "wall", type: "solid", shape: ["box", 25, 5, 5, 5] },
  { id: "hero", type: "piece", at: [5, 5] },
  { id: "token", type: "piece", at: [15, 15], behaviors: { [OCCUPANT.name]: {} } },
] as EntityDef[];

const scene: SceneDefinition = {
  v: 4,
  game: "grid-load",
  name: "grid-load",
  bounds: [0, 0, 50, 30],
  settings: { physics: "none", grid: { kind: "square", cell: [10, 10] } },
  entities,
};

describe("the grid at load", () => {
  it("is built with its walls before anything spawns and before onLoad", () => {
    seenAtSpawn.clear();
    atLoad = null;
    const rt = createSceneRuntime({ rapier: null, view: null, game });
    expect(rt.load(expandScene(scene, registry))).toMatchObject({ ok: true });

    expect(seenAtSpawn.get("hero")).toEqual({ grid: true, wall: true });
    expect(atLoad).toEqual({
      grid: true,
      wall: true,
      bounds: { c0: 0, r0: 0, c1: 4, r1: 2 },
      occupied: ["hero"],
      stepperCell: [0, 0],
    });
    rt.destroy();
  });

  it("stands a stepper made in onLoad and every occupant on its cell before the first tick", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game });
    expect(rt.load(expandScene(scene, registry))).toMatchObject({ ok: true });
    const grid = rt.ctx.grid!;
    expect(rt.ctx.tick).toBe(0);
    expect(grid.occupancy.cellOf("hero")).toEqual([0, 0]);
    expect(grid.occupancy.cellOf("token")).toEqual([1, 1]);
    expect(rt.ctx.poses.get("hero")).toMatchObject({ x: 5, y: 5 });
    expect(grid.passable([0, 0])).toBe(false);
    expect(stepper!.step([1, 0])).toBe(true);
    expect(grid.occupancy.cellOf("hero")).toEqual([1, 0]);
    rt.destroy();
  });

  it("is rebuilt for each load and gone after a failed one", () => {
    const rt = createSceneRuntime({ rapier: null, view: null, game });
    expect(rt.load(expandScene(scene, registry))).toMatchObject({ ok: true });
    const first = rt.ctx.grid;
    expect(rt.load(expandScene(scene, registry))).toMatchObject({ ok: true });
    expect(rt.ctx.grid).not.toBe(first);
    expect(rt.ctx.grid!.occupancy.at([0, 0])).toEqual(["hero"]);

    const boom = {
      ...scene,
      entities: [...entities, { id: "boom", type: "piece", at: [5, 5] }],
    };
    expect(rt.load(expandScene(boom as SceneDefinition, registry))).toMatchObject({ ok: false });
    expect(rt.ctx.grid).toBeNull();
    rt.destroy();
  });
});

describe("gridWallTypes", () => {
  const withWalls = (gridWalls?: readonly string[]) =>
    createRegistry(
      defineGame({ ...game, id: "grid-walls", world: { physics: "none", gridWalls } }),
    );

  it("defaults to solid and takes a game's declared gridWalls", () => {
    expect([...gridWallTypes(registry)]).toEqual(["solid"]);
    expect([...gridWallTypes(withWalls(["piece"]))]).toEqual(["piece"]);
    expect([...gridWallTypes(withWalls([]))]).toEqual([]);
  });

  it("is the set a load and sceneGrid rasterise walls from", () => {
    const expanded = expandScene(scene, registry);
    expect(sceneGrid(expanded, registry)!.occupancy.wall([2, 0])).toBe(true);
    expect(sceneGrid(expanded, registry, [])!.occupancy.wall([2, 0])).toBe(false);

    const none = withWalls([]);
    const rt = createSceneRuntime({ rapier: null, view: null, game: none.game! });
    expect(rt.load(expandScene({ ...scene, game: "grid-walls" }, none))).toMatchObject({
      ok: true,
    });
    expect(rt.ctx.grid!.occupancy.wall([2, 0])).toBe(false);
    rt.destroy();
  });
});

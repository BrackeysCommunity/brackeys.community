import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { OCCUPANT } from "../game/behaviors/occupant";
import { createRegistry, defineEntityType, defineGame } from "../game/define";
import { pointField } from "../game/fields";
import type { GameDefinition, SceneSystem } from "../game/types";
import { createMotionBody, type MotionBody } from "../motion/body";
import { createSceneRuntime } from "../runtime/runtime";
import { expandScene } from "../scene/expand";
import type { EntityDef, GridSettings, SceneDefinition } from "../scene/types";
import type { RapierModule } from "../types";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;

/** A point whose system moves its pose `vx` px right each tick, after the physics step. */
const walker = defineEntityType({
  type: "walker",
  description: "A point that walks right.",
  fields: { at: pointField("Where it starts."), vx: z.number().describe("px per tick.") },
  system: (ctx): SceneSystem => {
    const live = new Map<string, number>();
    return {
      spawn(e) {
        const [x, y] = e.at as [number, number];
        ctx.poses.set(e.id, x, y, 0, { snap: true });
        live.set(e.id, e.vx as number);
      },
      despawn: (id) => void live.delete(id),
      clear: () => live.clear(),
      size: () => live.size,
      afterStep() {
        for (const [id, vx] of live) {
          const p = ctx.poses.get(id)!;
          ctx.poses.set(id, p.x + vx, p.y);
        }
      },
    };
  },
});

/** A motion body that moves `vx` px right each tick, before the physics step. */
const glider = defineEntityType({
  type: "glider",
  description: "A motion body that glides right.",
  fields: { at: pointField("Where it starts."), vx: z.number().describe("px per tick.") },
  system: (ctx): SceneSystem => {
    const live = new Map<string, { body: MotionBody; vx: number }>();
    const drop = (id: string) => {
      live.get(id)?.body.destroy();
      live.delete(id);
    };
    return {
      spawn(e) {
        const [x, y] = e.at as [number, number];
        const shape = { type: "box", cx: 0, cy: 0, hw: 2, hh: 2, rotDeg: 0 } as const;
        live.set(e.id, { body: createMotionBody(ctx, e, { x, y }, { shape }), vx: e.vx as number });
      },
      despawn: drop,
      clear: () => [...live.keys()].forEach(drop),
      size: () => live.size,
      beforeStep() {
        for (const { body, vx } of live.values()) body.move({ x: vx, y: 0 });
      },
    };
  },
});

/** A walker whose system pauses it while disabled, keeping its pose. */
const strider = defineEntityType({
  type: "strider",
  description: "A point that walks right and can be paused.",
  fields: { at: pointField("Where it starts."), vx: z.number().describe("px per tick.") },
  system: (ctx): SceneSystem => {
    const live = new Map<string, number>();
    const paused = new Set<string>();
    return {
      spawn(e) {
        const [x, y] = e.at as [number, number];
        ctx.poses.set(e.id, x, y, 0, { snap: true });
        live.set(e.id, e.vx as number);
      },
      despawn: (id) => void (live.delete(id), paused.delete(id)),
      clear: () => (live.clear(), paused.clear()),
      size: () => live.size,
      afterStep() {
        for (const [id, vx] of live) {
          if (paused.has(id)) continue;
          const p = ctx.poses.get(id)!;
          ctx.poses.set(id, p.x + vx, p.y);
        }
      },
      disable: (id) => void paused.add(id),
      enable: (id) => void paused.delete(id),
    };
  },
});

const game: GameDefinition = defineGame({
  id: "occ",
  types: [walker, glider, strider],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(game);

const GRID: GridSettings = { kind: "square", cell: [10, 10] };

function scene(entities: EntityDef[], over: Partial<SceneDefinition> = {}): SceneDefinition {
  return {
    v: 3,
    game: "occ",
    name: "occupants",
    bounds: [0, 0, 200, 100],
    settings: { gravity: [0, 0], grid: GRID },
    entities,
    ...over,
  };
}

const walk = (id: string, at: [number, number], vx: number, block: object = {}): EntityDef =>
  ({ id, type: "walker", at, vx, behaviors: { [OCCUPANT.name]: block } }) as EntityDef;

function loaded(def: SceneDefinition) {
  const rt = createSceneRuntime({ rapier, view: null, game });
  const report = rt.load(expandScene(def, registry));
  expect(report).toMatchObject({ ok: true });
  return rt;
}

describe("the occupant behavior", () => {
  it("stands each carrier on its pose's cell once the scene loads", () => {
    const rt = loaded(scene([walk("a", [15, 15], 0), walk("b", [17, 12], 0, { blocks: false })]));
    const grid = rt.ctx.grid!;
    expect(grid.occupancy.at([1, 1])).toEqual(["a", "b"]);
    expect(grid.occupancy.cellOf("b")).toEqual([1, 1]);
    expect(grid.occupancy.blocked([1, 1])).toBe(true);
    expect(grid.passable([1, 1])).toBe(false);
    expect(rt.stats().behaviors).toMatchObject({ [OCCUPANT.name]: 2 });
    rt.destroy();
  });

  it("follows the poses a system writes, moving only when the cell changes", () => {
    const rt = loaded(scene([walk("a", [1, 5], 3), walk("still", [5, 5], 0)]));
    const occ = rt.ctx.grid!.occupancy;
    expect(occ.at([0, 0])).toEqual(["a", "still"]);
    const cells: number[] = [];
    for (let i = 0; i < 12; i++) {
      rt.step(DT, []);
      cells.push(occ.cellOf("a")![0]);
    }
    // x after each tick: 4, 7, 10, 13, … 37.
    expect(cells).toEqual([0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(occ.at([0, 0])).toEqual(["still"]);
    expect(occ.at([3, 0])).toEqual(["a"]);
    rt.destroy();
  });

  it.each(["rapier", "none"] as const)(
    "follows a motion body's pose up to the wall that stops it (physics %s)",
    (physics) => {
      const rt = loaded(
        scene(
          [
            { id: "g", type: "glider", at: [5, 5], vx: 4, behaviors: { [OCCUPANT.name]: {} } },
            { id: "wall", type: "solid", shape: ["box", 45, 50, 5, 50] },
          ] as EntityDef[],
          { settings: { gravity: [0, 0], grid: GRID, physics } },
        ),
      );
      const occ = rt.ctx.grid!.occupancy;
      expect(occ.cellOf("g")).toEqual([0, 0]);
      const cells: number[] = [];
      for (let i = 0; i < 12; i++) {
        rt.step(DT, []);
        cells.push(occ.cellOf("g")![0]);
      }
      // x after each tick: 9, 13, 17, … up to the wall's face at 40, less the half-width.
      expect(cells).toEqual([0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
      expect(rt.ctx.poses.get("g")!.x).toBeGreaterThan(37.9);
      expect(occ.at([3, 0])).toEqual(["g"]);
      rt.destroy();
    },
  );

  it("re-places on an edit, takes the new blocks, and leaves when the block or the entity goes", () => {
    const rt = loaded(scene([walk("a", [5, 5], 0), walk("b", [25, 5], 0)]));
    const occ = rt.ctx.grid!.occupancy;
    const expanded = (def: EntityDef) =>
      expandScene(scene([def]), registry).entities.find((e) => e.id === (def.id as string))!;
    expect(rt.update([expanded(walk("a", [55, 35], 0, { blocks: false }))])).toMatchObject({
      ok: true,
    });
    expect(occ.cellOf("a")).toEqual([5, 3]);
    expect(occ.blocked([5, 3])).toBe(false);
    expect(occ.at([0, 0])).toEqual([]);
    const plain = { id: "a", type: "walker", at: [55, 35], vx: 0 } as EntityDef;
    expect(rt.update([expanded(plain)])).toMatchObject({ ok: true });
    expect(occ.cellOf("a")).toBeUndefined();
    expect(occ.at([5, 3])).toEqual([]);
    rt.remove(["b"]);
    expect(occ.cellOf("b")).toBeUndefined();
    expect(rt.stats().behaviors?.[OCCUPANT.name]).toBeUndefined();
    rt.destroy();
  });

  it("leaves occupancy on disable and is re-placed at its pose's cell on enable", () => {
    const stride = {
      id: "s",
      type: "strider",
      at: [5, 5],
      vx: 10,
      behaviors: { [OCCUPANT.name]: {} },
    };
    const rt = loaded(scene([walk("w", [5, 5], 10), stride as EntityDef]));
    const occ = rt.ctx.grid!.occupancy;
    for (let i = 0; i < 3; i++) rt.step(DT, []);
    expect(occ.cellOf("w")).toEqual([3, 0]);
    expect(occ.cellOf("s")).toEqual([3, 0]);

    rt.ctx.setEnabled("w", false);
    rt.ctx.setEnabled("s", false);
    expect(occ.cellOf("w")).toBeUndefined();
    expect(occ.cellOf("s")).toBeUndefined();
    expect(occ.at([3, 0])).toEqual([]);
    rt.step(DT, []);
    expect(occ.at([3, 0])).toEqual([]);

    // The strider's system keeps its pose; the walker's has no hooks, so it spawns again from its record.
    rt.ctx.setEnabled("s", true);
    rt.ctx.setEnabled("w", true);
    expect(occ.cellOf("s")).toEqual([3, 0]);
    expect(occ.cellOf("w")).toEqual([0, 0]);
    rt.step(DT, []);
    expect(occ.cellOf("s")).toEqual([4, 0]);
    expect(occ.cellOf("w")).toEqual([1, 0]);
    rt.destroy();
  });

  it("places nothing without a grid, and clears the grid at unload", () => {
    const rt = loaded(scene([walk("a", [5, 5], 1)], { settings: { gravity: [0, 0] } }));
    expect(rt.ctx.grid).toBeNull();
    rt.step(DT, []);
    rt.unload();
    expect(rt.ctx.grid).toBeNull();
    const again = rt.load(expandScene(scene([walk("a", [5, 5], 0)]), registry));
    expect(again.ok).toBe(true);
    expect(rt.ctx.grid!.occupancy.at([0, 0])).toEqual(["a"]);
    rt.unload();
    expect(rt.ctx.grid).toBeNull();
    rt.destroy();
  });
});

describe("the runtime grid", () => {
  it("marks the cells whose centre a solid holds as walls, and bounds paths to the scene", () => {
    const rt = loaded(
      scene([{ id: "wall", type: "solid", shape: ["box", 50, 50, 10, 30] } as EntityDef]),
    );
    const grid = rt.ctx.grid!;
    expect(grid.bounds).toEqual({ c0: 0, r0: 0, c1: 19, r1: 9 });
    const walls: string[] = [];
    for (let r = 0; r <= 9; r++)
      for (let c = 0; c <= 19; c++) if (grid.occupancy.wall([c, r])) walls.push(`${c},${r}`);
    expect(walls).toEqual([
      "4,2",
      "5,2",
      "4,3",
      "5,3",
      "4,4",
      "5,4",
      "4,5",
      "5,5",
      "4,6",
      "5,6",
      "4,7",
      "5,7",
    ]);
    expect(grid.passable([4, 2])).toBe(false);
    expect(grid.passable([3, 2])).toBe(true);
    expect(grid.passable([20, 0])).toBe(false);
    expect(grid.passable([0, -1])).toBe(false);
    rt.destroy();
  });

  it("keeps walls in step with reconciled solids, leaving walls game code set", () => {
    const rt = loaded(
      scene([{ id: "wall", type: "solid", shape: ["box", 15, 15, 5, 5] } as EntityDef]),
    );
    const occ = rt.ctx.grid!.occupancy;
    expect(occ.wall([1, 1])).toBe(true);
    occ.setWall([9, 9], true);
    const moved = expandScene(
      scene([{ id: "wall", type: "solid", shape: ["box", 35, 15, 5, 5] } as EntityDef]),
      registry,
    ).entities;
    expect(rt.update(moved)).toMatchObject({ ok: true });
    expect(occ.wall([1, 1])).toBe(false);
    expect(occ.wall([3, 1])).toBe(true);
    const more = expandScene(
      scene([{ id: "more", type: "solid", shape: ["box", 75, 15, 5, 5] } as EntityDef]),
      registry,
    ).entities;
    expect(rt.add(more)).toMatchObject({ ok: true });
    expect(occ.wall([7, 1])).toBe(true);
    rt.remove(["wall"]);
    expect(occ.wall([3, 1])).toBe(false);
    expect(occ.wall([7, 1])).toBe(true);
    expect(occ.wall([9, 9])).toBe(true);
    rt.destroy();
  });

  it("rasterises the types a game names in world.gridWalls, and none for []", () => {
    const def = scene([{ id: "wall", type: "solid", shape: ["box", 15, 15, 5, 5] } as EntityDef]);
    const none = defineGame({ ...game, world: { gridWalls: [] } });
    const rt = createSceneRuntime({ rapier, view: null, game: none });
    expect(rt.load(expandScene(def, createRegistry(none))).ok).toBe(true);
    expect(rt.ctx.grid!.occupancy.wall([1, 1])).toBe(false);
    rt.destroy();
  });
});

// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import type { CharacterSystem } from "../game/behaviors/character-top-down";
import { createRegistry, defineGame } from "../game/define";
import { composePose, type Pose } from "../runtime/poses";
import { createSceneRuntime } from "../runtime/runtime";
import { SENSOR_ENTER, type SceneRuntimeHandle, type StepEvent } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { prefabLibrary } from "../scene/prefab";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type ExpandedScene,
  type Prefab,
  type SceneDefinition,
} from "../scene/types";
import { validateScene } from "../scene/validate";
import type { SolidSystem } from "../systems/bodies";
import { testGame } from "./fixtures/test-game";

/** The test game, without its Rapier-driven avatar, so sensors fire and nothing else needs physics. */
const game = defineGame({
  ...testGame,
  createRuntime: () => ({ snapshot: () => null, restore: () => {} }),
});
const registry = createRegistry(game);

function source(entities: EntityDef[], gravity: [number, number]): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    game: game.id,
    name: "tree-geometry",
    bounds: [-30, -30, 30, 30],
    settings: { physics: "none", gravity },
    entities,
  };
}

/** The scene expanded on the geometry backend, each id in `parents` linked under the one it names. */
function scene(
  entities: EntityDef[],
  parents: Record<string, string>,
  gravity: [number, number] = [0, 20],
): ExpandedScene {
  const def = source(entities, gravity);
  expect(validateScene(def, registry).filter((i) => i.code === "physics-required")).toEqual([]);
  const out = expandScene(def, registry);
  for (const e of out.entities) {
    const parent = parents[e.id];
    if (parent !== undefined) e.parent = parent;
  }
  return out;
}

function load(
  entities: EntityDef[],
  parents: Record<string, string>,
  gravity?: [number, number],
): SceneRuntimeHandle {
  const rt = createSceneRuntime({ rapier: null, view: null, game });
  const report = rt.load(scene(entities, parents, gravity));
  if (!report.ok) throw new Error(`${report.reason ?? ""} ${report.error}`);
  expect(rt.ctx.physics).toBeNull();
  return rt;
}

function steps(rt: SceneRuntimeHandle, n: number): StepEvent[] {
  const events: StepEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...rt.step(rt.ctx.time.tickMs, []).events);
  return events;
}

const pose = (rt: SceneRuntimeHandle, id: string) => rt.ctx.poses.get(id)!;

/** Who the geometry world has at (x, y), any group. */
const at = (rt: SceneRuntimeHandle, x: number, y: number) =>
  rt.ctx.space
    .overlaps({ type: "circle", cx: x, cy: y, r: 0.02 }, { sensors: true })
    .map((h) => h.tag.entityId)
    .sort();

const close = (got: Readonly<Pose> | undefined, want: Pose, what: string, digits = 6) => {
  expect(got, what).toBeDefined();
  expect(got!.x, `${what}.x`).toBeCloseTo(want.x, digits);
  expect(got!.y, `${what}.y`).toBeCloseTo(want.y, digits);
  expect(got!.rot, `${what}.rot`).toBeCloseTo(want.rot, digits);
};

/** No `physics-required` anywhere in a run's events. */
const noPhysicsAsked = (events: readonly StepEvent[]) =>
  expect(JSON.stringify(events)).not.toContain("physics-required");

/** A kinematic collider on a node: the geometry world's stand-in for a body that carries. */
const kinematicNode = (id: string, x: number, y: number, rot = 0): EntityDef => ({
  id,
  type: "node",
  at: [x, y],
  ...(rot ? { rot } : {}),
  behaviors: {
    collider: { shape: ["box", 0, 0, 0.5, 0.1] },
    body: { kind: "kinematic" },
  },
});

describe("geometry colliders under a parent follow it by pose", () => {
  it("moves a child solid's and a child sensor's colliders with a node that moves and turns", () => {
    const rt = load(
      [
        { id: "hub", type: "node", at: [0, 0] },
        { id: "shelf", type: "solid", shape: ["box", 2, 0, 0.5, 0.1] },
        { id: "lid", type: "sensor", shape: ["box", 0, -2, 0.3, 0.1] },
      ],
      { shelf: "hub", lid: "hub" },
      [0, 0],
    );
    steps(rt, 1);
    expect(at(rt, 2, 0)).toEqual(["shelf"]);
    expect(at(rt, 0, -2)).toEqual(["lid"]);

    rt.ctx.setPose("hub", 5, 5, Math.PI / 2);
    const events = steps(rt, 2);
    const shelf = composePose(5, 5, Math.PI / 2, { x: 2, y: 0, rot: 0 });
    const lid = composePose(5, 5, Math.PI / 2, { x: 0, y: -2, rot: 0 });
    close(pose(rt, "shelf"), shelf, "shelf");
    close(pose(rt, "lid"), lid, "lid");
    expect(at(rt, shelf.x, shelf.y)).toEqual(["shelf"]);
    expect(at(rt, lid.x, lid.y)).toEqual(["lid"]);
    expect(at(rt, 2, 0)).toEqual([]);
    expect(at(rt, 0, -2)).toEqual([]);
    noPhysicsAsked(events);
    rt.destroy();
  });

  it("carries a child sensor onto what it then reports", () => {
    const rt = load(
      [
        kinematicNode("cart", 0, 0),
        { id: "scoop", type: "sensor", shape: ["box", 0, -1, 0.3, 0.3] },
        {
          id: "rock",
          type: "marker",
          at: [4, -1],
          behaviors: { collider: { shape: ["box", 0, 0, 0.2, 0.2], group: "dynamic" } },
        },
      ],
      { scoop: "cart" },
      [0, 0],
    );
    expect(steps(rt, 5).filter((e) => e.type === SENSOR_ENTER)).toEqual([]);
    rt.ctx.bodies.setVelocity("cart", { x: 2, y: 0 });
    const events = steps(rt, 120);
    expect(pose(rt, "cart").x).toBeCloseTo(4, 3);
    expect(pose(rt, "scoop").x - pose(rt, "cart").x).toBeCloseTo(0, 6);
    expect(
      events.some((e) => e.type === SENSOR_ENTER && e.entityId === "scoop" && e.other === "rock"),
    ).toBe(true);
    noPhysicsAsked(events);
    rt.destroy();
  });

  it("moves a child's collider with a kinematic node's velocity, a character standing on it carried", () => {
    const rt = load(
      [
        kinematicNode("host", 0, 3),
        { id: "deck", type: "solid", shape: ["box", 4, 2.9, 1, 0.1] },
        {
          id: "hero",
          type: "marker",
          at: [4.5, 2.8 - 0.4 - 0.0005],
          behaviors: {
            collider: { shape: ["box", 0, 0, 0.2, 0.4] },
            "character-side-view": {},
          },
        },
      ],
      { deck: "host" },
    );
    steps(rt, 30);
    const start = pose(rt, "hero").x;
    const characters = rt.ctx.behavior<CharacterSystem>("character-side-view")!;
    expect(characters.grounded("hero")).toBe(true);

    rt.ctx.bodies.setVelocity("host", { x: 1, y: 0 });
    const events = steps(rt, 60);
    expect(pose(rt, "host").x).toBeCloseTo(1, 3);
    expect(pose(rt, "deck").x).toBeCloseTo(5, 3);
    expect(at(rt, 5.9, 2.9)).toContain("deck");
    expect(pose(rt, "hero").x - start).toBeCloseTo(1, 1);
    expect(characters.grounded("hero")).toBe(true);
    noPhysicsAsked(events);
    rt.destroy();
  });

  it("carries a character standing on a child solid of a node a tween moves", () => {
    const rt = load(
      [
        {
          id: "barge",
          type: "node",
          at: [0, 3],
          behaviors: { tween: { tweens: [{ to: { x: 2 }, duration: 60, delay: 30 }] } },
        },
        { id: "deck", type: "solid", shape: ["box", 0, 3, 1.5, 0.1] },
        {
          id: "hero",
          type: "marker",
          at: [0, 2.9 - 0.4 - 0.0005],
          behaviors: {
            collider: { shape: ["box", 0, 0, 0.2, 0.4] },
            "character-side-view": {},
          },
        },
      ],
      { deck: "barge" },
    );
    steps(rt, 30);
    const characters = rt.ctx.behavior<CharacterSystem>("character-side-view")!;
    expect(characters.grounded("hero")).toBe(true);
    const start = pose(rt, "hero").x;
    const events = steps(rt, 70);
    expect(pose(rt, "barge").x).toBe(2);
    expect(pose(rt, "deck").x).toBeCloseTo(2, 6);
    expect(at(rt, 3.4, 3)).toContain("deck");
    expect(pose(rt, "hero").x - start).toBeCloseTo(2, 1);
    expect(characters.grounded("hero")).toBe(true);
    noPhysicsAsked(events);
    rt.destroy();
  });

  it("moves a collider to a new parent's frame on setParent, and keeps it where it is for none", () => {
    const rt = load(
      [
        kinematicNode("a", 0, 0),
        kinematicNode("b", 5, 0),
        { id: "plate", type: "solid", shape: ["box", 0, 1, 0.5, 0.1] },
      ],
      { plate: "a" },
      [0, 0],
    );
    rt.ctx.tree.setParent("plate", "b");
    expect(rt.ctx.tree.parent("plate")).toBe("b");
    expect(pose(rt, "plate")).toMatchObject({ x: 0, y: 1 });
    rt.ctx.setPose("b", 5, 3);
    steps(rt, 1);
    expect(pose(rt, "plate")).toMatchObject({ x: 0, y: 4 });
    expect(at(rt, 0, 4)).toEqual(["plate"]);
    rt.ctx.setPose("a", 0, -3);
    steps(rt, 1);
    expect(pose(rt, "plate")).toMatchObject({ x: 0, y: 4 });

    rt.ctx.tree.setParent("plate", null);
    rt.ctx.setPose("b", 5, 0);
    steps(rt, 1);
    expect(pose(rt, "plate")).toMatchObject({ x: 0, y: 4 });
    expect(at(rt, 0, 4)).toEqual(["plate"]);
    expect(rt.ctx.system<SolidSystem>("solid")!.position("plate")).toEqual({ x: 0, y: 4 });
    rt.destroy();
  });

  it("gates a one-way child by its box as its turned parent holds it", () => {
    const rt = load(
      [
        kinematicNode("host", 0, 0, 90),
        { id: "plank", type: "solid", oneWay: true, shape: ["box", 2, 0, 1, 0.1] },
      ],
      { plank: "host" },
      [0, 0],
    );
    steps(rt, 1);
    close(pose(rt, "plank"), { x: 2, y: 0, rot: 0 }, "plank");
    const solids = rt.ctx.system<SolidSystem>("solid")!;
    solids.gateOneWaySides({ minX: 1.8, minY: -0.9, maxX: 2.2, maxY: -0.1 }, false);
    expect(solids.isHidden("plank")).toBe(false);
    solids.gateOneWaySides({ minX: 1.8, minY: 0.2, maxX: 2.2, maxY: 1 }, false);
    expect(solids.isHidden("plank")).toBe(true);
    rt.destroy();
  });
});

describe("a bodiless follower", () => {
  const lift: EntityDef = {
    id: "lift",
    type: "follower",
    shape: ["box", 0, 0, 0.4, 0.08],
    path: {
      pts: [
        [4, 6],
        [8, 6],
      ],
      mode: "ping_pong",
      speed: 1,
    },
  };

  it("carries a child marker and a child solid along its path", () => {
    const rt = load(
      [
        lift,
        { id: "lamp", type: "marker", at: [4, 5] },
        { id: "plank", type: "solid", shape: ["box", 5, 5.9, 0.6, 0.04] },
      ],
      { lamp: "lift", plank: "lift" },
      [0, 0],
    );
    const events = steps(rt, 90);
    const l = pose(rt, "lift");
    expect(l.x).toBeGreaterThan(5);
    expect(pose(rt, "lamp").x - l.x).toBeCloseTo(0, 6);
    expect(pose(rt, "lamp").y - l.y).toBeCloseTo(-1, 6);
    expect(pose(rt, "plank").x - l.x).toBeCloseTo(1, 6);
    expect(pose(rt, "plank").y - l.y).toBeCloseTo(-0.1, 6);
    expect(at(rt, pose(rt, "plank").x, pose(rt, "plank").y)).toEqual(["plank"]);
    noPhysicsAsked(events);
    rt.destroy();
  });

  it("moves a child solid's collider as a tween moves its offset", () => {
    const rt = load(
      [
        lift,
        {
          id: "plank",
          type: "solid",
          shape: ["box", 5, 5.9, 0.6, 0.04],
          behaviors: { tween: { tweens: [{ to: { y: -0.5 }, duration: 30 }] } },
        },
      ],
      { plank: "lift" },
      [0, 0],
    );
    steps(rt, 60);
    const l = pose(rt, "lift");
    const p = pose(rt, "plank");
    expect(p.x - l.x).toBeCloseTo(1, 6);
    expect(p.y - l.y).toBeCloseTo(-0.5, 6);
    expect(rt.ctx.tree.local("plank")).toMatchObject({ y: expect.closeTo(-0.5, 6) });
    expect(at(rt, p.x, p.y)).toEqual(["plank"]);
    steps(rt, 60);
    expect(pose(rt, "plank").y - pose(rt, "lift").y).toBeCloseTo(-0.5, 6);
    rt.destroy();
  });

  it("carries a character standing on its child solid, as it carries one standing on itself", () => {
    const hero = (id: string, x: number, top: number): EntityDef => ({
      id,
      type: "marker",
      at: [x, top - 0.4 - 0.0005],
      behaviors: {
        collider: { shape: ["box", 0, 0, 0.1, 0.4], group: "dynamic" },
        "character-side-view": {},
      },
    });
    const low: EntityDef = {
      ...lift,
      path: {
        pts: [
          [4, 7],
          [8, 7],
        ],
        mode: "ping_pong",
        speed: 1,
      },
    };
    const rt = load(
      [
        low,
        { id: "plank", type: "solid", shape: ["box", 5, 5.96, 0.6, 0.04] },
        hero("rider", 5, 5.92),
        hero("stander", 4, 6.92),
      ],
      { plank: "lift" },
    );
    steps(rt, 1);
    const characters = rt.ctx.behavior<CharacterSystem>("character-side-view")!;
    expect(characters.grounded("rider")).toBe(true);
    expect(characters.grounded("stander")).toBe(true);
    const start = {
      lift: pose(rt, "lift").x,
      rider: pose(rt, "rider").x,
      stander: pose(rt, "stander").x,
    };
    const events = steps(rt, 90);
    const moved = pose(rt, "lift").x - start.lift;
    expect(moved).toBeGreaterThan(1);
    expect(pose(rt, "stander").x - start.stander).toBeCloseTo(moved, 1);
    expect(pose(rt, "rider").x - start.rider).toBeCloseTo(moved, 1);
    expect(characters.grounded("rider")).toBe(true);
    noPhysicsAsked(events);
    rt.destroy();
  });

  it("destroys its children with it", () => {
    const rt = load(
      [lift, { id: "plank", type: "solid", shape: ["box", 5, 5.9, 0.6, 0.04] }],
      { plank: "lift" },
      [0, 0],
    );
    steps(rt, 1);
    rt.ctx.destroy("lift");
    steps(rt, 1);
    expect(rt.ctx.exists("lift")).toBe(false);
    expect(rt.ctx.exists("plank")).toBe(false);
    rt.destroy();
  });
});

describe("nothing asks for Rapier", () => {
  const CART: Prefab = {
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    id: "cart",
    entities: [
      {
        id: "bed",
        type: "solid",
        shape: ["box", 0, 0, 1, 0.1],
      },
      {
        id: "flag",
        type: "sensor",
        shape: ["box", 0, -1, 0.1, 0.5],
      },
    ],
  };
  const prefabs = prefabLibrary([CART]);

  it("loads, instantiates and spawns children under parents with no physics world", () => {
    const def: SceneDefinition = {
      ...source([{ id: "yard", type: "node", at: [0, 0] }], [0, 0]),
      instances: [{ id: "cart", prefab: "cart", at: [3, 3], rot: 90 }],
    };
    expect(
      validateScene(def, registry, { prefabs }).filter((i) => i.code === "physics-required"),
    ).toEqual([]);
    const rt = createSceneRuntime({ rapier: null, view: null, game, prefabs });
    const report = rt.load(expandScene(def, registry, { prefabs }));
    if (!report.ok) throw new Error(`${report.reason ?? ""} ${report.error}`);
    expect(rt.ctx.tree.parent("cart/bed")).toBe("cart");

    const second = rt.ctx.instantiate("cart", { x: -3, y: 0 }, { id: "cart#two", parent: "yard" });
    expect(rt.ctx.tree.parent(second.id)).toBe("yard");
    expect(second.entities.map((id) => rt.ctx.tree.parent(id))).toEqual([second.id, second.id]);
    rt.ctx.spawn({
      id: "solid#post",
      type: "solid",
      shape: ["box", 0, 0, 0.1, 0.1],
      parent: second.id,
      local: true,
    });
    const events = steps(rt, 2);
    expect(rt.ctx.tree.parent("solid#post")).toBe(second.id);

    rt.ctx.setPose("yard", 0, 10);
    steps(rt, 1);
    expect(pose(rt, second.id)).toMatchObject({ x: -3, y: 10 });
    expect(pose(rt, "solid#post")).toMatchObject({ x: -3, y: 10 });
    expect(at(rt, -3, 10)).toContain("solid#post");
    noPhysicsAsked(events);
    rt.destroy();
  });
});

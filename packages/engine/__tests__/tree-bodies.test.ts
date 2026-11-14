import type { Collider } from "@dimforge/rapier2d";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { CharacterSystem } from "../game/behaviors/character-top-down";
import { createRegistry } from "../game/define";
import type { Registry } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import { SENSOR_ENTER, type SceneRuntimeHandle } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef, type ExpandedScene } from "../scene/types";
import type { SolidSystem } from "../systems/bodies";
import type { RapierModule } from "../types";
import { testGame } from "./fixtures/test-game";
import { stepEvents, withParents } from "./fixtures/tree-rig";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const game = createRegistry(testGame);
const engine = createRegistry();

/** The scene expanded, each id in `parents` linked under the one it names. */
function scene(
  entities: EntityDef[],
  parents: Record<string, string>,
  opts: { registry?: Registry; gravity?: [number, number] } = {},
): ExpandedScene {
  const registry = opts.registry ?? game;
  const out = expandScene(
    {
      v: SCENE_FORMAT_VERSION,
      ...(registry === game ? { game: testGame.id } : {}),
      name: "tree-bodies",
      bounds: [-20, -20, 20, 20],
      settings: { physics: "rapier", gravity: opts.gravity ?? [0, 20] },
      entities,
    },
    registry,
  );
  return withParents(out, parents);
}

function load(
  entities: EntityDef[],
  parents: Record<string, string>,
  opts: { registry?: Registry; gravity?: [number, number] } = {},
): SceneRuntimeHandle {
  const registry = opts.registry ?? game;
  const rt = createSceneRuntime({ rapier, view: null, registry });
  const report = rt.load(scene(entities, parents, opts));
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const colliderOf = (rt: SceneRuntimeHandle, id: string): Collider =>
  rt.ctx.physics!.world.getCollider(rt.ctx.tags.handlesOf(id)[0]!)!;
const bodyHandle = (rt: SceneRuntimeHandle, id: string) => colliderOf(rt, id).parent()!.handle;
const pose = (rt: SceneRuntimeHandle, id: string) => rt.ctx.poses.get(id)!;

const floor: EntityDef = { id: "floor", type: "solid", shape: ["box", 0, 5.5, 20, 0.5] };

describe("colliders on the nearest body", () => {
  it("puts a solid and a sensor under a dynamic prop on the prop's body, where they collide as part of it", () => {
    const ball = (id: string, x: number): EntityDef => ({
      id,
      type: "prop",
      shape: ["circle", x, -3, 0.2],
      density: 1,
      restitution: 0,
    });
    const rt = load(
      [
        floor,
        {
          id: "crate",
          type: "prop",
          shape: ["box", 0, 0, 0.5, 0.5],
          density: 1,
          restitution: 0,
          fixedRotation: true,
        },
        { id: "shelf", type: "solid", shape: ["box", 1, 0, 0.5, 0.1] },
        { id: "lid", type: "sensor", shape: ["box", 0, -0.6, 0.3, 0.1] },
        ball("ball", 0),
        ball("pea", 1),
      ],
      { shelf: "crate", lid: "crate" },
    );
    const crate = bodyHandle(rt, "crate");
    expect(bodyHandle(rt, "shelf")).toBe(crate);
    expect(bodyHandle(rt, "lid")).toBe(crate);
    // the floor, the crate and the two balls: the children brought no body of their own
    expect(rt.ctx.physics!.world.bodies.len()).toBe(4);
    expect(rt.ctx.tags.get(colliderOf(rt, "shelf").handle)).toMatchObject({
      entityId: "shelf",
      carrier: { entityId: "crate", type: "prop" },
    });

    const events = stepEvents(rt, 180);
    expect(pose(rt, "crate").y).toBeCloseTo(4.5, 1);
    // the shelf goes where the crate goes, and holds the pea up off the floor
    expect(pose(rt, "shelf").x - pose(rt, "crate").x).toBeCloseTo(1, 6);
    expect(pose(rt, "shelf").y - pose(rt, "crate").y).toBeCloseTo(0, 6);
    expect(colliderOf(rt, "shelf").translation().x - pose(rt, "crate").x).toBeCloseTo(1, 4);
    expect(pose(rt, "pea").x).toBeCloseTo(1, 1);
    expect(pose(rt, "pea").y).toBeCloseTo(pose(rt, "crate").y - 0.3, 1);
    // the lid sees the ball land on the crate
    expect(
      events.some((e) => e.type === SENSOR_ENTER && e.entityId === "lid" && e.other === "ball"),
    ).toBe(true);
    rt.destroy();
  });

  it("carries a child of a kinematic collider, and what stands on it, a character included", () => {
    const rt = load(
      [
        {
          id: "host",
          type: "node",
          at: [0, 3],
          behaviors: {
            collider: { shape: ["box", 0, 0, 1.5, 0.1] },
            body: { kind: "kinematic" },
          },
        },
        { id: "deck", type: "solid", shape: ["box", 4, 2.9, 1, 0.1] },
        {
          id: "crate",
          type: "prop",
          shape: ["box", 3.6, 2.6, 0.2, 0.2],
          density: 1,
          restitution: 0,
          friction: 1,
        },
        {
          id: "hero",
          type: "marker",
          at: [4.5, 2.8 - 0.4 - 0.0005],
          behaviors: {
            collider: { shape: ["box", 0, 0, 0.2, 0.4] },
            "character-side-view": {},
          },
        },
      ] as EntityDef[],
      { deck: "host" },
    );
    expect(bodyHandle(rt, "deck")).toBe(bodyHandle(rt, "host"));
    stepEvents(rt, 30);
    const start = { crate: pose(rt, "crate").x, hero: pose(rt, "hero").x };
    const characters = rt.ctx.behavior<CharacterSystem>("character-side-view")!;
    expect(characters.grounded("hero")).toBe(true);

    rt.ctx.bodies.setVelocity("host", { x: 1, y: 0 });
    stepEvents(rt, 60);
    expect(pose(rt, "host").x).toBeCloseTo(1, 3);
    expect(pose(rt, "deck").x).toBeCloseTo(5, 3);
    expect(colliderOf(rt, "deck").translation().x).toBeCloseTo(5, 3);
    expect(pose(rt, "crate").x - start.crate).toBeCloseTo(1, 1);
    expect(pose(rt, "hero").x - start.hero).toBeCloseTo(1, 1);
    expect(characters.grounded("hero")).toBe(true);
    rt.destroy();
  });

  it("moves a collider between bodies on setParent, and back onto its own for no parent", () => {
    const prop = (id: string, x: number): EntityDef => ({
      id,
      type: "prop",
      shape: ["box", x, 0, 0.5, 0.5],
      density: 1,
      restitution: 0,
    });
    const rt = load(
      [prop("a", 0), prop("b", 5), { id: "plate", type: "solid", shape: ["box", 0, 1, 0.5, 0.1] }],
      { plate: "a" },
      { gravity: [0, 0] },
    );
    const bodies = () => rt.ctx.physics!.world.bodies.len();
    expect(bodyHandle(rt, "plate")).toBe(bodyHandle(rt, "a"));
    expect(bodies()).toBe(2);

    rt.ctx.tree.setParent("plate", "b");
    expect(bodyHandle(rt, "plate")).toBe(bodyHandle(rt, "b"));
    expect(colliderOf(rt, "plate").translation()).toEqual({ x: 0, y: 1 });
    expect(rt.ctx.tags.get(colliderOf(rt, "plate").handle)?.carrier?.entityId).toBe("b");
    expect(rt.ctx.system<SolidSystem>("solid")!.position("plate")).toEqual({ x: 0, y: 1 });

    rt.ctx.tree.setParent("plate", null);
    const own = colliderOf(rt, "plate").parent()!;
    expect(own.isFixed()).toBe(true);
    expect([bodyHandle(rt, "a"), bodyHandle(rt, "b")]).not.toContain(own.handle);
    expect(colliderOf(rt, "plate").translation()).toEqual({ x: 0, y: 1 });
    expect(bodies()).toBe(3);
    rt.destroy();
  });

  it("moves a riding child's collider on its host's body as a tween moves its offset", () => {
    const rt = load(
      [
        {
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
        },
        {
          id: "plank",
          type: "solid",
          shape: ["box", 5, 5.9, 0.6, 0.04],
          behaviors: { tween: { tweens: [{ to: { y: -0.5 }, duration: 30 }] } },
        },
      ],
      { plank: "lift" },
    );
    const lift = colliderOf(rt, "lift").parent()!;
    expect(bodyHandle(rt, "plank")).toBe(lift.handle);
    expect(rt.ctx.tree.parent("plank")).toBe("lift");
    stepEvents(rt, 60);
    const at = lift.translation();
    const plank = colliderOf(rt, "plank");
    expect(plank.parent()!.handle).toBe(lift.handle);
    expect(plank.translation().x - at.x).toBeCloseTo(1, 4);
    expect(plank.translation().y - at.y).toBeCloseTo(-0.5, 4);
    expect(pose(rt, "plank").x - pose(rt, "lift").x).toBeCloseTo(1, 6);
    expect(pose(rt, "plank").y - pose(rt, "lift").y).toBeCloseTo(-0.5, 6);
    expect(rt.ctx.tree.local("plank")).toMatchObject({ y: expect.closeTo(-0.5, 6) });
    // it stays there as the lift goes on
    stepEvents(rt, 60);
    expect(colliderOf(rt, "plank").translation().y - lift.translation().y).toBeCloseTo(-0.5, 4);
    rt.destroy();
  });

  it("gates a one-way rider by its box as its turned host holds it", () => {
    const rt = load(
      [
        {
          id: "host",
          type: "node",
          at: [0, 0],
          rot: 90,
          behaviors: {
            collider: { shape: ["box", 0, 0, 0.1, 0.1] },
            body: { kind: "kinematic" },
          },
        },
        { id: "plank", type: "solid", oneWay: true, shape: ["box", 2, 0, 1, 0.1] },
      ],
      { plank: "host" },
      { registry: engine, gravity: [0, 0] },
    );
    expect(bodyHandle(rt, "plank")).toBe(bodyHandle(rt, "host"));
    expect(colliderOf(rt, "plank").parent()!.rotation()).toBeCloseTo(Math.PI / 2, 6);
    const t = colliderOf(rt, "plank").translation();
    expect(t.x).toBeCloseTo(2, 5);
    expect(t.y).toBeCloseTo(0, 5);
    const solids = rt.ctx.system<SolidSystem>("solid")!;
    // standing on it, over its middle: on its one-way side
    solids.gateOneWaySides({ minX: 1.8, minY: -0.9, maxX: 2.2, maxY: -0.1 }, false);
    expect(solids.isHidden("plank")).toBe(false);
    // below it: off that side
    solids.gateOneWaySides({ minX: 1.8, minY: 0.2, maxX: 2.2, maxY: 1 }, false);
    expect(solids.isHidden("plank")).toBe(true);
    rt.destroy();
  });
});

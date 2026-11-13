import type { Collider, KinematicCharacterController, RigidBody } from "@dimforge/rapier2d";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { Side } from "../game/types";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import type { Aabb, ExpandedScene, RuntimeEntity, ShapeObj } from "../scene/types";
import { computeMovementSkipping, oneWayPasses, type SolidSystem } from "../systems/bodies";
import type { RapierModule, Vec2 } from "../types";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const DT = 1000 / 60;
const BACKENDS = ["rapier", "none"] as const;
const SIDES: Side[] = ["up", "down", "left", "right"];
/** Each side's outward face direction, +y being down. */
const OUT: Record<Side, Vec2> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});

const ACTOR_HALF = 0.5;
const actorBox = (at: Vec2): Aabb => ({
  minX: at.x - ACTOR_HALF,
  minY: at.y - ACTOR_HALF,
  maxX: at.x + ACTOR_HALF,
  maxY: at.y + ACTOR_HALF,
});

function load(
  entities: RuntimeEntity[],
  physics: "rapier" | "none",
  gravity: [number, number] = [0, 0],
): SceneRuntimeHandle {
  const scene: ExpandedScene = {
    name: "one-way-actors",
    bounds: [-20, -20, 20, 20],
    settings: { gravity, physics, grid: null, view: { projection: "orthogonal" } },
    entities,
  };
  const rt = createSceneRuntime({ rapier, view: null, game: null });
  const report = rt.load(scene);
  if (!report.ok) throw new Error(report.error);
  return rt;
}

const solids = (rt: SceneRuntimeHandle) => rt.ctx.system<SolidSystem>("solid")!;
const handleOf = (rt: SceneRuntimeHandle, id: string) => rt.ctx.tags.handlesOf(id)[0]!;

/** The entity `actorId`'s sweep of its box from `at` by `by`, skipping what it passes. */
function sweepAs(rt: SceneRuntimeHandle, actorId: string, at: Vec2, by: Vec2) {
  const passed = [...oneWayPasses(rt.ctx, actorId)].map((h) => rt.ctx.tags.get(h)!.entityId);
  return rt.ctx.space.sweep(box(at.x, at.y, ACTOR_HALF, ACTOR_HALF), by, {
    exclude: [actorId, ...passed],
  });
}

describe("passesOneWay per actor", () => {
  for (const physics of BACKENDS) {
    for (const side of SIDES) {
      it(`holds the actor on the ${side} side and lets the one past it through, in one tick (${physics})`, () => {
        const rt = load(
          [{ id: "s", type: "solid", shape: box(0, 0, 1, 1), oneWay: side }],
          physics,
        );
        const d = OUT[side];
        const held = { x: d.x * 1.52, y: d.y * 1.52 };
        const through = { x: -d.x * 1.6, y: -d.y * 1.6 };
        const s = handleOf(rt, "s");

        solids(rt).passesOneWay("held", actorBox(held), false);
        solids(rt).passesOneWay("through", actorBox(through), false);

        expect(oneWayPasses(rt.ctx, "held").has(s)).toBe(false);
        expect(oneWayPasses(rt.ctx, "through").has(s)).toBe(true);
        expect(solids(rt).isHidden("s")).toBe(false);

        const into = { x: -d.x, y: -d.y };
        expect(sweepAs(rt, "held", held, into)?.tag.entityId).toBe("s");
        const across = { x: d.x * 3.2, y: d.y * 3.2 };
        expect(sweepAs(rt, "through", through, across)).toBeNull();
        expect(
          rt.ctx.space.sweep(box(through.x, through.y, ACTOR_HALF, ACTOR_HALF), across, {
            exclude: ["through"],
          })?.tag.entityId,
        ).toBe("s");

        solids(rt).passesOneWay("held", actorBox(held), true);
        expect(oneWayPasses(rt.ctx, "held").has(s)).toBe(true);
        solids(rt).passesOneWay("through", actorBox(held), false);
        expect(oneWayPasses(rt.ctx, "through").has(s)).toBe(false);
        rt.destroy();
      });
    }
  }

  it("keeps each system's passes apart and takes a despawned solid's back", () => {
    const rt = load(
      [
        { id: "a", type: "solid", shape: box(0, 0, 1, 0.1), oneWay: true },
        { id: "b", type: "solid", shape: box(5, 0, 1, 0.1), oneWay: true },
        { id: "wall", type: "solid", shape: box(-5, 0, 0.1, 1) },
      ],
      "rapier",
    );
    const below = actorBox({ x: 0, y: 2 });
    solids(rt).passesOneWay("p", below, false);
    const a = handleOf(rt, "a");
    const b = handleOf(rt, "b");
    expect(new Set(oneWayPasses(rt.ctx, "p"))).toEqual(new Set([a, b]));
    solids(rt).despawn("a");
    expect([...oneWayPasses(rt.ctx, "p")]).toEqual([b]);
    solids(rt).reset!();
    expect(oneWayPasses(rt.ctx, "p").size).toBe(0);
    rt.destroy();
  });
});

describe("dynamic bodies and an actor passing", () => {
  /** A wide one-way floor with a crate resting on its left end. */
  const yard = (): RuntimeEntity[] => [
    { id: "floor", type: "solid", shape: box(0, 0, 6, 0.1), oneWay: true },
    { id: "crate", type: "prop", shape: box(-4, -0.3, 0.2, 0.2), density: 1, restitution: 0 },
  ];

  function crateTrace(passThrough: boolean): number[] {
    const rt = load(yard(), "rapier", [0, 10]);
    const below = actorBox({ x: 4, y: 1 });
    const trace: number[] = [];
    for (let i = 0; i < 120; i++) {
      if (passThrough) solids(rt).passesOneWay("actor", below, false);
      rt.step(DT, []);
      const t = rt.ctx.physics!.world.getCollider(handleOf(rt, "crate"))!.translation();
      trace.push(t.x, t.y);
    }
    if (passThrough) expect(oneWayPasses(rt.ctx, "actor").has(handleOf(rt, "floor"))).toBe(true);
    rt.destroy();
    return trace;
  }

  it("a crate on a one-way floor stays on it, step for step, while an actor passes it", () => {
    const passing = crateTrace(true);
    expect(passing).toEqual(crateTrace(false));
    expect(passing.at(-1)!).toBeLessThan(-0.2);
  });

  it("where the world gate drops it", () => {
    const rt = load(yard(), "rapier", [0, 10]);
    for (let i = 0; i < 60; i++) {
      solids(rt).gateOneWaySides(actorBox({ x: 4, y: 1 }), false);
      rt.step(DT, []);
    }
    expect(
      rt.ctx.physics!.world.getCollider(handleOf(rt, "crate"))!.translation().y,
    ).toBeGreaterThan(1);
    rt.destroy();
  });
});

describe("computeMovementSkipping", () => {
  type Mover = { body: RigidBody; collider: Collider; controller: KinematicCharacterController };

  function mover(rt: SceneRuntimeHandle, at: Vec2): Mover {
    const world = rt.ctx.physics!.world;
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y),
    );
    const collider = world.createCollider(rapier.ColliderDesc.cuboid(ACTOR_HALF, ACTOR_HALF), body);
    return { body, collider, controller: world.createCharacterController(0.0001) };
  }

  /** Moves `m` by `by` as `actorId`, skipping what it passes; returns what it travelled. */
  function move(rt: SceneRuntimeHandle, actorId: string, m: Mover, by: Vec2): Vec2 {
    computeMovementSkipping(
      m.controller,
      m.collider,
      new rapier.Vector2(by.x, by.y),
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
      m.collider.collisionGroups(),
      oneWayPasses(rt.ctx, actorId),
    );
    const out = m.controller.computedMovement();
    const t = m.body.translation();
    m.body.setNextKinematicTranslation({ x: t.x + out.x, y: t.y + out.y });
    return { x: out.x, y: out.y };
  }

  it("moves one actor up through the floor while the one above lands on it", () => {
    const rt = load(
      [{ id: "floor", type: "solid", shape: box(0, 0, 6, 0.1), oneWay: true }],
      "rapier",
    );
    rt.step(DT, []);
    const floor = rt.ctx.physics!.world.getCollider(handleOf(rt, "floor"))!;
    const groups = floor.collisionGroups();
    const below = mover(rt, { x: 1, y: 1 });
    const above = mover(rt, { x: -1, y: -1 });
    rt.ctx.physics!.refreshQueries();

    solids(rt).passesOneWay("below", actorBox({ x: 1, y: 1 }), false);
    solids(rt).passesOneWay("above", actorBox({ x: -1, y: -1 }), false);
    expect(move(rt, "below", below, { x: 0, y: -2 }).y).toBeCloseTo(-2, 6);
    expect(move(rt, "above", above, { x: 0, y: 2 }).y).toBeCloseTo(0.4, 3);
    expect(floor.collisionGroups()).toBe(groups);
    rt.destroy();
  });

  it("leaves a crate on the floor step for step while an actor rises through it", () => {
    function trace(x: number): number[] {
      const rt = load(
        [
          { id: "floor", type: "solid", shape: box(0, 0, 6, 0.1), oneWay: true },
          {
            id: "crate",
            type: "prop",
            shape: box(-4, -0.3, 0.2, 0.2),
            density: 1,
            restitution: 0,
          },
        ],
        "rapier",
        [0, 10],
      );
      rt.step(DT, []);
      const m = mover(rt, { x, y: 2 });
      rt.ctx.physics!.refreshQueries();
      const out: number[] = [];
      for (let i = 0; i < 90; i++) {
        const at = m.body.translation();
        solids(rt).passesOneWay("actor", actorBox(at), false);
        move(rt, "actor", m, { x: 0, y: -0.05 });
        rt.step(DT, []);
        const c = rt.ctx.physics!.world.getCollider(handleOf(rt, "crate"))!.translation();
        out.push(c.x, c.y);
      }
      expect(m.body.translation().y).toBeLessThan(-2);
      rt.destroy();
      return out;
    }
    expect(trace(4)).toEqual(trace(12));
  });
});

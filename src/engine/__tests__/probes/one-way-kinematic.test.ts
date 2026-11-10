// @vitest-environment node
/**
 * The one-way collider probe on a moving body: can a collider attached to a
 * path follower's kinematic body stop colliding on its own, without moving
 * the body (which would move the follower and everything on it)? The
 * engine's one-way solids move their whole body out of the world; an
 * attached one needs a per-collider switch that takes effect on the next
 * step and in queries straight away, with no stale contact carrying it over.
 *
 * Answer on Rapier 0.19.3: collision groups do (a query must pass
 * `filterGroups` to respect them); `setEnabled(false)` does nothing to an attached
 * collider's contacts or queries.
 */
import type { Collider, RigidBody, World } from "@dimforge/rapier2d";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import type { Side } from "../../game/types";
import { createSceneRuntime } from "../../runtime/runtime";
import { expandScene } from "../../scene/expand";
import { prefabLibrary } from "../../scene/prefab";
import { aabb, translateShape } from "../../scene/shape-geometry";
import { applyVec, dihedral, type Dihedral } from "../../scene/transform";
import type { ExpandedScene, Pt, RuntimeEntity, ShapeObj } from "../../scene/types";
import type { SolidSystem } from "../../systems/bodies";
import type { RapierModule } from "../../types";

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const ALL = 0xffff_ffff;
const NONE = 0x0000_0000;
/** Where the rider rests: the plank's half-height plus its own. */
const RESTING_Y = -16;

type Rig = { world: World; mover: RigidBody; block: Collider; plank: Collider; rider: RigidBody };

/**
 * A kinematic mover with two colliders, a solid block and a wide one-way
 * plank, and a box resting on the plank.
 */
function rig(): Rig {
  const world = new rapier.World({ x: 0, y: 900 });
  const mover = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
  const block = world.createCollider(
    rapier.ColliderDesc.cuboid(40, 10).setTranslation(-300, 0),
    mover,
  );
  const plank = world.createCollider(
    rapier.ColliderDesc.cuboid(200, 6).setTranslation(100, 0).setFriction(1),
    mover,
  );
  const rider = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(100, -20));
  world.createCollider(rapier.ColliderDesc.cuboid(10, 10).setFriction(1), rider);
  return { world, mover, block, plank, rider };
}

/** Steps `n` ticks with the mover drifting 1px right per tick. */
function run(r: Rig, n: number): void {
  for (let i = 0; i < n; i++) {
    const t = r.mover.translation();
    r.mover.setNextKinematicTranslation({ x: t.x + 1, y: t.y });
    r.world.step();
  }
}

/**
 * Whether a ray straight down from above the rider hits the plank first.
 * Collision groups filter a query only through its `filterGroups`.
 */
function rayHitsPlank(r: Rig, filterGroups: number | undefined = ALL): boolean {
  const x = r.rider.translation().x;
  const ray = new rapier.Ray({ x, y: -200 }, { x: 0, y: 1 });
  const hit = r.world.castRay(ray, 400, true, undefined, filterGroups, undefined, r.rider);
  return hit?.collider.handle === r.plank.handle;
}

const y = (r: Rig) => r.rider.translation().y;

describe("a one-way collider on a moving kinematic body", () => {
  it("rides along: the rider rests on the plank and keeps pace with the mover", () => {
    const r = rig();
    run(r, 90);
    expect(y(r)).toBeCloseTo(RESTING_Y, 1);
    expect(r.rider.translation().x - r.mover.translation().x).toBeCloseTo(94, 0);
    r.world.free();
  });

  it("collision groups switch it off on the next step and in queries at once, and back on", () => {
    const r = rig();
    run(r, 90);
    expect(rayHitsPlank(r)).toBe(true);

    r.plank.setCollisionGroups(NONE);
    expect(rayHitsPlank(r)).toBe(false);
    run(r, 1);
    expect(y(r)).toBeGreaterThan(RESTING_Y + 0.1);
    run(r, 2);
    // The mover and its other collider stay on their path.
    expect(r.mover.translation()).toEqual({ x: 93, y: 0 });
    expect(r.block.translation()).toEqual({ x: -207, y: 0 });

    r.plank.setCollisionGroups(ALL);
    expect(rayHitsPlank(r)).toBe(true);
    run(r, 20);
    expect(y(r)).toBeCloseTo(RESTING_Y, 1);
    r.world.free();
  });

  it("setEnabled(false) on an attached collider changes nothing, so attachment must not use it", () => {
    const r = rig();
    run(r, 90);
    r.plank.setEnabled(false);
    expect(r.plank.isEnabled()).toBe(false);
    run(r, 60);
    expect(y(r)).toBeCloseTo(RESTING_Y, 1);
    expect(rayHitsPlank(r)).toBe(true);
    r.world.free();
  });
});

// ─── One-way sides on the solid system ───────────────────

const OUTWARD: Record<Side, Pt> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const SIDES = Object.keys(OUTWARD) as Side[];
const sideOfVec = (v: Pt): Side =>
  SIDES.find((s) => OUTWARD[s][0] === v[0] && OUTWARD[s][1] === v[1])!;

const box = (cx: number, cy: number, hw: number, hh: number): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg: 0,
});
const WALL = box(0, 0, 20, 20);
const ACTOR = box(0, 0, 5, 5);

type Backend = "rapier" | "geometry";
const BACKENDS: Backend[] = ["rapier", "geometry"];

function scene(entities: RuntimeEntity[], backend: Backend): ExpandedScene {
  return {
    name: "sides",
    bounds: [-1000, -1000, 1000, 1000],
    settings: {
      gravity: [0, 0],
      physics: backend === "rapier" ? "rapier" : "none",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities,
  };
}

type Runtime = ReturnType<typeof createSceneRuntime>;

function load(entities: RuntimeEntity[], backend: Backend) {
  const rt = createSceneRuntime({
    rapier: backend === "rapier" ? rapier : null,
    view: null,
    game: null,
  });
  rt.load(scene(entities, backend));
  return { rt, solids: rt.ctx.system<SolidSystem>("solid")! };
}

/**
 * Moves the actor from `from` by `by` in 10 px steps, gating the solids for
 * its box before each sweep as a kinematic mover would, and stops at a hit.
 * Returns where it ends.
 */
function travel(rt: Runtime, solids: SolidSystem, from: Pt, by: Pt): Pt {
  const steps = Math.max(Math.abs(by[0]), Math.abs(by[1])) / 10;
  const step: Pt = [by[0] / steps, by[1] / steps];
  let at: Pt = from;
  for (let i = 0; i < steps; i++) {
    gateAt(rt, solids, at);
    const shape = translateShape(ACTOR, at);
    const hit = rt.ctx.space.sweep(shape, { x: step[0], y: step[1] });
    const t = hit ? hit.toi : 1;
    at = [at[0] + step[0] * t, at[1] + step[1] * t];
    if (hit) break;
  }
  return at;
}

const scale = (v: Pt, k: number): Pt => [v[0] * k, v[1] * k];

/**
 * Gates the solids for the actor at `at`. Rapier's queries see a gated
 * body's move after the next step, as the actor's own move would, so the
 * world steps on that backend.
 */
function gateAt(rt: Runtime, solids: SolidSystem, at: Pt, passing = false): void {
  solids.gateOneWaySides(aabb(translateShape(ACTOR, at)), passing);
  rt.ctx.physics?.world.step();
}

describe("one-way sides", () => {
  for (const backend of BACKENDS) {
    it(`a "left" solid lets an actor through from the right only (${backend})`, () => {
      const { rt, solids } = load(
        [{ id: "w", type: "solid", shape: WALL, oneWay: "left" }],
        backend,
      );
      expect(rt.ctx.tags.get(rt.ctx.tags.handlesOf("w")[0]!)).toMatchObject({
        oneWay: true,
        oneWaySide: "left",
      });
      expect(travel(rt, solids, [60, 0], [-200, 0])).toEqual([-140, 0]);
      solids.reset?.();
      const [x, y] = travel(rt, solids, [-60, 0], [200, 0]);
      expect(x).toBeCloseTo(-25, 1);
      expect(y).toBe(0);
      rt.destroy();
    });

    it(`each side holds an actor on it and lets one through from the other (${backend})`, () => {
      for (const side of SIDES) {
        const { rt, solids } = load(
          [{ id: "w", type: "solid", shape: WALL, oneWay: side }],
          backend,
        );
        const n = OUTWARD[side];
        const toward = (from: Pt) =>
          rt.ctx.space.sweep(translateShape(ACTOR, from), { x: -2 * from[0], y: -2 * from[1] });

        gateAt(rt, solids, scale(n, 60));
        expect(solids.isHidden("w"), side).toBe(false);
        expect(toward(scale(n, 60))?.tag.entityId, side).toBe("w");

        gateAt(rt, solids, scale(n, 60), true);
        expect(solids.isHidden("w"), `${side} passing`).toBe(true);
        expect(toward(scale(n, 60)), `${side} passing`).toBeNull();

        gateAt(rt, solids, scale(n, -60));
        expect(solids.isHidden("w"), `${side} far side`).toBe(true);
        expect(toward(scale(n, -60)), `${side} far side`).toBeNull();
        rt.destroy();
      }
    });

    it(`gateOneWay gates only the "up" solids (${backend})`, () => {
      const { rt, solids } = load(
        [
          { id: "ledge", type: "solid", shape: box(0, 0, 20, 5), oneWay: true },
          { id: "wall", type: "solid", shape: box(200, 0, 5, 20), oneWay: "left" },
        ],
        backend,
      );
      expect(rt.ctx.tags.get(rt.ctx.tags.handlesOf("ledge")[0]!)?.oneWaySide).toBe("up");
      solids.gateOneWay(20, false);
      expect(solids.isHidden("ledge")).toBe(true);
      expect(solids.isHidden("wall")).toBe(false);
      solids.gateOneWay(-10, false);
      expect(solids.isHidden("ledge")).toBe(false);
      rt.destroy();
    });
  }

  it("a turned or flipped instance turns its one-way side", () => {
    const prefabs = prefabLibrary([
      {
        kind: "prefab",
        v: 3,
        id: "gate",
        entities: [
          { id: "up", type: "solid", shape: ["box", 0, 0, 20, 20], oneWay: true },
          { id: "left", type: "solid", shape: ["box", 0, 0, 20, 20], oneWay: "left" },
        ],
      },
    ]);
    const registry = createRegistry(null);
    const elements: Dihedral[] = [false, true].flatMap((flip) =>
      ([0, 1, 2, 3] as const).map((rot) => ({ rot, flip })),
    );
    for (const backend of BACKENDS) {
      for (const d of elements) {
        const expanded = expandScene(
          {
            v: 3,
            name: "turned",
            bounds: [-1000, -1000, 1000, 1000],
            instances: [
              {
                id: "g",
                prefab: "gate",
                at: [0, 0],
                ...(d.rot ? { rot: d.rot } : {}),
                ...(d.flip ? { flip: true as const } : {}),
              },
            ],
          },
          registry,
          { prefabs },
        );
        for (const [child, own] of [
          ["up", "up"],
          ["left", "left"],
        ] as const) {
          const side = sideOfVec(applyVec(dihedral(d, [0, 0]), OUTWARD[own]));
          const label = `${backend} ${JSON.stringify(d)} ${child} -> ${side}`;
          const e = expanded.entities.find((x) => x.id === `g/${child}`)!;
          const { rt, solids } = load([e], backend);
          expect(rt.ctx.tags.get(rt.ctx.tags.handlesOf(e.id)[0]!)?.oneWaySide, label).toBe(side);
          const n = OUTWARD[side];
          gateAt(rt, solids, scale(n, 60));
          expect(solids.isHidden(e.id), label).toBe(false);
          gateAt(rt, solids, scale(n, -60));
          expect(solids.isHidden(e.id), label).toBe(true);
          rt.destroy();
        }
      }
    }
  });
});

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

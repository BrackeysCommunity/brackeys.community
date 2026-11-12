import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createSensorCollider } from "../collisions";
import { createRegistry } from "../game/define";
import { createPhysicsWorld } from "../physics";
import type { RapierModule } from "../types";
import { testGame } from "./fixtures/test-game";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

/** A fixed sensor and a kinematic and a dynamic body overlapping it, in `registry`'s groups. */
function overlapping(registry = createRegistry(testGame)) {
  const physics = createPhysicsWorld(rapier);
  const ctx = { rapier, physics, registry };
  const sensor = createSensorCollider(
    ctx,
    physics.addRigidBody(rapier.RigidBodyDesc.fixed()),
    rapier.ColliderDesc.cuboid(10, 10),
  );
  const body = (desc: InstanceType<RapierModule["RigidBodyDesc"]>, group: string) =>
    physics.addCollider(
      rapier.ColliderDesc.ball(4).setCollisionGroups(registry.collisionGroups(group)),
      physics.addRigidBody(desc),
    );
  const dynamic = body(rapier.RigidBodyDesc.dynamic().setGravityScale(0), "dynamic");
  const kinematic = body(rapier.RigidBodyDesc.kinematicPositionBased(), "dynamic");
  physics.step();
  return { physics, registry, sensor, dynamic, kinematic };
}

describe("createSensorCollider", () => {
  it("makes a sensor in the registry's sensor group", () => {
    const { physics, registry, sensor } = overlapping();
    expect(sensor.isSensor()).toBe(true);
    expect(sensor.collisionGroups()).toBe(registry.collisionGroups("sensor"));
    physics.destroy();
  });

  it("overlaps dynamic and kinematic bodies in a group the registry links to sensors", () => {
    const { physics, sensor, dynamic, kinematic } = overlapping();
    expect(physics.world.intersectionPair(sensor, dynamic)).toBe(true);
    expect(physics.world.intersectionPair(sensor, kinematic)).toBe(true);
    physics.destroy();
  });

  it("ignores groups the registry doesn't link to sensors", () => {
    const { physics, sensor, dynamic, kinematic } = overlapping(createRegistry());
    expect(physics.world.intersectionPair(sensor, dynamic)).toBe(false);
    expect(physics.world.intersectionPair(sensor, kinematic)).toBe(false);
    physics.destroy();
  });
});

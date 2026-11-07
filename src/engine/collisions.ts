import type { Collider, ColliderDesc, RigidBody } from "@dimforge/rapier2d";

import type { EngineContext } from "./game/types";

/**
 * Turns `desc` into a sensor in the registry's `sensor` group and attaches
 * it to `body`. Sensors are fixed and actors often kinematic, a pairing
 * Rapier skips by default, so those pairs are switched on too.
 */
export function createSensorCollider(
  ctx: Pick<EngineContext, "rapier" | "physics" | "registry">,
  body: RigidBody,
  desc: ColliderDesc,
): Collider {
  const { ActiveCollisionTypes } = ctx.rapier;
  desc
    .setSensor(true)
    .setCollisionGroups(ctx.registry.collisionGroups("sensor"))
    .setActiveCollisionTypes(
      ActiveCollisionTypes.DEFAULT |
        ActiveCollisionTypes.KINEMATIC_FIXED |
        ActiveCollisionTypes.KINEMATIC_KINEMATIC,
    );
  return ctx.physics.addCollider(desc, body);
}

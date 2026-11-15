import type { RigidBody } from "@dimforge/rapier2d";

import type { EngineContext } from "../game/types";
import type { PhysicsWorld } from "../physics";

/**
 * The body holding `id`'s first enabled non-sensor collider (lowest handle),
 * which is what `joint-ref-type` validates. `cached` is a body handle tried
 * first and skipped once disabled or gone.
 */
export function bodyOf(
  ctx: EngineContext,
  physics: PhysicsWorld,
  id: string,
  cached: number | null = null,
): RigidBody | null {
  if (cached !== null) {
    const body = physics.world.bodies.get(cached);
    if (body?.isEnabled()) return body;
  }
  let best: RigidBody | null = null;
  let bestHandle = Infinity;
  for (const handle of ctx.tags.handlesOf(id)) {
    const collider = physics.world.getCollider(handle);
    if (!collider || collider.isSensor() || !collider.isEnabled() || handle >= bestHandle) continue;
    const parent = collider.parent();
    if (!parent?.isEnabled()) continue;
    best = parent;
    bestHandle = handle;
  }
  return best;
}

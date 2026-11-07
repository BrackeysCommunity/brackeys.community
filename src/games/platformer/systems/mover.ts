import {
  createFollowerSystem,
  type EngineContext,
  type FollowerSystem,
  type RegisteredType,
} from "@jams/engine/game";

import { PLATFORMER_LAYERS } from "../layers";

/** A mover's collider when it has no material. */
const MOVER_SURFACE = { friction: 0.8, restitution: 0 };

/**
 * Movers: moving platforms. The engine's follower system moves them along
 * their path, reports each frame's delta for rider carry, and draws each one
 * in its type's style under its material's.
 */
export function createMoverSystem(ctx: EngineContext, type: RegisteredType): FollowerSystem {
  return createFollowerSystem(ctx, type, { ...MOVER_SURFACE, layer: PLATFORMER_LAYERS.mover });
}

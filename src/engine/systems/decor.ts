import type { EngineContext, RegisteredType, SceneSystem } from "../game/types";
import type { Pt, RuntimeEntity } from "../scene/types";

export type DecorEntity = RuntimeEntity<{ at: Pt }>;

/**
 * Pictures with no body. The runtime gives each its spawn pose and the
 * sprite behavior draws it, so this system only keeps count: nothing
 * enters the physics world.
 */
export function createDecorSystem(
  _ctx: EngineContext,
  _type: RegisteredType,
): SceneSystem<DecorEntity> {
  const live = new Set<string>();
  return {
    spawn: (e) => void live.add(e.id),
    despawn: (id) => void live.delete(id),
    clear: () => live.clear(),
    update: (e) => void live.add(e.id),
    size: () => live.size,
  };
}

import type { EngineContext, RegisteredType, SceneSystem } from "../game/types";
import type { Pt, RuntimeEntity } from "../scene/types";

export type DecorEntity = RuntimeEntity<{ at: Pt }>;

/**
 * Pictures with no body. The runtime gives each its spawn pose and the
 * sprite behavior draws it, so this system only keeps count and moves
 * poses it is asked to: nothing enters the physics world.
 */
export function createDecorSystem(
  ctx: EngineContext,
  _type: RegisteredType,
): SceneSystem<DecorEntity> & { setPose(id: string, x: number, y: number, rot: number): void } {
  const live = new Set<string>();
  return {
    spawn: (e) => void live.add(e.id),
    despawn: (id) => void live.delete(id),
    clear: () => live.clear(),
    update: (e) => void live.add(e.id),
    size: () => live.size,
    /** Nothing here simulates, so a disabled entity keeps its record as it is. */
    disable() {},
    enable() {},
    /** Writes the pose index, which the sprite behavior draws from. */
    setPose(id, x, y, rot) {
      if (live.has(id)) ctx.poses.set(id, x, y, rot);
    },
  };
}

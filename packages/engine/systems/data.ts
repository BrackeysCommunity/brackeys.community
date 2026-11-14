import type { EngineContext, RegisteredType, SceneSystem } from "../game/types";
import type { RuntimeEntity } from "../scene/types";

export type DataSystem<E extends RuntimeEntity = RuntimeEntity> = SceneSystem<E> & {
  /** Live entities in spawn order. */
  list(): E[];
  get(id: string): E | undefined;
  /** Writes the pose index alone: a data entity has nothing else to move. */
  setPose(id: string, x: number, y: number, rot: number): void;
};

/**
 * A system for a type whose entities are data a game reads (`system:
 * createDataSystem`): it keeps the live ones and simulates and draws
 * nothing, so a disabled entity keeps its record as it is. `ctx.setPose`
 * moves one in the pose index alone.
 */
export function createDataSystem<E extends RuntimeEntity = RuntimeEntity>(
  ctx?: EngineContext,
  _type?: RegisteredType,
): DataSystem<E> {
  const live = new Map<string, E>();

  return {
    spawn(e) {
      live.delete(e.id);
      live.set(e.id, e);
    },
    despawn: (id) => void live.delete(id),
    clear: () => live.clear(),
    update: (e) => void live.set(e.id, e),
    size: () => live.size,
    disable() {},
    enable() {},
    list: () => [...live.values()],
    get: (id) => live.get(id),
    setPose(id, x, y, rot) {
      if (live.has(id)) ctx?.poses.set(id, x, y, rot);
    },
  };
}

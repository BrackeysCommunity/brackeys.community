import type { EngineContext, RegisteredType, SceneSystem } from "../game/types";
import type { RuntimeEntity } from "../scene/types";

export type DataSystem<E extends RuntimeEntity = RuntimeEntity> = SceneSystem<E> & {
  /** Live entities in spawn order. */
  list(): E[];
  get(id: string): E | undefined;
};

/**
 * A system for a type whose entities are data a game reads (`system:
 * createDataSystem`): it keeps the live ones and simulates and draws
 * nothing, so a disabled entity keeps its record as it is.
 */
export function createDataSystem<E extends RuntimeEntity = RuntimeEntity>(
  _ctx?: EngineContext,
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
  };
}

import type { EngineContext, RegisteredType, SceneSystem } from "../game/types";
import type { Pt, RuntimeEntity } from "../scene/types";

export type MarkerEntity = RuntimeEntity<{ at: Pt; tags?: string[] }>;

export type MarkerSystem = SceneSystem<MarkerEntity> & {
  /** Live markers in spawn order. */
  list(): MarkerEntity[];
  get(id: string): MarkerEntity | undefined;
};

/** Named points with no body; a game reads them, e.g. to place its actors on load. */
export function createMarkerSystem(_ctx: EngineContext, _type: RegisteredType): MarkerSystem {
  const markers = new Map<string, MarkerEntity>();

  return {
    spawn(e) {
      markers.delete(e.id);
      markers.set(e.id, e);
    },
    despawn: (id) => void markers.delete(id),
    clear: () => markers.clear(),
    update: (e) => void markers.set(e.id, e),
    size: () => markers.size,
    /** Nothing here simulates, so a disabled entity keeps its record as it is. */
    disable() {},
    enable() {},
    list: () => [...markers.values()],
    get: (id) => markers.get(id),
  };
}

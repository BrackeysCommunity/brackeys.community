import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import type { CameraTargetBlock } from "../../game/behaviors/camera-target";

/** One entity the camera follows, with its pull. */
export type CameraTarget = { readonly id: string; readonly weight: number };

export type CameraTargetSystem = BehaviorSystem<CameraTargetBlock> & {
  /** The live entities carrying `camera-target`, in the order they attached. */
  targets(): readonly CameraTarget[];
};

/**
 * The `camera-target` behavior's system: it only tracks the live entities
 * carrying the block, loaded or spawned, for the shell's camera. It never
 * touches the simulation and keeps nothing a save needs.
 */
export const createCameraTargetSystem: BehaviorSystemFactory = () => {
  const weights = new Map<string, number>();
  let list: CameraTarget[] | null = null;

  const set = (id: string, block: Partial<CameraTargetBlock>) => {
    weights.set(id, block.weight ?? 1);
    list = null;
  };

  const system: CameraTargetSystem = {
    attach: set,
    update: set,
    detach(id) {
      if (weights.delete(id)) list = null;
    },
    clear() {
      weights.clear();
      list = null;
    },
    size: () => weights.size,
    targets() {
      list ??= [...weights].map(([id, weight]) => ({ id, weight }));
      return list;
    },
  };
  return system as BehaviorSystem;
};

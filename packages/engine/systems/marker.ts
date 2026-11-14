import type { EngineContext, RegisteredType } from "../game/types";
import type { Pt, RuntimeEntity } from "../scene/types";
import { createDataSystem, type DataSystem } from "./data";

export type MarkerEntity = RuntimeEntity<{ at: Pt; tags?: string[] }>;

export type MarkerSystem = DataSystem<MarkerEntity> & {
  setPose(id: string, x: number, y: number, rot: number): void;
};

/** Named points with no body; a game reads them, e.g. to place its actors on load. */
export function createMarkerSystem(ctx: EngineContext, type: RegisteredType): MarkerSystem {
  const data = createDataSystem<MarkerEntity>(ctx, type);
  return {
    ...data,
    /** Writes the pose index alone: a marker has nothing else to move. */
    setPose(id, x, y, rot) {
      if (data.get(id)) ctx.poses.set(id, x, y, rot);
    },
  };
}

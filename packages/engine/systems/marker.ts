import type { EngineContext, RegisteredType } from "../game/types";
import type { Pt, RuntimeEntity } from "../scene/types";
import { createDataSystem, type DataSystem } from "./data";

export type MarkerEntity = RuntimeEntity<{ at: Pt; tags?: string[] }>;

export type MarkerSystem = DataSystem<MarkerEntity>;

/** Named points with no body; a game reads them, e.g. to place its actors on load. */
export function createMarkerSystem(ctx: EngineContext, type: RegisteredType): MarkerSystem {
  return createDataSystem<MarkerEntity>(ctx, type);
}

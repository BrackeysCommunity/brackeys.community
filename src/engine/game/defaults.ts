/**
 * The engine's world defaults: the only home of these literals. No value
 * imports, so the canvas-sync image can carry it.
 */
import type { CharacterControllerOptions } from "../physics";

/** World gravity, px/s²; y is down. */
export const DEFAULT_GRAVITY: [number, number] = [0, 1200];
export const DEFAULT_TICK_RATE = 60;
export const DEFAULT_PHYSICS = "rapier";
export const DEFAULT_TIME = { kind: "fixed", rate: DEFAULT_TICK_RATE } as const;
export const DEFAULT_SPAWN_CAST = "gravity";

/** Side-view tuning, the controller every game had through 0.8: up −y, climb 50°, slide 30°, autostep 4×2, snap 4, push. */
export const SIDE_VIEW_CONTROLLER: CharacterControllerOptions = {
  offset: 0.01,
  up: [0, -1],
  maxSlopeClimbDeg: 50,
  minSlopeSlideDeg: 30,
  autostep: { maxHeight: 4, minWidth: 2, dynamic: true },
  snapToGround: 4,
  pushDynamic: true,
};

/** No slopes, autostep or snap: walls stop you, nothing lifts you. */
export const TOP_DOWN_CONTROLLER: CharacterControllerOptions = {
  offset: 0.01,
  up: [0, -1],
  maxSlopeClimbDeg: null,
  minSlopeSlideDeg: null,
  autostep: null,
  snapToGround: null,
  pushDynamic: false,
};

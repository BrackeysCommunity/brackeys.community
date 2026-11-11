/**
 * The engine's world defaults: the only home of these literals. No value
 * imports, so the canvas-sync image can carry it.
 */
import type { CharacterControllerOptions } from "../physics";

/** World gravity, m/s²; y is down. */
export const DEFAULT_GRAVITY: [number, number] = [0, 12];
export const DEFAULT_TICK_RATE = 60;
export const DEFAULT_PHYSICS = "rapier";
export const DEFAULT_TIME = { kind: "fixed", rate: DEFAULT_TICK_RATE } as const;
export const DEFAULT_SPAWN_CAST = "gravity";
/** A game's px per metre when its `world.lengthUnit` sets none. */
export const DEFAULT_LENGTH_UNIT = 100;

/** Side-view tuning in metres: up −y, climb 50°, slide 30°, autostep 0.04 × 0.02, snap 0.04, push. */
export const SIDE_VIEW_CONTROLLER: CharacterControllerOptions = {
  offset: 0.0001,
  up: [0, -1],
  maxSlopeClimbDeg: 50,
  minSlopeSlideDeg: 30,
  autostep: { maxHeight: 0.04, minWidth: 0.02, dynamic: true },
  snapToGround: 0.04,
  pushDynamic: true,
};

/** No slopes, autostep or snap: walls stop you, nothing lifts you. */
export const TOP_DOWN_CONTROLLER: CharacterControllerOptions = {
  offset: 0.0001,
  up: [0, -1],
  maxSlopeClimbDeg: null,
  minSlopeSlideDeg: null,
  autostep: null,
  snapToGround: null,
  pushDynamic: false,
};

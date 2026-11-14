/**
 * The engine's world defaults: the only home of these literals. No value
 * imports, so the canvas-sync image can carry it.
 */
import type { BlendMode } from "../context";
import type { CharacterControllerOptions } from "../physics";
import type { ActionDef, Binding } from "./types";

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

const moveKey = (code: string, axis: "x" | "y", value: number): Binding => ({
  device: "key",
  code,
  axis,
  value,
});

/**
 * The actions a registry built without a game has, so the standard
 * behaviors can be played in a project with no game module. A game's own
 * `actions` replace them.
 */
export const DEFAULT_ACTIONS: readonly ActionDef[] = Object.freeze([
  {
    action: "move",
    kind: "vector",
    description: "Move: WASD, the arrow keys, the left stick or the d-pad.",
    bindings: [
      moveKey("KeyA", "x", -1),
      moveKey("KeyD", "x", 1),
      moveKey("KeyW", "y", -1),
      moveKey("KeyS", "y", 1),
      moveKey("ArrowLeft", "x", -1),
      moveKey("ArrowRight", "x", 1),
      moveKey("ArrowUp", "y", -1),
      moveKey("ArrowDown", "y", 1),
      { device: "pad", stick: "left" },
      { device: "pad", button: "dpad-left", axis: "x", value: -1 },
      { device: "pad", button: "dpad-right", axis: "x", value: 1 },
      { device: "pad", button: "dpad-up", axis: "y", value: -1 },
      { device: "pad", button: "dpad-down", axis: "y", value: 1 },
    ],
  },
  {
    action: "jump",
    kind: "button",
    description: "Jump: Space or the pad's south button.",
    bindings: [
      { device: "key", code: "Space" },
      { device: "pad", button: "south" },
    ],
  },
]);

/** Every `BlendMode`, in the order schemas list them. */
export const BLEND_MODES = [
  "normal",
  "add",
  "multiply",
  "screen",
] as const satisfies readonly BlendMode[];
/** Compiles only while `BLEND_MODES` lists every `BlendMode`. */
const everyBlendMode: [Exclude<BlendMode, (typeof BLEND_MODES)[number]>] extends [never]
  ? true
  : never = true;
void everyBlendMode;

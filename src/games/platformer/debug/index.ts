import { jumpArcLayer } from "./jump-arc";
import { playerScaleLayer } from "./player-scale";

/** Shown after the engine's grid and physics layers: F3 then cycles arcs, then scale. */
export const PLATFORMER_DEBUG_LAYERS = [jumpArcLayer, playerScaleLayer] as const;
export { computeJumpArc } from "./jump-arc";

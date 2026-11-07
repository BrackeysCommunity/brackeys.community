import { DRAW_LAYERS } from "@jams/engine/game";

/** Where the platformer's visuals sit among the engine's draw layers, bottom to top. */
export const PLATFORMER_LAYERS = {
  mover: DRAW_LAYERS.body,
  anchor: DRAW_LAYERS.marker,
  tether: DRAW_LAYERS.marker + 1,
  player: DRAW_LAYERS.actor,
  cloud: DRAW_LAYERS.actor + 10,
  construct: DRAW_LAYERS.overlay,
  preview: DRAW_LAYERS.preview,
} as const;

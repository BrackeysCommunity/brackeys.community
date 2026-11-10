import type { GameInstance } from "@jams/engine";

import type { RenderProbe, Rgba } from "../browser-compare";
import { INSIDE_POINT, OUTSIDE_POINT } from "./sink";

/** What a point off the canvas reads as: transparent black, which no judgement passes as a sprite. */
export const OFF_CANVAS: Rgba = [0, 0, 0, 0];

/** The render run's two points as `game` reads them back through its camera. */
export function readProbe(game: Pick<GameInstance, "extractPixels">): RenderProbe {
  const { renderer, pixels } = game.extractPixels([
    { x: INSIDE_POINT[0], y: INSIDE_POINT[1] },
    { x: OUTSIDE_POINT[0], y: OUTSIDE_POINT[1] },
  ]);
  const rgba = (px: Rgba | null | undefined): Rgba =>
    px ? [px[0], px[1], px[2], px[3]] : OFF_CANVAS;
  return { renderer, inside: rgba(pixels[0]), outside: rgba(pixels[1]) };
}

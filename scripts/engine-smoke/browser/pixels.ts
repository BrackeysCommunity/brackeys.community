import type { GameInstance } from "@jams/engine";

import type { RenderProbe, Rgba, ViewportPixel } from "../browser-compare";
import { INSIDE_POINT, OUTSIDE_POINT } from "./sink";

/** What a point off the canvas reads as: transparent black, which no judgement passes as a sprite. */
export const OFF_CANVAS: Rgba = [0, 0, 0, 0];

const rgba = (px: Rgba | null | undefined): Rgba =>
  px ? [px[0], px[1], px[2], px[3]] : OFF_CANVAS;

/** The render run's two points as `game` reads them back through its camera. */
export function readProbe(game: Pick<GameInstance, "extractPixels">): RenderProbe {
  const { renderer, pixels } = game.extractPixels([
    { x: INSIDE_POINT[0], y: INSIDE_POINT[1] },
    { x: OUTSIDE_POINT[0], y: OUTSIDE_POINT[1] },
  ]);
  return { renderer, inside: rgba(pixels[0]), outside: rgba(pixels[1]) };
}

/**
 * The canvas pixel where `viewport` draws `world` (metres). `extractPixels`
 * reads the whole stage, every viewport's surface included, but places its
 * points through the first viewport's camera, so the canvas point is turned
 * back into the world point the first camera puts there.
 */
export function readThrough(
  game: Pick<GameInstance, "worldToClient" | "clientToWorld" | "extractPixels">,
  canvas: Pick<HTMLCanvasElement, "getBoundingClientRect">,
  world: readonly [x: number, y: number],
  viewport: number,
): { renderer: string; read: ViewportPixel } {
  const page = game.worldToClient({ x: world[0], y: world[1] }, viewport);
  const { renderer, pixels } = game.extractPixels([game.clientToWorld(page.x, page.y, 0)]);
  const box = canvas.getBoundingClientRect();
  return {
    renderer,
    read: { viewport, at: [page.x - box.left, page.y - box.top], pixel: rgba(pixels[0]) },
  };
}

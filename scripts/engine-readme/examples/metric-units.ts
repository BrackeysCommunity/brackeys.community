import { createRegistry, defineGame, pxPerMetreOf, scaleLengths } from "@jams/engine/game";
import { isWholePixel, lengthDecimals, pxToMetres, snapToPixel } from "@jams/engine/scene";
import { z } from "zod";

/** Pixel art drawn at 32 px per metre: a 32 px tile is one metre of world. */
export const tinyGame = defineGame({
  id: "tiny",
  types: [],
  actions: [],
  world: { physics: "none", lengthUnit: 32, grid: { kind: "square", cell: [1, 1] } },
  createRuntime: () => ({ snapshot: () => null }),
});

/** A game's own length field declares its unit, so a migration knows to scale it. */
const launch = z
  .strictObject({
    speed: z.number().describe("Launch speed, m/s.").meta({ unit: "m/s" }),
    count: z.number().int().describe("How many."),
  })
  .describe("A launcher's tuning.");

export function units() {
  const ppm = pxPerMetreOf(createRegistry(tinyGame));
  return {
    ppm,
    // A free drag lands on whole world px: 0.5 m is 16 px, and 0.51 m (16.32 px) snaps back to it.
    snapped: [snapToPixel(0.5, ppm), snapToPixel(0.51, ppm)],
    // What a v3 file's 48 px means here, written the one way.
    fromPx: pxToMetres(48, ppm),
    whole: [isWholePixel(1.5, ppm), isWholePixel(1.51, ppm)],
    decimals: [lengthDecimals(100), lengthDecimals(32)],
    // Only the field that declares a length unit is scaled: 320 px/s is 10 m/s, `count` keeps 3.
    scaled: scaleLengths({ speed: 320, count: 3 }, launch, ppm),
  };
}

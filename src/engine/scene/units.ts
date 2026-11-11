/**
 * Lengths in metres and the game's px per metre: the one rounding rule for
 * a metric length written to a file, and the whole-px checks. No imports,
 * so the canvas-sync image and every format can share it.
 */

/** The units a length field declares in `meta.unit`. */
export type LengthUnitName = "m" | "m/s" | "m/s²";

export const LENGTH_UNITS: readonly LengthUnitName[] = Object.freeze(["m", "m/s", "m/s²"]);

/** The most decimals a length is written with: micrometres. */
const MAX_DECIMALS = 6;

/** Micrometres, no -0: the one rounding rule for a metric length written to a file. */
export function roundLength(m: number): number {
  return Math.round(m * 1e6) / 1e6 + 0;
}

/** The nearest whole world px at `pxPerMetre`, in metres (roundLength applied). */
export function snapToPixel(m: number, pxPerMetre: number): number {
  return roundLength(Math.round(m * pxPerMetre) / pxPerMetre);
}

/** A v3 px, px/s or px/s² number in metres: roundLength(px / pxPerMetre). */
export function pxToMetres(px: number, pxPerMetre: number): number {
  return roundLength(px / pxPerMetre);
}

/**
 * Whether m × pxPerMetre is a whole number, to the rounding rule's
 * precision: within 1e-6 m of a whole world px, so every `snapToPixel` and
 * `pxToMetres` result passes at any px per metre (at 48, 5 px is written
 * 0.104167 m).
 */
export function isWholePixel(m: number, pxPerMetre: number): boolean {
  return Math.abs(m - Math.round(m * pxPerMetre) / pxPerMetre) <= 1e-6;
}

/** Decimals that show one world px exactly at pxPerMetre, at most 6 (2 at 100, 5 at 32). */
export function lengthDecimals(pxPerMetre: number): number {
  const px = 1 / pxPerMetre;
  for (let d = 0; d < MAX_DECIMALS; d++) {
    const scaled = px * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) <= 1e-9 * Math.max(1, scaled)) return d;
  }
  return MAX_DECIMALS;
}

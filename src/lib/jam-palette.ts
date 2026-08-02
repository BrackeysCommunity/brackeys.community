/**
 * Two-distinct-colors picks for jams with no banner art. Both variants
 * live here so the choice between them is visible at the call site
 * instead of being an accident of which feature folder you started in.
 */

const FALLBACK: [string, string] = ["#444444", "#222222"];

/**
 * Deterministic pick keyed by jam id. Both the timeline row's Grainient
 * backdrop and the spotlight modal's banner call this so a jam without an
 * image keeps the same colorway across the shared-layout morph — a random
 * pick would re-roll on the modal mount and cross-fade through a different
 * palette mid-animation.
 */
export function jamPaletteColors(palette: string[], jamId: number): [string, string] {
  if (palette.length === 0) return FALLBACK;
  if (palette.length === 1) return [palette[0]!, palette[0]!];
  const a = Math.abs(jamId) % palette.length;
  let b = Math.abs(jamId * 1103515245 + 12345) % palette.length;
  if (b === a) b = (b + 1) % palette.length;
  return [palette[a]!, palette[b]!];
}

/**
 * Random pick, re-rolled on every call. Used only by the featured
 * carousel, where a fresh pair per viewing is the intended effect (see
 * `use-grainient-palette.ts`). Anything with a shared-layout morph wants
 * `jamPaletteColors` instead — stability beats novelty there.
 */
export function pickTwo(palette: string[]): [string, string] {
  if (palette.length === 0) return FALLBACK;
  if (palette.length === 1) return [palette[0]!, palette[0]!];
  const i = Math.floor(Math.random() * palette.length);
  let j = Math.floor(Math.random() * palette.length);
  if (j === i) j = (j + 1) % palette.length;
  return [palette[i]!, palette[j]!];
}

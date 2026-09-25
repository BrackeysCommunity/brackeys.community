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

/**
 * Re-validates a scraped theme color before it is interpolated into an
 * inline `style` — the scraper already validates at ingest, but scraped
 * text never gets to reach a style attribute on trust.
 */
export function safeThemeColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ok =
    /^#[0-9a-fA-F]{3}$/.test(raw) ||
    /^#[0-9a-fA-F]{6}$/.test(raw) ||
    /^#[0-9a-fA-F]{8}$/.test(raw) ||
    /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/.test(raw);
  return ok ? raw : null;
}

function parseRgb(color: string): [number, number, number] | null {
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/**
 * Ink for dots and lettering drawn directly on a jam color: the same hue
 * pushed toward whichever of black or white contrasts more, so the stand-in
 * art reads as a tint of the jam rather than a theme gray that vanishes on
 * light colors. Null when the color can't be parsed (e.g. a CSS variable).
 */
export function jamInk(color: string): string | null {
  const rgb = parseRgb(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const toward = luminance > 0.179 ? "black" : "white";
  return `color-mix(in oklab, ${color} 45%, ${toward})`;
}

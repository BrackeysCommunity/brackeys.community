/**
 * Colours from other tools as JSON Canvas presets. A card shows its colour
 * as a faint tint, so a pastel fill copied as hex would vanish; the nearest
 * preset in hue follows the theme instead.
 */

function hexRgb(color: string | undefined): [number, number, number] | null {
  const m = color?.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** The JSON Canvas preset nearest in hue, or undefined for greys. */
export function presetFor(color: string | undefined): string | undefined {
  const rgb = hexRgb(color);
  if (!rgb) return undefined;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.2 || delta < 0.08) return undefined;
  let hue =
    max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 330) return "1";
  if (hue < 42) return "3";
  if (hue < 70) return "2";
  if (hue < 170) return "4";
  if (hue < 260) return "5";
  return "6";
}

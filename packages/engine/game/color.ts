/** A 0xRRGGBB colour as CSS hex, `#rrggbb`. */
export const cssHex = (rgb: number): string =>
  `#${(Math.trunc(rgb) & 0xffffff).toString(16).padStart(6, "0")}`;

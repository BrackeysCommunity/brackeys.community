import { z } from "zod";

/** Whether `n` is a 0xRRGGBB colour: a whole number in 0–0xffffff. */
export const isRgb = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 0xffffff;

const RGB_ERROR = "Invalid colour: expected 0xRRGGBB, a whole number from 0 to 0xffffff";

/** A 0xRRGGBB colour as a number; each field describes its own use. */
export const rgbSchema = z
  .number({ error: RGB_ERROR })
  .int({ error: RGB_ERROR })
  .min(0, { error: RGB_ERROR })
  .max(0xffffff, { error: RGB_ERROR });

/** A 0xRRGGBB colour as CSS hex, `#rrggbb`. */
export const cssHex = (rgb: number): string =>
  `#${(Math.trunc(rgb) & 0xffffff).toString(16).padStart(6, "0")}`;

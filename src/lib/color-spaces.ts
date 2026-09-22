/**
 * The colour spaces the glow picker can be driven in. Every space converts
 * through one shared currency — sRGB as 0–1 floats — so adding a space is a
 * pair of conversions and a channel list, and nothing else needs to know it
 * exists.
 *
 * Channel values are held in the units the member sees (saturation 0–100,
 * not 0–1) so a slider, its number box and the space's text notation all
 * read the same number.
 */

/** sRGB, gamma-encoded, each channel 0–1. May fall outside 0–1 on the way
 *  out of a wider space (OKLCH); `rgbToHex` clips at the end. */
export type Rgb = { r: number; g: number; b: number };

export type Channel = {
  label: string;
  min: number;
  max: number;
  step: number;
  /** Hue wraps: 360 and 0 are the same colour, so nudging past either end
   *  comes round rather than stopping. */
  wraps?: boolean;
  format: (value: number) => string;
  parse: (raw: string) => number | null;
};

export const COLOR_SPACE_IDS = [
  "hex",
  "rgb",
  "hsl",
  "hsb",
  "oklch",
  "cmyk",
  "vec3",
  "dec",
] as const;
export type ColorSpaceId = (typeof COLOR_SPACE_IDS)[number];

export type ColorSpace = {
  id: ColorSpaceId;
  label: string;
  /** One line on what the notation is, for the switcher. */
  description: string;
  channels: readonly Channel[];
  fromRgb: (rgb: Rgb) => number[];
  toRgb: (values: readonly number[]) => Rgb;
  /** The whole colour in this space's own notation — what the text field
   *  shows and what a copy hands over. */
  stringify: (values: readonly number[]) => string;
};

// ── Channels ───────────────────────────────────────────────────────

function number(raw: string): number | null {
  const cleaned = raw.trim().replace(/[%°]|deg$/gi, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** How many decimal places a channel's step is worth showing. */
export function decimals(step: number): number {
  return step >= 1 ? 0 : Math.ceil(-Math.log10(step));
}

function channel(label: string, max: number, step = 1, options?: { wraps?: boolean }): Channel {
  const places = decimals(step);
  return {
    label,
    min: 0,
    max,
    step,
    wraps: options?.wraps,
    format: (value) => String(Number(value.toFixed(places))),
    parse: number,
  };
}

const hueChannel = (label = "HUE") => channel(label, 360, 1, { wraps: true });

function hexChannel(label: string): Channel {
  return {
    label,
    min: 0,
    max: 255,
    step: 1,
    format: (value) => Math.round(value).toString(16).padStart(2, "0").toUpperCase(),
    parse: (raw) => {
      const cleaned = raw.trim().replace(/^(#|0x)/i, "");
      return /^[0-9a-f]{1,2}$/i.test(cleaned) ? parseInt(cleaned, 16) : null;
    },
  };
}

// ── Conversions ────────────────────────────────────────────────────

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round = (v: number, places = 0) => Number(v.toFixed(places));

/** https://www.w3.org/TR/css-color-4/#hex-notation */
export function rgbToHex({ r, g, b }: Rgb): string {
  const byte = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** `#rrggbb` only — the picker's `value` is always the stored, normalized form.
 *  https://www.w3.org/TR/css-color-4/#hex-notation */
export function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

/** True when a colour had to be clipped to fit sRGB — OKLCH reaches
 *  saturated colours no screen-safe hex can hold. */
export function isOutOfGamut({ r, g, b }: Rgb): boolean {
  const epsilon = 0.5 / 255;
  return [r, g, b].some((v) => v < -epsilon || v > 1 + epsilon);
}

/** https://en.wikipedia.org/wiki/HSL_and_HSV#From_RGB */
function rgbToHslValues({ r, g, b }: Rgb): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, l * 100];
  const s = delta / (1 - Math.abs(2 * l - 1));
  return [hueOf(r, g, b, max, delta), s * 100, l * 100];
}

/** https://en.wikipedia.org/wiki/HSL_and_HSV#From_RGB */
function rgbToHsbValues({ r, g, b }: Rgb): [number, number, number] {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return [0, 0, max * 100];
  return [hueOf(r, g, b, max, delta), (delta / max) * 100, max * 100];
}

/** https://en.wikipedia.org/wiki/HSL_and_HSV#Hue_and_chroma */
function hueOf(r: number, g: number, b: number, max: number, delta: number): number {
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Chroma, a hue, and the offset that lifts it to the target — shared by
 *  HSL and HSB, which differ only in how they get to those three.
 *  https://en.wikipedia.org/wiki/HSL_and_HSV#Color_conversion_formulae */
function fromChroma(h: number, c: number, m: number): Rgb {
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  return { r: r + m, g: g + m, b: b + m };
}

/** https://en.wikipedia.org/wiki/HSL_and_HSV#HSL_to_RGB */
function hslToRgb([h, s, l]: readonly number[]): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  return fromChroma(h, c, light - c / 2);
}

/** https://en.wikipedia.org/wiki/HSL_and_HSV#HSV_to_RGB */
function hsbToRgb([h, s, v]: readonly number[]): Rgb {
  const value = v / 100;
  const c = value * (s / 100);
  return fromChroma(h, c, value - c);
}

/** The sRGB transfer function, sign-preserving so out-of-gamut values
 *  survive the trip (as CSS Color 4's sample code does).
 *  https://www.w3.org/TR/css-color-4/#color-conversion-code */
const toLinear = (c: number) =>
  Math.sign(c) *
  (Math.abs(c) <= 0.04045 ? Math.abs(c) / 12.92 : ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) =>
  Math.sign(c) *
  (Math.abs(c) <= 0.0031308 ? Math.abs(c) * 12.92 : 1.055 * Math.abs(c) ** (1 / 2.4) - 0.055);

/** OKLCH per Björn Ottosson's OKLab, with L as a percentage the way CSS
 *  writes it.
 *  https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab
 *  https://www.w3.org/TR/css-color-4/#ok-lab */
function rgbToOklchValues(rgb: Rgb): [number, number, number] {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const C = Math.hypot(A, B);
  // Below this a grey's hue is rounding noise, not a direction.
  const H = C < 1e-4 ? 0 : (Math.atan2(B, A) * 180) / Math.PI;
  return [L * 100, C, H < 0 ? H + 360 : H];
}

/** https://bottosson.github.io/posts/oklab/#converting-from-linear-srgb-to-oklab
 *  https://www.w3.org/TR/css-color-4/#oklab-lab-to-predefined */
function oklchToRgb([L, C, H]: readonly number[]): Rgb {
  const hr = (H * Math.PI) / 180;
  const lightness = L / 100;
  const A = C * Math.cos(hr);
  const B = C * Math.sin(hr);

  const l = (lightness + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (lightness - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (lightness - 0.0894841775 * A - 1.291485548 * B) ** 3;

  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** The naive, profile-free conversion — no ICC profile, so it's a notation
 *  for print-minded members rather than a press-accurate separation.
 *  https://www.w3.org/TR/css-color-5/#naively-convert-from-rgba-to-cmyk */
function rgbToCmykValues({ r, g, b }: Rgb): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  const ink = (v: number) => ((1 - v - k) / (1 - k)) * 100;
  return [ink(r), ink(g), ink(b), k * 100];
}

/** `(1 - c)(1 - k)` is the spec's `1 - min(1, c(1 - k) + k)` without the
 *  clamp, which `rgbToHex` applies at the end anyway.
 *  https://www.w3.org/TR/css-color-5/#naively-convert-from-cmyk-to-rgba */
function cmykToRgb([c, m, y, k]: readonly number[]): Rgb {
  const key = 1 - k / 100;
  return { r: (1 - c / 100) * key, g: (1 - m / 100) * key, b: (1 - y / 100) * key };
}

// ── Spaces ─────────────────────────────────────────────────────────

const byteRgb = (rgb: Rgb) => [rgb.r * 255, rgb.g * 255, rgb.b * 255];
const fromBytes = ([r, g, b]: readonly number[]): Rgb => ({ r: r / 255, g: g / 255, b: b / 255 });
const bytes = (values: readonly number[]) => values.map((v) => Math.round(v));

export const COLOR_SPACES: Record<ColorSpaceId, ColorSpace> = {
  hex: {
    id: "hex",
    label: "HEX",
    description: "#RRGGBB, as the web writes it",
    channels: [hexChannel("RED"), hexChannel("GREEN"), hexChannel("BLUE")],
    fromRgb: byteRgb,
    toRgb: fromBytes,
    stringify: (values) => rgbToHex(fromBytes(values)),
  },
  rgb: {
    id: "rgb",
    label: "RGB",
    description: "red, green, blue · 0–255",
    channels: [channel("RED", 255), channel("GREEN", 255), channel("BLUE", 255)],
    fromRgb: byteRgb,
    toRgb: fromBytes,
    stringify: (values) => `rgb(${bytes(values).join(", ")})`,
  },
  hsl: {
    id: "hsl",
    label: "HSL",
    description: "hue, saturation, lightness",
    channels: [hueChannel(), channel("SATURATION", 100), channel("LIGHTNESS", 100)],
    fromRgb: rgbToHslValues,
    toRgb: hslToRgb,
    stringify: ([h, s, l]) => `hsl(${round(h)}, ${round(s)}%, ${round(l)}%)`,
  },
  hsb: {
    id: "hsb",
    label: "HSB",
    description: "hue, saturation, brightness (HSV)",
    channels: [hueChannel(), channel("SATURATION", 100), channel("BRIGHTNESS", 100)],
    fromRgb: rgbToHsbValues,
    toRgb: hsbToRgb,
    stringify: ([h, s, v]) => `hsb(${round(h)}, ${round(s)}%, ${round(v)}%)`,
  },
  oklch: {
    id: "oklch",
    label: "OKLCH",
    description: "perceptual · reaches past sRGB",
    channels: [channel("LIGHTNESS", 100, 0.1), channel("CHROMA", 0.4, 0.001), hueChannel()],
    fromRgb: rgbToOklchValues,
    toRgb: oklchToRgb,
    stringify: ([l, c, h]) => `oklch(${round(l, 1)}% ${round(c, 3)} ${round(h, 1)})`,
  },
  cmyk: {
    id: "cmyk",
    label: "CMYK",
    description: "print inks, no colour profile",
    channels: [
      channel("CYAN", 100),
      channel("MAGENTA", 100),
      channel("YELLOW", 100),
      channel("KEY", 100),
    ],
    fromRgb: rgbToCmykValues,
    toRgb: cmykToRgb,
    stringify: (values) => `cmyk(${values.map((v) => `${round(v)}%`).join(", ")})`,
  },
  // sRGB-encoded floats, as an engine's colour inspector shows them — not
  // linear. https://docs.unity3d.com/ScriptReference/Color.html
  // https://docs.godotengine.org/en/stable/classes/class_color.html
  vec3: {
    id: "vec3",
    label: "VEC3",
    description: "0–1 floats, like an engine's Color",
    channels: [channel("R", 1, 0.001), channel("G", 1, 0.001), channel("B", 1, 0.001)],
    fromRgb: ({ r, g, b }) => [r, g, b],
    toRgb: ([r, g, b]) => ({ r, g, b }),
    stringify: (values) => values.map((v) => round(v, 3).toFixed(3)).join(", "),
  },
  // `0xRRGGBB` as one integer.
  // https://discord.com/developers/docs/resources/message#embed-object
  dec: {
    id: "dec",
    label: "DEC",
    description: "one integer, like a Discord embed",
    channels: [channel("RED", 255), channel("GREEN", 255), channel("BLUE", 255)],
    fromRgb: byteRgb,
    toRgb: fromBytes,
    stringify: (values) => {
      const [r, g, b] = bytes(values);
      return String((r << 16) | (g << 8) | b);
    },
  },
};

/** Back inside 0–1 — what an sRGB-bound space has to do with a colour
 *  that came from beyond it. */
export function clipRgb({ r, g, b }: Rgb): Rgb {
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

/** A space's channel values as a CSS colour. OKLCH is written as itself so
 *  it keeps whatever gamut it reaches; everything else is sRGB hex. */
export function cssColor(space: ColorSpace, values: readonly number[]): string {
  return space.id === "oklch" ? space.stringify(values) : rgbToHex(space.toRgb(values));
}

/** The form a glow stop is stored in: hex while sRGB can hold the colour,
 *  the OKLCH notation once it can't, so nothing is clipped on the way in. */
export function glowStopValue(space: ColorSpace, values: readonly number[]): string {
  const rgb = space.toRgb(values);
  return space.id === "oklch" && isOutOfGamut(rgb) ? space.stringify(values) : rgbToHex(rgb);
}

export function isColorSpaceId(value: unknown): value is ColorSpaceId {
  return typeof value === "string" && (COLOR_SPACE_IDS as readonly string[]).includes(value);
}

// ── Parsing ────────────────────────────────────────────────────────

/** A whole number with only a trailing unit — what separates `50%` from a
 *  bare `0.5` when deciding whether a value is a fraction or a percentage. */
function arg(raw: string): { value: number; percent: boolean } | null {
  const trimmed = raw.trim().replace(/f$/i, "");
  const percent = trimmed.endsWith("%");
  const value = number(trimmed);
  return value == null ? null : { value, percent };
}

/** 0–1 or 0–100: a percent sign settles it, otherwise anything above 1 is
 *  read as a percentage. */
const unit = ({ value, percent }: { value: number; percent: boolean }) =>
  percent || value > 1 ? value / 100 : value;

function byteArg({ value, percent }: { value: number; percent: boolean }): number {
  return percent ? value / 100 : value / 255;
}

function fromHexDigits(digits: string): Rgb | null {
  if (/^[0-9a-f]{3,4}$/i.test(digits)) {
    const [r, g, b] = digits.split("").map((d) => parseInt(d + d, 16) / 255);
    return { r, g, b };
  }
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(digits)) return hexToRgb(`#${digits.slice(0, 6)}`);
  return null;
}

function fromDecimal(n: number): Rgb | null {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffff) return null;
  return fromBytes([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}

/** Three or four 0–1 floats, or 0–255 bytes when any of them says so. */
function fromTriple(parts: { value: number; percent: boolean }[]): Rgb | null {
  if (parts.length < 3 || parts.length > 4) return null;
  const [r, g, b] = parts;
  const floats = [r, g, b].every((p) => !p.percent && p.value <= 1);
  return floats
    ? { r: r.value, g: g.value, b: b.value }
    : fromBytes([r, g, b].map((p) => byteArg(p) * 255));
}

const FUNCTION = /^([a-z][a-z0-9]*(?:\s+[a-z][a-z0-9]*)?)\s*\((.*)\)\s*;?$/i;

/**
 * Whatever a member pastes: `#7f5af0`, `7F5AF0`, `0x7f5af0`, `rgb(…)`,
 * `hsl(…)`, `hsb(…)`/`hsv(…)`, `oklch(…)`, `cmyk(…)`, a bare decimal
 * integer, or three floats in any wrapper an engine prints them in —
 * `new Color(0.5f, 0.35f, 0.94f)`, `vec3(…)`, `Color(…)`. Alpha, where
 * given, is dropped: a name glow has none.
 *
 * `prefer` breaks the one real ambiguity, six bare digits: `123456` is hex
 * everywhere except in the decimal space, where it is a number.
 *
 * The functional forms follow CSS Color 4's syntax, and `cmyk()` the shape
 * of CSS Color 5's `device-cmyk()`.
 * https://www.w3.org/TR/css-color-4/#color-syntax
 * https://www.w3.org/TR/css-color-5/#device-cmyk
 */
export function parseColor(input: string, prefer?: ColorSpaceId): Rgb | null {
  const text = input.trim();
  if (!text) return null;

  const hashed = /^(?:#|0x)([0-9a-f]+)$/i.exec(text);
  if (hashed) return fromHexDigits(hashed[1]);

  if (/^\d+$/.test(text)) {
    if (prefer === "dec" || text.length !== 6) return fromDecimal(Number(text));
    return fromHexDigits(text);
  }
  if (/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(text)) return fromHexDigits(text);

  const call = FUNCTION.exec(text);
  const name = call?.[1].toLowerCase().replace(/^new\s+/, "") ?? null;
  const body = call ? call[2] : text.replace(/^[[(]|[\])]$/g, "");
  const parts = body
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(arg);
  if (parts.some((p) => p == null)) return null;
  const args = parts as { value: number; percent: boolean }[];

  switch (name) {
    case null:
    case "vec3":
    case "vec4":
    case "vector3":
    case "vector4":
    case "float3":
    case "float4":
    case "color":
    case "color32":
      return fromTriple(args);
    case "rgb":
    case "rgba":
      if (args.length < 3) return null;
      return fromBytes(args.slice(0, 3).map((p) => byteArg(p) * 255));
    case "hsl":
    case "hsla":
    case "hsv":
    case "hsva":
    case "hsb":
    case "hsba": {
      if (args.length < 3) return null;
      const [h, s, l] = args;
      const values = [h.value, unit(s) * 100, unit(l) * 100];
      return name.startsWith("hsl") ? hslToRgb(values) : hsbToRgb(values);
    }
    case "oklch": {
      if (args.length < 3) return null;
      const [l, c, h] = args;
      // CSS: a chroma percentage is of 0.4.
      // https://www.w3.org/TR/css-color-4/#specifying-oklab-oklch
      const chroma = c.percent ? (c.value / 100) * 0.4 : c.value;
      return oklchToRgb([unit(l) * 100, chroma, h.value]);
    }
    case "cmyk":
      if (args.length !== 4) return null;
      return cmykToRgb(args.map((p) => unit(p) * 100));
    default:
      return null;
  }
}

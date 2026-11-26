import type { MapCell, MapStyle, MapStyleEntry, MapViewNumbers } from "../../mmo-api/src/index.ts";

export interface Style {
  /** The style payload's rev, so what was drawn with it can be cached by it. */
  rev: string;
  /** An entry's colour at its alpha, as rgba(); an id the pack lacks is magenta, so the gap shows. */
  colour(id: string): string;
  /** An entry's colour at full alpha. */
  opaque(id: string): string;
  /** An entry's colour at another alpha, 0 to 255. */
  colourAt(id: string, alpha: number): string;
  /** An entry's alpha, 0 to 255. */
  alpha(id: string): number;
  /** An entry's glyph; "" draws none. */
  glyph(id: string): string;
  /** An entry's pattern; "" draws none. */
  pattern(id: string): string;
  /** A cell's terrain colour, its ecotone's secondary mixed in by its share. */
  terrainFill(cell: Pick<MapCell, "terrain" | "secondary" | "blend">): string;
  /** A colour dimmed by seenDim percent, for a last-seen tile. */
  dim(colour: string): string;
  /** Black at seenDim percent: laid over an opaque colour it dims it as dim does. */
  veil: string;
  view: MapViewNumbers;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number; // 0 to 255
}

const MISSING: Rgba = { r: 255, g: 0, b: 255, a: 255 };

function hexRgb(s: string): Rgba | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(s);
  if (!m) return undefined;
  const v = Number.parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255, a: 255 };
}

function css(c: Rgba): string {
  const a = Math.round((c.a / 255) * 1000) / 1000;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

/** Reads a colour this module wrote, or #rrggbb. */
export function parseColour(s: string): Rgba | undefined {
  const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(s);
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Math.round(Number(m[4]) * 255) };
  }
  return hexRgb(s);
}

function noneIsEmpty(v: string | undefined): string {
  return !v || v === "none" ? "" : v;
}

export function resolveStyle(s: MapStyle): Style {
  const entries = new Map<string, MapStyleEntry>();
  const colours = new Map<string, Rgba>();
  for (const e of s.entries) {
    entries.set(e.id, e);
    const rgb = hexRgb(e.colour) ?? MISSING;
    colours.set(e.id, { ...rgb, a: Math.min(255, Math.max(0, e.alpha)) });
  }
  const rgba = (id: string) => colours.get(id) ?? MISSING;
  const view = s.view;
  const keep = 1 - Math.min(100, Math.max(0, view.seenDim)) / 100;
  const fills = new Map<string, string>();
  return {
    rev: s.rev,
    colour: (id) => css(rgba(id)),
    colourAt: (id, alpha) => css({ ...rgba(id), a: Math.min(255, Math.max(0, Math.round(alpha))) }),
    opaque: (id) => css({ ...rgba(id), a: 255 }),
    alpha: (id) => rgba(id).a,
    glyph: (id) => noneIsEmpty(entries.get(id)?.glyph),
    pattern: (id) => noneIsEmpty(entries.get(id)?.pattern),
    terrainFill(cell) {
      const share = Math.min(cell.blend ?? 0, view.blendMax) / 100;
      const key = `${cell.terrain}|${cell.secondary ?? ""}|${share}`;
      const hit = fills.get(key);
      if (hit) return hit;
      const a = rgba(`terrain:${cell.terrain}`);
      let out = { ...a, a: 255 };
      if (cell.secondary && share > 0) {
        // As Go's blend: the secondary's own alpha scales its share.
        const b = rgba(`terrain:${cell.secondary}`);
        const t = share * (b.a / 255);
        const mix = (x: number, y: number) => Math.trunc(x * (1 - t) + y * t);
        out = { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b), a: 255 };
      }
      const fill = css(out);
      fills.set(key, fill);
      return fill;
    },
    dim(colour) {
      const c = parseColour(colour) ?? MISSING;
      const d = (x: number) => Math.round(x * keep);
      return css({ r: d(c.r), g: d(c.g), b: d(c.b), a: c.a });
    },
    veil: css({ r: 0, g: 0, b: 0, a: Math.round((1 - keep) * 255) }),
    view,
  };
}

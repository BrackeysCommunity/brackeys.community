// Draw lists, pure and with no DOM: every op is in world px at size 1, and
// paint scales them. Nothing here decides what a viewer may see: an op is
// made only for a hex the inputs carry.

import {
  BusyBusy,
  BusyCrowded,
  BusyLight,
  FogSeen,
  type MapCell,
  type MapChunk,
  type MapIndex,
  type MapLive,
  type MapOverlay,
  type MapRegions,
  type MapTileView,
  PlaceCity,
  PlaceCityTile,
} from "../../mmo-api/src/index.ts";
import {
  type Camera,
  type Level,
  levelFor,
  regionTiles,
  screenToHex,
  type View,
} from "./camera.ts";
import { chunkKey, chunkRev, chunksInView } from "./chunks.ts";
import {
  type Axial,
  DIRECTION_IDS,
  DIRECTIONS,
  hexCentre,
  hexCorners,
  hexKey,
  neighbour,
  type Point,
  sideCorners,
} from "./hex.ts";
import { type LayerId, layersKey } from "./layers.ts";
import { liveByHex, mergeTile } from "./merge.ts";
import type { Style } from "./style.ts";

export type DrawOp =
  | { kind: "hex"; x: number; y: number; size: number; fill: string; pattern?: string }
  | { kind: "edge"; x1: number; y1: number; x2: number; y2: number; colour: string; width: number }
  | {
      kind: "glyph";
      x: number;
      y: number;
      glyph: string;
      colour: string;
      size: number;
      /** A last-seen mark is drawn in this pattern rather than solid. */
      pattern?: string;
    }
  | {
      kind: "label";
      x: number;
      y: number;
      text: string;
      colour: string;
      /** The ref the text names, so a viewer's server mask can replace it. */
      ref?: string;
      /** Drawn only from this hex size in CSS px. */
      minSize?: number;
    }
  | { kind: "path"; points: Point[]; colour: string; width: number };

// structural: mark sizes in world px at size 1. The tile-level ones are
// /map's at its 26 px hex, so both drawings agree.
const PICTURE_HEX = 26;
const SETTLEMENT_INK = 11 / PICTURE_HEX;
const SETTLEMENT_MARK = 8 / PICTURE_HEX;
const CITY_INK = 14 / PICTURE_HEX;
const CITY_MARK = 11 / PICTURE_HEX;
const DUNGEON_MARK = 7 / PICTURE_HEX;
const SITE_MARK = 5 / PICTURE_HEX;
const ROAD_BASE = 3 / PICTURE_HEX;
const ROAD_STEP = 1 / PICTURE_HEX;
const RIVER_WIDTH = 4 / PICTURE_HEX;
const STREAM_WIDTH = 2.5 / PICTURE_HEX;
const SELF_INK = 9 / PICTURE_HEX;
const SELF_MARK = 6 / PICTURE_HEX;
const ROUTE_WIDTH = 3 / PICTURE_HEX;
const LIVE_MARK = 4 / PICTURE_HEX;
const PIP = 2.5 / PICTURE_HEX;
const STRUCTURE_PIP = 2 / PICTURE_HEX;
const BORDER_WIDTH = 1 / PICTURE_HEX;
const FRONTIER_WIDTH = 0.12;
const RIM_WIDTH = 0.14;
const FRONT_WIDTH = 0.12;
const FRONT_REACH = 0.55;
const LABEL_BELOW = 0.7;
// structural: the region level is drawn at 1 to 4 px a hex, so its marks are
// larger in world px.
const REGION_INK = 1.6;
const REGION_MARK = 1.1;
const REGION_BORDER_WIDTH = 0.35;
const REGION_FRONTIER_WIDTH = 0.45;
/** A region's name is drawn once the region spans this many CSS px. */
export const REGION_LABEL_SPAN = 40;
// structural: where live marks sit round a tile's centre, and the pip row.
const MARK_SLOTS: readonly Point[] = [
  { x: -0.42, y: -0.38 },
  { x: 0.42, y: -0.38 },
  { x: -0.5, y: 0.12 },
  { x: 0.5, y: 0.12 },
  { x: 0, y: -0.62 },
  { x: 0, y: 0.62 },
];
const PIP_ROW = 0.5;
const PIP_GAP = 0.22;
const BUSY_PIPS: Record<string, number> = { [BusyLight]: 1, [BusyBusy]: 2, [BusyCrowded]: 3 };

const STANDING_WATER = new Set(["lake", "sea", "bog"]);
const FLOWING_WATER = new Set(["river", "stream", "ford"]);
const DUNGEON = "dungeon";

function centre(h: Axial): Point {
  return hexCentre(h, 1);
}

function side(c: Point, d: number, size = 1): [Point, Point] {
  const corners = hexCorners(c, size);
  const [i, j] = sideCorners(d);
  return [corners[i]!, corners[j]!];
}

function edgeOp(c: Point, d: number, colour: string, width: number): DrawOp {
  const [a, b] = side(c, d);
  return { kind: "edge", x1: a.x, y1: a.y, x2: b.x, y2: b.y, colour, width };
}

/** A cell's ground: terrain with its ecotone, or standing water, or paper with terrain off. */
export function groundFill(
  cell: Pick<MapCell, "terrain" | "secondary" | "blend" | "water">,
  s: Style,
  layers: ReadonlySet<LayerId>,
): string {
  if (!layers.has("terrain")) return s.opaque("paper");
  if (cell.water && STANDING_WATER.has(cell.water)) return s.opaque(`water:${cell.water}`);
  return s.terrainFill(cell);
}

function placeMarks(out: DrawOp[], p: Point, place: string, s: Style, region: boolean): void {
  const id = `place:${place}`;
  const glyph = s.glyph(id);
  if (!glyph) return;
  const city = place === PlaceCity;
  const ink = region ? REGION_INK : city ? CITY_INK : SETTLEMENT_INK;
  const mark = region ? REGION_MARK : city ? CITY_MARK : SETTLEMENT_MARK;
  out.push({ kind: "glyph", x: p.x, y: p.y, glyph, colour: s.opaque("ink"), size: ink });
  out.push({ kind: "glyph", x: p.x, y: p.y, glyph, colour: s.colour(id), size: mark });
}

/** The widest level: each discovered tile in its region's biome, borders, names and places. */
export function regionOps(r: MapRegions, s: Style, layers: ReadonlySet<LayerId>): DrawOp[] {
  const slots = new Map<string, number>();
  for (const { h, slot } of regionTiles(r)) slots.set(hexKey(h), slot);
  const fills = r.regions.map((g) =>
    layers.has("terrain") ? s.terrainFill({ terrain: g.terrain }) : s.opaque("paper"),
  );
  const paper = s.opaque("paper");
  const frontier = s.colour("frontier");
  const border = s.colour("region-border");
  const spans = r.regions.map(() => ({ l: Infinity, t: Infinity, r: -Infinity, b: -Infinity }));
  const ground: DrawOp[] = [];
  const lines: DrawOp[] = [];
  for (const { h, slot } of regionTiles(r)) {
    const p = centre(h);
    ground.push({ kind: "hex", x: p.x, y: p.y, size: 1, fill: fills[slot] ?? paper });
    const span = spans[slot];
    if (span) {
      span.l = Math.min(span.l, p.x);
      span.r = Math.max(span.r, p.x);
      span.t = Math.min(span.t, p.y);
      span.b = Math.max(span.b, p.y);
    }
    for (let d = 0; d < DIRECTIONS.length; d++) {
      const n = slots.get(hexKey(neighbour(h, d)));
      if (n === undefined) lines.push(edgeOp(p, d, frontier, REGION_FRONTIER_WIDTH));
      else if (d < 3 && n !== slot && layers.has("regions")) {
        lines.push(edgeOp(p, d, border, REGION_BORDER_WIDTH));
      }
    }
  }
  const out = ground.concat(lines);
  if (layers.has("places")) {
    for (const dot of r.places) placeMarks(out, centre(dot), dot.place, s, true);
  }
  if (layers.has("regions")) {
    const ink = s.opaque("ink");
    r.regions.forEach((g, i) => {
      const span = spans[i];
      if (!g.name || !span || span.l > span.r) return;
      const extent = Math.max(span.r - span.l + Math.sqrt(3), span.b - span.t + 2);
      const p = centre(g.anchor);
      out.push({
        kind: "label",
        x: p.x,
        y: p.y,
        text: g.name,
        colour: ink,
        ref: g.ref,
        minSize: REGION_LABEL_SPAN / extent,
      });
    });
  }
  return out;
}

/** One chunk's shared base at area or tile level. */
export function chunkOps(
  ch: MapChunk,
  level: Level,
  s: Style,
  layers: ReadonlySet<LayerId>,
): DrawOp[] {
  const tile = level === "tile";
  const here = new Set(ch.cells.map((c) => hexKey(c)));
  const ground: DrawOp[] = [];
  const lines: DrawOp[] = [];
  const marks: DrawOp[] = [];
  const labels: DrawOp[] = [];
  const frontier = s.colour("frontier");
  const border = s.colour("border");
  const ink = s.opaque("ink");
  const named = new Set<string>();
  for (const cell of ch.cells) {
    const p = centre(cell);
    ground.push({ kind: "hex", x: p.x, y: p.y, size: 1, fill: groundFill(cell, s, layers) });
    if (layers.has("terrain") && cell.water && FLOWING_WATER.has(cell.water)) {
      const w = cell.water === "river" ? RIVER_WIDTH : STREAM_WIDTH;
      ground.push({
        kind: "path",
        points: [
          { x: p.x - 0.7, y: p.y + 3 / PICTURE_HEX },
          { x: p.x, y: p.y - 2 / PICTURE_HEX },
          { x: p.x + 0.7, y: p.y + 3 / PICTURE_HEX },
        ],
        colour: s.opaque(`water:${cell.water}`),
        width: w,
      });
    }
    if (layers.has("places") && cell.place === PlaceCityTile) {
      ground.push({ kind: "hex", x: p.x, y: p.y, size: 1, fill: s.colour("place:city-tile") });
    }
    for (let d = 0; d < DIRECTIONS.length; d++) {
      if (((cell.edge ?? 0) >> d) & 1) lines.push(edgeOp(p, d, frontier, FRONTIER_WIDTH));
      else if (tile && (d < 3 || !here.has(hexKey(neighbour(cell, d))))) {
        lines.push(edgeOp(p, d, border, BORDER_WIDTH));
      }
    }
    if (layers.has("roads") && (cell.road ?? 0) > 0) {
      marks.push({
        kind: "glyph",
        x: p.x,
        y: p.y,
        glyph: "circle",
        colour: s.colour("road"),
        size: ROAD_BASE + ROAD_STEP * (cell.road ?? 0),
      });
      if (tile && cell.roadName && !named.has(cell.roadName)) {
        named.add(cell.roadName);
        labels.push({
          kind: "label",
          x: p.x,
          y: p.y + LABEL_BELOW,
          text: cell.roadName,
          colour: ink,
        });
      }
    }
    if (!layers.has("places")) continue;
    if (cell.place && cell.place !== PlaceCityTile) {
      placeMarks(marks, p, cell.place, s, false);
      const name = cell.placeRef ? ch.names?.[cell.placeRef] : undefined;
      if (tile && name) {
        labels.push({
          kind: "label",
          x: p.x,
          y: p.y + LABEL_BELOW,
          text: name,
          colour: ink,
          ref: cell.placeRef,
        });
      }
    } else if (tile && cell.site) {
      const id = cell.site === DUNGEON || cell.siteKind === DUNGEON ? "site:dungeon" : "site:other";
      const glyph = s.glyph(id);
      const size = id === "site:dungeon" ? DUNGEON_MARK : SITE_MARK;
      if (glyph) marks.push({ kind: "glyph", x: p.x, y: p.y, glyph, colour: s.colour(id), size });
    }
    if (!tile) continue;
    if (cell.landmark) {
      marks.push({
        kind: "glyph",
        x: p.x,
        y: p.y,
        glyph: "ring",
        colour: s.colour("site:other"),
        size: SETTLEMENT_INK,
      });
    }
    (cell.structures ?? []).forEach((_, i, all) => {
      marks.push({
        kind: "glyph",
        x: p.x + (i - (all.length - 1) / 2) * PIP_GAP,
        y: p.y + PIP_ROW,
        glyph: "square",
        colour: ink,
        size: STRUCTURE_PIP,
      });
    });
  }
  return ground.concat(lines, marks, labels);
}

function relative(v: number | undefined, max: number): number {
  return max > 0 && v ? Math.min(1, v / max) : 0;
}

/**
 * One viewer's live layers: last-seen tiles veiled dim, base marks and all, live marks
 * (dotted when last seen), the rim of their sight, fronts and themselves.
 * cells are the base under the overlay; a tile with no cell draws nothing.
 * Threat and corruption tint by their share of the highest value the
 * overlay carries, so the hottest tile in view reads strongest.
 */
export function overlayOps(
  o: MapOverlay,
  cells: Map<string, MapCell>,
  s: Style,
  layers: ReadonlySet<LayerId>,
): DrawOp[] {
  const self = o.self;
  const selfKey = self ? hexKey(self) : "";
  const cellAt = (h: Axial): MapCell | undefined => {
    const k = hexKey(h);
    return cells.get(k) ?? (k === selfKey ? self?.cell : undefined);
  };
  const out: DrawOp[] = [];
  if (self?.cell && !cells.has(selfKey)) {
    const p = centre(self);
    out.push({ kind: "hex", x: p.x, y: p.y, size: 1, fill: groundFill(self.cell, s, layers) });
  }
  let maxThreat = 0;
  let maxCorruption = 0;
  for (const t of o.tiles) {
    maxThreat = Math.max(maxThreat, t.threat ?? 0);
    maxCorruption = Math.max(maxCorruption, t.corruption ?? 0);
  }
  const seenPattern = s.pattern("fog:seen");
  const sight = new Set<string>();
  const marks: DrawOp[] = [];
  for (const t of o.tiles) {
    const cell = cellAt(t);
    if (!cell) continue;
    const p = centre(t);
    const seen = t.fog === FogSeen;
    if (!seen) sight.add(hexKey(t));
    const tint = (fill: string, own: string) =>
      out.push({ kind: "hex", x: p.x, y: p.y, size: 1, fill, ...pat(seen ? seenPattern : own) });
    if (seen) {
      out.push({ kind: "hex", x: p.x, y: p.y, size: 1, fill: s.veil });
    }
    if (layers.has("weather") && t.weather && s.alpha(`weather:${t.weather}`) > 0) {
      tint(s.colour(`weather:${t.weather}`), "");
    }
    if (layers.has("threat")) {
      const share = relative(t.threat, maxThreat);
      if (share > 0) {
        const a = Math.round(s.alpha("layer:threat") * share);
        tint(s.colourAt("layer:threat", a), s.pattern("layer:threat"));
      }
      if (t.danger) tint(s.colour("layer:danger"), s.pattern("layer:danger"));
    }
    if (layers.has("corruption")) {
      const share = relative(t.corruption, maxCorruption);
      if (share > 0)
        tint(s.colourAt("layer:corruption", Math.round(s.alpha("layer:corruption") * share)), "");
      if (t.corrupted) tint(s.colour("layer:corruption"), s.pattern("layer:corruption"));
    }
    if (layers.has("troubles") && t.haunted) {
      tint(s.colour("layer:haunted"), s.pattern("layer:haunted"));
    }
    liveMarks(marks, t, p, s, layers, seen ? seenPattern : "");
  }
  out.push(...marks);
  if (self) sight.add(selfKey);
  const rim = s.opaque("fog:sight");
  for (const k of sight) {
    const [q = 0, r = 0] = k.split(",").map(Number);
    const h = { q, r };
    if (!cellAt(h)) continue;
    const p = centre(h);
    for (let d = 0; d < DIRECTIONS.length; d++) {
      if (!sight.has(hexKey(neighbour(h, d)))) out.push(edgeOp(p, d, rim, RIM_WIDTH));
    }
  }
  if (layers.has("weather")) {
    for (const f of o.fronts) {
      const d = (DIRECTION_IDS as readonly string[]).indexOf(f.heading);
      if (d < 0 || !cellAt(f)) continue;
      out.push(...frontArrow(centre(f), d, s.opaque(`weather:${f.kind}`)));
    }
  }
  if (self && layers.has("self")) {
    const at = centre(self);
    if (self.route?.length) {
      out.push({
        kind: "path",
        points: [at, ...self.route.map(centre)],
        colour: s.opaque("layer:route"),
        width: ROUTE_WIDTH,
      });
    }
    const glyph = s.glyph("layer:self") || "ring";
    out.push({ kind: "glyph", x: at.x, y: at.y, glyph, colour: s.opaque("ink"), size: SELF_INK });
    out.push({
      kind: "glyph",
      x: at.x,
      y: at.y,
      glyph,
      colour: s.colour("layer:self"),
      size: SELF_MARK,
    });
  }
  return out;
}

function pat(p: string): { pattern?: string } {
  return p ? { pattern: p } : {};
}

function liveMarks(
  out: DrawOp[],
  t: MapLive,
  p: Point,
  s: Style,
  layers: ReadonlySet<LayerId>,
  pattern: string,
): void {
  if (layers.has("troubles")) {
    const wanted: [boolean, string, string][] = [
      [!!t.trouble, "layer:trouble", s.colour("layer:trouble")],
      [!!t.fire, "layer:fire", s.colour("layer:fire")],
      [!!t.camp, "layer:camp", s.colour("layer:camp")],
      [!!t.cut, "cross", s.opaque("layer:danger")],
      [(t.toll ?? 0) > 0, "circle", s.opaque("layer:trouble")],
    ];
    let slot = 0;
    for (const [on, id, colour] of wanted) {
      if (!on) continue;
      const glyph = id.includes(":") ? s.glyph(id) : id;
      const at = MARK_SLOTS[slot++ % MARK_SLOTS.length]!;
      if (glyph) {
        out.push({
          kind: "glyph",
          x: p.x + at.x,
          y: p.y + at.y,
          glyph,
          colour,
          size: LIVE_MARK,
          ...pat(pattern),
        });
      }
    }
  }
  const pips = layers.has("busy") ? (BUSY_PIPS[t.busy ?? ""] ?? 0) : 0;
  const glyph = s.glyph("layer:busy");
  for (let i = 0; i < pips && glyph; i++) {
    out.push({
      kind: "glyph",
      x: p.x + (i - (pips - 1) / 2) * PIP_GAP,
      y: p.y + PIP_ROW,
      glyph,
      colour: s.colour("layer:busy"),
      size: PIP,
      ...pat(pattern),
    });
  }
}

function frontArrow(c: Point, d: number, colour: string): DrawOp[] {
  const v = centre(DIRECTIONS[d]!);
  const len = Math.hypot(v.x, v.y);
  const ux = v.x / len;
  const uy = v.y / len;
  const head = { x: c.x + ux * FRONT_REACH, y: c.y + uy * FRONT_REACH };
  const tail = { x: c.x - ux * FRONT_REACH, y: c.y - uy * FRONT_REACH };
  const barb = FRONT_REACH / 2;
  const left = { x: head.x - ux * barb - uy * barb, y: head.y - uy * barb + ux * barb };
  const right = { x: head.x - ux * barb + uy * barb, y: head.y - uy * barb - ux * barb };
  return [
    { kind: "path", points: [tail, head], colour, width: FRONT_WIDTH },
    { kind: "path", points: [left, head, right], colour, width: FRONT_WIDTH },
  ];
}

export interface FrameInput {
  camera: Camera;
  view: View;
  index: MapIndex;
  regions?: MapRegions;
  /** Fetched chunk payloads by chunkKey. */
  chunks: Map<string, MapChunk>;
  overlay?: MapOverlay;
  layers: ReadonlySet<LayerId>;
  style: Style;
}

export interface Frame {
  level: Level;
  /** Shared, cacheable draw lists: key names the payload, the layers and the style. */
  base: { key: string; ops: DrawOp[] }[];
  live: DrawOp[];
  /** The tile under a point in CSS px of the view, as the viewer may see it. */
  hit(x: number, y: number): MapTileView | undefined;
}

type Memo<T> = WeakMap<object, Map<string, { style: Style; value: T }>>;

function memo<T>(m: Memo<T>, owner: object, key: string, style: Style, make: () => T): T {
  let byKey = m.get(owner);
  if (!byKey) {
    byKey = new Map();
    m.set(owner, byKey);
  }
  const hit = byKey.get(key);
  if (hit && hit.style === style) return hit.value;
  const value = make();
  byKey.set(key, { style, value });
  return value;
}

const opsMemo: Memo<DrawOp[]> = new WeakMap();
const cellsMemo: Memo<Map<string, MapCell>> = new WeakMap();

export function regionCells(r: MapRegions): Map<string, MapCell> {
  const out = new Map<string, MapCell>();
  for (const { h, slot } of regionTiles(r)) {
    const g = r.regions[slot];
    if (g) out.set(hexKey(h), { q: h.q, r: h.r, terrain: g.terrain, region: g.ref });
  }
  return out;
}

function renamed(ops: DrawOp[], names: Record<string, string>): DrawOp[] {
  if (!ops.some((op) => op.kind === "label" && op.ref && names[op.ref] !== undefined)) return ops;
  return ops.map((op) =>
    op.kind === "label" && op.ref && names[op.ref] !== undefined
      ? { ...op, text: names[op.ref]! }
      : op,
  );
}

export function buildFrame(i: FrameInput): Frame {
  const { camera, view, style, layers } = i;
  const level = levelFor(camera.size, style.view);
  const lk = layersKey(layers);
  const base: Frame["base"] = [];
  let cells = new Map<string, MapCell>();
  if (level === "region") {
    const r = i.regions;
    if (r) {
      base.push({
        key: `region/${r.rev}|${lk}|${style.rev}`,
        ops: memo(opsMemo, r, `region|${lk}`, style, () => regionOps(r, style, layers)),
      });
      cells = memo(cellsMemo, r, "cells", style, () => regionCells(r));
    }
  } else {
    for (const ref of chunksInView(i.index, camera, view, Infinity)) {
      const key = chunkKey(ref, level, chunkRev(ref, level));
      const ch = i.chunks.get(key);
      if (!ch) continue;
      base.push({
        key: `${key}|${lk}|${style.rev}`,
        ops: memo(opsMemo, ch, `${level}|${lk}`, style, () => chunkOps(ch, level, style, layers)),
      });
      for (const cell of ch.cells) cells.set(hexKey(cell), cell);
    }
  }
  const o = i.overlay;
  const names = o?.names;
  if (names && Object.keys(names).length > 0) {
    for (const b of base) b.ops = renamed(b.ops, names);
  }
  const live = o ? overlayOps(o, cells, style, layers) : [];
  const lives = o ? liveByHex(o) : new Map<string, MapLive>();
  const self = o?.self;
  return {
    level,
    base,
    live,
    hit(x, y) {
      const h = screenToHex(camera, view, x, y);
      const k = hexKey(h);
      const cell = cells.get(k) ?? (self && hexKey(self) === k ? self.cell : undefined);
      return cell ? mergeTile(cell, lives.get(k)) : undefined;
    },
  };
}

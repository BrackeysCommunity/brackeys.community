import { isCameraRegionType } from "../game/primitives";
import type { Registry } from "../game/types";
import {
  gridCellsIn,
  metresToPx,
  num,
  oneWayEdge,
  overlaps,
  sceneDrawing,
  type DrawnEntity,
  type OverlayPoint,
  type SceneOverlay,
  type SceneRegionOptions,
} from "./render-geometry";
import { aabb, containsPoint, regionBox } from "./shape-geometry";
import { shapeIsClosed, shapeOutline } from "./shape-outline";
import type { Aabb, Bounds, ExpandedScene, Pt, SceneDefinition, ShapeObj } from "./types";

/** Tags that pick a map character over the type's own: a sensor tagged `goal` draws `G`. */
export const DEFAULT_ASCII_TAG_CHARS: Readonly<Record<string, string>> = {
  goal: "G",
  spawn: "S",
  hazard: "x",
};

export type SceneAsciiOptions = SceneRegionOptions & {
  registry: Registry;
  /** World px per character (metres times px per metre); default 64. Grows in steps of 64 when the map would pass `maxCells`. */
  cell?: number;
  /** Cap on columns and on rows; default 200. */
  maxCells?: number;
  /** `~` along every path rider's path; default true. */
  paths?: boolean;
  /** Characters for tagged entities; default `DEFAULT_ASCII_TAG_CHARS`. */
  tagChars?: Readonly<Record<string, string>>;
  /** `*` along the trail and `!` at the outcome. */
  overlay?: Pick<SceneOverlay, "trail" | "outcome">;
};

export type SceneAsciiMap = {
  name: string;
  /** The rectangle drawn, world px: metres times `pxPerMetre`. */
  region: Bounds;
  /** The game's px per metre. */
  pxPerMetre: number;
  /** World px per character. */
  cell: number;
  cols: number;
  rows: number;
  /** One string of `cols` characters per row, top first. Outside the scene's bounds is a space. */
  lines: string[];
  /** Every character the map uses, in first-use order, with what it stands for. */
  legend: { char: string; label: string }[];
};

const EMPTY = ".";
const OUTSIDE = " ";
const PATH = "~";
const TRAIL = "*";
const OUTCOME = "!";
const MORE = "…";
const RULER_EVERY = 8;

/**
 * Which character wins a cell: points over sensors over moving bodies over
 * static shapes over lines over sprites over camera regions' outlines.
 */
const PRIORITY = {
  region: -2,
  sprite: -1,
  path: 0,
  trail: 1,
  static: 2,
  moving: 3,
  sensor: 4,
  point: 5,
  more: 5,
  outcome: 6,
};

type Mark = { char: string; label: string; priority: number };
/** Inclusive column and row ranges: `[c0, c1, r0, r1]`. */
type Span = [number, number, number, number];
const UNBOUNDED: Span = [-Infinity, Infinity, -Infinity, Infinity];

function markOf(
  d: DrawnEntity,
  registry: Registry,
  tagChars: Readonly<Record<string, string>>,
): Mark {
  const name = d.type.type;
  const priority = !d.shape
    ? PRIORITY.point
    : isRegion(d)
      ? PRIORITY.region
      : d.base === "sensor"
        ? PRIORITY.sensor
        : d.path || d.base === "prop" || d.base === "follower"
          ? PRIORITY.moving
          : PRIORITY.static;
  if (oneWayEdge(d)) return { char: "=", label: `${name} one-way`, priority };
  const tag = d.tags.find((t) => Object.hasOwn(tagChars, t));
  if (tag !== undefined) return { char: tagChars[tag]!, label: `${name} [${tag}]`, priority };
  const base = d.base === undefined ? undefined : registry.types.get(d.base);
  const char = d.type.ascii ?? base?.ascii ?? (name[0] ?? "?").toLowerCase();
  return { char, label: name, priority };
}

/** A camera region: an area the camera frames, drawn as the outline of the box it frames only. */
const isRegion = (d: DrawnEntity) => isCameraRegionType(d.type);

/** `shape`'s outline as polylines, arcs flattened to at most `step` world px per segment. */
function outlinePolylines(shape: ShapeObj, step: number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const c of shapeOutline(shape)) {
    switch (c.op) {
      case "moveTo":
        if (cur.length) out.push(cur);
        cur = [[c.x, c.y]];
        break;
      case "lineTo":
        cur.push([c.x, c.y]);
        break;
      case "arc": {
        const sweep = c.end - c.start;
        const n = Math.max(4, Math.ceil((Math.abs(sweep) * c.r) / step));
        for (let i = 0; i <= n; i++) {
          const a = c.start + (sweep * i) / n;
          cur.push([c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a)]);
        }
        break;
      }
      case "close":
        if (cur[0]) cur.push(cur[0]);
        break;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Points along a polyline, no further apart than `step`. */
function* sampleLine(pts: readonly Pt[], step: number): Generator<Pt> {
  if (pts.length === 1) yield pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k <= n; k++) yield [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n];
  }
}

/**
 * The scene as a character map, one character per `cell` world px (the
 * scene's metres times the game's px per metre): each
 * entity in its type's character (`EntityTypeDef.ascii`, else its base
 * primitive's), camera regions as their box's outline under everything else, `=` for one-way solids, tag characters for tagged ones,
 * `~` along paths, each sprite's box in its entity's character under
 * everything else, grid fields' filled cells in their entity's character
 * (at most `SCENE_GRID_MAX_CELLS`, then `…`). Pure; region and `around` work as in `renderSceneSvg`.
 */
export function sceneAsciiMap(
  scene: SceneDefinition | ExpandedScene,
  opts: SceneAsciiOptions,
): SceneAsciiMap {
  const { registry } = opts;
  const drawing = sceneDrawing(scene, opts);
  const { entities: all, scene: expanded, pxPerMetre } = drawing;
  const wanted = drawing.region;
  const maxCells = opts.maxCells ?? 200;
  let cell = opts.cell ?? 64;
  if (!(cell > 0)) throw new Error(`cell must be positive, not ${cell}`);
  const longest = Math.max(wanted[2] - wanted[0], wanted[3] - wanted[1]);
  if (longest / cell > maxCells) cell = Math.ceil(longest / maxCells / 64) * 64;
  // Cells sit on multiples of `cell`, so the ruler and row labels read as round world coordinates.
  const x0 = Math.floor(wanted[0] / cell) * cell;
  const y0 = Math.floor(wanted[1] / cell) * cell;
  const cols = Math.max(1, Math.ceil((wanted[2] - x0) / cell));
  const rows = Math.max(1, Math.ceil((wanted[3] - y0) / cell));
  const region: Bounds = [x0, y0, x0 + cols * cell, y0 + rows * cell];

  const [bx0, by0, bx1, by1] = drawing.bounds;
  const inBounds = (c: number, r: number) => {
    const cx = x0 + (c + 0.5) * cell;
    const cy = y0 + (r + 0.5) * cell;
    return cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1;
  };
  const marks: (Mark | null)[][] = Array.from({ length: rows }, () =>
    new Array<Mark | null>(cols).fill(null),
  );
  /** The cells a box covers; a box edge on a cell line stays out of the next cell. */
  const spanOf = (b: Aabb): Span => {
    const c0 = Math.floor((b.minX - x0) / cell);
    const r0 = Math.floor((b.minY - y0) / cell);
    return [
      c0,
      Math.max(c0, Math.ceil((b.maxX - x0) / cell) - 1),
      r0,
      Math.max(r0, Math.ceil((b.maxY - y0) / cell) - 1),
    ];
  };
  const put = ([x, y]: Pt, m: Mark, [c0, c1, r0, r1]: Span = UNBOUNDED) => {
    const c = Math.min(c1, Math.max(c0, Math.floor((x - x0) / cell)));
    const r = Math.min(r1, Math.max(r0, Math.floor((y - y0) / cell)));
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    const prev = marks[r]![c];
    if (!prev || m.priority >= prev.priority) marks[r]![c] = m;
  };

  const step = cell / 4;
  const visible = all.filter((d) => overlaps(d.box, region));
  if (opts.paths !== false) {
    const mark: Mark = { char: PATH, label: "path", priority: PRIORITY.path };
    for (const d of visible) {
      if (!d.path || d.path.pts.length < 2) continue;
      const pts = d.path.mode === "loop" ? [...d.path.pts, d.path.pts[0]!] : d.path.pts;
      for (const p of sampleLine(pts, step)) put(p, mark);
    }
  }
  const trail = opts.overlay?.trail;
  const trailPts = (trail ? ("pts" in trail ? trail.pts : trail) : []).map(
    ([x, y]): Pt => [metresToPx(x, pxPerMetre), metresToPx(y, pxPerMetre)],
  );
  for (const p of sampleLine(trailPts, step))
    put(p, { char: TRAIL, label: "trail", priority: PRIORITY.trail });

  const tagChars = opts.tagChars ?? DEFAULT_ASCII_TAG_CHARS;
  const grid = gridCellsIn(visible, drawing.grid, region);
  const cellMarks = new Map<DrawnEntity, Mark>();
  for (const g of grid.cells) {
    let m = cellMarks.get(g.entity);
    if (!m) {
      m = { ...markOf(g.entity, registry, tagChars), priority: PRIORITY.static };
      cellMarks.set(g.entity, m);
    }
    // Every map cell whose centre the grid cell covers; a grid cell smaller than a map cell marks its own centre's.
    const [c0, c1, r0, r1] = spanOf(g.box);
    let marked = false;
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        const centre: Pt = [x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell];
        const { minX, minY, maxX, maxY } = g.box;
        if (centre[0] < minX || centre[0] >= maxX || centre[1] < minY || centre[1] >= maxY)
          continue;
        put(centre, m);
        marked = true;
      }
    }
    if (!marked) put([(g.box.minX + g.box.maxX) / 2, (g.box.minY + g.box.maxY) / 2], m);
  }
  if (grid.moreAt)
    put(grid.moreAt, {
      char: MORE,
      label: `${grid.more} more grid cells, not drawn`,
      priority: PRIORITY.more,
    });

  for (const d of visible) {
    if (!d.sprite) continue;
    const m = { ...markOf(d, registry, tagChars), priority: PRIORITY.sprite };
    const s = d.sprite.shape;
    const [c0, c1, r0, r1] = spanOf(d.sprite.box);
    let marked = false;
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        const centre: Pt = [x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell];
        if (!containsPoint(s, centre)) continue;
        put(centre, m);
        marked = true;
      }
    }
    if (!marked) put([s.cx, s.cy], m);
  }

  for (const d of visible) {
    const m = markOf(d, registry, tagChars);
    if (d.shape) {
      const span = spanOf(aabb(d.shape));
      if (shapeIsClosed(d.shape) && !isRegion(d)) {
        const [c0, c1, r0, r1] = span;
        for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
          for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
            const centre: Pt = [x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell];
            if (containsPoint(d.shape, centre)) put(centre, m);
          }
        }
      }
      for (const line of outlinePolylines(isRegion(d) ? regionBox(d.shape) : d.shape, step)) {
        for (const p of sampleLine(line, step)) put(p, m, span);
      }
    } else if (d.at) {
      put(d.at, m);
    }
  }

  const outcome = opts.overlay?.outcome;
  if (outcome?.at) {
    const p: OverlayPoint = outcome.at;
    const [x, y] = Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y];
    put([metresToPx(x, pxPerMetre), metresToPx(y, pxPerMetre)], {
      char: OUTCOME,
      label: `outcome ${outcome.result}`,
      priority: PRIORITY.outcome,
    });
  }

  // Only what survived on the map goes in the legend, in scan order.
  const legend = new Map<string, string[]>();
  const lines = marks.map((row, r) =>
    row
      .map((m, c) => {
        if (!m) return inBounds(c, r) ? EMPTY : OUTSIDE;
        const labels = legend.get(m.char) ?? [];
        if (!labels.includes(m.label)) legend.set(m.char, [...labels, m.label]);
        return m.char;
      })
      .join(""),
  );

  return {
    name: expanded.name,
    region,
    pxPerMetre,
    cell,
    cols,
    rows,
    lines,
    legend: [...legend].map(([char, labels]) => ({ char, label: labels.join(", ") })),
  };
}

/** `sceneAsciiMap` as text: a header, an x ruler, rows prefixed by their y, and the legend. */
export function formatAsciiMap(map: SceneAsciiMap): string {
  const [x0, y0, x1, y1] = map.region;
  const ys = Array.from({ length: map.rows }, (_, r) => num(y0 + r * map.cell));
  const gutter = Math.max(...ys.map((y) => y.length)) + 1;
  let ruler = "";
  for (let c = 0; c < map.cols; c += RULER_EVERY) {
    ruler = ruler.padEnd(c, " ") + num(x0 + c * map.cell);
  }
  const legend = [...map.legend.map((l) => `  ${l.char}  ${l.label}`), `  ${EMPTY}  empty`];
  return [
    `${map.name}: x ${num(x0)}..${num(x1)}, y ${num(y0)}..${num(y1)}, ${num(map.cell)}px cells (${map.cols} x ${map.rows})`,
    `${" ".repeat(gutter)}${ruler}`.trimEnd(),
    ...map.lines.map((l, r) => `${ys[r]!.padStart(gutter - 1)} ${l}`.trimEnd()),
    "legend:",
    ...legend,
  ].join("\n");
}

/** The scene's character map as text; see `sceneAsciiMap`. */
export function renderSceneAscii(
  scene: SceneDefinition | ExpandedScene,
  opts: SceneAsciiOptions,
): string {
  return `${formatAsciiMap(sceneAsciiMap(scene, opts))}\n`;
}

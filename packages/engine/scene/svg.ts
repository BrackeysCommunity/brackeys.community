import { cssHex } from "../game/color";
import { CAMERA_REGION_TYPE, outlineOnly } from "../game/primitives";
import { styleOf } from "../game/style";
import type { Registry, Style } from "../game/types";
import {
  type DrawnGridCell,
  type DrawnGridCells,
  gridCellsIn,
  num,
  oneWayEdges,
  overlaps,
  overlayInPx,
  sceneDrawing,
  type DrawnEntity,
  type OverlayPoint,
  type SceneDrawing,
  type SceneOverlay,
  type SceneRegionOptions,
} from "./render-geometry";
import { aabb, regionBox, translateShape } from "./shape-geometry";
import { shapeIsClosed, shapeOutline, type PathCommand } from "./shape-outline";
import type { Bounds, ExpandedScene, Pt, SceneDefinition, ShapeObj } from "./types";
import { pxToMetres } from "./units";

/** The longest side of a rendered scene, in image px. */
export const SCENE_SVG_MAX_SIZE = 1600;

export { SCENE_GRID_MAX_CELLS } from "./render-geometry";

export type SceneLabels = "entities" | "all" | "none";

export type SceneSvgOptions = SceneRegionOptions & {
  /** Types, styles and materials; the registry the scene was parsed with. */
  registry: Registry;
  /** Image px per world px, before the cap; default 1. */
  scale?: number;
  /** Cap on the longest side, image px; default `SCENE_SVG_MAX_SIZE`. */
  maxSize?: number;
  /** `entities` (default) labels entities that have ids; `all` adds bulk refs; `none` labels nothing. */
  labels?: SceneLabels;
  /** Waypoints, numbered ghosts and the line between them for every path rider; default true. */
  paths?: boolean;
  overlay?: SceneOverlay;
};

/** The world rectangle a render covers and the image size it gets. */
export type SceneViewport = {
  /** The world rectangle, metres. */
  region: Bounds;
  /** The game's px per metre: world px are metres times this. */
  pxPerMetre: number;
  /** Image px per world px. */
  scale: number;
  width: number;
  height: number;
  /** World px between grid lines and axis ticks; the ticks are labelled in world px. */
  tick: number;
};

/** A viewport with its region in world px, as the drawing uses it. */
type PxViewport = Omit<SceneViewport, "pxPerMetre">;

const FALLBACK_STYLE: Style = { fill: 0x888888, stroke: 0xcccccc, alpha: 0.5 };
const POINT_COLOR = 0xffcc44;
const SEVERITY_COLOR = { error: "#ff4d4f", warn: "#ffb020", info: "#4da3ff" } as const;
const CATEGORY_COLORS = [
  "#4dd0e1",
  "#ffd54f",
  "#ba68c8",
  "#81c784",
  "#ff8a65",
  "#90caf9",
  "#f48fb1",
];
const BACKGROUND = "#101218";
const SCENE_FILL = "#181b22";
const INK = "#f2f4f8";
const ONE_WAY_COLOR = "#4da3ff";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const toPt = (p: OverlayPoint): Pt => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]);

/** World px between ticks: 64, 128, then doubling, the first at least 48 image px apart. */
function tickSpacing(scale: number): number {
  let s = 64;
  while (s * scale < 48) s *= 2;
  return s;
}

function viewportOf(
  { region }: SceneDrawing,
  opts: Pick<SceneSvgOptions, "maxSize" | "scale">,
): PxViewport {
  const w = region[2] - region[0];
  const h = region[3] - region[1];
  const max = opts.maxSize ?? SCENE_SVG_MAX_SIZE;
  const wanted = opts.scale ?? 1;
  if (!(wanted > 0) || !Number.isFinite(wanted))
    throw new Error(`scale must be positive, not ${wanted}`);
  const scale = Math.min(wanted, max / Math.max(w, h));
  return {
    region,
    scale,
    width: Math.max(1, Math.min(max, Math.round(w * scale))),
    height: Math.max(1, Math.min(max, Math.round(h * scale))),
    tick: tickSpacing(scale),
  };
}

/** Where `renderSceneSvg` looks and how big its image is, without drawing it. */
export function sceneViewport(
  scene: SceneDefinition | ExpandedScene,
  opts: SceneSvgOptions,
): SceneViewport {
  const drawing = sceneDrawing(scene, opts);
  const vp = viewportOf(drawing, opts);
  const k = drawing.pxPerMetre;
  const [x0, y0, x1, y1] = vp.region;
  return {
    ...vp,
    region: [pxToMetres(x0, k), pxToMetres(y0, k), pxToMetres(x1, k), pxToMetres(y1, k)],
    pxPerMetre: k,
  };
}

/** SVG path data for an outline; arcs are split into quarter turns so a full circle draws. */
export function svgPathData(cmds: readonly PathCommand[]): string {
  const out: string[] = [];
  let cur: Pt | null = null;
  for (const c of cmds) {
    switch (c.op) {
      case "moveTo":
      case "lineTo":
        out.push(`${c.op === "moveTo" ? "M" : "L"}${num(c.x)} ${num(c.y)}`);
        cur = [c.x, c.y];
        break;
      case "arc": {
        const sweep = c.end - c.start;
        const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
        const sx = c.cx + c.r * Math.cos(c.start);
        const sy = c.cy + c.r * Math.sin(c.start);
        if (!cur) out.push(`M${num(sx)} ${num(sy)}`);
        else if (Math.hypot(sx - cur[0], sy - cur[1]) > 1e-6) out.push(`L${num(sx)} ${num(sy)}`);
        for (let i = 1; i <= n; i++) {
          const a = c.start + (sweep * i) / n;
          cur = [c.cx + c.r * Math.cos(a), c.cy + c.r * Math.sin(a)];
          out.push(
            `A${num(c.r)} ${num(c.r)} 0 0 ${sweep > 0 ? 1 : 0} ${num(cur[0])} ${num(cur[1])}`,
          );
        }
        break;
      }
      case "close":
        out.push("Z");
        break;
    }
  }
  return out.join("");
}

const isSpawnLike = (d: DrawnEntity) => d.tags.includes("spawn") || d.type.type === "spawn";

/**
 * A schematic of the scene as SVG text, drawn in world px (the scene's
 * metres times the game's px per metre, written to 1/100 px): every entity
 * through `shapeOutline` in its registered type's (and material's) style, each
 * one-way solid's landing face (as the edit overlay marks it), a
 * grid with axis ticks in world px, id labels, each sprite's box labelled `asset[:frame]` (sized
 * from `opts.project` when given), path waypoints with numbered ghosts, and overlays
 * (issues, a playtest's trail, events and outcome). Pure and deterministic:
 * the same scene and options give the same text.
 */
export function renderSceneSvg(
  scene: SceneDefinition | ExpandedScene,
  opts: SceneSvgOptions,
): string {
  const { registry } = opts;
  const drawing = sceneDrawing(scene, opts);
  const { entities: all, scene: expanded } = drawing;
  const vp = viewportOf(drawing, opts);
  const [x0, y0, x1, y1] = vp.region;
  const u = 1 / vp.scale;
  const px = (n: number) => num(n * u);
  const visible = all.filter((d) =>
    overlaps(d.box, [x0 - 8 * u, y0 - 8 * u, x1 + 8 * u, y1 + 8 * u]),
  );
  const byId = new Map(all.map((d) => [d.id, d]));
  const labels = opts.labels ?? "entities";
  const out: string[] = [];

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vp.width}" height="${vp.height}" ` +
      `viewBox="${num(x0)} ${num(y0)} ${num(x1 - x0)} ${num(y1 - y0)}" preserveAspectRatio="none" ` +
      `font-family="Rubik, sans-serif" data-scene="${esc(expanded.name)}" data-scale="${vp.scale.toFixed(4)}">`,
  );
  out.push(
    `<rect x="${num(x0)}" y="${num(y0)}" width="${num(x1 - x0)}" height="${num(y1 - y0)}" fill="${BACKGROUND}"/>`,
  );
  const [bx0, by0, bx1, by1] = drawing.bounds;
  out.push(
    `<rect id="bounds" x="${num(bx0)}" y="${num(by0)}" width="${num(bx1 - bx0)}" height="${num(by1 - by0)}" ` +
      `fill="${SCENE_FILL}" stroke="#4a5060" stroke-width="${px(1)}"/>`,
  );

  // Grid
  const lines: number[] = [];
  const grid: string[] = [];
  const axis: string[] = [];
  for (let x = Math.ceil(x0 / vp.tick) * vp.tick; x <= x1; x += vp.tick) {
    lines.push(x);
    (x === 0 ? axis : grid).push(`M${num(x)} ${num(y0)}V${num(y1)}`);
  }
  const rows: number[] = [];
  for (let y = Math.ceil(y0 / vp.tick) * vp.tick; y <= y1; y += vp.tick) {
    rows.push(y);
    (y === 0 ? axis : grid).push(`M${num(x0)} ${num(y)}H${num(x1)}`);
  }
  out.push(`<g id="grid" fill="none" stroke-width="${px(1)}">`);
  if (grid.length) out.push(`<path d="${grid.join("")}" stroke="#ffffff" stroke-opacity="0.07"/>`);
  if (axis.length) out.push(`<path d="${axis.join("")}" stroke="#ffffff" stroke-opacity="0.25"/>`);
  out.push(`</g>`);

  // Grid fields' cells, under the entities
  const cells = gridCellsIn(visible, drawing.grid, vp.region);
  if (cells.cells.length > 0 || cells.more > 0)
    out.push(...gridCellElements(cells, registry, px, u));

  // Entities
  out.push(`<g id="entities">`);
  for (const d of visible) {
    if (!d.shape) continue;
    const style = styleOf({ registry }, d.type, materialOf(d)) ?? FALLBACK_STYLE;
    // A camera region is an area the camera frames, not a surface: the box it frames, dashed and unfilled.
    const region = d.base === CAMERA_REGION_TYPE;
    out.push(
      shapeElement(
        region ? regionBox(d.shape) : d.shape,
        region ? outlineOnly(style) : style,
        px,
        `data-ref="${esc(d.id)}" data-type="${esc(d.type.type)}"` +
          (region ? ` stroke-dasharray="${px(6)} ${px(4)}"` : ""),
      ),
    );
  }
  for (const d of visible) {
    if (d.shape || !d.at) continue;
    const style = styleOf({ registry }, d.type, materialOf(d));
    const color = cssHex(style?.stroke ?? style?.fill ?? POINT_COLOR);
    const [x, y] = d.at;
    const attrs = `data-ref="${esc(d.id)}" data-type="${esc(d.type.type)}"`;
    if (isSpawnLike(d)) {
      // A flag standing on the point: spawns are feet positions.
      out.push(
        `<g ${attrs} class="spawn"><path d="M${num(x)} ${num(y)}V${num(y - 22 * u)}L${num(x + 12 * u)} ${num(y - 17 * u)}L${num(x)} ${num(y - 12 * u)}" ` +
          `fill="${color}" fill-opacity="0.85" stroke="${color}" stroke-width="${px(1.5)}"/>` +
          `<circle cx="${num(x)}" cy="${num(y)}" r="${px(3)}" fill="${color}"/></g>`,
      );
    } else {
      out.push(
        `<g ${attrs} class="marker" fill="none" stroke="${color}" stroke-width="${px(1.5)}">` +
          `<circle cx="${num(x)}" cy="${num(y)}" r="${px(5)}"/>` +
          `<path d="M${num(x - 8 * u)} ${num(y)}H${num(x + 8 * u)}M${num(x)} ${num(y - 8 * u)}V${num(y + 8 * u)}"/></g>`,
      );
    }
  }
  out.push(`</g>`);

  // One-way solids' landing faces: actors pass through every other side
  const faces = oneWayEdges(visible);
  if (faces.length > 0) {
    out.push(
      `<g id="one-way" fill="none" stroke="${ONE_WAY_COLOR}" stroke-width="${px(3)}" stroke-linecap="round">`,
    );
    for (const { entity, side, from, to } of faces)
      out.push(
        `<path data-one-way="${esc(entity.id)}" data-side="${side}" d="M${num(from[0])} ${num(from[1])}L${num(to[0])} ${num(to[1])}"/>`,
      );
    out.push(`</g>`);
  }

  // Sprites: the box each draws, over the bodies they dress
  const sprites = visible.filter((d) => d.sprite);
  if (sprites.length > 0) {
    out.push(
      `<g id="sprites" fill="none" stroke-width="${px(1.25)}" stroke-dasharray="${px(4)} ${px(3)}">`,
    );
    for (const d of sprites) {
      const s = d.sprite!;
      const style = styleOf({ registry }, d.type, materialOf(d));
      const color = cssHex(style?.stroke ?? style?.fill ?? POINT_COLOR);
      const asset = s.asset === undefined ? "" : ` data-asset="${esc(s.asset)}"`;
      const frame = s.frame === undefined ? "" : ` data-frame="${esc(s.frame)}"`;
      out.push(
        `<path data-sprite="${esc(d.id)}"${asset}${frame} d="${svgPathData(shapeOutline(s.shape))}" stroke="${color}"/>`,
      );
    }
    out.push(`</g>`);
  }

  // Paths
  if (opts.paths !== false) {
    out.push(`<g id="paths" fill="none">`);
    for (const d of visible) {
      if (!d.path || d.path.pts.length === 0) continue;
      const style = styleOf({ registry }, d.type, materialOf(d)) ?? FALLBACK_STYLE;
      const color = cssHex(style.stroke ?? style.fill ?? POINT_COLOR);
      const pts = d.path.pts;
      const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${num(x)} ${num(y)}`).join("");
      const dash = `stroke-dasharray="${px(6)} ${px(4)}"`;
      out.push(`<g data-path="${esc(d.id)}" stroke="${color}">`);
      out.push(
        `<path d="${line}${d.path.mode === "loop" && pts.length > 2 ? "Z" : ""}" stroke-opacity="0.7" stroke-width="${px(1.5)}" ${dash}/>`,
      );
      if (d.localShape) {
        for (const p of pts.slice(1)) {
          const ghost = translateShape(d.localShape, p);
          out.push(
            `<path d="${svgPathData(shapeOutline(ghost))}" stroke-opacity="0.5" stroke-width="${px(1)}" ${dash}/>`,
          );
        }
      }
      pts.forEach(([x, y], i) => {
        out.push(
          `<circle cx="${num(x)}" cy="${num(y)}" r="${px(7)}" fill="${BACKGROUND}" fill-opacity="0.85" stroke-width="${px(1.5)}"/>` +
            `<text x="${num(x)}" y="${num(y + 3.2 * u)}" font-size="${px(9)}" text-anchor="middle" fill="${color}" stroke="none">${i}</text>`,
        );
      });
      out.push(`</g>`);
    }
    out.push(`</g>`);
  }

  // Labels
  if (labels !== "none") {
    out.push(
      `<g id="labels" text-anchor="middle" fill="${INK}" stroke="#000000" stroke-opacity="0.75" ` +
        `stroke-width="${px(3)}" stroke-linejoin="round" paint-order="stroke">`,
    );
    for (const d of visible) {
      if (d.bulk && labels !== "all") continue;
      const size = d.bulk ? 9 : 11;
      const opacity = d.bulk ? ` fill-opacity="0.7"` : "";
      if (d.shape) {
        const [x, y] = labelPoint(d, u, vp.region);
        out.push(
          `<text x="${num(x)}" y="${num(y + (size / 2.8) * u)}" font-size="${px(size)}"${opacity}>${esc(d.id)}</text>`,
        );
      } else if (d.at) {
        out.push(
          `<text x="${num(d.at[0] + 9 * u)}" y="${num(d.at[1] - 9 * u)}" font-size="${px(size)}" text-anchor="start"${opacity}>${esc(d.id)}</text>`,
        );
      }
      if (d.sprite) {
        const b = d.sprite.box;
        out.push(
          `<text class="sprite-label" x="${num((b.minX + b.maxX) / 2)}" y="${num(b.minY - 3 * u)}" font-size="${px(9)}" fill-opacity="0.8">${esc(d.sprite.label)}</text>`,
        );
      }
    }
    out.push(`</g>`);
  }

  // Overlays, over the labels so a report reads first
  if (opts.overlay)
    out.push(...overlayElements(overlayInPx(opts.overlay, drawing.pxPerMetre), byId, px, u, vp));

  // Axis ticks, along the top and left edges
  out.push(
    `<g id="ticks" font-size="${px(10)}" fill="#c8ccd6" stroke="${BACKGROUND}" stroke-width="${px(2.5)}" paint-order="stroke">`,
  );
  for (const x of lines) {
    if (x1 - x < 28 * u) continue;
    out.push(`<text x="${num(x + 3 * u)}" y="${num(y0 + 11 * u)}">${num(x)}</text>`);
  }
  for (const y of rows) {
    if (y - y0 < 16 * u) continue;
    out.push(`<text x="${num(x0 + 3 * u)}" y="${num(y - 3 * u)}">${num(y)}</text>`);
  }
  out.push(`</g>`);

  out.push(`</svg>`);
  return `${out.join("\n")}\n`;
}

function gridCellElements(
  { cells, more, moreAt }: DrawnGridCells,
  registry: Registry,
  px: (n: number) => string,
  u: number,
): string[] {
  const out: string[] = [`<g id="grid-cells" fill-opacity="0.7" stroke-width="${px(1)}">`];
  let open: DrawnGridCell | null = null;
  for (const c of cells) {
    if (open?.entity !== c.entity || open.field !== c.field) {
      if (open) out.push(`</g>`);
      const d = c.entity;
      const style = styleOf({ registry }, d.type, materialOf(d)) ?? FALLBACK_STYLE;
      out.push(
        `<g data-ref="${esc(d.id)}" data-type="${esc(d.type.type)}" data-field="${esc(c.field)}" ` +
          `stroke="${cssHex(style.stroke ?? style.fill ?? POINT_COLOR)}" stroke-opacity="0.6">`,
      );
      open = c;
    }
    const fill = CATEGORY_COLORS[(c.value - 1) % CATEGORY_COLORS.length]!;
    const attrs = `data-cell="${c.col},${c.row}" data-v="${c.value}" fill="${fill}"`;
    if (c.outline.length === 4) {
      const { minX, minY, maxX, maxY } = c.box;
      out.push(
        `<rect ${attrs} x="${num(minX)}" y="${num(minY)}" width="${num(maxX - minX)}" height="${num(maxY - minY)}"/>`,
      );
    } else {
      const d = c.outline.map(([x, y], i) => `${i ? "L" : "M"}${num(x)} ${num(y)}`).join("");
      out.push(`<path ${attrs} d="${d}Z"/>`);
    }
  }
  if (open) out.push(`</g>`);
  if (moreAt)
    out.push(
      `<text class="grid-more" data-more="${more}" x="${num(moreAt[0])}" y="${num(moreAt[1] + 4 * u)}" ` +
        `font-size="${px(12)}" text-anchor="middle" fill="${INK}" fill-opacity="1" stroke="none">…</text>`,
    );
  out.push(`</g>`);
  return out;
}

const materialOf = (d: DrawnEntity) =>
  typeof d.entity.material === "string" ? d.entity.material : undefined;

/**
 * Where a shape's label sits: the centre of its box, kept inside the image;
 * a path rider's goes above it, clear of its first waypoint.
 */
function labelPoint(d: DrawnEntity, u: number, [x0, y0, x1, y1]: Bounds): Pt {
  const b = aabb(d.shape!);
  const x = (b.minX + b.maxX) / 2;
  const y = d.path ? b.minY - 9 * u : (b.minY + b.maxY) / 2;
  const clamp = (v: number, lo: number, hi: number) =>
    lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
  return [clamp(x, x0 + 30 * u, x1 - 30 * u), clamp(y, y0 + 20 * u, y1 - 8 * u)];
}

/** Like `drawShape`: closed shapes fill and stroke, an open one strokes in its fill color. */
function shapeElement(
  shape: ShapeObj,
  style: Style,
  px: (n: number) => string,
  attrs: string,
): string {
  const closed = shapeIsClosed(shape);
  const fill = closed ? style.fill : undefined;
  const stroke = closed ? style.stroke : (style.stroke ?? style.fill);
  const alpha = style.alpha ?? 1;
  const parts = [`<path ${attrs} d="${svgPathData(shapeOutline(shape))}"`];
  parts.push(
    fill === undefined ? ` fill="none"` : ` fill="${cssHex(fill)}" fill-opacity="${num(alpha)}"`,
  );
  if (stroke !== undefined) {
    const width = Math.max(style.strokeWidth ?? 1, closed ? 1.25 : 2);
    parts.push(
      ` stroke="${cssHex(stroke)}" stroke-opacity="${num(style.strokeAlpha ?? Math.max(alpha, 0.6))}" stroke-width="${px(width)}" stroke-linejoin="round"`,
    );
  }
  parts.push("/>");
  return parts.join("");
}

function overlayElements(
  overlay: SceneOverlay,
  byId: ReadonlyMap<string, DrawnEntity>,
  px: (n: number) => string,
  u: number,
  vp: PxViewport,
): string[] {
  const out: string[] = [`<g id="overlay">`];
  const text = (x: number, y: number, size: number, fill: string, body: string, anchor = "start") =>
    `<text x="${num(x)}" y="${num(y)}" font-size="${px(size)}" fill="${fill}" text-anchor="${anchor}" ` +
    `stroke="#000000" stroke-opacity="0.8" stroke-width="${px(3)}" paint-order="stroke">${esc(body)}</text>`;

  const trail = overlay.trail ? ("pts" in overlay.trail ? overlay.trail.pts : overlay.trail) : [];
  if (trail.length > 0) {
    const d = trail.map(([x, y], i) => `${i ? "L" : "M"}${num(x)} ${num(y)}`).join("");
    const [sx, sy] = trail[0]!;
    const [ex, ey] = trail[trail.length - 1]!;
    out.push(
      `<g id="trail"><path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="${px(2)}" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<circle cx="${num(sx)}" cy="${num(sy)}" r="${px(4)}" fill="#66ff99"/>` +
        `<circle cx="${num(ex)}" cy="${num(ey)}" r="${px(4)}" fill="#ffffff"/></g>`,
    );
  }

  const events = overlay.events ?? [];
  if (events.length > 0) {
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    const types = [...counts.keys()].sort();
    const color = new Map(types.map((t, i) => [t, CATEGORY_COLORS[i % CATEGORY_COLORS.length]!]));
    out.push(`<g id="events" stroke="#000000" stroke-width="${px(1)}">`);
    for (const e of events) {
      const [x, y] = toPt(e.at);
      const tick = e.tick === undefined ? "" : ` data-tick="${e.tick}"`;
      out.push(
        `<circle cx="${num(x)}" cy="${num(y)}" r="${px(3.5)}" fill="${color.get(e.type)}" data-event="${esc(e.type)}"${tick}/>`,
      );
    }
    out.push(`</g>`);
    // A legend in the bottom-left corner: each event type, its color and count.
    const [lx, , , ly] = vp.region;
    out.push(`<g id="event-legend">`);
    types.forEach((t, i) => {
      const y = ly - (types.length - i) * 14 * u;
      out.push(
        `<circle cx="${num(lx + 10 * u)}" cy="${num(y - 3.5 * u)}" r="${px(3.5)}" fill="${color.get(t)}"/>` +
          text(lx + 18 * u, y, 10, INK, `${t} ×${counts.get(t)}`),
      );
    });
    out.push(`</g>`);
  }

  for (const issue of overlay.issues ?? []) {
    const color = SEVERITY_COLOR[issue.severity] ?? SEVERITY_COLOR.info;
    const boxes = issue.entityIds.map((id) => byId.get(id)).filter((d) => d !== undefined);
    const parts: string[] = [];
    for (const d of boxes) {
      const pad = 6 * u;
      parts.push(
        `<rect x="${num(d.box.minX - pad)}" y="${num(d.box.minY - pad)}" width="${num(d.box.maxX - d.box.minX + 2 * pad)}" ` +
          `height="${num(d.box.maxY - d.box.minY + 2 * pad)}" fill="none" stroke="${color}" stroke-width="${px(2)}" stroke-dasharray="${px(5)} ${px(3)}"/>`,
      );
    }
    let anchor: Pt | null = null;
    if (issue.at) {
      const [x, y] = issue.at;
      parts.push(
        `<circle cx="${num(x)}" cy="${num(y)}" r="${px(9)}" fill="none" stroke="${color}" stroke-width="${px(2.5)}"/>`,
      );
      anchor = [x + 11 * u, y - 11 * u];
    } else if (boxes[0]) {
      anchor = [boxes[0].box.minX - 6 * u, boxes[0].box.minY - 9 * u];
    }
    if (anchor)
      parts.push(text(anchor[0], anchor[1], 10, color, `${issue.severity} ${issue.code}`));
    if (parts.length > 0)
      out.push(
        `<g data-issue="${esc(issue.code)}" data-severity="${issue.severity}">${parts.join("")}</g>`,
      );
  }

  const outcome = overlay.outcome;
  if (outcome?.at) {
    const [x, y] = toPt(outcome.at);
    const r = 10 * u;
    const label = [
      outcome.result,
      outcome.tick === undefined ? "" : `@${outcome.tick}`,
      outcome.cause ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    out.push(
      `<g id="outcome" data-result="${esc(outcome.result)}"><circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}" fill="none" stroke="#ff5c8a" stroke-width="${px(2.5)}"/>` +
        `<path d="M${num(x - r)} ${num(y - r)}L${num(x + r)} ${num(y + r)}M${num(x + r)} ${num(y - r)}L${num(x - r)} ${num(y + r)}" stroke="#ff5c8a" stroke-width="${px(2)}"/>` +
        text(x + r + 3 * u, y + r + 12 * u, 12, "#ff8fab", label) +
        `</g>`,
    );
  }

  out.push(`</g>`);
  return out;
}

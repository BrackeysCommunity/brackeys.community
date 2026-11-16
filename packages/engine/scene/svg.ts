import type { TextFont } from "../context";
import {
  measureFont,
  richSource,
  TEXT,
  TEXT_SIZE_DEFAULT,
  textBoxShape,
  textFontOf,
  type FontAssetInfo,
  type TextBlock,
} from "../game/behaviors/text";
import { cssHex } from "../game/color";
import { isCameraRegionType, outlineOnly } from "../game/primitives";
import { styleOf } from "../game/style";
import { decodeCell } from "../game/tile-cell";
import type { DebugDrawCommand, Registry, Style } from "../game/types";
import { assetInfo } from "../project/asset-info";
import { measureText } from "../text/measure";
import { parseRichText, richPlainText } from "../text/rich";
import { keyedText, type StringTableData } from "../text/strings";
import type { TileTraits } from "../tiles/chunks";
import {
  type DrawnGridCell,
  type DrawnGridCells,
  drawnJoints,
  jointGlyph,
  gridCellsIn,
  num,
  oneWayEdges,
  overlaps,
  overlayInPx,
  sceneDrawing,
  shapeInPx,
  type DrawnEntity,
  type OverlayPoint,
  type SceneDrawing,
  type SceneOverlay,
  type SceneRegionOptions,
} from "./render-geometry";
import {
  aabb,
  geometryPose,
  regionBox,
  shapeCentre,
  translateShape,
  turnBy,
} from "./shape-geometry";
import { shapeIsClosed, shapeOutline, type PathCommand } from "./shape-outline";
import type { Bounds, ExpandedScene, Pt, RuntimeEntity, SceneDefinition, ShapeObj } from "./types";
import { pxToMetres } from "./units";

/** The longest side of a rendered scene, in image px. */
export const SCENE_SVG_MAX_SIZE = 1600;

export { SCENE_GRID_MAX_CELLS } from "./render-geometry";

export type SceneLabels = "entities" | "all" | "none";

/** What a schematic measures world text in. */
export type SceneTextOptions = {
  /**
   * The locale a `text` block is measured in, the default: its text by key
   * and the font a block without one draws in. Without it a key measures as
   * its bracketed key, in an estimate.
   */
  strings?: StringTableData;
};

/**
 * Each tileset's tiles as `tileTraits` judges them, by tileset asset id and
 * then tile id: plain data the caller computes, so renders and colliders
 * read one rule. A tile, or a tileset, not listed draws as not solid.
 */
export type SceneTileTraits = Readonly<
  Record<string, Readonly<Record<number, Pick<TileTraits, "solid">>>>
>;

export type SceneTileOptions = {
  /** Per-tile traits for tilemaps' cells: solid tiles fill, the rest outline. */
  tileTraits?: SceneTileTraits;
};

/** A tilemap cell as renders draw it; null for a grid cell that isn't a tilemap's. */
export type DrawnTile = { id: number; solid: boolean };

/** The tile a drawn grid cell holds, judged by `traits`. */
export function drawnTile(
  cell: DrawnGridCell,
  traits: SceneTileTraits | undefined,
): DrawnTile | null {
  const d = cell.entity;
  if (cell.field !== "cells" || (d.type.type !== "tilemap" && d.base !== "tilemap")) return null;
  const decoded = decodeCell(cell.value);
  if (!decoded) return null;
  const tileset = typeof d.entity.tileset === "string" ? d.entity.tileset : undefined;
  const solid = tileset === undefined ? false : traits?.[tileset]?.[decoded.id]?.solid === true;
  return { id: decoded.id, solid };
}

/** Tilemap cells are labelled with their tile id while at most this many are drawn. */
export const TILE_LABEL_MAX_CELLS = 400;
/** …and while a cell is at least this many image px across. */
const TILE_LABEL_MIN_PX = 12;

export type SceneSvgOptions = SceneRegionOptions &
  SceneTextOptions &
  SceneTileOptions & {
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
    /** `ctx.debug` draws (a probe's `debug`), drawn over everything in world metres; widths and text sizes in image px. */
    debugDraw?: readonly DebugDrawCommand[];
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
const JOINT_COLOR = "#c792ea";

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

/** The entity geometry a text is posed from: world shape, point and path, and its transform. */
export type TextPoseSource = {
  shape?: ShapeObj;
  at?: Pt;
  path?: { pts: readonly Pt[] };
  transform?: RuntimeEntity["transform"];
};

/** A text block as a schematic render draws it, in the pose's units. */
export type DrawnText = {
  /** The text measured, markup removed: its key's in the given strings, else its literal. */
  label: string;
  key?: string;
  /** The box in world space, turned with the entity. */
  shape: Extract<ShapeObj, { type: "box" }>;
  /** Measured from a BMFont's metrics; false for an estimate. */
  exact: boolean;
};

/** What a schematic measures a text in: its locale's strings and font, its fonts and its units. */
export type TextMeasureEnv = {
  /** Text by key in the locale measured; a key without one measures bracketed. */
  strings?: Readonly<Record<string, string>>;
  /** The face a block without `font` draws in: the locale's. */
  font?: TextFont | null;
  asset?: (id: string) => FontAssetInfo | null | undefined;
  /** Px at zoom 1 per unit of the pose: 1 for world px. */
  pxPerUnit: number;
};

const isUnitPair = (v: unknown): v is [number, number] =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1);
const isPositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/** The fields of a text block the box reads, each kept only when it has its schema's shape. */
function readTextBlock(v: unknown): TextBlock | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const b = v as Record<string, unknown>;
  const out: TextBlock = {};
  if (typeof b.text === "string") out.text = b.text;
  if (typeof b.key === "string") out.key = b.key;
  if (typeof b.font === "string") out.font = b.font;
  if (isPositive(b.size)) out.size = b.size;
  if (isPositive(b.wrap)) out.wrap = b.wrap;
  if (isUnitPair(b.anchor)) out.anchor = b.anchor;
  if (b.rich === true) out.rich = true;
  if (b.vars !== null && typeof b.vars === "object" && !Array.isArray(b.vars)) {
    const vars = Object.entries(b.vars).filter(
      (e): e is [string, string | number] => typeof e[1] === "string" || typeof e[1] === "number",
    );
    out.vars = Object.fromEntries(vars);
  }
  return out;
}

const DEG = Math.PI / 180;

/**
 * Where a `text` block draws for an entity posed by `src`, as the text
 * system places it: its lines measured at its size and wrap in its font,
 * else `env.font`, its box placed by its anchor at the pose and turned
 * with it. Undefined for a value that isn't a block or an entity with no
 * pose.
 */
export function textBoxOf(
  block: unknown,
  src: TextPoseSource,
  env: TextMeasureEnv,
): DrawnText | undefined {
  const read = readTextBlock(block);
  const pose = src.shape ? shapeCentre(src.shape) : geometryPose({ at: src.at, path: src.path });
  if (!read || !pose) return undefined;
  const { key } = read;
  const source = key === undefined ? (read.text ?? "") : keyedText(env.strings, key);
  const lines = parseRichText(richSource(source, read.rich === true), read.vars).lines;
  const font = read.font === undefined ? (env.font ?? null) : textFontOf(env.asset, read.font);
  const m = measureText(lines, measureFont(font), read.size ?? TEXT_SIZE_DEFAULT, read.wrap);
  const box = textBoxShape(m, read.anchor, env.pxPerUnit);
  const deg = pose.rotDeg ?? src.transform?.rot ?? 0;
  const [cx, cy] = turnBy([box.cx, box.cy], deg * DEG);
  return {
    label: richPlainText(lines),
    ...(key !== undefined ? { key } : {}),
    shape: { ...box, cx: pose.at[0] + cx, cy: pose.at[1] + cy, rotDeg: deg },
    exact: m.exact,
  };
}

/** A drawn entity's `text` block, measured. */
export type SceneText = { entity: DrawnEntity; text: DrawnText };

/**
 * The text boxes `entities` (in world px) draw, in their order: each
 * `text` block measured as the text system places it, in `opts.strings`'
 * locale, its font's metrics from `opts.project`.
 */
export function drawnTexts(
  entities: readonly DrawnEntity[],
  opts: SceneTextOptions & Pick<SceneRegionOptions, "project">,
): SceneText[] {
  const project = opts.project;
  const env: TextMeasureEnv = {
    pxPerUnit: 1,
    ...(opts.strings ? { strings: opts.strings.strings, font: opts.strings.font } : {}),
    ...(project ? { asset: (id: string) => assetInfo(project, id) } : {}),
  };
  const out: SceneText[] = [];
  for (const d of entities) {
    const block = d.entity.behaviors?.[TEXT.name];
    if (block === undefined) continue;
    const text = textBoxOf(
      block,
      {
        ...(d.shape ? { shape: d.shape } : {}),
        ...(d.at ? { at: d.at } : {}),
        ...(d.path ? { path: d.path } : {}),
        ...(d.entity.transform ? { transform: d.entity.transform } : {}),
      },
      env,
    );
    if (text) out.push({ entity: d, text });
  }
  return out;
}

/** A text box's label: its first line, cut at 40 characters, "≈" before an estimated size. */
export function textLabel(text: DrawnText): string {
  const first = text.label.split("\n")[0] ?? "";
  const cut = first.length > 40 ? `${first.slice(0, 39)}…` : first;
  return `${text.exact ? "" : "≈ "}"${cut}"`;
}

const isSpawnLike = (d: DrawnEntity) => d.tags.includes("spawn") || d.type.type === "spawn";

/**
 * The scene as SVG text in world px (written to 1/100 px): each entity in
 * its type's and material's style, one-way landing faces, a grid with axis
 * ticks, id labels, tilemap cells (solid tiles filled, the rest outlined, by
 * `opts.tileTraits`, labelled by tile id while the map is small), sprite boxes labelled `asset[:frame]` (sized from
 * `opts.project` when given), text boxes labelled with their text ("≈"
 * before an estimated size), path waypoints and the given overlays. The
 * same scene and options give the same text.
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
    out.push(
      ...gridCellElements(cells, {
        registry,
        px,
        u,
        traits: opts.tileTraits,
        tileLabels: labels !== "none",
      }),
    );

  // Entities
  out.push(`<g id="entities">`);
  for (const d of visible) {
    if (!d.shape) continue;
    const style = styleOf({ registry }, d.type, materialOf(d)) ?? FALLBACK_STYLE;
    // A camera region is an area the camera frames, not a surface: the box it frames, dashed and unfilled.
    const region = isCameraRegionType(d.type);
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

  // Joints: a line between the two anchors, the kind's glyph at its middle
  const joints = drawnJoints(all, drawing.pxPerMetre);
  if (joints.length > 0) {
    out.push(`<g id="joints" fill="none" stroke="${JOINT_COLOR}" stroke-width="${px(1.5)}">`);
    for (const { entity, kind, to, from, end, mid } of joints)
      out.push(
        `<g data-joint="${esc(entity.id)}" data-kind="${esc(kind)}" data-to="${esc(to)}">` +
          `<path d="M${num(from[0])} ${num(from[1])}L${num(end[0])} ${num(end[1])}"/>` +
          `<circle cx="${num(mid[0])}" cy="${num(mid[1])}" r="${px(6)}" fill="${BACKGROUND}"/>` +
          `<text x="${num(mid[0])}" y="${num(mid[1] + 3.2 * u)}" font-size="${px(9)}" font-weight="600" text-anchor="middle" fill="${JOINT_COLOR}" stroke="none">${jointGlyph(kind).mark}</text></g>`,
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

  // World text: the box each block measures, labelled with "≈" where it's an estimate
  const texts = drawnTexts(visible, opts);
  if (texts.length > 0) {
    out.push(
      `<g id="texts" fill="none" stroke-width="${px(1)}" stroke-dasharray="${px(2)} ${px(2)}">`,
    );
    for (const { entity: d, text } of texts) {
      const style = styleOf({ registry }, d.type, materialOf(d));
      const color = cssHex(style?.stroke ?? style?.fill ?? POINT_COLOR);
      const key = text.key === undefined ? "" : ` data-key="${esc(text.key)}"`;
      out.push(
        `<path data-text="${esc(d.id)}"${key} data-exact="${text.exact}" d="${svgPathData(shapeOutline(text.shape))}" stroke="${color}"/>`,
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
    for (const { entity: d, text } of texts) {
      if (d.bulk && labels !== "all") continue;
      const b = aabb(text.shape);
      out.push(
        `<text class="text-label" data-text="${esc(d.id)}" x="${num((b.minX + b.maxX) / 2)}" y="${num(b.maxY + 10 * u)}" font-size="${px(9)}" fill-opacity="0.8">${esc(textLabel(text))}</text>`,
      );
    }
    out.push(`</g>`);
  }

  // Overlays, over the labels so a report reads first
  if (opts.overlay)
    out.push(...overlayElements(overlayInPx(opts.overlay, drawing.pxPerMetre), byId, px, u, vp));

  if (opts.debugDraw && opts.debugDraw.length > 0)
    out.push(...debugDrawElements(opts.debugDraw, drawing.pxPerMetre, px, u));

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
  env: {
    registry: Registry;
    px: (n: number) => string;
    u: number;
    traits: SceneTileTraits | undefined;
    tileLabels: boolean;
  },
): string[] {
  const { registry, px, u } = env;
  const out: string[] = [`<g id="grid-cells" fill-opacity="0.7" stroke-width="${px(1)}">`];
  const tiles = cells.map((c) => drawnTile(c, env.traits));
  const tileCount = tiles.reduce((n, t) => (t ? n + 1 : n), 0);
  const labelled: { c: DrawnGridCell; id: number }[] = [];
  let open: DrawnGridCell | null = null;
  cells.forEach((c, i) => {
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
    const tile = tiles[i];
    const color = CATEGORY_COLORS[(tile ? tile.id : c.value - 1) % CATEGORY_COLORS.length]!;
    const paint = !tile
      ? `fill="${color}"`
      : tile.solid
        ? `data-solid="true" fill="${color}"`
        : `data-solid="false" fill="none" stroke="${color}" stroke-opacity="0.9"`;
    const attrs =
      `data-cell="${c.col},${c.row}" data-v="${c.value}"` +
      (tile ? ` data-tile="${tile.id}"` : "") +
      ` ${paint}`;
    if (c.outline.length === 4) {
      const { minX, minY, maxX, maxY } = c.box;
      out.push(
        `<rect ${attrs} x="${num(minX)}" y="${num(minY)}" width="${num(maxX - minX)}" height="${num(maxY - minY)}"/>`,
      );
    } else {
      const d = c.outline.map(([x, y], j) => `${j ? "L" : "M"}${num(x)} ${num(y)}`).join("");
      out.push(`<path ${attrs} d="${d}Z"/>`);
    }
    if (tile) labelled.push({ c, id: tile.id });
  });
  if (open) out.push(`</g>`);
  if (env.tileLabels && tileCount > 0 && tileCount <= TILE_LABEL_MAX_CELLS) {
    const shown = labelled.filter(
      ({ c }) =>
        Math.min(c.box.maxX - c.box.minX, c.box.maxY - c.box.minY) / u >= TILE_LABEL_MIN_PX,
    );
    if (shown.length > 0) {
      out.push(
        `<g class="tile-ids" text-anchor="middle" fill="${INK}" fill-opacity="1" stroke="none">`,
      );
      for (const { c, id } of shown) {
        const side = Math.min(c.box.maxX - c.box.minX, c.box.maxY - c.box.minY) / u;
        const size = Math.min(11, side * 0.5);
        const cx = (c.box.minX + c.box.maxX) / 2;
        const cy = (c.box.minY + c.box.maxY) / 2;
        out.push(
          `<text data-tile-label="${c.col},${c.row}" x="${num(cx)}" y="${num(cy + size * 0.35 * u)}" font-size="${px(size)}">${id}</text>`,
        );
      }
      out.push(`</g>`);
    }
  }
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

/** A `ctx.debug` draw's color when its style names none, here and in the shell's layer. */
export const DEBUG_DRAW_COLOR = 0xff3df0;
/** A `ctx.debug` text's height when it names none, screen px. */
export const DEBUG_TEXT_SIZE = 11;

/** `ctx.debug` draws as SVG: shapes stroked in their style, text measured as world text is. */
function debugDrawElements(
  draws: readonly DebugDrawCommand[],
  k: number,
  px: (n: number) => string,
  u: number,
): string[] {
  const out: string[] = [`<g id="debug-draw" stroke-linejoin="round" stroke-linecap="round">`];
  const xy = (p: { x: number; y: number }) => `${num(p.x * k)} ${num(p.y * k)}`;
  for (const cmd of draws) {
    const color = cssHex(cmd.style.color ?? DEBUG_DRAW_COLOR);
    const alpha = num(cmd.style.alpha ?? 1);
    const layer = cmd.style.layer === undefined ? "" : ` data-layer="${esc(cmd.style.layer)}"`;
    const attrs = `data-debug="${cmd.kind}"${layer}`;
    if (cmd.kind === "text") {
      const size = cmd.size ?? DEBUG_TEXT_SIZE;
      const lines = parseRichText(richSource(cmd.text, false)).lines;
      const m = measureText(lines, null, size);
      const x = cmd.at.x * k;
      const y = cmd.at.y * k;
      out.push(
        `<g ${attrs}><rect x="${num(x - 2 * u)}" y="${num(y - 2 * u)}" width="${num((m.width + 4) * u)}" height="${num((m.height + 4) * u)}" fill="#000000" fill-opacity="0.6"/>` +
          `<text x="${num(x)}" y="${num(y + size * 0.8 * u)}" font-size="${px(size)}" fill="${color}" fill-opacity="${alpha}">${esc(richPlainText(lines))}</text></g>`,
      );
      continue;
    }
    let d: string;
    let closed = true;
    switch (cmd.kind) {
      case "line":
        d = `M${xy(cmd.a)}L${xy(cmd.b)}`;
        closed = false;
        break;
      case "box": {
        const [w, h] = cmd.size;
        d = svgPathData(
          shapeOutline({
            type: "box",
            cx: cmd.at.x * k,
            cy: cmd.at.y * k,
            hw: (w / 2) * k,
            hh: (h / 2) * k,
            rotDeg: 0,
          }),
        );
        break;
      }
      case "circle":
        d = svgPathData(
          shapeOutline({ type: "circle", cx: cmd.at.x * k, cy: cmd.at.y * k, r: cmd.r * k }),
        );
        break;
      case "shape":
        d = svgPathData(shapeOutline(shapeInPx(cmd.shape, k)));
        closed = shapeIsClosed(cmd.shape);
        break;
      case "path":
        if (cmd.pts.length < 2) continue;
        d = cmd.pts.map((p, i) => `${i ? "L" : "M"}${xy(p)}`).join("") + (cmd.closed ? "Z" : "");
        closed = cmd.closed;
        break;
    }
    const fill = closed
      ? `fill="${color}" fill-opacity="${num((cmd.style.alpha ?? 1) * 0.12)}"`
      : `fill="none"`;
    out.push(
      `<path ${attrs} d="${d}" ${fill} stroke="${color}" stroke-opacity="${alpha}" stroke-width="${px(cmd.style.width ?? 1)}"/>`,
    );
  }
  out.push(`</g>`);
  return out;
}

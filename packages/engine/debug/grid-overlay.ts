import { Container, Graphics, Text, TextStyle } from "pixi.js";

import type { Viewport } from "../camera";
import type { GridGeometry } from "../grid/geometry";
import { roundLength } from "../scene/units";
import type { DebugLayerFactory } from "./index";

// ─── Config ──────────────────────────────────────────────

/** Without a scene grid: a minor line every metre, a major one every ten. */
const FALLBACK_STEP = 1;
/** Minor lines (or cells) per major line. */
const MAJOR_EVERY = 10;
/** Lines closer than this many screen px aren't drawn: at that density they'd only shade the view. */
const MIN_SPACING_PX = 4;
/** The debug overlay's default `maxCells`. */
const MAX_CELLS = 20_000;
const MAX_LABELS = 400;

const MINOR_COLOR = 0x444466;
const MINOR_ALPHA = 0.15;
const MAJOR_COLOR = 0x6666aa;
const MAJOR_ALPHA = 0.3;
const ORIGIN_X_COLOR = 0xff4444;
const ORIGIN_Y_COLOR = 0x44ff44;
const ORIGIN_ALPHA = 0.6;

/** Line widths and label offsets, screen px. */
const MINOR_WIDTH = 1;
const MAJOR_WIDTH = 2;
const ORIGIN_WIDTH = 2;
const LABEL_OFFSET = { x: 4, y: 2 } as const;

let labelStyle: TextStyle | null = null;
/** Made on first draw, so importing the plan alone builds nothing of Pixi's. */
const labelStyleOf = () =>
  (labelStyle ??= new TextStyle({ fontFamily: "monospace", fontSize: 10, fill: 0x8888bb }));

// ─── Plan ────────────────────────────────────────────────

/** A line from (x1, y1) to (x2, y2), world metres. */
export type GridSegment = readonly [x1: number, y1: number, x2: number, y2: number];

/** What the overlay draws for one view, world metres. */
export type GridOverlayPlan = {
  /** Identifies the plan: an unchanged key draws the same. */
  key: string;
  minor: GridSegment[];
  major: GridSegment[];
  /** Hex cell outlines, each clockwise. */
  cells: (readonly [number, number])[][];
  /** The x axis (y = 0) and the y axis (x = 0), when in the drawn region. */
  axisX: GridSegment | null;
  axisY: GridSegment | null;
  /** At the major intersections: the point's metres. */
  labels: { text: string; x: number; y: number }[];
};

export type GridOverlayPlanOptions = {
  /** Major steps the drawn region reaches past each edge of the view (default 1). */
  margin?: number;
  /** The most hex cells outlined at once; past it the plan draws only the axes. */
  maxCells?: number;
};

/** Indices i with origin + i × step inside [lo, hi]. */
function steps(lo: number, hi: number, origin: number, step: number): number[] {
  const out: number[] = [];
  for (let i = Math.ceil((lo - origin) / step); origin + i * step <= hi; i++) out.push(i);
  return out;
}

/**
 * The lines, cells and labels for `viewport` at `scale` canvas px per metre:
 * the scene grid's cells when it has one (a square grid as lines, a major
 * one every ten cells from its origin; a hex grid as cell outlines), else a
 * line every metre and a major one every ten. The drawn region is aligned
 * to the major lines and reaches `margin` major steps past each edge, so
 * small pans reuse the drawing.
 */
export function gridOverlayPlan(
  viewport: Viewport,
  scale: number,
  grid: GridGeometry | null = null,
  { margin = 1, maxCells = MAX_CELLS }: GridOverlayPlanOptions = {},
): GridOverlayPlan {
  const settings = grid?.settings ?? null;
  const [ox, oy] = settings?.kind === "square" ? (settings.origin ?? [0, 0]) : [0, 0];
  const [sx, sy] = settings ? settings.cell : [FALLBACK_STEP, FALLBACK_STEP];
  const mx = sx * MAJOR_EVERY;
  const my = sy * MAJOR_EVERY;
  const left = ox + (Math.floor((viewport.x - ox) / mx) - margin) * mx;
  const top = oy + (Math.floor((viewport.y - oy) / my) - margin) * my;
  const right = ox + (Math.ceil((viewport.x + viewport.width - ox) / mx) + margin) * mx;
  const bottom = oy + (Math.ceil((viewport.y + viewport.height - oy) / my) + margin) * my;

  const plan: GridOverlayPlan = {
    key: [left, top, right, bottom, scale, settings ? JSON.stringify(settings) : ""].join("|"),
    minor: [],
    major: [],
    cells: [],
    axisX: top <= 0 && bottom >= 0 ? [left, 0, right, 0] : null,
    axisY: left <= 0 && right >= 0 ? [0, top, 0, bottom] : null,
    labels: [],
  };

  if (settings?.kind === "hex" && grid) {
    if (Math.min(sx, sy) * scale < MIN_SPACING_PX) return plan;
    const { c0, r0, c1, r1 } = grid.rect([left, top, right, bottom]);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > maxCells) return plan;
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) plan.cells.push(grid.corners([c, r]).map(([x, y]) => [x, y]));
    return plan;
  }

  const minorShows = Math.min(sx, sy) * scale >= MIN_SPACING_PX;
  const majorShows = Math.min(mx, my) * scale >= MIN_SPACING_PX;
  if (!majorShows) return plan;
  const columns = steps(left, right, ox, sx);
  const rows = steps(top, bottom, oy, sy);
  for (const i of columns) {
    const x = ox + i * sx;
    if (x === 0 && plan.axisY) continue;
    const isMajor = i % MAJOR_EVERY === 0;
    if (isMajor) plan.major.push([x, top, x, bottom]);
    else if (minorShows) plan.minor.push([x, top, x, bottom]);
  }
  for (const j of rows) {
    const y = oy + j * sy;
    if (y === 0 && plan.axisX) continue;
    const isMajor = j % MAJOR_EVERY === 0;
    if (isMajor) plan.major.push([left, y, right, y]);
    else if (minorShows) plan.minor.push([left, y, right, y]);
  }

  const majorColumns = columns.filter((i) => i % MAJOR_EVERY === 0);
  const majorRows = rows.filter((j) => j % MAJOR_EVERY === 0);
  if (majorColumns.length * majorRows.length > MAX_LABELS) return plan;
  for (const i of majorColumns) {
    for (const j of majorRows) {
      const x = ox + i * sx;
      const y = oy + j * sy;
      plan.labels.push({ text: `${roundLength(x)},${roundLength(y)}`, x, y });
    }
  }
  return plan;
}

// ─── Types ───────────────────────────────────────────────

export type GridOverlay = {
  /** `scale` is canvas px per metre, zoom included; `grid` the loaded scene's, if it has one. */
  update: (viewport: Viewport, scale: number, grid?: GridGeometry | null) => void;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
  container: Container;
};

// ─── Factory ─────────────────────────────────────────────

/** Drawn in world metres; line widths and labels are screen px at any zoom. */
export function createGridOverlay(): GridOverlay {
  const container = new Container();
  container.label = "debug-grid";

  const graphics = new Graphics();
  container.addChild(graphics);

  const labelContainer = new Container();
  labelContainer.label = "debug-grid-labels";
  container.addChild(labelContainer);

  // Pool of reusable text objects to avoid GC churn
  const labelPool: Text[] = [];
  let lastKey = "";

  function getLabel(index: number): Text {
    const pooled = labelPool[index];
    if (pooled) {
      pooled.visible = true;
      return pooled;
    }
    const text = new Text({ text: "", style: labelStyleOf() });
    text.alpha = 0.5;
    labelPool.push(text);
    labelContainer.addChild(text);
    return text;
  }

  function strokeSegments(segments: readonly GridSegment[]): void {
    for (const [x1, y1, x2, y2] of segments) {
      graphics.moveTo(x1, y1);
      graphics.lineTo(x2, y2);
    }
  }

  function update(viewport: Viewport, scale: number, grid: GridGeometry | null = null): void {
    if (!(scale > 0) || !Number.isFinite(scale)) return;
    const plan = gridOverlayPlan(viewport, scale, grid);
    if (plan.key === lastKey) return;
    lastKey = plan.key;
    const px = 1 / scale;

    graphics.clear();
    if (plan.minor.length > 0 || plan.cells.length > 0) {
      graphics.setStrokeStyle({ width: MINOR_WIDTH * px, color: MINOR_COLOR, alpha: MINOR_ALPHA });
      strokeSegments(plan.minor);
      for (const corners of plan.cells) graphics.poly(corners.flat(), true);
      graphics.stroke();
    }
    if (plan.major.length > 0) {
      graphics.setStrokeStyle({ width: MAJOR_WIDTH * px, color: MAJOR_COLOR, alpha: MAJOR_ALPHA });
      strokeSegments(plan.major);
      graphics.stroke();
    }
    for (const [axis, color] of [
      [plan.axisX, ORIGIN_X_COLOR],
      [plan.axisY, ORIGIN_Y_COLOR],
    ] as const) {
      if (!axis) continue;
      graphics.setStrokeStyle({ width: ORIGIN_WIDTH * px, color, alpha: ORIGIN_ALPHA });
      strokeSegments([axis]);
      graphics.stroke();
    }

    plan.labels.forEach(({ text, x, y }, i) => {
      const label = getLabel(i);
      label.text = text;
      label.scale.set(px);
      label.position.set(x + LABEL_OFFSET.x * px, y + LABEL_OFFSET.y * px);
    });
    for (const label of labelPool.slice(plan.labels.length)) label.visible = false;
  }

  function setVisible(visible: boolean): void {
    container.visible = visible;
  }

  function destroy(): void {
    for (const label of labelPool) {
      label.destroy();
    }
    labelPool.length = 0;
    graphics.destroy();
    labelContainer.destroy();
    container.destroy();
  }

  return { update, setVisible, destroy, container };
}

/** The scene grid's cells (else metre lines) with coordinate labels, drawn behind the scene. */
export const gridLayer: DebugLayerFactory = {
  id: "grid",
  create(host) {
    const grid = createGridOverlay();
    host.worldContainer.addChildAt(grid.container, 0);
    return {
      update: (frame) => grid.update(frame.viewport, frame.scale, frame.scene?.grid?.geometry),
      setVisible: grid.setVisible,
      destroy: grid.destroy,
    };
  },
};

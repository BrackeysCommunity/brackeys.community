// The only file that touches the DOM: it rasterises a frame's shared draw
// lists once per payload and scale, and paints a frame onto a canvas.

import type { Camera, View } from "./camera.ts";
import type { DrawOp, Frame } from "./frame.ts";
import { hexCorners } from "./hex.ts";

// structural: bitmap scales step by a quarter octave, and past the largest a
// chunk is drawn as vectors, so a close zoom never holds huge bitmaps.
const SCALE_STEPS_PER_OCTAVE = 4;
const MAX_BITMAP_SCALE = 24;
const MAX_BITMAP_PX = 4096;
// structural: label size and pattern spacing, in device px.
const LABEL_PX = 12;
const PATTERN_GAP_PX = 5;
const DOT_PX = 1.2;
const MIN_LINE_PX = 1;

type Raster = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Placed {
  image: Raster;
  left: number;
  top: number;
  width: number;
  height: number;
}

function newRaster(w: number, h: number): Raster {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function quantise(scale: number): number {
  const step = Math.ceil(Math.log2(Math.max(scale, 1 / 64)) * SCALE_STEPS_PER_OCTAVE);
  return 2 ** (step / SCALE_STEPS_PER_OCTAVE);
}

function bounds(ops: DrawOp[]): { l: number; t: number; r: number; b: number } {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  const take = (x: number, y: number, pad: number) => {
    l = Math.min(l, x - pad);
    r = Math.max(r, x + pad);
    t = Math.min(t, y - pad);
    b = Math.max(b, y + pad);
  };
  for (const op of ops) {
    switch (op.kind) {
      case "hex":
        take(op.x, op.y, op.size);
        break;
      case "glyph":
        take(op.x, op.y, op.size);
        break;
      case "edge":
        take(op.x1, op.y1, op.width);
        take(op.x2, op.y2, op.width);
        break;
      case "path":
        for (const p of op.points) take(p.x, p.y, op.width);
        break;
      case "label":
        break;
    }
  }
  return { l, t, r, b };
}

/** Bitmaps of shared draw lists, by key and scale, the least recently used dropped past max. */
export class ChunkCache {
  private readonly max: number;
  private readonly entries = new Map<string, Placed>();

  constructor(max: number) {
    this.max = Math.max(1, max);
  }

  /** The list drawn at size device px a world px; labels are left to paint. */
  bitmap(key: string, ops: DrawOp[], size: number): CanvasImageSource {
    return this.placed(key, ops, size).image;
  }

  placed(key: string, ops: DrawOp[], size: number): Placed {
    const id = `${key}@${size}`;
    const hit = this.entries.get(id);
    if (hit) {
      this.entries.delete(id);
      this.entries.set(id, hit);
      return hit;
    }
    const box = bounds(ops);
    const width = Number.isFinite(box.r) ? box.r - box.l : 0;
    const height = Number.isFinite(box.b) ? box.b - box.t : 0;
    const scale = Math.min(size, MAX_BITMAP_PX / Math.max(width, height, 1e-9));
    const image = newRaster(
      Math.max(1, Math.ceil(width * scale)),
      Math.max(1, Math.ceil(height * scale)),
    );
    const ctx = image.getContext("2d") as Ctx2D | null;
    if (ctx && width > 0 && height > 0) {
      ctx.setTransform(scale, 0, 0, scale, -box.l * scale, -box.t * scale);
      drawOps(ctx, ops, scale, 0, "sans-serif", false);
    }
    const placed = { image, left: box.l, top: box.t, width, height };
    this.entries.set(id, placed);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return placed;
  }

  clear(): void {
    this.entries.clear();
  }
}

function hexPath(ctx: Ctx2D, x: number, y: number, size: number): void {
  const pts = hexCorners({ x, y }, size);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function patternFill(ctx: Ctx2D, op: Extract<DrawOp, { kind: "hex" }>, scale: number): void {
  const gap = PATTERN_GAP_PX / scale;
  const s = op.size;
  ctx.save();
  hexPath(ctx, op.x, op.y, s);
  if (op.pattern === "rim") {
    ctx.clip();
    ctx.strokeStyle = op.fill;
    ctx.lineWidth = Math.max(s * 0.16, (2 * MIN_LINE_PX) / scale);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.clip();
  ctx.fillStyle = op.fill;
  ctx.strokeStyle = op.fill;
  if (op.pattern === "dots") {
    const r = DOT_PX / scale;
    for (let y = op.y - s; y <= op.y + s; y += gap) {
      for (let x = op.x - s; x <= op.x + s; x += gap) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    const wide = op.pattern === "stripes";
    ctx.lineWidth = wide ? gap / 2 : Math.max(MIN_LINE_PX / scale, gap / 6);
    const step = wide ? gap * 1.5 : gap;
    ctx.beginPath();
    for (let o = -2 * s; o <= 2 * s; o += step) {
      ctx.moveTo(op.x + o - s, op.y + s);
      ctx.lineTo(op.x + o + s, op.y - s);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function glyphPath(ctx: Ctx2D, glyph: string, x: number, y: number, r: number): boolean {
  ctx.beginPath();
  switch (glyph) {
    case "diamond":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      return true;
    case "square":
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      return true;
    case "triangle":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r * 0.8);
      ctx.lineTo(x - r, y + r * 0.8);
      ctx.closePath();
      return true;
    case "circle":
    case "pip":
    case "ring":
      ctx.arc(x, y, r, 0, Math.PI * 2);
      return true;
    case "cross":
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      return false;
    default:
      return false;
  }
}

function drawGlyph(ctx: Ctx2D, op: Extract<DrawOp, { kind: "glyph" }>, scale: number): void {
  const filled = glyphPath(ctx, op.glyph, op.x, op.y, op.size);
  const line = Math.max(op.size * 0.35, MIN_LINE_PX / scale);
  if (op.pattern) {
    ctx.save();
    ctx.setLineDash([line, line]);
    ctx.strokeStyle = op.colour;
    ctx.lineWidth = line;
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (filled && op.glyph !== "ring") {
    ctx.fillStyle = op.colour;
    ctx.fill();
    return;
  }
  ctx.strokeStyle = op.colour;
  ctx.lineWidth = line;
  ctx.stroke();
}

/**
 * Draws ops in world px; scale is device px a world px. Labels are drawn
 * only when withLabels is set, at a fixed device size, from minSize up.
 */
function drawOps(
  ctx: Ctx2D,
  ops: DrawOp[],
  scale: number,
  size: number,
  font: string,
  withLabels: boolean,
): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const op of ops) {
    switch (op.kind) {
      case "hex":
        if (op.pattern) {
          patternFill(ctx, op, scale);
          break;
        }
        hexPath(ctx, op.x, op.y, op.size);
        ctx.fillStyle = op.fill;
        ctx.fill();
        // A hairline in the same colour closes the antialiased seam between
        // opaque hexes; a tint would darken its own edge.
        if (op.fill.endsWith(", 1)")) {
          ctx.strokeStyle = op.fill;
          ctx.lineWidth = MIN_LINE_PX / scale;
          ctx.stroke();
        }
        break;
      case "edge":
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.strokeStyle = op.colour;
        ctx.lineWidth = Math.max(op.width, MIN_LINE_PX / scale);
        ctx.stroke();
        break;
      case "glyph":
        drawGlyph(ctx, op, scale);
        break;
      case "path": {
        if (op.points.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(op.points[0].x, op.points[0].y);
        for (let i = 1; i < op.points.length; i++) ctx.lineTo(op.points[i].x, op.points[i].y);
        ctx.strokeStyle = op.colour;
        ctx.lineWidth = Math.max(op.width, MIN_LINE_PX / scale);
        ctx.stroke();
        break;
      }
      case "label":
        if (!withLabels || (op.minSize !== undefined && size < op.minSize)) break;
        ctx.font = `${LABEL_PX / scale}px ${font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = op.colour;
        ctx.fillText(op.text, op.x, op.y);
        break;
    }
  }
}

const labelsMemo = new WeakMap<DrawOp[], DrawOp[]>();

function labelsOf(ops: DrawOp[]): DrawOp[] {
  let out = labelsMemo.get(ops);
  if (!out) {
    out = ops.filter((op) => op.kind === "label");
    labelsMemo.set(ops, out);
  }
  return out;
}

function deviceScale(ctx: CanvasRenderingContext2D): number {
  const t = typeof ctx.getTransform === "function" ? ctx.getTransform() : undefined;
  return t ? Math.hypot(t.a, t.b) || 1 : 1;
}

function fontOf(ctx: CanvasRenderingContext2D): string {
  const el = ctx.canvas as HTMLCanvasElement | undefined;
  if (el && typeof getComputedStyle === "function" && el.isConnected) {
    const f = getComputedStyle(el).fontFamily;
    if (f) return f;
  }
  return "sans-serif";
}

/**
 * Paints a frame over the view, in CSS px under whatever transform ctx
 * already carries (the device pixel ratio). Unknown tiles stay blank: the
 * canvas's own background shows through.
 */
export function paint(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  c: Camera,
  view: View,
  cache: ChunkCache,
): void {
  const device = deviceScale(ctx);
  const scale = c.size * device;
  const q = quantise(scale);
  const font = fontOf(ctx);
  ctx.save();
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.translate(view.width / 2, view.height / 2);
  ctx.scale(c.size, c.size);
  ctx.translate(-c.x, -c.y);
  for (const b of f.base) {
    if (q > MAX_BITMAP_SCALE) {
      drawOps(ctx, b.ops, scale, c.size, font, false);
      continue;
    }
    const p = cache.placed(b.key, b.ops, q);
    if (p.width > 0 && p.height > 0) ctx.drawImage(p.image, p.left, p.top, p.width, p.height);
  }
  for (const b of f.base) {
    drawOps(ctx, labelsOf(b.ops), scale, c.size, font, true);
  }
  drawOps(ctx, f.live, scale, c.size, font, true);
  ctx.restore();
}

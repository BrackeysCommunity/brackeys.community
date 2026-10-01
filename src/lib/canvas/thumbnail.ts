/**
 * A canvas's thumbnail: its cards as rectangles in their colors, small enough
 * to ride along with a listing. Drawn as SVG by the client; no screenshots.
 */

export interface CanvasThumbnail {
  /** The bounding box every rect sits in. */
  box: { x: number; y: number; w: number; h: number };
  /** `[x, y, w, h, color, group]`, bottom to top. */
  rects: [number, number, number, number, string | null, 0 | 1][];
}

const MAX_RECTS = 300;

interface ThumbnailNode {
  type?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  color?: unknown;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function canvasThumbnail(snapshot: { nodes?: unknown }): CanvasThumbnail | null {
  const nodes = (Array.isArray(snapshot.nodes) ? snapshot.nodes : []).slice(
    0,
    MAX_RECTS,
  ) as ThumbnailNode[];
  if (nodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rects: CanvasThumbnail["rects"] = nodes.map((node) => {
    const [x, y, w, h] = [
      n(node.x),
      n(node.y),
      Math.max(1, n(node.width)),
      Math.max(1, n(node.height)),
    ];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
    return [
      x,
      y,
      w,
      h,
      typeof node.color === "string" ? node.color : null,
      node.type === "group" ? 1 : 0,
    ];
  });
  return { box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, rects };
}

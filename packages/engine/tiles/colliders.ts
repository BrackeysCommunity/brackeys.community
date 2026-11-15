/** Per-chunk collider merging over solid cells: integer-only, in row-major order. Pure. */
import { cellKey, type CellBounds, type CellKey } from "../grid/geometry";
import { GRID_CHUNK } from "../scene/grid";
import type { Pt } from "../scene/types";

/** How a tilemap's solid tiles collide: merged boxes (the default), outline chains, one collider per tile, or none. */
export type TileCollision = "tiles" | "boxes" | "outline" | "none";

export const DEFAULT_TILE_COLLISION: TileCollision = "boxes";

type Solid = (col: number, row: number) => boolean;

const chunkOf = (n: number) => Math.floor(n / GRID_CHUNK);

/** `rect` cut at chunk borders, in row-major chunk order. */
export function chunkRects(rect: CellBounds): CellBounds[] {
  const out: CellBounds[] = [];
  if (rect.c1 < rect.c0 || rect.r1 < rect.r0) return out;
  for (let cy = chunkOf(rect.r0); cy <= chunkOf(rect.r1); cy++)
    for (let cx = chunkOf(rect.c0); cx <= chunkOf(rect.c1); cx++)
      out.push({
        c0: Math.max(rect.c0, cx * GRID_CHUNK),
        r0: Math.max(rect.r0, cy * GRID_CHUNK),
        c1: Math.min(rect.c1, cx * GRID_CHUNK + GRID_CHUNK - 1),
        r1: Math.min(rect.r1, cy * GRID_CHUNK + GRID_CHUNK - 1),
      });
  return out;
}

function chunkBoxes(solid: Solid, b: CellBounds, out: CellBounds[]): void {
  // Boxes still open from the rows above, keyed by their column span.
  let open = new Map<number, CellBounds>();
  const span = (c0: number, c1: number) => c0 * (GRID_CHUNK * GRID_CHUNK) + c1;
  for (let r = b.r0; r <= b.r1; r++) {
    const next = new Map<number, CellBounds>();
    let c = b.c0;
    while (c <= b.c1) {
      if (!solid(c, r)) {
        c++;
        continue;
      }
      const c0 = c;
      while (c + 1 <= b.c1 && solid(c + 1, r)) c++;
      const key = span(c0, c);
      const above = open.get(key);
      if (above) {
        above.r1 = r;
        open.delete(key);
        next.set(key, above);
      } else {
        const box = { c0, r0: r, c1: c, r1: r };
        out.push(box);
        next.set(key, box);
      }
      c++;
    }
    open = next;
  }
}

/** Maximal runs per row, merged downwards with an identical run below; never spanning chunks. */
export function greedyBoxes(solid: Solid, rect: CellBounds): CellBounds[] {
  const out: CellBounds[] = [];
  for (const b of chunkRects(rect)) chunkBoxes(solid, b, out);
  return out;
}

type Edge = { x: number; y: number; dx: number; dy: number; used: boolean };

function chunkChains(solid: Solid, b: CellBounds, out: Pt[][]): void {
  const inside = (c: number, r: number) =>
    c >= b.c0 && c <= b.c1 && r >= b.r0 && r <= b.r1 && solid(c, r);
  const edges: Edge[] = [];
  const from = new Map<CellKey, Edge[]>();
  const add = (x: number, y: number, dx: number, dy: number) => {
    const e = { x, y, dx, dy, used: false };
    edges.push(e);
    const k = cellKey([x, y]);
    const list = from.get(k);
    if (list) list.push(e);
    else from.set(k, [e]);
  };
  // Clockwise on screen (y down), so a solid region's boundary keeps it on the right.
  for (let r = b.r0; r <= b.r1; r++)
    for (let c = b.c0; c <= b.c1; c++) {
      if (!inside(c, r)) continue;
      if (!inside(c, r - 1)) add(c, r, 1, 0);
      if (!inside(c + 1, r)) add(c + 1, r, 0, 1);
      if (!inside(c, r + 1)) add(c + 1, r + 1, -1, 0);
      if (!inside(c - 1, r)) add(c, r + 1, 0, -1);
    }
  for (const start of edges) {
    if (start.used) continue;
    const pts: Pt[] = [];
    let e: Edge = start;
    for (;;) {
      e.used = true;
      const prev = pts[pts.length - 1];
      const turns = !prev || pts.length < 2 || !collinear(pts[pts.length - 2]!, prev, [e.x, e.y]);
      if (turns) pts.push([e.x, e.y]);
      else {
        prev[0] = e.x;
        prev[1] = e.y;
      }
      const nx = e.x + e.dx;
      const ny = e.y + e.dy;
      const choices = (from.get(cellKey([nx, ny])) ?? []).filter((n) => !n.used);
      if (choices.length === 0) break;
      // Where two regions touch at a corner, turn right so each stays its own chain.
      const right = choices.find((n) => n.dx === -e.dy && n.dy === e.dx);
      e = right ?? choices[0]!;
    }
    while (pts.length > 2 && collinear(pts[pts.length - 2]!, pts[pts.length - 1]!, pts[0]!))
      pts.pop();
    while (pts.length > 2 && collinear(pts[pts.length - 1]!, pts[0]!, pts[1]!)) pts.shift();
    out.push(pts);
  }
}

const collinear = (a: Pt, b: Pt, c: Pt): boolean =>
  (b[0] - a[0]) * (c[1] - b[1]) === (b[1] - a[1]) * (c[0] - b[0]);

/**
 * Closed chains, in cell corners, around the solid regions in `rect`, one set per chunk.
 * Each chain is implicitly closed (its last point joins its first); outer boundaries run
 * clockwise on screen and holes counter-clockwise.
 */
export function outlineChains(solid: Solid, rect: CellBounds): readonly Pt[][] {
  const out: Pt[][] = [];
  for (const b of chunkRects(rect)) chunkChains(solid, b, out);
  return out;
}

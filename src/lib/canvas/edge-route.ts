/**
 * How a connection is drawn: the curve Obsidian draws, or, when that curve
 * would run through a card, a right-angled route around the cards in its
 * way. Render-only: nothing here is written to the doc, the snapshot or the
 * vault file, and the sides the file gives are kept. Deterministic, so the
 * editor and the snapshot view draw the same line, and free of React Flow
 * and Yjs so the reader's bundle stays small.
 */
import type { CanvasSide } from "./json-canvas";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A card as the router sees it; groups are never in the way. */
export interface RouteCard extends Box {
  id: string;
  type: string;
}

/** A connection's end card; `id` matches it to its indexed copy. */
type EndBox = Box & { id?: string };

export type Point = [number, number];

export interface EdgeEnd {
  x: number;
  y: number;
  side: CanvasSide;
}

export interface EdgeDrawing {
  d: string;
  label: Point;
  start: EdgeEnd;
  end: EdgeEnd;
  /**
   * Where the file's sides (or `nearestSides`) put the ends. A route may
   * leave and arrive by other sides; these stay what the drawing answers to.
   */
  anchors: [EdgeEnd, EdgeEnd];
  /** Everything the line covers, for telling which cards could get in its way. */
  bounds: Box;
  /** A route's corners and the clearance it kept, for `separateOverlaps`. */
  route?: { points: Point[]; clearance: number };
  /** True when the line goes around cards rather than following the curve. */
  routed: boolean;
}

const SIDE_ORDER: readonly CanvasSide[] = ["top", "right", "bottom", "left"];
const SIDES: readonly unknown[] = SIDE_ORDER;

function isSide(value: unknown): value is CanvasSide {
  return SIDES.includes(value);
}

/** How far a route keeps from the cards it passes. */
const CLEARANCE = 24;
/** Closer clearances tried when cards sit nearer than that to an end, each costing `TIGHT_COST` more. */
const TIGHT_CLEARANCES = [12, 6];
const TIGHT_COST = 200;
/** Another pair of sides replaces the file's only when its route costs this much less. */
const SWITCH_RATIO = 0.75;
/** Other sides are tried only when the route costs this many times a direct one, or is blocked or cramped. */
const ROUNDABOUT = 1.5;
/** A curve that only grazes a card's border isn't crossing it. */
const GRAZE = 2;
/** A bend costs this much extra length, so routes prefer fewer of them. */
const BEND_COST = 48;
const CORNER_RADIUS = 12;
const CURVE_SAMPLES = 32;
/** Past this many cards near one connection, routing costs too much; it keeps the curve. */
const MAX_OBSTACLES = 48;
/** The spatial index's cell size, in canvas units. */
const CELL = 512;
/** Cards spanning more cells than this per axis sit in one list checked every time. */
const MAX_CELLS_PER_AXIS = 16;

const NORMAL: Record<CanvasSide, Point> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};

/**
 * The sides an edge leaves and enters by when the file doesn't say: the
 * pair facing each other along the longer axis between the card centres.
 */
export function nearestSides(from: Box, to: Box): [CanvasSide, CanvasSide] {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  return Math.abs(dx) > Math.abs(dy)
    ? dx > 0
      ? ["right", "left"]
      : ["left", "right"]
    : dy > 0
      ? ["bottom", "top"]
      : ["top", "bottom"];
}

export function sideAnchor(box: Box, side: CanvasSide): EdgeEnd {
  switch (side) {
    case "top":
      return { x: box.x + box.w / 2, y: box.y, side };
    case "right":
      return { x: box.x + box.w, y: box.y + box.h / 2, side };
    case "bottom":
      return { x: box.x + box.w / 2, y: box.y + box.h, side };
    case "left":
      return { x: box.x, y: box.y + box.h / 2, side };
  }
}

// ── The curve ───────────────────────────────────────────────────────────────

/** React Flow's bezier, so a curve looks the same whichever view draws it. */
function controlOffset(distance: number): number {
  return distance >= 0 ? 0.5 * distance : 0.25 * 25 * Math.sqrt(-distance);
}

function control(end: EdgeEnd, other: EdgeEnd): Point {
  switch (end.side) {
    case "left":
      return [end.x - controlOffset(end.x - other.x), end.y];
    case "right":
      return [end.x + controlOffset(other.x - end.x), end.y];
    case "top":
      return [end.x, end.y - controlOffset(end.y - other.y)];
    case "bottom":
      return [end.x, end.y + controlOffset(other.y - end.y)];
  }
}

function cubicAt(p0: Point, c1: Point, c2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0],
    a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1],
  ];
}

const fmt = (n: number) => Math.round(n * 100) / 100;

export function curvedEdge(start: EdgeEnd, end: EdgeEnd): EdgeDrawing {
  const [c1x, c1y] = control(start, end);
  const [c2x, c2y] = control(end, start);
  const label = cubicAt([start.x, start.y], [c1x, c1y], [c2x, c2y], [end.x, end.y], 0.5);
  return {
    bounds: boundsOf([
      [start.x, start.y],
      [c1x, c1y],
      [c2x, c2y],
      [end.x, end.y],
    ]),
    d: `M${fmt(start.x)},${fmt(start.y)} C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(end.x)},${fmt(end.y)}`,
    label,
    start,
    end,
    anchors: [start, end],
    routed: false,
  };
}

// ── Geometry ────────────────────────────────────────────────────────────────

function inflate(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, w: box.w + 2 * by, h: box.h + 2 * by };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function strictlyInside([px, py]: Point, box: Box): boolean {
  return px > box.x && px < box.x + box.w && py > box.y && py < box.y + box.h;
}

/** Whether segment a→b passes through the box (Liang–Barsky clipping). */
function segmentHits(a: Point, b: Point, box: Box): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - box.x],
    [dx, box.x + box.w - a[0]],
    [-dy, a[1] - box.y],
    [dy, box.y + box.h - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

function boundsOf(points: Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

// ── The route ───────────────────────────────────────────────────────────────

/** Directions, clockwise from right; a route may turn but never reverse. */
const STEP: Point[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

function directionOf([dx, dy]: Point): number {
  return STEP.findIndex(([sx, sy]) => sx === dx && sy === dy);
}

/** A min-heap of states keyed by cost, ties broken by insertion order. */
class Heap {
  private items: [number, number, number][] = [];
  private seq = 0;

  get size() {
    return this.items.length;
  }

  push(key: number, value: number) {
    const items = this.items;
    items.push([key, this.seq++, value]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  pop(): number {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(l, m)) m = l;
        if (r < items.length && this.less(r, m)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m]!, items[i]!];
        i = m;
      }
    }
    return top[2];
  }

  private less(a: number, b: number) {
    const x = this.items[a]!;
    const y = this.items[b]!;
    return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  }
}

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * The shortest right-angled path with few bends from one card's side to
 * another's, keeping `clearance` from every obstacle. Searched on the grid
 * the obstacles' inflated borders make, so it hugs cards rather than
 * wandering. Null when there's no way through.
 */
function orthogonalRoute(
  start: EdgeEnd,
  end: EdgeEnd,
  obstacles: Box[],
  clearance: number,
): { points: Point[]; cost: number } | null {
  const startNormal = NORMAL[start.side];
  const endNormal = NORMAL[end.side];
  const s: Point = [start.x + startNormal[0] * clearance, start.y + startNormal[1] * clearance];
  const e: Point = [end.x + endNormal[0] * clearance, end.y + endNormal[1] * clearance];
  const walls = obstacles.map((o) => inflate(o, clearance));
  if (walls.some((w) => strictlyInside(s, w) || strictlyInside(e, w))) return null;

  const xs = sortedUnique([
    s[0],
    e[0],
    (s[0] + e[0]) / 2,
    ...walls.flatMap((w) => [w.x, w.x + w.w]),
  ]);
  const ys = sortedUnique([
    s[1],
    e[1],
    (s[1] + e[1]) / 2,
    ...walls.flatMap((w) => [w.y, w.y + w.h]),
  ]);
  const nx = xs.length;
  const ny = ys.length;
  const at = (i: number, j: number) => i * ny + j;

  // Points inside a wall, and steps that cross one between two of its borders.
  const blocked = new Uint8Array(nx * ny);
  const blockedRight = new Uint8Array(nx * ny);
  const blockedDown = new Uint8Array(nx * ny);
  for (const w of walls) {
    const i0 = xs.indexOf(w.x);
    const i1 = xs.indexOf(w.x + w.w);
    const j0 = ys.indexOf(w.y);
    const j1 = ys.indexOf(w.y + w.h);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const innerX = i > i0 && i < i1;
        const innerY = j > j0 && j < j1;
        if (innerX && innerY) blocked[at(i, j)] = 1;
        if (innerY && i < i1) blockedRight[at(i, j)] = 1;
        if (innerX && j < j1) blockedDown[at(i, j)] = 1;
      }
    }
  }

  const source = at(xs.indexOf(s[0]), ys.indexOf(s[1]));
  const target = at(xs.indexOf(e[0]), ys.indexOf(e[1]));
  const arriveDir = directionOf([-endNormal[0], -endNormal[1]]);
  const ti = Math.floor(target / ny);
  const tj = target % ny;
  const heuristic = (node: number) =>
    Math.abs(xs[Math.floor(node / ny)]! - xs[ti]!) + Math.abs(ys[node % ny]! - ys[tj]!);

  // State: node * 4 + the direction we arrived in.
  const cost = new Float64Array(nx * ny * 4).fill(Infinity);
  const from = new Int32Array(nx * ny * 4).fill(-1);
  const heap = new Heap();
  const first = source * 4 + directionOf(startNormal);
  cost[first] = 0;
  heap.push(heuristic(source), first);

  let best = -1;
  let bestCost = Infinity;
  while (heap.size > 0) {
    const state = heap.pop();
    const node = state >> 2;
    const dir = state & 3;
    const g = cost[state]!;
    if (g + heuristic(node) >= bestCost) break;
    if (node === target) {
      const total = g + (dir === arriveDir ? 0 : BEND_COST);
      if (total < bestCost) {
        bestCost = total;
        best = state;
      }
      continue;
    }
    const i = Math.floor(node / ny);
    const j = node % ny;
    for (let next = 0; next < 4; next++) {
      if (next === (dir + 2) % 4) continue;
      const [di, dj] = STEP[next]!;
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const neighbour = at(ni, nj);
      if (blocked[neighbour]) continue;
      if (dj === 0 && blockedRight[at(Math.min(i, ni), j)]) continue;
      if (di === 0 && blockedDown[at(i, Math.min(j, nj))]) continue;
      const length = Math.abs(xs[ni]! - xs[i]!) + Math.abs(ys[nj]! - ys[j]!);
      const nextCost = g + length + (next === dir ? 0 : BEND_COST);
      const nextState = neighbour * 4 + next;
      if (nextCost < cost[nextState]!) {
        cost[nextState] = nextCost;
        from[nextState] = state;
        heap.push(nextCost + heuristic(neighbour), nextState);
      }
    }
  }
  if (best < 0) return null;

  const path: Point[] = [[end.x, end.y]];
  for (let state = best; state >= 0; state = from[state]!) {
    const node = state >> 2;
    path.push([xs[Math.floor(node / ny)]!, ys[node % ny]!]);
  }
  path.push([start.x, start.y]);
  path.reverse();
  return { points: withoutStraightPoints(path), cost: bestCost };
}

function withoutStraightPoints(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    const before = out[out.length - 2];
    if (
      before &&
      prev &&
      ((before[0] === prev[0] && prev[0] === p[0]) || (before[1] === prev[1] && prev[1] === p[1]))
    ) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

/** A polyline with its corners rounded. */
function roundedPath(points: Point[]): string {
  const [first] = points;
  let d = `M${fmt(first![0])},${fmt(first![1])}`;
  for (let k = 1; k < points.length - 1; k++) {
    const [px, py] = points[k - 1]!;
    const [cx, cy] = points[k]!;
    const [qx, qy] = points[k + 1]!;
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(qx - cx, qy - cy);
    const r = Math.min(CORNER_RADIUS, inLen / 2, outLen / 2);
    const ax = cx - ((cx - px) / inLen) * r;
    const ay = cy - ((cy - py) / inLen) * r;
    const bx = cx + ((qx - cx) / outLen) * r;
    const by = cy + ((qy - cy) / outLen) * r;
    d += ` L${fmt(ax)},${fmt(ay)} Q${fmt(cx)},${fmt(cy)} ${fmt(bx)},${fmt(by)}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L${fmt(last[0])},${fmt(last[1])}`;
}

function midpointAlong(points: Point[]): Point {
  let total = 0;
  for (let k = 1; k < points.length; k++) {
    total += Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1]);
  }
  let left = total / 2;
  for (let k = 1; k < points.length; k++) {
    const [ax, ay] = points[k - 1]!;
    const [bx, by] = points[k]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (len >= left && len > 0) {
      return [ax + ((bx - ax) * left) / len, ay + ((by - ay) * left) / len];
    }
    left -= len;
  }
  return points[0]!;
}

// ── The router ──────────────────────────────────────────────────────────────

/**
 * Draws connections among one set of cards. Build it once per set of cards
 * (it indexes them) and ask it for any number of connections.
 */
export class EdgeRouter {
  private cells = new Map<string, RouteCard[]>();
  private large: RouteCard[] = [];

  constructor(cards: Iterable<RouteCard>) {
    for (const card of cards) {
      if (card.type === "group") continue;
      const [cx0, cy0, cx1, cy1] = cellRange(card);
      if (cx1 - cx0 >= MAX_CELLS_PER_AXIS || cy1 - cy0 >= MAX_CELLS_PER_AXIS) {
        this.large.push(card);
        continue;
      }
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = `${cx},${cy}`;
          const cell = this.cells.get(key);
          if (cell) cell.push(card);
          else this.cells.set(key, [card]);
        }
      }
    }
  }

  /** Cards overlapping the box; stops early once there are more than `limit`. */
  private query(box: Box, limit = Infinity): RouteCard[] {
    const found = new Set<RouteCard>();
    for (const card of this.large) if (overlaps(card, box)) found.add(card);
    const [cx0, cy0, cx1, cy1] = cellRange(box);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 4096) return [...found];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (const card of this.cells.get(`${cx},${cy}`) ?? []) {
          if (!found.has(card) && overlaps(card, box)) {
            found.add(card);
            if (found.size > limit) return [...found];
          }
        }
      }
    }
    return [...found];
  }

  /** The plain curve, without looking for cards in the way: cheap enough for every frame. */
  curve(from: Box, to: Box, fromSide?: unknown, toSide?: unknown): EdgeDrawing {
    const [autoFrom, autoTo] = nearestSides(from, to);
    return curvedEdge(
      sideAnchor(from, isSide(fromSide) ? fromSide : autoFrom),
      sideAnchor(to, isSide(toSide) ? toSide : autoTo),
    );
  }

  /**
   * The connection's drawing. Sides the file gives are honoured; missing
   * ones are picked for drawing only. An end may be somewhere other than
   * the indexed card with its id (a card being dragged); the indexed one
   * is then ignored.
   */
  draw(from: EndBox, to: EndBox, fromSide?: unknown, toSide?: unknown): EdgeDrawing {
    const curve = this.curve(from, to, fromSide, toSide);
    const { start, end } = curve;
    if (from === to || (from.id != null && from.id === to.id)) return curve;
    const isEnd = (card: RouteCard) =>
      card === from ||
      card === to ||
      (card.id !== "" && (card.id === from.id || card.id === to.id)) ||
      sameBox(card, from) ||
      sameBox(card, to);

    const [c1, c2] = [control(start, end), control(end, start)];
    const samples: Point[] = [];
    for (let k = 0; k <= CURVE_SAMPLES; k++) {
      samples.push(cubicAt([start.x, start.y], c1, c2, [end.x, end.y], k / CURVE_SAMPLES));
    }
    // Its own cards count too: a curve that doubles back through them is routed around.
    const near: Box[] = [...this.query(boundsOf(samples)).filter((card) => !isEnd(card)), from, to];
    const crossed = near.some((card) => {
      const solid = inflate(card, -GRAZE);
      if (solid.w <= 0 || solid.h <= 0) return false;
      for (let k = 1; k < samples.length; k++) {
        if (segmentHits(samples[k - 1]!, samples[k]!, solid)) return true;
      }
      return false;
    });
    if (!crossed) return curve;

    // The cards near both ends, then those near anything a detour might
    // pass, so the route can go around the far side of a card in the way.
    const reach = 4 * CLEARANCE;
    let region = inflate(union(from, to), reach);
    const nearby = this.query(region, MAX_OBSTACLES);
    if (nearby.length > MAX_OBSTACLES) return curve;
    for (const card of nearby) region = union(region, inflate(card, reach));
    const found = this.query(region, MAX_OBSTACLES);
    if (found.length > MAX_OBSTACLES) return curve;
    const obstacles: Box[] = [...found.filter((card) => !isEnd(card)), from, to];

    type Route = {
      start: EdgeEnd;
      end: EdgeEnd;
      points: Point[];
      cost: number;
      clearance: number;
    };
    const routeBy = (fromSide: CanvasSide, toSide: CanvasSide): Route | null => {
      const a = sideAnchor(from, fromSide);
      const b = sideAnchor(to, toSide);
      const clearances = [CLEARANCE, ...TIGHT_CLEARANCES];
      for (let k = 0; k < clearances.length; k++) {
        const found = orthogonalRoute(a, b, obstacles, clearances[k]!);
        if (found)
          return {
            start: a,
            end: b,
            points: found.points,
            cost: found.cost + k * TIGHT_COST,
            clearance: clearances[k]!,
          };
      }
      return null;
    };

    // A route that's blocked, cramped or goes the long way round may leave
    // and arrive by other sides, for drawing only.
    let best = routeBy(start.side, end.side);
    const direct = Math.abs(end.x - start.x) + Math.abs(end.y - start.y) + 2 * BEND_COST;
    if (!best || best.cost > ROUNDABOUT * direct) {
      // Moving one end at a time, then the pair facing each other.
      const pairs: [CanvasSide, CanvasSide][] = [
        ...SIDE_ORDER.filter((side) => side !== start.side).map(
          (side): [CanvasSide, CanvasSide] => [side, end.side],
        ),
        ...SIDE_ORDER.filter((side) => side !== end.side).map((side): [CanvasSide, CanvasSide] => [
          start.side,
          side,
        ]),
        nearestSides(from, to),
      ];
      let alternative: Route | null = null;
      for (const [fromSide, toSide] of pairs) {
        if (fromSide === start.side && toSide === end.side) continue;
        const route = routeBy(fromSide, toSide);
        if (route && (!alternative || route.cost < alternative.cost)) alternative = route;
      }
      if (alternative && (!best || alternative.cost < best.cost * SWITCH_RATIO)) best = alternative;
    }
    if (!best) return curve;
    return {
      d: roundedPath(best.points),
      label: midpointAlong(best.points),
      start: best.start,
      end: best.end,
      anchors: [start, end],
      bounds: boundsOf(best.points),
      route: { points: best.points, clearance: best.clearance },
      routed: true,
    };
  }
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function cellRange(box: Box): [number, number, number, number] {
  return [
    Math.floor(box.x / CELL),
    Math.floor(box.y / CELL),
    Math.floor((box.x + box.w) / CELL),
    Math.floor((box.y + box.h) / CELL),
  ];
}

// ── Shared stretches ────────────────────────────────────────────────────────

/** Space between routes that would otherwise run along the same line. */
const SEPARATION = 10;

interface Stretch {
  id: string;
  /** Index of the segment's first point. */
  k: number;
  /** 0: horizontal, at a fixed y. 1: vertical, at a fixed x. */
  axis: 0 | 1;
  at: number;
  lo: number;
  hi: number;
  /** Which way the line turns at either end: negative toward smaller `at`. */
  bias: number;
  clearance: number;
}

/**
 * Routes are found one at a time, so two can land on the same line and
 * read as one. This spreads every stretch two or more routes share apart,
 * each to the side its line turns toward, within the clearance it kept,
 * and fans out lines that meet a card at the same point along its side.
 * Pure over the whole set: the editor and the snapshot view pass the same
 * routes and get the same lines. Returns only the drawings it moved.
 */
export function separateOverlaps(
  drawings: Iterable<[string, EdgeDrawing]>,
): Map<string, EdgeDrawing> {
  const groups = new Map<string, Stretch[]>();
  const meeting = new Map<string, Stretch[]>();
  const routes = new Map<string, EdgeDrawing>();
  for (const [id, drawing] of drawings) {
    const route = drawing.route;
    if (!route) continue;
    routes.set(id, drawing);
    const p = route.points;
    for (let k = 1; k < p.length - 2; k++) {
      const [ax, ay] = p[k]!;
      const [bx, by] = p[k + 1]!;
      const axis = ay === by ? 0 : 1;
      const at = axis === 0 ? ay : ax;
      const side = (q: Point) => Math.sign((axis === 0 ? q[1] : q[0]) - at);
      const stretch: Stretch = {
        id,
        k,
        axis,
        at,
        lo: axis === 0 ? Math.min(ax, bx) : Math.min(ay, by),
        hi: axis === 0 ? Math.max(ax, bx) : Math.max(ay, by),
        bias: side(p[k - 1]!) + side(p[k + 2]!),
        clearance: route.clearance,
      };
      const key = `${axis}:${at}`;
      const group = groups.get(key);
      if (group) group.push(stretch);
      else groups.set(key, [stretch]);
    }
    // Lines meeting a card at the same point fan out along its side.
    if (p.length >= 3) {
      for (const [k, anchor, after] of [
        [0, p[0]!, p[2]!],
        [p.length - 2, p.at(-1)!, p.at(-3)!],
      ] as const) {
        const [ax, ay] = p[k]!;
        const [, by] = p[k + 1]!;
        const axis = ay === by ? 0 : 1;
        const at = axis === 0 ? ay : ax;
        const stub: Stretch = {
          id,
          k,
          axis,
          at,
          lo: 0,
          hi: 0,
          bias: Math.sign((axis === 0 ? after[1] : after[0]) - at),
          clearance: route.clearance,
        };
        const key = `${anchor[0]},${anchor[1]}`;
        const group = meeting.get(key);
        if (group) group.push(stub);
        else meeting.set(key, [stub]);
      }
    }
  }

  const shifts = new Map<string, Map<number, [0 | 1, number]>>();
  for (const group of meeting.values()) {
    if (new Set(group.map((s) => s.id)).size > 1) spread(group, shifts);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.lo - b.lo || a.hi - b.hi || cmp(a.id, b.id) || a.k - b.k);
    let cluster: Stretch[] = [];
    let reach = 0;
    const flush = () => {
      if (new Set(cluster.map((s) => s.id)).size > 1) spread(cluster, shifts);
      cluster = [];
    };
    for (const stretch of group) {
      // Touching at a corner isn't sharing; overlapping by more than a pixel is.
      if (cluster.length > 0 && stretch.lo >= reach - 1) flush();
      reach = cluster.length > 0 ? Math.max(reach, stretch.hi) : stretch.hi;
      cluster.push(stretch);
    }
    flush();
  }

  const moved = new Map<string, EdgeDrawing>();
  for (const [id, byIndex] of shifts) {
    const drawing = routes.get(id)!;
    const points = drawing.route!.points.map((q): Point => [q[0], q[1]]);
    for (const [k, [axis, offset]] of byIndex) {
      const c = axis === 0 ? 1 : 0;
      points[k]![c] += offset;
      points[k + 1]![c] += offset;
    }
    const [sx, sy] = points[0]!;
    const [ex, ey] = points.at(-1)!;
    moved.set(id, {
      ...drawing,
      d: roundedPath(points),
      label: midpointAlong(points),
      start: { ...drawing.start, x: sx, y: sy },
      end: { ...drawing.end, x: ex, y: ey },
      bounds: boundsOf(points),
      route: { ...drawing.route!, points },
    });
  }
  return moved;
}

function spread(cluster: Stretch[], shifts: Map<string, Map<number, [0 | 1, number]>>) {
  cluster.sort((a, b) => a.bias - b.bias || cmp(a.id, b.id) || a.k - b.k);
  const room = Math.min(...cluster.map((s) => s.clearance)) - 2;
  const gap = Math.min(SEPARATION, (2 * room) / (cluster.length - 1));
  cluster.forEach((stretch, i) => {
    const offset = (i - (cluster.length - 1) / 2) * gap;
    if (offset === 0) return;
    let byIndex = shifts.get(stretch.id);
    if (!byIndex) shifts.set(stretch.id, (byIndex = new Map()));
    byIndex.set(stretch.k, [stretch.axis, offset]);
  });
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

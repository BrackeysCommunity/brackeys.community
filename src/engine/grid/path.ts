import {
  cellKey,
  inCellBounds,
  type Cell,
  type CellBounds,
  type CellKey,
  type GridGeometry,
} from "./geometry";

export type GridPathOptions = {
  /** Default: RuntimeGrid.passable when called through ctx.grid, else every cell in `bounds`. */
  passable?: (c: Cell) => boolean;
  /** Extra integer cost to enter `to` (added to stepCost); null: impassable. */
  cost?: (from: Cell, to: Cell) => number | null;
  diagonals?: boolean;
  /** With diagonals: may a diagonal step pass between two blocked edge neighbours? Default false. */
  cutCorners?: boolean;
  bounds?: CellBounds;
  /** Give up after expanding this many cells; default 65,536. */
  maxExpanded?: number;
};

export type GridPath = { cells: Cell[]; cost: number; expanded: number };

export const DEFAULT_MAX_EXPANDED = 65_536;

/** A min-heap ordered by (a, b, insertion), so equal keys pop in the order they were pushed. */
export class CellHeap {
  private keys: CellKey[] = [];
  private a: number[] = [];
  private b: number[] = [];
  private seq: number[] = [];
  private pushed = 0;

  get size(): number {
    return this.keys.length;
  }

  push(key: CellKey, a: number, b: number): void {
    let i = this.keys.length;
    this.keys.push(key);
    this.a.push(a);
    this.b.push(b);
    this.seq.push(this.pushed++);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** The smallest entry's key; the heap must not be empty. */
  pop(): CellKey {
    const top = this.keys[0]!;
    const last = this.keys.length - 1;
    this.swap(0, last);
    this.keys.pop();
    this.a.pop();
    this.b.pop();
    this.seq.pop();
    const n = this.keys.length;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }

  private less(i: number, j: number): boolean {
    const ai = this.a[i]!;
    const aj = this.a[j]!;
    if (ai !== aj) return ai < aj;
    const bi = this.b[i]!;
    const bj = this.b[j]!;
    if (bi !== bj) return bi < bj;
    return this.seq[i]! < this.seq[j]!;
  }

  private swap(i: number, j: number): void {
    for (const arr of [this.keys, this.a, this.b, this.seq]) {
      const t = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = t;
    }
  }
}

export type GridSteps = {
  /** Whether a cell may be entered at all: inside `bounds` and `passable`. */
  open(c: Cell): boolean;
  /** The cells reachable from `c` in one step, in neighbour order, with what each step costs. */
  steps(c: Cell): Array<{ to: Cell; cost: number }>;
  /** What stepping from a cell to one of its neighbours costs; null when the step is not allowed. */
  step(from: Cell, to: Cell): number | null;
};

/** One step rule shared by every search: bounds, passability, corner cutting and integer costs. */
export function gridSteps(grid: GridGeometry, opts: GridPathOptions = {}): GridSteps {
  const { passable, cost, bounds } = opts;
  const diagonals = opts.diagonals === true;
  const cutCorners = opts.cutCorners === true;
  const square = grid.settings.kind === "square";
  const inBounds = (c: Cell) => bounds === undefined || inCellBounds(bounds, c);
  const open = (c: Cell) => inBounds(c) && (passable === undefined || passable(c));

  /** What stepping from `from` to its neighbour `to` costs; null when the step is not allowed. */
  function step(from: Cell, to: Cell): number | null {
    if (!open(to)) return null;
    const diagonal = square && to[0] !== from[0] && to[1] !== from[1];
    if (diagonal && !cutCorners && (!open([to[0], from[1]]) || !open([from[0], to[1]])))
      return null;
    const base = grid.stepCost(from, to);
    if (cost === undefined) return base;
    const extra = cost(from, to);
    if (extra === null) return null;
    if (!Number.isInteger(extra) || extra < 0)
      throw new RangeError(`grid step cost must be a whole number ≥ 0, got ${extra}`);
    return base + extra;
  }

  return {
    open,
    step,
    steps(from) {
      const out: Array<{ to: Cell; cost: number }> = [];
      for (const to of grid.neighbors(from, diagonals)) {
        const c = step(from, to);
        if (c !== null) out.push({ to, cost: c });
      }
      return out;
    },
  };
}

/** A*: integer costs, a binary heap ordered by (f, h, insertion), so one answer everywhere. */
export function findPath(
  grid: GridGeometry,
  from: Cell,
  to: Cell,
  opts?: GridPathOptions,
): GridPath | null {
  const maxExpanded = opts?.maxExpanded ?? DEFAULT_MAX_EXPANDED;
  const start: Cell = [from[0], from[1]];
  const startKey = cellKey(start);
  const goalKey = cellKey(to);
  if (startKey === goalKey) return { cells: [start], cost: 0, expanded: 0 };
  const rule = gridSteps(grid, opts);
  if (!rule.open(to)) return null;

  const g = new Map<CellKey, number>([[startKey, 0]]);
  const cells = new Map<CellKey, Cell>([[startKey, start]]);
  const parent = new Map<CellKey, CellKey>();
  const closed = new Set<CellKey>();
  const heap = new CellHeap();
  const h0 = grid.heuristic(start, to);
  heap.push(startKey, h0, h0);
  let expanded = 0;

  while (heap.size > 0) {
    const key = heap.pop();
    if (closed.has(key)) continue;
    if (key === goalKey) {
      const path: Cell[] = [];
      for (let k: CellKey | undefined = key; k !== undefined; k = parent.get(k))
        path.push(cells.get(k)!);
      path.reverse();
      return { cells: path, cost: g.get(key)!, expanded };
    }
    if (expanded >= maxExpanded) return null;
    closed.add(key);
    expanded++;
    const here = cells.get(key)!;
    const gHere = g.get(key)!;
    for (const step of rule.steps(here)) {
      const k = cellKey(step.to);
      if (closed.has(k)) continue;
      const gNext = gHere + step.cost;
      const known = g.get(k);
      if (known !== undefined && known <= gNext) continue;
      g.set(k, gNext);
      cells.set(k, step.to);
      parent.set(k, key);
      const h = grid.heuristic(step.to, to);
      heap.push(k, gNext + h, h);
    }
  }
  return null;
}

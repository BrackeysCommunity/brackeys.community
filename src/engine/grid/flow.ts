import { cellKey, type Cell, type CellBounds, type CellKey, type GridGeometry } from "./geometry";
import { CellHeap, DEFAULT_MAX_EXPANDED, gridSteps, type GridPathOptions } from "./path";

export type FlowField = {
  readonly bounds: CellBounds;
  /** Integer cost to the nearest goal; undefined when unreachable. */
  cost(c: Cell): number | undefined;
  /** The neighbour to move to (the cheapest, first in neighbour order on ties); undefined at a goal or unreachable. */
  next(c: Cell): Cell | undefined;
};

/**
 * Dijkstra outwards from every goal at once over the same steps `findPath`
 * takes, run backwards: a cell's cost is what walking from it to the nearest
 * goal costs. Without `bounds`, the field's bounds are the cells it reached.
 */
export function flowField(
  grid: GridGeometry,
  goals: readonly Cell[],
  opts?: GridPathOptions & { maxCost?: number },
): FlowField {
  const rule = gridSteps(grid, opts);
  const diagonals = opts?.diagonals === true;
  const maxCost = opts?.maxCost ?? Infinity;
  const maxExpanded = opts?.maxExpanded ?? DEFAULT_MAX_EXPANDED;
  const costs = new Map<CellKey, number>();
  const best = new Map<CellKey, number>();
  const cells = new Map<CellKey, Cell>();
  const heap = new CellHeap();

  for (const goal of goals) {
    if (!rule.open(goal)) continue;
    const k = cellKey(goal);
    if (best.has(k)) continue;
    best.set(k, 0);
    cells.set(k, [goal[0], goal[1]]);
    heap.push(k, 0, 0);
  }

  while (heap.size > 0 && costs.size < maxExpanded) {
    const key = heap.pop();
    if (costs.has(key)) continue;
    const here = cells.get(key)!;
    const cHere = best.get(key)!;
    costs.set(key, cHere);
    // Neighbouring is symmetric, so the cells that can step into `here` are
    // among its neighbours; price each one's own step into it.
    for (const prev of grid.neighbors(here, diagonals)) {
      if (!rule.open(prev)) continue;
      const k = cellKey(prev);
      if (costs.has(k)) continue;
      const step = rule.step(prev, here);
      if (step === null) continue;
      const c = cHere + step;
      if (c > maxCost) continue;
      const known = best.get(k);
      if (known !== undefined && known <= c) continue;
      best.set(k, c);
      cells.set(k, prev);
      heap.push(k, c, 0);
    }
  }

  let bounds = opts?.bounds;
  if (bounds === undefined) {
    let c0 = Infinity;
    let r0 = Infinity;
    let c1 = -Infinity;
    let r1 = -Infinity;
    for (const k of costs.keys()) {
      const [c, r] = cells.get(k)!;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
    }
    bounds = costs.size === 0 ? { c0: 0, r0: 0, c1: -1, r1: -1 } : { c0, r0, c1, r1 };
  }
  const fieldBounds = bounds;
  const inField = (c: Cell) =>
    c[0] >= fieldBounds.c0 &&
    c[0] <= fieldBounds.c1 &&
    c[1] >= fieldBounds.r0 &&
    c[1] <= fieldBounds.r1;
  const costOf = (c: Cell): number | undefined => (inField(c) ? costs.get(cellKey(c)) : undefined);

  return {
    bounds: fieldBounds,
    cost: costOf,
    next(c) {
      const here = costOf(c);
      if (here === undefined || here === 0) return undefined;
      let pick: Cell | undefined;
      let pickCost = Infinity;
      for (const step of rule.steps(c)) {
        const there = costOf(step.to);
        if (there === undefined) continue;
        const total = step.cost + there;
        if (total < pickCost) {
          pickCost = total;
          pick = step.to;
        }
      }
      return pick;
    },
  };
}

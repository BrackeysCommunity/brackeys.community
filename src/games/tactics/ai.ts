/**
 * The computer side, pure over a snapshot and an Rng: each red unit in id
 * order strikes the weakest blue unit it can reach a strike on, else walks
 * toward the nearest one along `findPath` as far as its move allows. Ties
 * go by cell order, then the Rng.
 */
import { cellKey, findPath, sameCell, type Cell, type CellKey } from "@jams/engine/game";
import type { Rng } from "@jams/engine/sim-kit";

import type { TacticsCommand } from "./commands";
import {
  applyCommand,
  occupancy,
  otherSide,
  ordersOpen,
  reachCells,
  reachField,
  targetsFrom,
  unitIds,
} from "./rules";
import { byCell, type TacticsBoard, type TacticsSnapshot, type UnitClasses } from "./types";

/** The best of `items` by `compare`; what's still tied after it is the Rng's to pick. */
function best<T>(items: readonly T[], compare: (a: T, b: T) => number, rng: Rng): T | undefined {
  if (items.length === 0) return undefined;
  const sorted = [...items].sort(compare);
  const top = sorted.filter((x) => compare(x, sorted[0]!) === 0);
  return top.length === 1 ? top[0] : rng.pick(top);
}

/** The next red unit still to act this turn, by id order; null when none is left. */
export function nextEnemyUnit(snapshot: TacticsSnapshot): string | null {
  if (!ordersOpen(snapshot) || snapshot.side !== "red") return null;
  return unitIds(snapshot, "red").find((id) => !snapshot.units[id]!.acted) ?? null;
}

/** One unit's orders for its turn, each legal once the ones before it apply. */
export function enemyOrders(
  snapshot: TacticsSnapshot,
  unitId: string,
  classes: UnitClasses,
  board: TacticsBoard,
  rng: Rng,
): TacticsCommand[] {
  const unit = snapshot.units[unitId];
  if (!unit || unit.acted || !ordersOpen(snapshot) || unit.side !== snapshot.side) return [];
  const enemies = otherSide(unit.side);
  const stands: Cell[] = [
    unit.cell,
    ...(unit.moved ? [] : reachCells(snapshot, unitId, classes, board)),
  ];

  const strikes: { target: string; from: Cell; cost: number }[] = [];
  const field = unit.moved ? null : reachField(snapshot, unitId, classes, board);
  for (const from of stands)
    for (const target of targetsFrom(snapshot, unitId, classes, board, from))
      strikes.push({ target, from, cost: field?.cost(from) ?? 0 });

  const cellOf = (id: string) => snapshot.units[id]!.cell;
  const weakest = best(
    [...new Set(strikes.map((s) => s.target))],
    (a, b) => snapshot.units[a]!.hp - snapshot.units[b]!.hp || byCell(cellOf(a), cellOf(b)),
    rng,
  );
  if (weakest !== undefined) {
    const stand = best(
      strikes.filter((s) => s.target === weakest),
      (a, b) => a.cost - b.cost || byCell(a.from, b.from),
      rng,
    )!;
    const attack: TacticsCommand = { name: "attack", args: { unit: unitId, target: weakest } };
    if (sameCell(stand.from, unit.cell)) return [attack];
    return [{ name: "move", args: { unit: unitId, to: [stand.from[0], stand.from[1]] } }, attack];
  }

  const wait: TacticsCommand = { name: "wait", args: { unit: unitId } };
  if (unit.moved || !field) return [wait];
  const held = occupancy(snapshot);
  const routes: { target: string; cells: Cell[]; cost: number }[] = [];
  for (const target of unitIds(snapshot, enemies)) {
    const goal = cellOf(target);
    const path = findPath(board.geometry, unit.cell, goal, {
      bounds: board.bounds,
      passable: (c) => {
        const k: CellKey = cellKey(c);
        if (board.walls.has(k)) return false;
        const holder = held.get(k);
        return holder === undefined || holder === unitId || sameCell(c, goal);
      },
      cost: (_from, to) => board.costs.get(cellKey(to)) ?? 0,
    });
    if (path) routes.push({ target, cells: path.cells, cost: path.cost });
  }
  const nearest = best(
    routes,
    (a, b) => a.cost - b.cost || byCell(cellOf(a.target), cellOf(b.target)),
    rng,
  );
  if (!nearest) return [wait];
  // The farthest cell along the route, short of the target, that this turn's move reaches.
  for (let i = nearest.cells.length - 2; i >= 1; i--) {
    const to = nearest.cells[i]!;
    const cost = field.cost(to);
    if (cost !== undefined && cost > 0)
      return [{ name: "move", args: { unit: unitId, to: [to[0], to[1]] } }, wait];
  }
  return [wait];
}

/**
 * The whole red turn: every red unit's orders in id order, applied as they
 * go (strikes draw their crits from `rng`), then `end-turn` unless the
 * fight ended first.
 */
export function enemyTurn(
  snapshot: TacticsSnapshot,
  classes: UnitClasses,
  board: TacticsBoard,
  rng: Rng,
  critChance: number,
): { orders: TacticsCommand[]; snapshot: TacticsSnapshot; log: string[] } {
  let state = snapshot;
  const orders: TacticsCommand[] = [];
  const log: string[] = [];
  const play = (command: TacticsCommand) => {
    const applied = applyCommand(state, command, classes, board, rng, critChance);
    if (!applied) return false;
    orders.push(command);
    log.push(...applied.log);
    state = applied.snapshot;
    return true;
  };
  for (let id = nextEnemyUnit(state); id !== null; id = nextEnemyUnit(state)) {
    const unitOrders = enemyOrders(state, id, classes, board, rng);
    if (unitOrders.length === 0 || !unitOrders.every(play)) break;
  }
  if (ordersOpen(state) && state.side === "red") play({ name: "end-turn" });
  return { orders, snapshot: state, log };
}

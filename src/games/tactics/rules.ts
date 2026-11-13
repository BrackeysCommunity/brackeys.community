/**
 * The skirmish's rules as pure functions over a snapshot, the board and an
 * Rng. Grid costs are integers on the toolkit's 10-per-step scale and the
 * only float maths is the crit draw's exact division, so every platform
 * agrees on every result.
 */
import {
  boundsCells,
  cellKey,
  flowField,
  inCellBounds,
  lineOfSight,
  type Cell,
  type CellKey,
  type FlowField,
} from "@jams/engine/game";
import type { Rng } from "@jams/engine/sim-kit";

import type { TacticsCommand } from "./commands";
import {
  byCell,
  STEP_COST,
  type Side,
  type TacticsBoard,
  type TacticsSnapshot,
  type UnitClass,
  type UnitClasses,
  type UnitState,
} from "./types";

const U32 = 0x1_0000_0000;

export const otherSide = (side: Side): Side => (side === "blue" ? "red" : "blue");

/** Unit ids in the order every rule walks them: by code unit, the same everywhere. */
export const unitIds = (snapshot: TacticsSnapshot, side?: Side): string[] =>
  Object.keys(snapshot.units)
    .filter((id) => side === undefined || snapshot.units[id]!.side === side)
    .sort();

/** Whether the side named by `snapshot.side` may give orders now. */
export const ordersOpen = (snapshot: TacticsSnapshot): boolean =>
  snapshot.result === null && (snapshot.phase === "orders" || snapshot.phase === "enemy");

/** Cells standing units hold, to the unit on each. */
export function occupancy(snapshot: TacticsSnapshot): Map<CellKey, string> {
  const out = new Map<CellKey, string>();
  for (const id of unitIds(snapshot)) out.set(cellKey(snapshot.units[id]!.cell), id);
  return out;
}

/** Whether a unit may stand on or walk through `c`: on the board, no wall, and no other unit there. */
function freeFor(board: TacticsBoard, held: ReadonlyMap<CellKey, string>, self: string) {
  return (c: Cell) => {
    if (!inCellBounds(board.bounds, c)) return false;
    const k = cellKey(c);
    if (board.walls.has(k)) return false;
    const holder = held.get(k);
    return holder === undefined || holder === self;
  };
}

const extraCost = (board: TacticsBoard, c: Cell) => board.costs.get(cellKey(c)) ?? 0;

/**
 * Where a unit can walk this turn: a flow field out from its cell, capped at
 * its class's move. The field runs from its goal backwards, so the cost of a
 * step is charged on the cell the walker would enter going the other way
 * (`from`), which makes each cell's cost the cost of walking out to it.
 */
export function reachField(
  snapshot: TacticsSnapshot,
  unitId: string,
  classes: UnitClasses,
  board: TacticsBoard,
): FlowField | null {
  const unit = snapshot.units[unitId];
  const cls = unit && classes[unit.class];
  if (!unit || !cls) return null;
  return flowField(board.geometry, [unit.cell], {
    passable: freeFor(board, occupancy(snapshot), unitId),
    cost: (from) => extraCost(board, from),
    maxCost: cls.move * STEP_COST,
    bounds: board.bounds,
  });
}

/** The cells a unit may move to, its own excluded, in cell order. */
export function reachCells(
  snapshot: TacticsSnapshot,
  unitId: string,
  classes: UnitClasses,
  board: TacticsBoard,
): Cell[] {
  const field = reachField(snapshot, unitId, classes, board);
  if (!field) return [];
  return boundsCells(field.bounds)
    .filter((c) => {
      const cost = field.cost(c);
      return cost !== undefined && cost > 0;
    })
    .sort(byCell);
}

/** Whether a unit of `cls` standing on `from` can strike `to`: grid distance in its range, and a clear line for a class that needs sight. */
export function canStrike(cls: UnitClass, from: Cell, to: Cell, board: TacticsBoard): boolean {
  const d = board.geometry.distance(from, to);
  if (d < cls.range[0] || d > cls.range[1]) return false;
  if (!cls.sight) return true;
  return lineOfSight(board.geometry, from, to, (c) => board.walls.has(cellKey(c)));
}

/** Enemy ids a unit could strike from `from` (its own cell when omitted), in id order. */
export function targetsFrom(
  snapshot: TacticsSnapshot,
  unitId: string,
  classes: UnitClasses,
  board: TacticsBoard,
  from?: Cell,
): string[] {
  const unit = snapshot.units[unitId];
  const cls = unit && classes[unit.class];
  if (!unit || !cls) return [];
  const at = from ?? unit.cell;
  return unitIds(snapshot, otherSide(unit.side)).filter((id) =>
    canStrike(cls, at, snapshot.units[id]!.cell, board),
  );
}

/** A unit of the side to act, alive and of a known class; null otherwise. */
function actor(
  snapshot: TacticsSnapshot,
  unitId: string,
  classes: UnitClasses,
): (UnitState & { cls: UnitClass }) | null {
  if (!ordersOpen(snapshot)) return null;
  const unit = snapshot.units[unitId];
  const cls = unit && classes[unit.class];
  if (!unit || !cls || unit.side !== snapshot.side) return null;
  return { ...unit, cls };
}

/** Whether a command is legal now: the one rule `legal` lists and `applyCommand` enforces. */
export function isLegal(
  snapshot: TacticsSnapshot,
  command: TacticsCommand,
  classes: UnitClasses,
  board: TacticsBoard,
): boolean {
  if (command.name === "end-turn") return ordersOpen(snapshot);
  const unit = actor(snapshot, command.args.unit, classes);
  if (!unit || unit.acted) return false;
  switch (command.name) {
    case "wait":
      return true;
    case "move": {
      if (unit.moved || !inCellBounds(board.bounds, command.args.to)) return false;
      const cost = reachField(snapshot, command.args.unit, classes, board)?.cost(command.args.to);
      return cost !== undefined && cost > 0;
    }
    case "attack": {
      const target = snapshot.units[command.args.target];
      return (
        target !== undefined &&
        target.side !== unit.side &&
        canStrike(unit.cls, unit.cell, target.cell, board)
      );
    }
  }
}

/**
 * Every legal command for the side to act, in a stable order: each of its
 * units in id order (moves by cell order, then attacks by target id, then
 * wait), then `end-turn`.
 */
export function legal(
  snapshot: TacticsSnapshot,
  classes: UnitClasses,
  board: TacticsBoard,
): TacticsCommand[] {
  if (!ordersOpen(snapshot)) return [];
  const out: TacticsCommand[] = [];
  for (const id of unitIds(snapshot, snapshot.side)) {
    const unit = actor(snapshot, id, classes);
    if (!unit || unit.acted) continue;
    if (!unit.moved)
      for (const to of reachCells(snapshot, id, classes, board))
        out.push({ name: "move", args: { unit: id, to: [to[0], to[1]] } });
    for (const target of targetsFrom(snapshot, id, classes, board))
      out.push({ name: "attack", args: { unit: id, target } });
    out.push({ name: "wait", args: { unit: id } });
  }
  out.push({ name: "end-turn" });
  return out;
}

/** One draw per strike, crit or not, so the stream never depends on the chance. */
export function rollDamage(
  cls: UnitClass,
  rng: Rng,
  critChance: number,
): { damage: number; crit: boolean } {
  const crit = rng.nextU32() / U32 < critChance;
  return { damage: crit ? cls.attack * 2 : cls.attack, crit };
}

export type Applied = { snapshot: TacticsSnapshot; log: string[] };

/** How a board with these units stands: won or lost once a side has none left, open otherwise or with no units at all. */
export function resultOf(units: Readonly<Record<string, UnitState>>): TacticsSnapshot["result"] {
  const sides = new Set(Object.values(units).map((u) => u.side));
  if (sides.size === 0) return null;
  if (!sides.has("red")) return "won";
  if (!sides.has("blue")) return "lost";
  return null;
}

/**
 * The snapshot after a command, and what to log about it; null when the
 * command isn't legal. A move lands at once: walking there over ticks is
 * the runtime's to show.
 */
export function applyCommand(
  snapshot: TacticsSnapshot,
  command: TacticsCommand,
  classes: UnitClasses,
  board: TacticsBoard,
  rng: Rng,
  critChance: number,
): Applied | null {
  if (!isLegal(snapshot, command, classes, board)) return null;
  const units: Record<string, UnitState> = { ...snapshot.units };
  const log: string[] = [];
  if (command.name === "end-turn") {
    for (const id of Object.keys(units)) units[id] = { ...units[id]!, moved: false, acted: false };
    const side = otherSide(snapshot.side);
    log.push(`${snapshot.side} ends the turn`);
    return {
      snapshot: {
        ...snapshot,
        units,
        side,
        turn: side === "blue" ? snapshot.turn + 1 : snapshot.turn,
        phase: side === "blue" ? "orders" : "enemy",
      },
      log,
    };
  }
  const id = command.args.unit;
  const unit = units[id]!;
  if (command.name === "move") {
    const to = command.args.to;
    units[id] = { ...unit, cell: [to[0], to[1]], moved: true };
    log.push(`${id} moves to ${to[0]},${to[1]}`);
    return { snapshot: { ...snapshot, units }, log };
  }
  units[id] = { ...unit, moved: true, acted: true };
  if (command.name === "wait") {
    log.push(`${id} waits`);
    return { snapshot: { ...snapshot, units }, log };
  }
  const targetId = command.args.target;
  const target = units[targetId]!;
  const { damage, crit } = rollDamage(classes[unit.class]!, rng, critChance);
  const hp = target.hp - damage;
  log.push(`${id} hits ${targetId} for ${damage}${crit ? " (crit)" : ""}`);
  if (hp > 0) units[targetId] = { ...target, hp };
  else {
    delete units[targetId];
    log.push(`${targetId} falls`);
  }
  const result = resultOf(units);
  if (result !== null) log.push(result === "won" ? "blue wins" : "red wins");
  return {
    snapshot: { ...snapshot, units, result, phase: result === null ? snapshot.phase : "over" },
    log,
  };
}

/**
 * The board cursor as a pure state machine: idle → unit selected → target
 * chosen → command sent, then back once the slice shows the order landed.
 * Every input (a nudge, a pointer cell, confirm, cancel, a menu order) goes
 * through `stepCursor`, which returns the next state and the one command to
 * send, if any. It reads the board only through a `BoardView`.
 */
import {
  boundsCells,
  cellKey,
  fieldOfView,
  inCellBounds,
  sameCell,
  type Cell,
  type CellKey,
} from "@jams/engine/game";

import type { TacticsCommand } from "../commands";
import { canStrike, ordersOpen, reachCells, unitIds } from "../rules";
import {
  tacticsBoard,
  type Side,
  type TacticsBoard,
  type TacticsSlice,
  type UnitClass,
  type UnitClasses,
  type UnitState,
} from "../types";

/** The side the HUD gives orders for; the other is the computer's. */
export const PLAYER_SIDE: Side = "blue";

/** The board as the HUD reads it: one slice, with what it derives memoised. */
export type BoardView = {
  readonly slice: TacticsSlice;
  readonly board: TacticsBoard;
  /** Whether the player may give orders now: their side, orders open, no result. */
  canOrder(): boolean;
  /** Whether `id` is the player's living unit with its action left. */
  canAct(id: string): boolean;
  unitAt(cell: Cell): string | null;
  /** Cells the unit may move to this turn, its own excluded; [] once it moved. */
  reach(id: string): readonly Cell[];
  /** Cells it strikes from where it stands, by grid distance; walls excluded. */
  attackCells(id: string): readonly Cell[];
  /** Enemies in those cells, in id order. */
  targets(id: string): readonly string[];
  /** Cells none of the player's units can see. */
  fog(): readonly Cell[];
  /** The player's units with an action left, in id order. */
  ready(): readonly string[];
  inside(cell: Cell): boolean;
};

/**
 * The rules' class table from the slice: everything reach and the strike test
 * read (move, range, sight); attack stays neutral since the HUD never deals damage.
 */
function ruleClasses(slice: TacticsSlice): UnitClasses {
  const out: Record<string, UnitClass> = {};
  for (const [id, c] of Object.entries(slice.classes))
    out[id] = { hp: c.hp, move: c.move, range: c.range, attack: 1, sight: c.sight };
  return out;
}

export function boardView(slice: TacticsSlice): BoardView {
  const board = tacticsBoard(slice.grid);
  const classes = ruleClasses(slice);
  const held = new Map<CellKey, string>();
  for (const id of unitIds(slice)) held.set(cellKey(slice.units[id]!.cell), id);

  const memo = <T>(fn: (id: string) => T) => {
    const cache = new Map<string, T>();
    return (id: string): T => {
      if (!cache.has(id)) cache.set(id, fn(id));
      return cache.get(id)!;
    };
  };

  const inside = (c: Cell) => inCellBounds(board.bounds, c);
  const own = (id: string): UnitState | null => {
    const u = slice.units[id];
    return u && u.side === PLAYER_SIDE ? u : null;
  };
  const canOrder = () =>
    slice.side === PLAYER_SIDE && slice.phase === "orders" && ordersOpen(slice);

  const reach = memo((id): readonly Cell[] => {
    const u = own(id);
    return u && !u.moved && !u.acted ? reachCells(slice, id, classes, board) : [];
  });
  const attackCells = memo((id): readonly Cell[] => {
    const u = slice.units[id];
    const cls = u && classes[u.class];
    if (!u || !cls) return [];
    return boundsCells(board.bounds).filter(
      (c) => !board.walls.has(cellKey(c)) && canStrike(cls, u.cell, c, board),
    );
  });
  const targets = memo((id): readonly string[] => {
    const u = slice.units[id];
    if (!u) return [];
    const cells = new Set(attackCells(id).map(cellKey));
    return unitIds(slice).filter(
      (t) => slice.units[t]!.side !== u.side && cells.has(cellKey(slice.units[t]!.cell)),
    );
  });

  let fogged: Cell[] | null = null;
  const fog = (): readonly Cell[] => {
    if (fogged) return fogged;
    const seen = new Set<CellKey>();
    const opaque = (c: Cell) => !inside(c) || board.walls.has(cellKey(c));
    for (const id of unitIds(slice, PLAYER_SIDE)) {
      const u = slice.units[id]!;
      const cls = slice.classes[u.class];
      const radius = cls ? cls.move + cls.range[1] : 1;
      for (const k of fieldOfView(board.geometry, u.cell, radius, opaque)) seen.add(k);
    }
    fogged = boundsCells(board.bounds).filter((c) => !seen.has(cellKey(c)));
    return fogged;
  };

  return {
    slice,
    board,
    canOrder,
    canAct: (id) => {
      const u = own(id);
      return u !== null && !u.acted;
    },
    unitAt: (cell) => (inside(cell) ? (held.get(cellKey(cell)) ?? null) : null),
    reach,
    attackCells,
    targets,
    fog,
    ready: () => unitIds(slice, PLAYER_SIDE).filter((id) => !slice.units[id]!.acted),
    inside,
  };
}

export type CursorMode = "idle" | "selected" | "target" | "sent";
/** An order the menu narrows the cursor to; null lets the cell under it decide. */
export type Order = "move" | "attack";

export type CursorState = {
  readonly mode: CursorMode;
  readonly cell: Cell;
  /** The selected unit ("selected", "target"), or the unit the sent command was for. */
  readonly unit: string | null;
  readonly order: Order | null;
  /** The chosen command ("target") or the one sent ("sent"). */
  readonly command: TacticsCommand | null;
  /** The cell the chosen command points at. */
  readonly targetCell: Cell | null;
};

export type CursorInput =
  | { type: "nudge"; dx: number; dy: number }
  /** The pointer over a cell: the cursor follows it. */
  | { type: "point"; cell: Cell }
  /** A click on a cell: point, then confirm. */
  | { type: "click"; cell: Cell }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "order"; order: Order | "wait" | "end-turn" }
  | { type: "next-unit" }
  /** The slice changed. */
  | { type: "sync" };

export type CursorStep = { state: CursorState; send: TacticsCommand | null };

export const initialCursor = (cell: Cell = [0, 0]): CursorState => ({
  mode: "idle",
  cell,
  unit: null,
  order: null,
  command: null,
  targetCell: null,
});

const keep = (state: CursorState): CursorStep => ({ state, send: null });

const idle = (s: CursorState): CursorState => initialCursor(s.cell);

const select = (s: CursorState, unit: string, v: BoardView): CursorState => ({
  mode: "selected",
  cell: v.slice.units[unit]?.cell ?? s.cell,
  unit,
  order: null,
  command: null,
  targetCell: null,
});

const sent = (s: CursorState, command: TacticsCommand, unit: string | null): CursorStep => ({
  state: { ...s, mode: "sent", unit, command, targetCell: null },
  send: command,
});

function clampCell(v: BoardView, [c, r]: Cell): Cell {
  const { c0, r0, c1, r1 } = v.board.bounds;
  return [Math.min(c1, Math.max(c0, c)), Math.min(r1, Math.max(r0, r))];
}

/** The order a cell offers the selected unit under its menu order: a strike on an enemy there, or a move onto it. */
function candidate(
  v: BoardView,
  unit: string,
  order: Order | null,
  cell: Cell,
): TacticsCommand | null {
  const at = v.unitAt(cell);
  if (order !== "move" && at !== null && v.targets(unit).includes(at))
    return { name: "attack", args: { unit, target: at } };
  if (order !== "attack" && v.reach(unit).some((c) => sameCell(c, cell)))
    return { name: "move", args: { unit, to: [cell[0], cell[1]] } };
  return null;
}

function confirm(s: CursorState, v: BoardView): CursorStep {
  if (!v.canOrder() || s.mode === "sent") return keep(s);
  const at = v.unitAt(s.cell);
  if (s.mode === "idle" || s.unit === null)
    return at !== null && v.canAct(at) ? keep(select(s, at, v)) : keep(s);
  if (!v.canAct(s.unit)) return keep(idle(s));
  if (s.mode === "target" && s.command && s.targetCell && sameCell(s.targetCell, s.cell))
    return sent(s, s.command, s.unit);
  const command = candidate(v, s.unit, s.order, s.cell);
  if (command) return keep({ ...s, mode: "target", command, targetCell: s.cell });
  if (at !== null && at !== s.unit && v.canAct(at)) return keep(select(s, at, v));
  return keep(s);
}

function order(s: CursorState, o: Order | "wait" | "end-turn", v: BoardView): CursorStep {
  if (!v.canOrder() || s.mode === "sent") return keep(s);
  if (o === "end-turn") return sent(s, { name: "end-turn" }, null);
  if (s.unit === null || !v.canAct(s.unit)) return keep(s);
  if (o === "wait") return sent(s, { name: "wait", args: { unit: s.unit } }, s.unit);
  if (o === "move" && v.reach(s.unit).length === 0) return keep(s);
  return keep({ ...s, mode: "selected", order: o, command: null, targetCell: null });
}

/** After the slice changed: a sent order resolves, and a selection or target that no longer holds falls back. */
function resync(s: CursorState, v: BoardView): CursorState {
  if (s.mode === "idle") return s;
  if (s.mode === "sent") {
    if (s.unit === null) return idle(s);
    if (v.slice.side !== PLAYER_SIDE || v.slice.result !== null) return idle(s);
    if (!v.canOrder()) return s;
    return v.canAct(s.unit) ? select(s, s.unit, v) : idle(s);
  }
  if (s.unit === null || !v.canOrder() || !v.canAct(s.unit)) return idle(s);
  let next = s;
  if (next.order === "move" && v.reach(s.unit).length === 0) next = { ...next, order: null };
  if (next.mode === "target" && next.targetCell) {
    const still = candidate(v, s.unit, next.order, next.targetCell);
    if (!still || JSON.stringify(still) !== JSON.stringify(next.command))
      next = { ...next, mode: "selected", command: null, targetCell: null };
  }
  return next;
}

export function stepCursor(s: CursorState, input: CursorInput, v: BoardView): CursorStep {
  switch (input.type) {
    case "nudge":
      return keep({ ...s, cell: clampCell(v, [s.cell[0] + input.dx, s.cell[1] + input.dy]) });
    case "point":
      return v.inside(input.cell) ? keep({ ...s, cell: input.cell }) : keep(s);
    case "click":
      return v.inside(input.cell) ? confirm({ ...s, cell: input.cell }, v) : keep(s);
    case "confirm":
      return confirm(s, v);
    case "cancel":
      if (s.mode === "target")
        return keep({ ...s, mode: "selected", command: null, targetCell: null });
      if (s.mode === "selected") return keep(s.order ? { ...s, order: null } : idle(s));
      return keep(s);
    case "order":
      return order(s, input.order, v);
    case "next-unit": {
      if (!v.canOrder() || s.mode === "sent") return keep(s);
      const ready = v.ready();
      if (ready.length === 0) return keep(s);
      const after = s.unit === null ? -1 : ready.indexOf(s.unit);
      const next = ready[(after + 1) % ready.length]!;
      return keep(select(s, next, v));
    }
    case "sync":
      return keep(resync(s, v));
  }
}

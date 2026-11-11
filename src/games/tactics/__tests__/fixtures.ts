import { cellKey, type Cell } from "@jams/engine/game";

import {
  BOARD_COLS,
  BOARD_ROWS,
  STEP_COST,
  tacticsBoard,
  type Side,
  type TacticsBoard,
  type TacticsSnapshot,
  type UnitClasses,
  type UnitState,
} from "../types";

export const CLASSES: UnitClasses = {
  knight: { hp: 10, move: 3, range: [1, 1], attack: 4, sight: false },
  archer: { hp: 6, move: 2, range: [2, 3], attack: 3, sight: true },
  scout: { hp: 5, move: 5, range: [1, 1], attack: 2, sight: false },
};

export function board(walls: Cell[] = [], rough: [Cell, number][] = []): TacticsBoard {
  return tacticsBoard({
    cols: BOARD_COLS,
    rows: BOARD_ROWS,
    cell: 1,
    walls: walls.map(cellKey),
    costs: rough.map(([c, moves]) => [cellKey(c), moves * STEP_COST]),
  });
}

export const unit = (
  side: Side,
  cls: string,
  cell: Cell,
  over: Partial<UnitState> = {},
): UnitState => ({
  side,
  class: cls,
  hp: CLASSES[cls]!.hp,
  cell,
  moved: false,
  acted: false,
  ...over,
});

export const snapshot = (
  units: Record<string, UnitState>,
  over: Partial<TacticsSnapshot> = {},
): TacticsSnapshot => ({
  turn: 1,
  side: "blue",
  phase: "orders",
  units,
  result: null,
  ...over,
});

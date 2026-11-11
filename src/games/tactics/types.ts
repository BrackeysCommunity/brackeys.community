import {
  cellKey,
  createDataSystem,
  defineEntityType,
  gridGeometry,
  pointField,
  shapeField,
  type Cell,
  type CellBounds,
  type CellKey,
  type EntityOf,
  type GridGeometry,
} from "@jams/engine/game";
import { z } from "zod";

export const TACTICS_SIDES = ["blue", "red"] as const;
export type Side = (typeof TACTICS_SIDES)[number];

/** The board's size in cells. */
export const BOARD_COLS = 12;
export const BOARD_ROWS = 8;

/** Square cells one metre across; the game draws 48 px per metre. */
export const TACTICS_GRID: GridGeometry["settings"] = { kind: "square", cell: [1, 1] };

/** What one edge step costs on the grid toolkit's scale: a unit's `move` is in these steps. */
export const STEP_COST = 10;

export type UnitState = {
  side: Side;
  /** A row id of the `unit-class` table. */
  class: string;
  hp: number;
  cell: Cell;
  moved: boolean;
  acted: boolean;
};

export type TacticsSnapshot = {
  turn: number;
  side: Side;
  phase: "orders" | "moving" | "enemy" | "over";
  /** Living units by entity id; a unit that falls leaves the record. */
  units: Readonly<Record<string, UnitState>>;
  result: "won" | "lost" | null;
};

export type TacticsGridData = {
  cols: number;
  rows: number;
  /** Cell size, m. */
  cell: number;
  walls: readonly CellKey[];
  /** Extra grid cost to enter each rough cell, on the `STEP_COST` scale. */
  costs: readonly [CellKey, number][];
};

/** The HUD's view: the snapshot plus the grid as data, so the HUD computes reach and fog with the pure grid toolkit. */
export type TacticsSlice = TacticsSnapshot & {
  grid: TacticsGridData;
  classes: Readonly<
    Record<string, { hp: number; move: number; range: [number, number]; sight: boolean }>
  >;
  /** The last 20 lines. */
  log: readonly string[];
};

// ─── Unit classes ────────────────────────────────────────

/** One row of the `unit-class` data table. */
export const UNIT_CLASS_ROW = {
  hp: z.number().int().min(1).max(99).describe("Hit points a unit of the class starts with."),
  move: z.number().int().min(0).max(12).describe("Cells it may walk per turn; rough costs more."),
  range: z
    .tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(12)])
    .describe("Nearest and farthest cells it attacks at, by grid distance."),
  attack: z.number().int().min(1).max(99).describe("Damage per hit; a crit doubles it."),
  sight: z.boolean().describe("Whether its attacks need a clear line of sight, walls blocking it."),
};

export type UnitClass = z.infer<z.ZodObject<typeof UNIT_CLASS_ROW>>;
export type UnitClasses = Readonly<Record<string, UnitClass>>;

// ─── Entity types ────────────────────────────────────────

const unitFields = {
  at: pointField("The cell it starts on, by its centre. Absolute world metres; y is down."),
  side: z.enum(TACTICS_SIDES).describe("Which side it fights for: blue is the player's.").meta({
    title: "Side",
  }),
  class: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,47}$/)
    .describe("A row id of the unit-class table: its hit points, move, range and attack.")
    .meta({ title: "Class" }),
};

const roughFields = {
  shape: shapeField(
    "The cells it covers: every cell whose centre the shape holds. Absolute world metres; y is down.",
  ),
  cost: z
    .number()
    .int()
    .min(1)
    .max(9)
    .describe("Extra cells of move a unit spends to enter one of its cells.")
    .meta({ title: "Move cost" }),
};

export type UnitEntity = EntityOf<typeof UNIT_TYPE>;
export type RoughEntity = EntityOf<typeof ROUGH_TYPE>;

export const UNIT_TYPE = defineEntityType({
  type: "unit",
  description: "A piece on the board: one side's unit of a class from the unit-class table.",
  base: "marker",
  fields: unitFields,
  behaviors: { required: { occupant: {} } },
  style: { stroke: 0x88aaff },
  ascii: "u",
});

export const ROUGH_TYPE = defineEntityType({
  type: "rough",
  description: "Rough ground: passable, but entering its cells costs extra move.",
  fields: roughFields,
  system: createDataSystem,
  style: { fill: 0x667744, stroke: 0x99aa66, alpha: 0.4 },
  ascii: "~",
});

// ─── The board ───────────────────────────────────────────

/** The grid as the rules read it: geometry, bounds, walls and rough costs. */
export type TacticsBoard = {
  readonly geometry: GridGeometry;
  readonly bounds: CellBounds;
  readonly walls: ReadonlySet<CellKey>;
  readonly costs: ReadonlyMap<CellKey, number>;
};

export function tacticsBoard(grid: TacticsGridData): TacticsBoard {
  return {
    geometry: gridGeometry({ kind: "square", cell: [grid.cell, grid.cell] }),
    bounds: { c0: 0, r0: 0, c1: grid.cols - 1, r1: grid.rows - 1 },
    walls: new Set(grid.walls),
    costs: new Map(grid.costs),
  };
}

/** The canonical cell order every tie falls back to. */
export const byCell = (a: Cell, b: Cell): number => cellKey(a) - cellKey(b);

import type { ExpandedScene } from "@jams/engine";
import {
  boundsCells,
  cellKey,
  createGridStepper,
  sameCell,
  spawnPose,
  type Cell,
  type CellKey,
  type EngineContext,
  type GameCommand,
  type GameRuntime,
  type GridStepper,
} from "@jams/engine/game";
import { z } from "zod";

import { nextEnemyUnit, enemyOrders } from "./ai";
import { parseTacticsCommand, type TacticsCommand } from "./commands";
import { applyCommand, reachField } from "./rules";
import {
  STEP_COST,
  tacticsBoard,
  UNIT_CLASS_ROW,
  type RoughEntity,
  type TacticsBoard,
  type TacticsGridData,
  type TacticsSlice,
  type TacticsSnapshot,
  type UnitClass,
  type UnitClasses,
  type UnitEntity,
  type UnitState,
} from "./types";

/** The `unit-class` table's name in the project's data tables. */
export const UNIT_CLASS_TABLE = "unit-class";

/** What the game adds to the project's game-settings doc. */
export const TACTICS_SETTINGS = {
  aiStepTicks: z
    .number()
    .int()
    .min(1)
    .max(120)
    .default(20)
    .describe("Ticks between one computer unit's orders and the next one's."),
  critChance: z
    .number()
    .min(0)
    .max(1)
    .default(0.1)
    .describe("The chance a strike is a crit, doubling its damage."),
};

const settingsSchema = z.object(TACTICS_SETTINGS);
const classSchema = z.object(UNIT_CLASS_ROW);

/** Ticks a unit takes to walk one cell. */
export const WALK_TICKS = 8;

/** The most log lines the HUD's slice keeps. */
const LOG_LINES = 20;

/** Raised for a command the rules refuse; `data` is the command. */
export const TACTICS_REFUSED = "tactics:refused";
/** Raised for each strike: `entityId` the target, `other` the striker, `data` the damage and crit. */
export const TACTICS_HIT = "tactics:hit";
/** Raised when a unit falls; `entityId` the unit. */
export const TACTICS_FELL = "tactics:fell";
/** Raised when the turn passes; `data` the side to act and the turn number. */
export const TACTICS_TURN = "tactics:turn";

/**
 * What the runtime reports each tick: the rules' snapshot plus the board and
 * the class table the run loaded, so `play.commands` can list legal orders
 * from the snapshot alone.
 */
export type TacticsRunSnapshot = TacticsSnapshot & {
  grid: TacticsGridData;
  classes: UnitClasses;
};

type Walk = { unit: string; stepper: GridStepper; path: Cell[]; resume: TacticsSnapshot["phase"] };

const EMPTY_GRID: TacticsGridData = { cols: 0, rows: 0, cell: 1, walls: [], costs: [] };

const INITIAL: TacticsSnapshot = {
  turn: 1,
  side: "blue",
  phase: "orders",
  units: {},
  result: null,
};

/** The class table from the project's rows; a row that doesn't fit the class row schema is left out. */
function readClasses(ctx: EngineContext): UnitClasses {
  const out: Record<string, UnitClass> = {};
  for (const row of ctx.project?.table(UNIT_CLASS_TABLE) ?? []) {
    const parsed = classSchema.safeParse(row);
    if (parsed.success) out[row.id] = parsed.data;
  }
  return out;
}

/** The loaded grid as data: its walls, and each rough cell's extra cost (the dearest rough area over it). */
function readGrid(ctx: EngineContext, scene: ExpandedScene): TacticsGridData {
  const grid = ctx.grid;
  if (!grid) return EMPTY_GRID;
  const { c0, r0, c1, r1 } = grid.bounds;
  const walls: CellKey[] = boundsCells(grid.bounds)
    .filter((c) => grid.occupancy.wall(c))
    .map(cellKey);
  const costs = new Map<CellKey, number>();
  for (const e of scene.entities) {
    if (e.type !== "rough") continue;
    const rough = e as RoughEntity;
    for (const cell of grid.geometry.cellsIn(rough.shape)) {
      const k = cellKey(cell);
      costs.set(k, Math.max(costs.get(k) ?? 0, rough.cost * STEP_COST));
    }
  }
  return {
    cols: c1 - c0 + 1,
    rows: r1 - r0 + 1,
    cell: grid.geometry.settings.cell[0],
    walls: walls.sort((a, b) => a - b),
    costs: [...costs].sort(([a], [b]) => a - b),
  };
}

const describe = (c: GameCommand) =>
  c.args === undefined ? c.name : `${c.name} ${JSON.stringify(c.args)}`;

/**
 * The skirmish's runtime. Orders arrive as commands and go through the
 * rules; a move lands in the snapshot at once and is then walked one cell
 * per `WALK_TICKS` ticks, the unit's pose written by a grid stepper so its
 * `occupant` behavior follows it. After `end-turn` the red side plays: one
 * unit's orders every `aiStepTicks` ticks, each walk finished before the
 * next order. The run stays busy while either goes on.
 */
export function createTacticsRuntime(ctx: EngineContext): GameRuntime<TacticsRunSnapshot> {
  let state: TacticsSnapshot = INITIAL;
  let grid: TacticsGridData = EMPTY_GRID;
  let board: TacticsBoard = tacticsBoard(EMPTY_GRID);
  let classes: UnitClasses = {};
  let log: string[] = [];
  let walk: Walk | null = null;
  let pending: TacticsCommand[] = [];
  let aiWait = 0;
  let slice: TacticsSlice | null = null;

  const settings = () => settingsSchema.parse(ctx.project?.settings ?? {});
  const changed = () => void (slice = null);

  function note(...lines: string[]): void {
    if (lines.length === 0) return;
    log = [...log, ...lines].slice(-LOG_LINES);
    changed();
  }

  const centre = (cell: Cell) => {
    const [x, y] = board.geometry.center(cell);
    return { x, y };
  };

  function refuse(c: GameCommand, why: string): void {
    note(`refused ${describe(c)}: ${why}`);
    const at = centre([0, 0]);
    ctx.emit({ type: TACTICS_REFUSED, at, data: { name: c.name, args: c.args ?? null, why } });
    if (ctx.dev) console.warn(`[tactics] refused ${describe(c)}: ${why}`);
  }

  /** The cells a move walks, the unit's own excluded, along its reach field from `before`. */
  function walkPath(before: TacticsSnapshot, unitId: string, to: Cell): Cell[] {
    const field = reachField(before, unitId, classes, board);
    const from = before.units[unitId]?.cell;
    if (!field || !from) return [];
    const back: Cell[] = [];
    for (let c: Cell | undefined = to; c && !sameCell(c, from); c = field.next(c)) back.push(c);
    return back.reverse();
  }

  function startWalk(unitId: string, from: Cell, path: Cell[]): void {
    const resume = state.phase;
    if (path.length === 0 || !ctx.grid) return;
    const msPerStep = (WALK_TICKS * 1000) / ctx.time.rate;
    const stepper = createGridStepper(ctx, unitId, { start: from, msPerStep });
    walk = { unit: unitId, stepper, path, resume };
    state = { ...state, phase: "moving" };
    changed();
    stepWalk(walk);
  }

  /** Starts the walk's next cell; ends the walk when none is left or the grid refuses the step. */
  function stepWalk(w: Walk): void {
    const next = w.path.shift();
    if (next && w.stepper.step(next)) return;
    if (next) {
      const last = w.path.at(-1) ?? next;
      const { x, y } = centre(last);
      ctx.poses.set(w.unit, x, y, undefined, { snap: true });
    }
    walk = null;
    state = { ...state, phase: w.resume };
    changed();
  }

  function advanceWalk(dtMs: number): void {
    if (!walk) return;
    walk.stepper.update(dtMs);
    if (!walk.stepper.moving()) stepWalk(walk);
  }

  /** Applies one command through the rules; false when they refuse it. */
  function apply(command: TacticsCommand): boolean {
    const before = state;
    const applied = applyCommand(
      before,
      command,
      classes,
      board,
      ctx.random,
      settings().critChance,
    );
    if (!applied) return false;
    state = applied.snapshot;
    changed();
    note(...applied.log);
    if (command.name === "move") {
      const from = before.units[command.args.unit]!.cell;
      startWalk(command.args.unit, from, walkPath(before, command.args.unit, command.args.to));
    } else if (command.name === "attack") {
      const { unit, target } = command.args;
      const struck = before.units[target]!;
      const left = state.units[target];
      const damage = struck.hp - (left?.hp ?? 0);
      ctx.emit({
        type: TACTICS_HIT,
        entityId: target,
        other: unit,
        at: centre(struck.cell),
        data: { damage, crit: applied.log.some((l) => l.endsWith("(crit)")) },
      });
      if (!left) {
        ctx.emit({ type: TACTICS_FELL, entityId: target, at: centre(struck.cell) });
        ctx.destroy(target);
      }
    } else if (command.name === "end-turn") {
      ctx.emit({
        type: TACTICS_TURN,
        at: centre([0, 0]),
        data: { side: state.side, turn: state.turn },
      });
      aiWait = settings().aiStepTicks;
      pending = [];
    }
    return true;
  }

  /** One tick of the red side: the rest of the current unit's orders, else the next unit after the wait, else `end-turn`. */
  function enemyTick(): void {
    if (walk || state.result !== null || state.side !== "red" || state.phase !== "enemy") return;
    const queued = pending.shift();
    if (queued) {
      if (!apply(queued)) pending = [];
      return;
    }
    if (aiWait > 0) {
      aiWait--;
      return;
    }
    aiWait = settings().aiStepTicks - 1;
    const id = nextEnemyUnit(state);
    if (id === null) {
      apply({ name: "end-turn" });
      return;
    }
    const orders = enemyOrders(state, id, classes, board, ctx.random);
    const first = orders.shift();
    pending = orders;
    // A unit the AI can give no order still has to finish, or the turn never ends.
    if (!first || !apply(first)) apply({ name: "wait", args: { unit: id } });
  }

  function load(scene: ExpandedScene): void {
    grid = readGrid(ctx, scene);
    board = tacticsBoard(grid);
    classes = readClasses(ctx);
    const units: Record<string, UnitState> = {};
    for (const e of scene.entities) {
      if (e.type !== "unit") continue;
      const unit = e as UnitEntity;
      const pose = spawnPose(e, ctx.registry);
      const cls = classes[unit.class];
      if (!cls) note(`${e.id}: no unit class "${unit.class}"`);
      units[e.id] = {
        side: unit.side,
        class: unit.class,
        hp: cls?.hp ?? 1,
        cell: board.geometry.cellAt([pose.x, pose.y]),
        moved: false,
        acted: false,
      };
    }
    const sides = new Set(Object.values(units).map((u) => u.side));
    const result =
      sides.size === 0 ? null : !sides.has("red") ? "won" : !sides.has("blue") ? "lost" : null;
    state = { ...INITIAL, units, result, phase: result === null ? "orders" : "over" };
    changed();
  }

  function reset(): void {
    state = INITIAL;
    grid = EMPTY_GRID;
    board = tacticsBoard(EMPTY_GRID);
    classes = {};
    log = [];
    walk = null;
    pending = [];
    aiWait = 0;
    changed();
  }

  return {
    onLoad: load,
    onUnload: reset,
    beforeStep(dtMs, _actions, commands) {
      advanceWalk(dtMs);
      for (const c of commands) {
        const command = parseTacticsCommand(c);
        if (!command) refuse(c, "not a tactics command, or its args don't fit");
        else if (state.side !== "blue") refuse(c, "the red side is acting");
        else if (!apply(command)) refuse(c, "not legal now");
      }
      enemyTick();
    },
    busy: () =>
      walk !== null ||
      pending.length > 0 ||
      (state.result === null && state.side === "red" && state.phase === "enemy"),
    snapshot: () => ({ ...state, grid, classes }),
    cameraTarget: () =>
      grid.cols === 0 ? null : { x: (grid.cols * grid.cell) / 2, y: (grid.rows * grid.cell) / 2 },
    storeSlice() {
      slice ??= {
        ...state,
        grid,
        classes: Object.fromEntries(
          Object.entries(classes).map(([id, c]) => [
            id,
            { hp: c.hp, move: c.move, range: c.range, sight: c.sight },
          ]),
        ),
        log,
      };
      return slice;
    },
    destroy: reset,
  };
}

import type { ExpandedScene, RuntimeEntity } from "@jams/engine";
import {
  boundsCells,
  cellKey,
  createGridStepper,
  defineEntityType,
  inCellBounds,
  OCCUPANT,
  ID_PATTERN,
  pointField,
  sameCell,
  spawnPose,
  vectorField,
  type Cell,
  type CellKey,
  type CommandDef,
  type EngineContext,
  type EntityOf,
  type GameCommand,
  type GameRuntime,
  type GridStepper,
  type PlayWorld,
  type ProjectRuntimeView,
  type RuntimeGrid,
  type SceneSwap,
  type TransitionSpec,
} from "@jams/engine/game";
import { z } from "zod";

import { nextEnemyUnit, enemyOrders } from "./ai";
import { parseTacticsCommand, type TacticsCommand } from "./commands";
import { applyCommand, isLegal, occupancy, reachField, resultOf } from "./rules";
import {
  ROUGH_TYPE,
  STEP_COST,
  TACTICS_SIDES,
  tacticsBoard,
  UNIT_CLASS_ROW,
  UNIT_TYPE,
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

/** Raised when a unit steps on a stair and its sublevel attaches: `entityId` the stair, `other` the unit, `data` the sublevel. */
export const TACTICS_OPENED = "tactics:opened";

// ─── Flow ────────────────────────────────────────────────

/** The title scene, with Start. */
export const MENU_SCENE = "menu";
/** Where a level's end goes: won or lost, turns taken, back to the menu. */
export const RESULT_SCENE = "result";
/** The levels in play order; Start goes to the first one not cleared yet. */
export const TACTICS_LEVELS = ["level-1", "level-2"] as const;

/** Every scene change the game asks for fades out and back in. */
export const TACTICS_FADE: TransitionSpec = { kind: "fade", ms: 400 };

/** The commands the menu and result scenes take; a level refuses them. */
export const TACTICS_FLOW_COMMANDS = {
  start: {
    description:
      "On the menu: play the first level not cleared yet, or level 1 afresh once every level is cleared.",
  },
  menu: { description: "On the result scene: go back to the menu." },
} as const satisfies Readonly<Record<string, CommandDef>>;

/** The game's persistent state: what outlives every scene change. */
export const TACTICS_PROGRESS = z.strictObject({
  cleared: z.array(z.string()).describe("The levels won, in the order they were first won."),
  roster: z.array(z.string()).describe("The blue units standing at the end of the last level won."),
  last: z
    .strictObject({
      level: z.string(),
      result: z.enum(["won", "lost"]),
      turns: z.number().int().min(1),
    })
    .nullable()
    .describe("How the last level played ended, for the result scene; null before any."),
});
export type TacticsProgress = z.infer<typeof TACTICS_PROGRESS>;

export const initialProgress = (): TacticsProgress => ({ cleared: [], roster: [], last: null });

/** What a loaded scene is to the game: a board to fight on, or one of the two screens around the levels. */
export type TacticsScreen = "level" | "menu" | "result";

const screenOf = (scene: string): TacticsScreen =>
  scene === MENU_SCENE ? "menu" : scene === RESULT_SCENE ? "result" : "level";

/** The first level `progress` hasn't cleared, or null once all are. */
export function nextLevel(progress: TacticsProgress): (typeof TACTICS_LEVELS)[number] | null {
  return TACTICS_LEVELS.find((l) => !progress.cleared.includes(l)) ?? null;
}

// ─── Stairs ──────────────────────────────────────────────

export const STAIR_TYPE = defineEntityType({
  type: "stair",
  description:
    "A stair cell: the first unit to step on it attaches a listed sublevel beside the board, its units joining the fight.",
  base: "marker",
  fields: {
    at: pointField("The stair's cell, by its centre. Absolute world metres; y is down."),
    sublevel: z
      .string()
      .regex(ID_PATTERN)
      .describe("The listed sublevel scene it opens, attached under its own id as the label.")
      .meta({ title: "Sublevel" }),
    offset: vectorField(
      "Where the sublevel's origin lands, world metres: a whole number of cells, so its cells fall on the board's.",
    ).meta({ title: "Offset" }),
  },
  style: { stroke: 0xffd75e },
  ascii: ">",
});
export type StairEntity = EntityOf<typeof STAIR_TYPE>;

type Stair = { id: string; cell: Cell; sublevel: string; offset: [number, number] };

/**
 * What the runtime reports each tick: the rules' snapshot and where the run
 * is. The board and the class table are the world's and the project's, read
 * with `worldBoard`, not carried here. A level's snapshot carries `screen`
 * and `next` only when they apply.
 */
export type TacticsRunSnapshot = TacticsSnapshot & {
  /** Set on the menu and result scenes; absent on a level. */
  screen?: Exclude<TacticsScreen, "level">;
  /** The scene this scene asked for once it ended; absent until then. */
  next?: string;
  /** The walk under way; absent when no unit walks. */
  walk?: TacticsWalk;
  /** The red side's orders in hand while it acts; absent on blue's turn and once the level ends. */
  ai?: { wait: number; pending: TacticsCommand[] };
};

/** A walk between ticks: the step it is on and the cells after it. */
export type TacticsWalk = {
  unit: string;
  /** The cell the current step left and the one it walks into. */
  from: Cell;
  on: Cell;
  /** Ticks of the current step done, fewer than `WALK_TICKS`. */
  done: number;
  path: Cell[];
  resume: TacticsSnapshot["phase"];
};

/** The slot the game autosaves to at each turn start. */
export const TACTICS_AUTOSAVE_SLOT = "auto";

/** A save's title, from either the autosave or the HUD's Save; the menu puts the level's title before it. */
export const turnSaveTitle = (turn: number) => `Turn ${turn}`;

const cellSchema = z.tuple([z.number().int(), z.number().int()]);
const phaseSchema = z.enum(["orders", "moving", "enemy", "over"]);

/** What `restore` takes: `snapshot()` output, checked before any of it is put back. */
const runSnapshotSchema = z.object({
  turn: z.number().int().min(1),
  side: z.enum(TACTICS_SIDES),
  phase: phaseSchema,
  units: z.record(
    z.string(),
    z.object({
      side: z.enum(TACTICS_SIDES),
      class: z.string(),
      hp: z.number().int(),
      cell: cellSchema,
      moved: z.boolean(),
      acted: z.boolean(),
    }),
  ),
  result: z.enum(["won", "lost"]).nullable(),
  screen: z.enum(["menu", "result"]).optional(),
  next: z.string().optional(),
  walk: z
    .object({
      unit: z.string(),
      from: cellSchema,
      on: cellSchema,
      done: z
        .number()
        .int()
        .min(0)
        .max(WALK_TICKS - 1),
      path: z.array(cellSchema),
      resume: phaseSchema,
    })
    .optional(),
  ai: z
    .object({
      wait: z.number().int().min(0),
      pending: z.array(z.object({ name: z.string(), args: z.unknown().optional() })),
    })
    .optional(),
});

/** The HUD's and the menu's view: the slice plus where the game is in its flow. */
export type TacticsFlowSlice = TacticsSlice & {
  flow?: {
    screen: TacticsScreen;
    /** The loaded scene's id; null for a scene loaded on its own. */
    scene: string | null;
    progress: TacticsProgress;
    /** Stair cells whose sublevel hasn't opened yet. */
    stairs: readonly Cell[];
    /** Set once this scene asked for the next one. */
    next: string | null;
  };
};

type Walk = {
  unit: string;
  stepper: GridStepper;
  path: Cell[];
  resume: TacticsSnapshot["phase"];
  /** The cell the stepper is walking into; null before the first step. */
  on: Cell | null;
  /** The cell the current step left. */
  from: Cell;
  /** Ticks of the current step done. */
  done: number;
};

const EMPTY_GRID: TacticsGridData = { cols: 0, rows: 0, cell: 1, walls: [], costs: [] };

const INITIAL: TacticsSnapshot = {
  turn: 1,
  side: "blue",
  phase: "orders",
  units: {},
  result: null,
};

/** The class table from the project's rows; a row that doesn't fit the class row schema is left out. */
export function unitClasses(project: ProjectRuntimeView | null | undefined): UnitClasses {
  const out: Record<string, UnitClass> = {};
  for (const row of project?.table(UNIT_CLASS_TABLE) ?? []) {
    const parsed = classSchema.safeParse(row);
    if (parsed.success) out[row.id] = parsed.data;
  }
  return out;
}

/** The loaded grid as data: its walls, and each rough cell's extra cost (the dearest rough area over it). */
export function boardData(
  grid: RuntimeGrid | null | undefined,
  roughs: Iterable<RoughEntity>,
): TacticsGridData {
  if (!grid) return EMPTY_GRID;
  const { c0, r0, c1, r1 } = grid.bounds;
  const walls: CellKey[] = boundsCells(grid.bounds)
    .filter((c) => grid.occupancy.wall(c))
    .map(cellKey);
  const costs = new Map<CellKey, number>();
  for (const rough of roughs) {
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

const isRough = (e: RuntimeEntity | undefined): e is RoughEntity => e?.type === ROUGH_TYPE.type;

/** The board and class table a run's world holds now, as `play.commands` reads them. */
export function worldBoard(world: PlayWorld): { grid: TacticsGridData; classes: UnitClasses } {
  const roughs = (world.select?.({ type: ROUGH_TYPE.type }) ?? [])
    .map((id) => world.get?.(id))
    .filter(isRough);
  return { grid: boardData(world.grid, roughs), classes: unitClasses(world.project) };
}

/** `record` with `order`'s keys first, in that order, then the rest sorted. */
function inOrder<T>(
  record: Readonly<Record<string, T>>,
  order: readonly string[],
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of order) if (Object.hasOwn(record, k)) out[k] = record[k]!;
  for (const k of Object.keys(record).sort()) if (!Object.hasOwn(out, k)) out[k] = record[k]!;
  return out;
}

const isEmptyArgs = (v: unknown) =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;

const describe = (c: GameCommand) =>
  c.args === undefined ? c.name : `${c.name} ${JSON.stringify(c.args)}`;

/**
 * The skirmish's runtime. Orders arrive as commands and go through the
 * rules; a move lands in the snapshot at once and is then walked one cell
 * per `WALK_TICKS` ticks, the unit's pose written by a grid stepper so its
 * `occupant` behavior follows it. After `end-turn` the red side plays: one
 * unit's orders every `aiStepTicks` ticks, each walk finished before the
 * next order. The run stays busy while either goes on.
 *
 * Around the levels: the menu's `start` asks for the next level, a listed
 * level that ends asks for the result scene with the progress updated, and
 * the result's `menu` goes back; each request fades. A level loaded on its
 * own (no scene list) asks for nothing, so its run ends won or lost. The
 * first unit to step on a stair attaches the stair's sublevel, whose units
 * join the fight and whose walls and rough ground join the board.
 *
 * Saves: a listed level asks for a world save to `TACTICS_AUTOSAVE_SLOT`
 * as each of blue's turns starts, and `restore` rebuilds the run from
 * `snapshot()` output, a walk or the red side's orders under way included.
 *
 * Live levels: the end of a full round (red handing the turn back) is a
 * `ctx.live.boundary()`. After a swap, `onSwap` rebuilds the board, puts
 * each unit on the cell its pose stands on, and drops the orders that a new
 * wall, a new unit or a removed cell made impossible.
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
  let screen: TacticsScreen = "level";
  let stairs: Stair[] = [];
  let next: string | null = null;
  let boardStale = false;
  let autosaved: number | null = null;
  let slice: TacticsFlowSlice | null = null;

  const settings = () => settingsSchema.parse(ctx.project?.settings ?? {});
  const changed = () => void (slice = null);
  const progress = (): TacticsProgress => {
    const parsed = TACTICS_PROGRESS.safeParse(ctx.persist.value);
    return parsed.success ? parsed.data : initialProgress();
  };

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
    walk = { unit: unitId, stepper, path, resume, on: null, from, done: 0 };
    state = { ...state, phase: "moving" };
    changed();
    stepWalk(walk);
  }

  /** Starts the walk's next cell; ends the walk when none is left or the grid refuses the step, on the cell it reached. */
  function stepWalk(w: Walk): void {
    if (w.on) arrive(w.unit, w.on);
    const step = w.path.shift();
    const from = w.stepper.cell();
    if (step && w.stepper.step(step)) {
      w.from = [from[0], from[1]];
      w.on = step;
      w.done = 0;
      return;
    }
    if (step) {
      // The grid refused the next cell (a wall or a unit took it): the walk ends where the unit stands.
      const { x, y } = centre(from);
      ctx.poses.set(w.unit, x, y, undefined, { snap: true });
      const unit = state.units[w.unit];
      if (unit && !sameCell(unit.cell, from))
        state = {
          ...state,
          units: { ...state.units, [w.unit]: { ...unit, cell: [from[0], from[1]] } },
        };
    }
    walk = null;
    state = { ...state, phase: w.resume };
    changed();
  }

  /** A unit is on `cell`: a stair there opens its sublevel, once. */
  function arrive(unitId: string, cell: Cell): void {
    const at = stairs.findIndex((s) => sameCell(s.cell, cell));
    if (at < 0) return;
    const [stair] = stairs.splice(at, 1);
    changed();
    const opened = ctx.flow.attach(stair!.sublevel, { label: stair!.sublevel, at: stair!.offset });
    if (!opened.ok) {
      note(`${stair!.id} stays shut: ${opened.issue.message}`);
      if (ctx.dev) console.warn(`[tactics] ${stair!.id} stays shut: ${opened.issue.message}`);
      return;
    }
    const units: Record<string, UnitState> = {};
    for (const id of opened.entities) {
      const e = ctx.get(id);
      if (e?.type === UNIT_TYPE.type) units[id] = unitState(e as UnitEntity);
    }
    // The grid walls the sublevel's solids at the tick's destroy flush; the board catches up after it.
    boardStale = true;
    state = { ...state, units: { ...state.units, ...units } };
    note(`${unitId} opens the ${stair!.sublevel}`);
    ctx.emit({
      type: TACTICS_OPENED,
      entityId: stair!.id,
      other: unitId,
      at: centre(stair!.cell),
      data: { sublevel: stair!.sublevel, units: Object.keys(units).sort() },
    });
  }

  function freshBoard(): void {
    if (!boardStale) return;
    boardStale = false;
    grid = boardData(ctx.grid, liveRoughs());
    board = tacticsBoard(grid);
    changed();
  }

  function liveRoughs(): RoughEntity[] {
    return ctx.query
      .select({ type: ROUGH_TYPE.type })
      .map((id) => ctx.get(id))
      .filter(isRough);
  }

  function unitState(unit: UnitEntity): UnitState {
    const pose = spawnPose(unit, ctx.registry);
    const cls = classes[unit.class];
    if (!cls) note(`${unit.id}: no unit class "${unit.class}"`);
    return {
      side: unit.side,
      class: unit.class,
      hp: cls?.hp ?? 1,
      cell: board.geometry.cellAt([pose.x, pose.y]),
      moved: false,
      acted: false,
    };
  }

  function request(to: string, persist?: TacticsProgress): void {
    ctx.flow.request({ to, transition: TACTICS_FADE, ...(persist ? { persist } : {}) });
    next = to;
    changed();
  }

  /** Whether a listed level has ended and not yet asked for the result scene. */
  const endPending = () =>
    screen === "level" && state.result !== null && next === null && ctx.flow.scene !== null;

  /** A listed level that has ended asks for the result scene, with the progress it made. */
  function finishLevel(): void {
    const level = ctx.flow.scene;
    if (!endPending() || level === null || state.result === null) return;
    const p = progress();
    const won = state.result === "won";
    const standing = Object.keys(state.units)
      .filter((id) => state.units[id]!.side === "blue")
      .sort();
    request(RESULT_SCENE, {
      cleared: won && !p.cleared.includes(level) ? [...p.cleared, level] : p.cleared,
      roster: won ? standing : p.roster,
      last: { level, result: state.result, turns: state.turn },
    });
  }

  /** The menu's and the result scene's one command each. */
  function screenCommand(c: GameCommand): void {
    const want = screen === "menu" ? "start" : "menu";
    if (c.name !== want || (c.args !== undefined && !isEmptyArgs(c.args)))
      return refuse(c, `the ${screen} scene takes only ${want}`);
    if (next !== null) return refuse(c, `already going to ${next}`);
    if (screen === "result") return request(MENU_SCENE);
    const level = nextLevel(progress());
    if (level) request(level);
    else request(TACTICS_LEVELS[0], initialProgress());
  }

  function advanceWalk(dtMs: number): void {
    if (!walk) return;
    walk.stepper.update(dtMs);
    walk.done += Math.round((dtMs * ctx.time.rate) / 1000);
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
      if (state.side === "blue") ctx.live.boundary(`round ${before.turn}`);
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

  function stairOf(stair: StairEntity): Stair {
    const pose = spawnPose(stair, ctx.registry);
    return {
      id: stair.id,
      cell: board.geometry.cellAt([pose.x, pose.y]),
      sublevel: stair.sublevel,
      offset: [stair.offset[0], stair.offset[1]],
    };
  }

  function load(scene: ExpandedScene): void {
    screen = screenOf(ctx.flow.scene ?? scene.name);
    next = null;
    boardStale = false;
    grid = boardData(
      ctx.grid,
      scene.entities.filter((e): e is RoughEntity => e.type === ROUGH_TYPE.type),
    );
    board = tacticsBoard(grid);
    classes = unitClasses(ctx.project);
    const units: Record<string, UnitState> = {};
    stairs = [];
    for (const e of scene.entities) {
      if (e.type === UNIT_TYPE.type) units[e.id] = unitState(e as UnitEntity);
      else if (e.type === STAIR_TYPE.type) stairs.push(stairOf(e as StairEntity));
    }
    const result = resultOf(units);
    state = { ...INITIAL, units, result, phase: result === null ? "orders" : "over" };
    autosaved = null;
    changed();
  }

  /**
   * A listed level autosaves once a turn, as blue's turn starts: at the tick
   * that starts it, or the first tick for turn 1. The host captures a request
   * after its tick, so a first tick that already carries orders skips turn 1's.
   */
  function autosave(ordered = false): void {
    if (screen !== "level" || ctx.flow.scene === null) return;
    if (state.result !== null || state.side !== "blue" || autosaved === state.turn) return;
    autosaved = state.turn;
    if (ordered) return;
    ctx.saves.request(TACTICS_AUTOSAVE_SLOT, { depth: "world", title: turnSaveTitle(state.turn) });
  }

  /** Whether the loaded world holds `s`'s units, each standing on its cell (the walker anywhere). */
  function worldHolds(s: TacticsRunSnapshot): boolean {
    const live = [...ctx.query.select({ type: UNIT_TYPE.type })].sort();
    const saved = Object.keys(s.units).sort();
    if (live.length !== saved.length || live.some((id, i) => id !== saved[i])) return false;
    return saved.every((id) => {
      if (id === s.walk?.unit) return true;
      const pose = ctx.poses.get(id);
      return (
        pose !== undefined && sameCell(board.geometry.cellAt([pose.x, pose.y]), s.units[id]!.cell)
      );
    });
  }

  /**
   * Puts the walk back mid-step: a stepper from the step's first cell, the
   * step taken and advanced by the ticks it had done. The walker stands on
   * that first cell while the step is taken, since its own cell would refuse
   * it, and back where it stood after.
   */
  function resumeWalk(w: TacticsWalk): void {
    const occupancy = ctx.grid?.occupancy;
    const held = occupancy?.cellOf(w.unit);
    const blocks = ctx.get(w.unit)?.behaviors?.[OCCUPANT.name]?.blocks !== false;
    if (held) occupancy!.place(w.unit, w.from, { blocks });
    const msPerStep = (WALK_TICKS * 1000) / ctx.time.rate;
    const stepper = createGridStepper(ctx, w.unit, { start: w.from, msPerStep });
    if (!stepper.step(w.on))
      throw new Error(`${w.unit} can't walk from ${w.from.join(",")} to ${w.on.join(",")}`);
    if (w.done > 0) stepper.update((w.done * 1000) / ctx.time.rate);
    if (held) occupancy!.place(w.unit, held, { blocks });
    walk = {
      unit: w.unit,
      stepper,
      path: w.path.map((c) => [c[0], c[1]]),
      resume: w.resume,
      on: [w.on[0], w.on[1]],
      from: [w.from[0], w.from[1]],
      done: w.done,
    };
  }

  /**
   * Rebuilds the run from `snapshot()` output over a world a save put back.
   * A save that kept no world (a progress save of a level) finds the level
   * as it loads, and the level starts again.
   */
  function restore(given: TacticsRunSnapshot): void {
    const parsed = runSnapshotSchema.safeParse(given);
    if (!parsed.success)
      throw new Error(`not a tactics snapshot: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    const s = parsed.data as TacticsRunSnapshot;
    const orders = (s.ai?.pending ?? []).map((c) => {
      const command = parseTacticsCommand(c);
      if (!command) throw new Error(`the red side's order ${describe(c)} isn't a tactics command`);
      return command;
    });
    walk = null;
    log = [];
    classes = unitClasses(ctx.project);
    boardStale = true;
    freshBoard();
    if (screen === "level" && !worldHolds(s)) {
      note("the save kept no board, so the level starts again");
      return;
    }
    // A save's text sorts its keys, and the rules walk units in record order: put back the run's own orders.
    const units = inOrder(s.units, ctx.query.select({ type: UNIT_TYPE.type }));
    state = { turn: s.turn, side: s.side, phase: s.phase, units, result: s.result };
    next = s.next ?? null;
    const open = new Set(ctx.flow.sublevels().map((l) => l.label));
    stairs = stairs.filter((st) => !open.has(st.sublevel));
    pending = orders;
    aiWait = s.ai?.wait ?? 0;
    autosaved = s.turn;
    if (s.walk) resumeWalk(s.walk);
    changed();
  }

  /**
   * The units after a swap, in their old order with new ones after: a unit
   * gone from the world is dropped, one new to it joins as it loads, a
   * changed one takes its side and class from its definition (its wounds
   * kept), and every unit not walking stands on the cell its pose is in.
   */
  function reindexUnits(swap: SceneSwap): Record<string, UnitState> {
    const changedIds = new Set(swap.diff.changed);
    const units: Record<string, UnitState> = {};
    const live = ctx.query.select({ type: UNIT_TYPE.type });
    const alive = new Set(live);
    for (const [id, was] of Object.entries(state.units)) {
      const e = ctx.get(id);
      if (!alive.has(id) || e?.type !== UNIT_TYPE.type) continue;
      let unit: UnitState = was;
      if (changedIds.has(id)) {
        const fresh = unitState(e as UnitEntity);
        unit = { ...was, side: fresh.side, class: fresh.class, hp: Math.min(was.hp, fresh.hp) };
      }
      const pose = ctx.poses.get(id);
      if (id !== walk?.unit && pose) {
        const cell = board.geometry.cellAt([pose.x, pose.y]);
        if (!sameCell(cell, unit.cell)) unit = { ...unit, cell };
      }
      units[id] = unit;
    }
    for (const id of live) {
      const e = ctx.get(id);
      if (!Object.hasOwn(units, id) && e) units[id] = unitState(e as UnitEntity);
    }
    return units;
  }

  /**
   * Cuts the walk under way short of the first cell it can no longer enter:
   * off the board, a wall, or another unit's. A step already walking into
   * such a cell goes back to the cell it left.
   */
  function cutWalk(): void {
    const w = walk;
    if (!w) return;
    const held = occupancy(state);
    const open = (c: Cell) => {
      if (!inCellBounds(board.bounds, c) || board.walls.has(cellKey(c))) return false;
      const holder = held.get(cellKey(c));
      return holder === undefined || holder === w.unit;
    };
    const unit = state.units[w.unit];
    const target = unit?.cell;
    if (w.on && !open(w.on)) {
      const { x, y } = centre(w.from);
      ctx.poses.set(w.unit, x, y, undefined, { snap: true });
      walk = null;
      state = { ...state, phase: w.resume };
      if (unit)
        state = { ...state, units: { ...state.units, [w.unit]: { ...unit, cell: w.from } } };
    } else {
      const blocked = w.path.findIndex((c) => !open(c));
      if (blocked < 0) return;
      w.path = w.path.slice(0, blocked);
      const end = w.path.at(-1) ?? w.on ?? w.from;
      if (unit)
        state = {
          ...state,
          units: { ...state.units, [w.unit]: { ...unit, cell: [end[0], end[1]] } },
        };
    }
    note(`${w.unit}'s move to ${target?.join(",") ?? "?"} is cut short: the way is gone`);
    pending = pending.filter((c) => c.name === "end-turn" || c.args.unit !== w.unit);
  }

  /** A new version of this scene is running: the board, the units, the stairs and the orders follow it. */
  function onSwap(swap: SceneSwap): void {
    if (screen !== "level") return;
    boardStale = true;
    freshBoard();
    state = { ...state, units: reindexUnits(swap) };
    cutWalk();
    const result = state.result ?? resultOf(state.units);
    if (result !== null) {
      state = { ...state, result, phase: "over" };
      if (walk) walk.resume = "over";
    }

    const fresh = new Set([...swap.diff.added, ...swap.diff.changed]);
    const kept = new Set(stairs.map((s) => s.id));
    const open = new Set(ctx.flow.sublevels().map((l) => l.label));
    stairs = ctx.query
      .select({ type: STAIR_TYPE.type })
      .map((id) => ctx.get(id) as StairEntity | undefined)
      .filter((e): e is StairEntity => e !== undefined)
      .filter((e) => (kept.has(e.id) || fresh.has(e.id)) && !open.has(e.sublevel))
      .map(stairOf);

    const before = pending.length;
    pending = pending.filter((c) => isLegal(state, c, classes, board));
    const dropped = before - pending.length;
    if (dropped > 0)
      note(`the new level drops ${dropped === 1 ? "a red order" : `${dropped} red orders`}`);
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
    screen = "level";
    stairs = [];
    next = null;
    boardStale = false;
    autosaved = null;
    changed();
  }

  return {
    onLoad: load,
    onUnload: reset,
    beforeStep(dtMs, _actions, commands) {
      autosave(commands.length > 0);
      freshBoard();
      advanceWalk(dtMs);
      for (const c of commands) {
        if (screen !== "level") {
          screenCommand(c);
          continue;
        }
        const command = parseTacticsCommand(c);
        if (!command) refuse(c, "not a tactics command, or its args don't fit");
        else if (state.side !== "blue") refuse(c, "the red side is acting");
        else if (!apply(command)) refuse(c, "not legal now");
      }
      enemyTick();
      finishLevel();
      autosave();
    },
    busy: () =>
      walk !== null ||
      pending.length > 0 ||
      (state.result === null && state.side === "red" && state.phase === "enemy") ||
      endPending(),
    snapshot() {
      freshBoard();
      return {
        ...state,
        ...(screen !== "level" ? { screen } : {}),
        ...(next !== null ? { next } : {}),
        ...(walk?.on
          ? {
              walk: {
                unit: walk.unit,
                from: [walk.from[0], walk.from[1]],
                on: [walk.on[0], walk.on[1]],
                done: walk.done,
                path: walk.path.map((c): Cell => [c[0], c[1]]),
                resume: walk.resume,
              },
            }
          : {}),
        ...(state.side === "red" && state.result === null
          ? { ai: { wait: aiWait, pending: structuredClone(pending) } }
          : {}),
      };
    },
    restore,
    onSwap,
    cameraTarget: () =>
      grid.cols === 0 ? null : { x: (grid.cols * grid.cell) / 2, y: (grid.rows * grid.cell) / 2 },
    storeSlice() {
      freshBoard();
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
        flow: {
          screen,
          scene: ctx.flow.scene,
          progress: progress(),
          stairs: stairs.map((s) => s.cell),
          next,
        },
      };
      return slice;
    },
    destroy: reset,
  };
}

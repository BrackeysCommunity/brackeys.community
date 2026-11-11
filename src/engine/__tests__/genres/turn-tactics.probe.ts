import { z } from "zod";

import { defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import { ticksFor } from "../../game/time";
import type { EngineContext } from "../../game/types";
import { fieldOfView } from "../../grid/fov";
import { cellKey, sameCell, type Cell } from "../../grid/geometry";
import { findPath } from "../../grid/path";
import { createGridStepper, type GridStepper } from "../../motion/grid-step";
import type { ExpandedScene, GridSettings, Pt, SceneDefinition } from "../../scene/types";
import type { Vec2 } from "../../types";
import type { GenreProbe } from "./harness";

const ID = "turn-tactics";
const UNIT = `${ID}-unit`;
const TARGET = `${ID}-target`;
/** Raised when the target first comes into a unit's field of view, and when a unit stands on it. */
export const REVEALED = `${ID}:revealed`;
export const REACHED = `${ID}:reached`;

export const MOVE = "move";
export const END_TURN = "end-turn";

/** Steps a unit may take per turn. */
const MOVES_PER_TURN = 4;
export const MS_PER_STEP = 100;
const SIGHT = 6;

const GRID: GridSettings = { kind: "hex", cell: [32, 28], side: 16, stagger: "x", index: "odd" };

export type TurnTacticsSnapshot = {
  turn: number;
  /** Steps the units have left this turn. */
  moves: number;
  units: Record<string, Cell>;
  /** The first unit's position, mid-step included. */
  at: Vec2 | null;
  moving: boolean;
  revealed: boolean;
  reached: boolean;
  /** Steps finished, every unit together. */
  walked: number;
  /** Presses of `inspect`, read on the ticks a command wakes. */
  inspected: number;
};

type Unit = { id: string; stepper: GridStepper; queue: Cell[] };

const unitType = defineEntityType({
  type: UNIT,
  description: "A piece the move command walks along a path.",
  base: "marker",
  fields: { at: pointField("The cell it starts on, by its centre.") },
});
const targetType = defineEntityType({
  type: TARGET,
  description: "The cell to reach; it can be walked to once a unit has seen it.",
  base: "marker",
  fields: { at: pointField("The target cell, by its centre.") },
});

const atOf = (scene: ExpandedScene, type: string) =>
  scene.entities.filter((e) => e.type === type).map((e) => ({ id: e.id, at: e.at as Pt }));

/**
 * Turn-based tactics on a hex grid with no physics. Only commands advance
 * the clock: `move` paths a unit with A* and walks it there through a grid
 * stepper (the game stays busy, so ticks run, until it stops), at most the
 * turn's moves; `end-turn` gives them back. Walls block both paths and
 * sight, and the target can be walked to only once a unit's field of view
 * has revealed it.
 */
const game = defineGame<TurnTacticsSnapshot>({
  id: ID,
  types: [unitType, targetType],
  time: { kind: "turns" },
  world: { physics: "none" },
  actions: [{ action: "inspect", keys: ["i"], description: "Inspect the board." }],
  commands: {
    [MOVE]: {
      description: "Walk a unit toward a cell along the shortest path, as far as its moves allow.",
      args: z.strictObject({
        unit: z.string().describe("The unit's entity id."),
        to: z.tuple([z.number().int(), z.number().int()]).describe("The cell, [col, row]."),
      }),
    },
    [END_TURN]: { description: "End the turn: every unit's moves come back." },
  },
  play: {
    results: ["won"],
    markers: [REVEALED, REACHED],
    focus: (snap) => snap.at,
    outcome: ({ snapshot }) =>
      snapshot.reached ? { result: "won", cause: "a unit reached the target" } : null,
  },
  createRuntime(ctx: EngineContext) {
    let units: Unit[] = [];
    let target: { id: string; cell: Cell } | null = null;
    let turn = 1;
    let moves = MOVES_PER_TURN;
    let revealed = false;
    let reached = false;
    let walked = 0;
    let inspected = 0;

    const poseOf = (id: string | undefined): Vec2 | null => {
      const p = id === undefined ? undefined : ctx.poses.get(id);
      return p ? { x: p.x, y: p.y } : null;
    };
    const opaque = (c: Cell) => ctx.grid?.occupancy.wall(c) ?? true;

    function look(u: Unit): void {
      const grid = ctx.grid;
      if (!grid || !target) return;
      const cell = u.stepper.cell();
      const at = grid.geometry.center(cell);
      if (!revealed && fieldOfView(grid.geometry, cell, SIGHT, opaque).has(cellKey(target.cell))) {
        revealed = true;
        ctx.emit({ type: REVEALED, entityId: target.id, other: u.id, at: { x: at[0], y: at[1] } });
      }
      if (!reached && sameCell(cell, target.cell)) {
        reached = true;
        ctx.emit({ type: REACHED, entityId: target.id, other: u.id, at: { x: at[0], y: at[1] } });
      }
    }

    function move(unitId: string, to: Cell): void {
      const grid = ctx.grid;
      const u = units.find((x) => x.id === unitId);
      if (!grid || !u || u.stepper.moving() || u.queue.length > 0) return;
      if (target && sameCell(to, target.cell) && !revealed) return;
      const path = findPath(grid.geometry, u.stepper.cell(), to, {
        passable: (c) => grid.passable(c),
      });
      if (path) u.queue = path.cells.slice(1);
    }

    /** Finishes a step that's due and starts the next while the turn has moves. */
    function advance(u: Unit, dtMs: number): void {
      if (u.stepper.moving()) {
        u.stepper.update(dtMs);
        if (u.stepper.moving()) return;
        walked++;
        look(u);
      }
      const next = u.queue[0];
      if (!next) return;
      if (moves > 0 && u.stepper.step(next)) {
        moves--;
        u.queue.shift();
      } else u.queue = [];
    }

    return {
      onLoad(next) {
        const grid = ctx.grid;
        if (!grid) return;
        units = atOf(next, UNIT).map((u) => ({
          id: u.id,
          stepper: createGridStepper(ctx, u.id, {
            start: grid.geometry.cellAt(u.at),
            msPerStep: MS_PER_STEP,
            occupy: true,
          }),
          queue: [],
        }));
        const [t] = atOf(next, TARGET);
        target = t ? { id: t.id, cell: grid.geometry.cellAt(t.at) } : null;
        for (const u of units) look(u);
      },
      onUnload() {
        units = [];
        target = null;
      },
      beforeStep(dtMs, actions, commands) {
        for (const a of actions) if (a.action === "inspect" && a.pressed) inspected++;
        for (const u of units) advance(u, dtMs);
        for (const c of commands) {
          if (c.name === END_TURN) {
            turn++;
            moves = MOVES_PER_TURN;
          } else if (c.name === MOVE) {
            const args = c.args as { unit: string; to: [number, number] };
            move(args.unit, args.to);
            const u = units.find((x) => x.id === args.unit);
            if (u) advance(u, 0);
          }
        }
      },
      busy: () => units.some((u) => u.stepper.moving() || u.queue.length > 0),
      snapshot: () => ({
        turn,
        moves,
        units: Object.fromEntries(units.map((u) => [u.id, u.stepper.cell()])),
        at: poseOf(units[0]?.id),
        moving: units.some((u) => u.stepper.moving()),
        revealed,
        reached,
        walked,
        inspected,
      }),
    };
  },
});

const centre = (g: Cell): Pt => {
  const [c, r] = g;
  return [16 + 24 * c, 14 + 28 * r + (c % 2 === 1 ? 14 : 0)];
};
const piece = (id: string, type: string, c: Cell) => ({ id, type, at: centre(c) });

/*
 * Columns 0–8 by rows 0–6 of flat-topped hexes, odd columns shifted down
 * half a row. A wall fills column 4 from row 1 to row 5, hiding the target
 * (T, at 7,3) from the scout (S, at 1,3); the only ways round are the open
 * cells 4,0 and 4,6.
 */
const scene: SceneDefinition = {
  v: 1,
  game: ID,
  name: "turn-tactics",
  bounds: [16, 14, 208, 196],
  settings: { physics: "none", grid: GRID },
  entities: [
    { id: "wall", type: "solid", shape: ["box", 112, 98, 6, 60] },
    piece("target", TARGET, [7, 3]),
    piece("scout", UNIT, [1, 3]),
  ],
};

const order = (unit: string, to: Cell) => ({ command: MOVE, args: { unit, to: [to[0], to[1]] } });
const endTurn = { command: END_TURN };
/** More slots than a full turn's walk takes, so each order finishes before the next. */
const settle = { wait: MOVES_PER_TURN * ticksFor(MS_PER_STEP, { rate: 60 }) + 6 };

export const probe: GenreProbe<TurnTacticsSnapshot> = {
  id: ID,
  rows: ["tactics", "roguelike"],
  pending: {
    tactics: "M16 (pointer selection), M17 (UI), M18 (saves)",
    roguelike: "M15 (seeded generation, runtime prefabs), M18 (saves), M25 (tilemap writes)",
  },
  game,
  scene,
  script: {
    v: 1,
    steps: [
      // Key edges alone don't wake a turns game: no tick runs until the first command.
      { hold: ["inspect"], for: 5 },
      { wait: 10 },
      // Hidden behind the wall: refused.
      order("scout", [7, 3]),
      // Five steps round the north end; the turn's four stop it at 3,0.
      order("scout", [4, 0]),
      settle,
      endTurn,
      // From 4,0 the target is in sight.
      order("scout", [4, 0]),
      settle,
      // Five steps to the target; three moves are left.
      order("scout", [7, 3]),
      settle,
      endTurn,
      order("scout", [7, 3]),
      settle,
    ],
  },
  expect: { result: "won", maxTicks: 80 },
  variants: [{ name: "gravity-sideways", settings: { gravity: [1200, 0] } }],
};

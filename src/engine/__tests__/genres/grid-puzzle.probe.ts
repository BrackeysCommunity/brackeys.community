import { defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { EngineContext } from "../../game/types";
import type { Cell } from "../../grid/geometry";
import { createGridStepper, type GridStepper } from "../../motion/grid-step";
import type { ExpandedScene, Pt, SceneDefinition } from "../../scene/types";
import type { GenreProbe } from "./harness";

const ID = "grid-puzzle";
const PUSHER = `${ID}-pusher`;
const CRATE = `${ID}-crate`;
const GOAL = `${ID}-goal`;

const CELL = 32;
const SIZE = 6;
const MS_PER_STEP = 100;

const DIRECTIONS: Readonly<Record<string, Cell>> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

export type GridPuzzleSnapshot = {
  pusher: Cell | null;
  crates: Cell[];
  moving: boolean;
  /** Crates standing on a goal cell. */
  placed: number;
};

const centre = (c: number, r: number): Pt => [c * CELL + CELL / 2, r * CELL + CELL / 2];
const wall = (id: string, c: number, r: number) => {
  const [x, y] = centre(c, r);
  return { id, type: "solid", shape: ["box", x, y, CELL / 2, CELL / 2] };
};
const piece = (id: string, type: string, c: number, r: number) => ({ id, type, at: centre(c, r) });

const pusherType = defineEntityType({
  type: PUSHER,
  description: "What the arrow keys move; it pushes a crate it walks into.",
  base: "marker",
  fields: { at: pointField("The cell it starts on, by its centre.") },
});
const crateType = defineEntityType({
  type: CRATE,
  description: "A block that moves one cell when pushed, if the cell beyond is free.",
  base: "marker",
  fields: { at: pointField("The cell it starts on, by its centre.") },
});
const goalType = defineEntityType({
  type: GOAL,
  description: "A cell a crate must end on.",
  base: "marker",
  fields: { at: pointField("The goal cell, by its centre.") },
});

const atOf = (scene: ExpandedScene, type: string) =>
  scene.entities.filter((e) => e.type === type).map((e) => ({ id: e.id, at: e.at as Pt }));

const sameCell = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

/**
 * Sokoban on a square grid with no physics, stepped only by input: an arrow
 * key's press edge steps the pusher, a crate in the way moves on ahead of it
 * when the cell beyond is free, and walls and other crates block through the
 * grid's occupancy.
 */
const game = defineGame<GridPuzzleSnapshot>({
  id: ID,
  types: [pusherType, crateType, goalType],
  time: { kind: "event" },
  actions: [
    { action: "left", keys: ["ArrowLeft"], description: "Step or push left." },
    { action: "right", keys: ["ArrowRight"], description: "Step or push right." },
    { action: "up", keys: ["ArrowUp"], description: "Step or push up." },
    { action: "down", keys: ["ArrowDown"], description: "Step or push down." },
  ],
  play: {
    results: ["won"],
    outcome: ({ snapshot }) =>
      !snapshot.moving && snapshot.crates.length > 0 && snapshot.placed === snapshot.crates.length
        ? { result: "won", cause: "every crate is on a goal" }
        : null,
  },
  createRuntime(ctx: EngineContext) {
    let pusher: GridStepper | null = null;
    let crates: GridStepper[] = [];
    let goals: Cell[] = [];

    function push(dir: Cell): void {
      if (!pusher || pusher.moving() || crates.some((c) => c.moving())) return;
      const [c, r] = pusher.cell();
      const to: Cell = [c + dir[0], r + dir[1]];
      const crate = crates.find((k) => sameCell(k.cell(), to));
      if (crate && !crate.step([to[0] + dir[0], to[1] + dir[1]])) return;
      pusher.step(to);
    }

    return {
      onLoad(next) {
        const grid = ctx.grid;
        if (!grid) return;
        const cellOf = (at: Pt) => grid.geometry.cellAt(at);
        const opts = (at: Pt) => ({ start: cellOf(at), msPerStep: MS_PER_STEP, occupy: true });
        crates = atOf(next, CRATE).map((c) => createGridStepper(ctx, c.id, opts(c.at)));
        goals = atOf(next, GOAL).map((g) => cellOf(g.at));
        const [p] = atOf(next, PUSHER);
        if (p) pusher = createGridStepper(ctx, p.id, opts(p.at));
      },
      onUnload() {
        pusher = null;
        crates = [];
        goals = [];
      },
      beforeStep(dtMs, actions) {
        for (const a of actions) {
          const dir = DIRECTIONS[a.action];
          if (a.pressed && dir) push(dir);
        }
        pusher?.update(dtMs);
        for (const c of crates) c.update(dtMs);
      },
      busy: () => (pusher?.moving() ?? false) || crates.some((c) => c.moving()),
      snapshot() {
        const cells = crates.map((c) => c.cell());
        return {
          pusher: pusher?.cell() ?? null,
          crates: cells,
          moving: (pusher?.moving() ?? false) || crates.some((c) => c.moving()),
          placed: cells.filter((c) => goals.some((g) => sameCell(g, c))).length,
        };
      },
    };
  },
});

/*
 * Columns 0–5 by rows 0–5; P pusher, C crate, G goal, # wall.
 *
 *   . . . . . .
 *   . P C . G #
 *   . # . . . .
 *   . . . C . .
 *   . . . . . .
 *   . . . G . .
 */
const scene: SceneDefinition = {
  v: 1,
  game: ID,
  name: "grid-puzzle",
  bounds: [0, 0, SIZE * CELL, SIZE * CELL],
  settings: { physics: "none", grid: { kind: "square", cell: [CELL, CELL] } },
  entities: [
    wall("wall-east", 5, 1),
    wall("wall-south", 1, 2),
    piece("goal-east", GOAL, 4, 1),
    piece("goal-south", GOAL, 3, 5),
    piece("crate-east", CRATE, 2, 1),
    piece("crate-south", CRATE, 3, 3),
    piece("pusher", PUSHER, 1, 1),
  ],
};

/** A press, then enough slots for the step it starts to finish. */
const move = (action: string) => [{ press: action }, { wait: 8 }];

export const probe: GenreProbe<GridPuzzleSnapshot> = {
  id: ID,
  rows: ["puzzle", "card-board"],
  pending: { puzzle: "M22 (tweens)", "card-board": "M16 (pointer swaps)" },
  game,
  scene,
  script: {
    v: 1,
    steps: [
      // Into the wall: refused, nothing moves.
      ...move("down"),
      ...move("right"),
      ...move("right"),
      // The crate is against the wall: refused.
      ...move("right"),
      ...move("down"),
      ...move("down"),
      ...move("down"),
    ],
  },
  expect: { result: "won", maxTicks: 120 },
  variants: [
    { name: "gravity-zero", settings: { gravity: [0, 0] } },
    { name: "gravity-sideways", settings: { gravity: [1200, 0] } },
  ],
};

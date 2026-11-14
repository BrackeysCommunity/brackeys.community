import { z } from "zod";

import { defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { EngineContext } from "../../game/types";
import { sameCell, type Cell } from "../../grid/geometry";
import type { InputScriptStepV2, InputScriptV2 } from "../../headless/playtest-types";
import { createGridStepper, type GridStepper } from "../../motion/grid-step";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type ExpandedScene,
  type Pt,
  type SceneDefinition,
} from "../../scene/types";
import type { GenreProbe } from "./harness";

const ID = "grid-puzzle";
const PUSHER = `${ID}-pusher`;
const CRATE = `${ID}-crate`;
const GOAL = `${ID}-goal`;
const PIECE = `${ID}-piece`;
/** Raised when a swap lines up pieces, as they are taken off the board. */
export const CLEARED = `${ID}:cleared`;
/** Swaps the two pieces the last two presses picked. */
export const SWAP = "swap";

/** A cell's side, m. */
const CELL = 1;
const SIZE = 6;
/** The swap board's top row, below the push puzzle. */
const BOARD_ROW = 7;
const MS_PER_STEP = 100;
/** How long a crate's picture takes to follow a push, and a pair of pieces to trade places. */
const SLIDE_TICKS = 8;
/** Pieces of one kind in a row or column that clear. */
const LINE = 3;
/** Pieces the swap rules must clear to win. */
const CLEAR_TARGET = 3;
/** The primary button's bit in `PointerState.buttons`. */
const PRIMARY = 1;

type Rules = "push" | "swap";

const DIRECTIONS: Readonly<Record<string, Cell>> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

type Piece = { id: string; kind: number; cell: Cell };
/** A swap under way: ticks until its slide ends, and the pieces it clears then. */
type Pending = { left: number; clears: string[] };

export type SwapSnapshot = {
  pieces: Piece[];
  /** Pieces picked by presses, oldest first, at most two. */
  picks: string[];
  cleared: number;
  /** Swaps played, whether they cleared or slid back. */
  swaps: number;
  /** Swap commands refused: not the picks, not neighbours, or mid-slide. */
  refused: number;
  pending: Pending | null;
  /** The pointer buttons read last tick. */
  buttons: number;
};

export type GridPuzzleSnapshot = {
  rules: Rules;
  pusher: Cell | null;
  crates: Cell[];
  /** Where each crate's picture stands, by the crate's order. */
  looks: Pt[];
  /** A step or a slide is still under way. */
  moving: boolean;
  /** Crates standing on a goal cell. */
  placed: number;
  swap?: SwapSnapshot;
};

const centre = (c: number, r: number): Pt => [c * CELL + CELL / 2, r * CELL + CELL / 2];
const wall = (id: string, c: number, r: number): EntityDef => {
  const [x, y] = centre(c, r);
  return { id, type: "solid", shape: ["box", x, y, CELL / 2, CELL / 2] };
};
const piece = (id: string, type: string, c: number, r: number): EntityDef => ({
  id,
  type,
  at: centre(c, r),
});
/** The picture a crate's pushes slide; it starts on the crate. */
const lookOf = (crateId: string) => `${crateId}-look`;
const look = (crateId: string, c: number, r: number): EntityDef => ({
  id: lookOf(crateId),
  type: "decor",
  at: centre(c, r),
  behaviors: { sprite: {} },
});

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
const pieceType = defineEntityType({
  type: PIECE,
  description: "A board piece: swapped with a neighbour, cleared in a line of its kind.",
  base: "marker",
  fields: {
    at: pointField("The cell it starts on, by its centre."),
    kind: z.number().int().min(0).describe("Pieces of one kind clear together."),
  },
});

const atOf = (scene: ExpandedScene, type: string) =>
  scene.entities.filter((e) => e.type === type).map((e) => ({ id: e.id, at: e.at as Pt }));

const neighbours = (a: Cell, b: Cell) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
const cellKey = (c: Cell) => `${c[0]},${c[1]}`;
const copyPiece = (p: Piece): Piece => ({ id: p.id, kind: p.kind, cell: [p.cell[0], p.cell[1]] });

/** The ids of every piece in a row or column of at least `LINE` of one kind. */
function lines(pieces: readonly Piece[]): string[] {
  const at = new Map(pieces.map((p) => [cellKey(p.cell), p]));
  const out = new Set<string>();
  for (const p of pieces) {
    for (const [dc, dr] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const prev = at.get(cellKey([p.cell[0] - dc, p.cell[1] - dr]));
      if (prev?.kind === p.kind) continue;
      const run = [p];
      for (let next = at.get(cellKey([p.cell[0] + dc, p.cell[1] + dr])); next?.kind === p.kind; ) {
        run.push(next);
        const last = next.cell;
        next = at.get(cellKey([last[0] + dc, last[1] + dr]));
      }
      if (run.length >= LINE) for (const q of run) out.add(q.id);
    }
  }
  return pieces.filter((p) => out.has(p.id)).map((p) => p.id);
}

/**
 * Two puzzles on one square grid with no physics, stepped only by input,
 * picked by the scene's `rules` setting.
 *
 * `push` (the default) is Sokoban: an arrow key's press edge steps the
 * pusher, a crate in the way moves on ahead of it when the cell beyond is
 * free, and walls and other crates block through the grid's occupancy. The
 * stepper owns where a crate is; each push also slides the crate's picture
 * after it with a tween.
 *
 * `swap` is match-3: a primary press on a piece picks it, and the host
 * sends `swap { a, b }` for the last two picks. Neighbours trade places with
 * a tweened slide; when that lines up `LINE` of a kind they clear as the
 * slide ends, and otherwise the pair slides back.
 */
const game = defineGame<GridPuzzleSnapshot>({
  id: ID,
  types: [pusherType, crateType, goalType, pieceType],
  time: { kind: "event" },
  settings: {
    rules: z
      .enum(["push", "swap"])
      .optional()
      .describe("push (default): the arrow keys push crates; swap: presses swap board pieces."),
  },
  actions: [
    { action: "left", keys: ["ArrowLeft"], description: "Step or push left." },
    { action: "right", keys: ["ArrowRight"], description: "Step or push right." },
    { action: "up", keys: ["ArrowUp"], description: "Step or push up." },
    { action: "down", keys: ["ArrowDown"], description: "Step or push down." },
  ],
  commands: {
    [SWAP]: {
      description: "Swap the two pieces the last two presses picked, if they are neighbours.",
      args: z.strictObject({
        a: z.string().describe("One picked piece's entity id."),
        b: z.string().describe("The other picked piece's entity id."),
      }),
    },
  },
  play: {
    results: ["won"],
    markers: [CLEARED],
    outcome: ({ snapshot }) => {
      if (snapshot.moving) return null;
      if (snapshot.swap)
        return snapshot.swap.cleared >= CLEAR_TARGET
          ? { result: "won", cause: `${snapshot.swap.cleared} pieces cleared` }
          : null;
      return snapshot.crates.length > 0 && snapshot.placed === snapshot.crates.length
        ? { result: "won", cause: "every crate is on a goal" }
        : null;
    },
  },
  createRuntime(ctx: EngineContext) {
    let rules: Rules = "push";
    let pusher: GridStepper | null = null;
    let crates: { id: string; stepper: GridStepper }[] = [];
    let goals: Cell[] = [];
    let pieces: Piece[] = [];
    let picks: string[] = [];
    let pending: Pending | null = null;
    let buttons = 0;
    let cleared = 0;
    let swaps = 0;
    let refused = 0;

    const slideTo = (id: string, to: Cell, back: boolean) => {
      const [x, y] = ctx.grid!.geometry.center(to);
      ctx.tweens.to(id, {
        to: { x, y },
        duration: SLIDE_TICKS,
        ease: "quadOut",
        key: "slide",
        ...(back ? { yoyo: true, repeat: 1 } : {}),
      });
    };

    function push(dir: Cell): void {
      if (!pusher || pusher.moving() || crates.some((c) => c.stepper.moving())) return;
      const [c, r] = pusher.cell();
      const to: Cell = [c + dir[0], r + dir[1]];
      const crate = crates.find((k) => sameCell(k.stepper.cell(), to));
      const beyond: Cell = [to[0] + dir[0], to[1] + dir[1]];
      if (crate) {
        if (!crate.stepper.step(beyond)) return;
        if (ctx.exists(lookOf(crate.id))) slideTo(lookOf(crate.id), beyond, false);
      }
      pusher.step(to);
    }

    function press(at: { x: number; y: number }): void {
      const grid = ctx.grid;
      if (!grid) return;
      const cell = grid.geometry.cellAt([at.x, at.y]);
      const hit = pieces.find((p) => sameCell(p.cell, cell));
      if (!hit) return;
      picks = [...picks.filter((id) => id !== hit.id), hit.id].slice(-2);
    }

    function swap(a: string, b: string): void {
      const pa = pieces.find((p) => p.id === a);
      const pb = pieces.find((p) => p.id === b);
      const picked = picks.length === 2 && picks.includes(a) && picks.includes(b) && a !== b;
      picks = [];
      if (pending || !picked || !pa || !pb || !neighbours(pa.cell, pb.cell)) {
        refused++;
        return;
      }
      swaps++;
      const traded = pieces.map((p) =>
        p.id === a ? { ...p, cell: pb.cell } : p.id === b ? { ...p, cell: pa.cell } : p,
      );
      const clears = lines(traded);
      const back = clears.length === 0;
      slideTo(a, pb.cell, back);
      slideTo(b, pa.cell, back);
      if (!back) pieces = traded;
      pending = { left: back ? 2 * SLIDE_TICKS : SLIDE_TICKS, clears };
    }

    function settle(): void {
      if (!pending || --pending.left > 0) return;
      const { clears } = pending;
      pending = null;
      if (clears.length === 0) return;
      for (const id of clears) ctx.destroy(id);
      pieces = pieces.filter((p) => !clears.includes(p.id));
      cleared += clears.length;
      const [x, y] = ctx.grid!.geometry.center([0, BOARD_ROW]);
      ctx.emit({ type: CLEARED, at: { x, y }, data: { pieces: [...clears] } });
    }

    const busy = () =>
      (pusher?.moving() ?? false) ||
      crates.some((c) => c.stepper.moving()) ||
      pending !== null ||
      ctx.tweens.size > 0;

    return {
      onLoad(next) {
        const grid = ctx.grid;
        if (!grid) return;
        rules = next.settings.rules === "swap" ? "swap" : "push";
        const cellOf = (at: Pt) => grid.geometry.cellAt(at);
        if (rules === "swap") {
          pieces = next.entities
            .filter((e) => e.type === PIECE)
            .map((e) => ({ id: e.id, kind: e.kind as number, cell: cellOf(e.at as Pt) }));
          return;
        }
        const opts = (at: Pt) => ({ start: cellOf(at), msPerStep: MS_PER_STEP, occupy: true });
        crates = atOf(next, CRATE).map((c) => ({
          id: c.id,
          stepper: createGridStepper(ctx, c.id, opts(c.at)),
        }));
        goals = atOf(next, GOAL).map((g) => cellOf(g.at));
        const [p] = atOf(next, PUSHER);
        if (p) pusher = createGridStepper(ctx, p.id, opts(p.at));
      },
      onUnload() {
        pusher = null;
        crates = [];
        goals = [];
        pieces = [];
        picks = [];
        pending = null;
        buttons = 0;
        cleared = 0;
        swaps = 0;
        refused = 0;
      },
      beforeStep(dtMs, actions, commands) {
        if (rules === "swap") {
          settle();
          const pointer = ctx.input.pointer();
          const now = pointer?.buttons ?? 0;
          if (pointer && now & PRIMARY && !(buttons & PRIMARY)) press(pointer);
          buttons = now;
          for (const c of commands) {
            if (c.name !== SWAP) continue;
            const { a, b } = c.args as { a: string; b: string };
            swap(a, b);
          }
          return;
        }
        for (const a of actions) {
          const dir = DIRECTIONS[a.action];
          if (a.pressed && dir) push(dir);
        }
        pusher?.update(dtMs);
        for (const c of crates) c.stepper.update(dtMs);
      },
      busy,
      // The steppers, poses and tweens come back with a world save; the board is the game's own.
      restore(s) {
        if (!s.swap) return;
        pieces = s.swap.pieces.map(copyPiece);
        picks = [...s.swap.picks];
        pending = s.swap.pending
          ? { left: s.swap.pending.left, clears: [...s.swap.pending.clears] }
          : null;
        buttons = s.swap.buttons;
        cleared = s.swap.cleared;
        swaps = s.swap.swaps;
        refused = s.swap.refused;
      },
      snapshot() {
        const cells = crates.map((c) => c.stepper.cell());
        const looks = crates.flatMap(({ id }): Pt[] => {
          const pose = ctx.poses.get(lookOf(id));
          return pose ? [[pose.x, pose.y]] : [];
        });
        return {
          rules,
          pusher: pusher?.cell() ?? null,
          crates: cells,
          looks,
          moving: busy(),
          placed: cells.filter((c) => goals.some((g) => sameCell(g, c))).length,
          ...(rules === "swap"
            ? {
                swap: {
                  pieces: pieces.map(copyPiece),
                  picks: [...picks],
                  cleared,
                  swaps,
                  refused,
                  pending: pending ? { left: pending.left, clears: [...pending.clears] } : null,
                  buttons,
                },
              }
            : {}),
        };
      },
    };
  },
});

/*
 * Columns 0–5 by rows 0–9, a cell a metre; P pusher, C crate, G goal,
 * # wall, and the swap board's pieces by kind (0, 1, 2) in rows 7–9.
 *
 *   . . . . . .
 *   . P C . G #
 *   . # . . . .
 *   . . . C . .
 *   . . . . . .
 *   . . . G . .
 *   . . . . . .
 *   0 1 0 2 1 .
 *   1 2 1 0 2 .
 *   2 0 2 1 0 .
 */
const BOARD: readonly (readonly number[])[] = [
  [0, 1, 0, 2, 1],
  [1, 2, 1, 0, 2],
  [2, 0, 2, 1, 0],
];
const pieceId = (c: number, r: number) => `piece-${c}-${r}`;

const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "grid-puzzle",
  bounds: [0, 0, SIZE * CELL, (BOARD_ROW + BOARD.length) * CELL],
  settings: { physics: "none", grid: { kind: "square", cell: [CELL, CELL] } },
  entities: [
    wall("wall-east", 5, 1),
    wall("wall-south", 1, 2),
    piece("goal-east", GOAL, 4, 1),
    piece("goal-south", GOAL, 3, 5),
    piece("crate-east", CRATE, 2, 1),
    piece("crate-south", CRATE, 3, 3),
    look("crate-east", 2, 1),
    look("crate-south", 3, 3),
    piece("pusher", PUSHER, 1, 1),
    ...BOARD.flatMap((kinds, i) =>
      kinds.map((kind, c) => ({
        ...piece(pieceId(c, BOARD_ROW + i), PIECE, c, BOARD_ROW + i),
        kind,
      })),
    ),
  ],
};

/** A tick inside a push, the pusher, a crate and its picture all mid-move. */
export const SAVE_AT = 10;
/** A tick inside the swap that clears a line, both pieces mid-slide. */
export const SWAP_SAVE_AT = 47;

/** A press, then enough slots for the step and slide it starts to finish. */
const move = (action: string): InputScriptStepV2[] => [{ press: action }, { wait: SLIDE_TICKS }];
const click = (c: number, r: number): InputScriptStepV2 => ({
  pointer: { at: centre(c, r), press: "primary", release: "primary" },
  for: 2,
});
/** Picks two pieces and sends the swap for them, as a host does, then waits out the slide. */
const swapStep = (a: Cell, b: Cell, wait: number): InputScriptStepV2[] => [
  click(...a),
  click(...b),
  { command: SWAP, args: { a: pieceId(...a), b: pieceId(...b) } },
  { wait },
];

/**
 * The push puzzle's moves, then the swap board's clicks; each set of rules
 * ignores the other's input. Pushing: into the wall (refused), the east
 * crate along to its goal (then refused against the wall), round and the
 * south crate down to its. Swapping: two pieces that aren't neighbours
 * (refused), a pair that lines nothing up (slides back), and a pair that
 * lines up three of kind 1 along row 8 (cleared).
 */
const script: InputScriptV2 = {
  v: 2,
  scene: scene.name,
  steps: [
    ...move("down"),
    ...move("right"),
    ...move("right"),
    ...move("right"),
    ...move("down"),
    ...move("down"),
    ...move("down"),
    ...swapStep([0, 7], [2, 7], 1),
    ...swapStep([3, 9], [4, 9], 2 * SLIDE_TICKS + 1),
    ...swapStep([1, 7], [1, 8], SLIDE_TICKS + 1),
  ],
};

const SWAP_RULES = { rules: "swap" } as const;

export const probe: GenreProbe<GridPuzzleSnapshot> = {
  id: ID,
  rows: ["puzzle", "card-board"],
  game,
  scene,
  script,
  expect: { result: "won", maxTicks: 120 },
  variants: [
    { name: "gravity-zero", settings: { gravity: [0, 0] } },
    { name: "gravity-sideways", settings: { gravity: [1200, 0] } },
    // Partway through the push that puts the first crate on its goal.
    { name: "saved-mid-push", saveAt: SAVE_AT },
    { name: "pointer-swap", settings: SWAP_RULES },
    { name: "saved-mid-swap", settings: SWAP_RULES, saveAt: SWAP_SAVE_AT },
  ],
};

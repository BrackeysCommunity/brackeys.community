import { z } from "zod";

import { defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { EngineContext } from "../../game/types";
import { fieldOfView } from "../../grid/fov";
import { cellKey, sameCell, type Cell, type CellKey } from "../../grid/geometry";
import { findPath } from "../../grid/path";
import { createGridStepper, type GridStepper } from "../../motion/grid-step";
import { prefabLibrary } from "../../scene/prefab";
import {
  SCENE_FORMAT_VERSION,
  type GridSettings,
  type Prefab,
  type Pt,
  type SceneDefinition,
} from "../../scene/types";
import type { Vec2 } from "../../types";
import type { GenreProbe } from "./harness";

const ID = "roguelike";
const ROGUE = "rogue";
const FLOOR = `${ID}-floor`;
const STAIRS = `${ID}-stairs`;
/** A plain room, and the room the stairs stand in. */
const HALL = `${ID}-hall`;
const VAULT = `${ID}-vault`;

/** Raised when the stairs first come into the rogue's field of view, and when it stands on them. */
export const SIGHTED = `${ID}:sighted`;
export const DESCENDED = `${ID}:descended`;
export const DESCEND = "descend";

const CELL = 16;
const COLS = 28;
const ROWS = 18;
const GRID: GridSettings = { kind: "square", cell: [CELL, CELL] };
const MS_PER_STEP = 100;
const SIGHT = 5;
/** Rooms the generator tries to place, the vault last; attempts give up after `TRIES`. */
const ROOMS = 5;
const TRIES = 60;

const ROOM_SIZE: Record<string, readonly [w: number, h: number]> = {
  [HALL]: [5, 4],
  [VAULT]: [3, 3],
};

export type RoguelikeSnapshot = {
  /** Each placed room's instance id and its top-left cell. */
  rooms: { id: string; cell: Cell }[];
  rogue: Cell | null;
  stairs: Cell | null;
  at: Vec2 | null;
  /** Steps taken. */
  steps: number;
  /** Cells the rogue has seen. */
  seen: number;
  sighted: boolean;
  descended: boolean;
};

const floorType = defineEntityType({
  type: FLOOR,
  description: "A rectangle of floor cells, from the cell its point is the centre of.",
  base: "marker",
  fields: {
    at: pointField("The centre of its top-left cell."),
    w: z.number().int().min(1).describe("Width, in cells."),
    h: z.number().int().min(1).describe("Height, in cells."),
  },
});
const stairsType = defineEntityType({
  type: STAIRS,
  description: "The way down: standing on it wins.",
  base: "marker",
  fields: { at: pointField("The stairs' cell, by its centre.") },
});
const rogueType = defineEntityType({
  type: ROGUE,
  description: "The explorer, spawned in the first room.",
  base: "marker",
  spawnOnly: true,
  fields: { at: pointField("Where it stands.") },
});

const room = (id: string, extra: Prefab["entities"] = []): Prefab => {
  const [w, h] = ROOM_SIZE[id]!;
  return {
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    game: ID,
    id,
    entities: [{ id: "floor", type: FLOOR, at: [0, 0], w, h }, ...extra],
  };
};

const prefabs = prefabLibrary([
  room(HALL),
  room(VAULT, [{ id: "stairs", type: STAIRS, at: [CELL, CELL] }]),
]);

type Rect = { c: number; r: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect) =>
  a.c - 1 <= b.c + b.w && b.c - 1 <= a.c + a.w && a.r - 1 <= b.r + b.h && b.r - 1 <= a.r + a.h;
const centreCell = (a: Rect): Cell => [a.c + Math.floor(a.w / 2), a.r + Math.floor(a.h / 2)];
const inBounds = ([c, r]: Cell) => c >= 0 && r >= 0 && c < COLS && r < ROWS;

/**
 * A roguelike floor with no physics. At load `ctx.random` picks room spots,
 * `ctx.instantiate` places a hall prefab at each and the vault (with the
 * stairs) at the last, L-shaped corridors join them in order, and every
 * other cell becomes a grid wall. `descend` sets the rogue off: it sees by
 * shadowcast field of view, walks by A* over the cells it has seen toward
 * the nearest edge of the known map, and once the stairs are in view walks
 * to them. The game stays busy while it walks, so a turns clock keeps
 * ticking until it arrives.
 */
const game = defineGame<RoguelikeSnapshot>({
  id: ID,
  types: [floorType, stairsType, rogueType],
  time: { kind: "turns" },
  world: { physics: "none" },
  actions: [],
  commands: {
    [DESCEND]: { description: "Explore the floor until the stairs are found, and take them." },
  },
  play: {
    results: ["won"],
    markers: [SIGHTED, DESCENDED],
    focus: (snap) => snap.at,
    outcome: ({ snapshot }) =>
      snapshot.descended ? { result: "won", cause: "the rogue took the stairs" } : null,
  },
  createRuntime(ctx: EngineContext) {
    let rooms: { id: string; cell: Cell }[] = [];
    let floor = new Set<CellKey>();
    let seen = new Set<CellKey>();
    let stairs: { id: string; cell: Cell } | null = null;
    let rogue: { id: string; stepper: GridStepper } | null = null;
    let exploring = false;
    let sighted = false;
    let descended = false;
    let steps = 0;

    const wall = (c: Cell) => !inBounds(c) || !floor.has(cellKey(c));

    function carve(rect: Rect): void {
      for (let r = rect.r; r < rect.r + rect.h; r++)
        for (let c = rect.c; c < rect.c + rect.w; c++) floor.add(cellKey([c, r]));
    }

    function corridor(a: Cell, b: Cell, horizontalFirst: boolean): void {
      const bend: Cell = horizontalFirst ? [b[0], a[1]] : [a[0], b[1]];
      for (const [from, to] of [
        [a, bend],
        [bend, b],
      ] as const) {
        const dc = Math.sign(to[0] - from[0]);
        const dr = Math.sign(to[1] - from[1]);
        let at: Cell = from;
        floor.add(cellKey(at));
        while (!sameCell(at, to)) {
          at = [at[0] + dc, at[1] + dr];
          floor.add(cellKey(at));
        }
      }
    }

    /** Places the rooms; every spot is drawn, the vault takes the last one. */
    function generate(): Rect[] {
      const grid = ctx.grid!;
      const spots: Rect[] = [];
      for (let t = 0; t < TRIES && spots.length < ROOMS; t++) {
        const [w, h] = ROOM_SIZE[HALL]!;
        const spot = {
          c: ctx.random.range(1, COLS - w - 1),
          r: ctx.random.range(1, ROWS - h - 1),
          w,
          h,
        };
        if (!spots.some((s) => overlaps(s, spot))) spots.push(spot);
      }
      const placed: Rect[] = [];
      for (const [i, spot] of spots.entries()) {
        const prefab = i === spots.length - 1 ? VAULT : HALL;
        const [w, h] = ROOM_SIZE[prefab]!;
        const rect = { ...spot, w, h };
        const inst = ctx.instantiate(prefab, grid.geometry.center([rect.c, rect.r]));
        rooms.push({ id: inst.id, cell: [rect.c, rect.r] });
        for (const id of inst.entities) {
          const e = ctx.get(id);
          if (e?.type === FLOOR) {
            const [c, r] = grid.geometry.cellAt(e.at as Pt);
            carve({ c, r, w: e.w as number, h: e.h as number });
          } else if (e?.type === STAIRS) {
            stairs = { id, cell: grid.geometry.cellAt(e.at as Pt) };
          }
        }
        placed.push(rect);
      }
      for (let i = 1; i < placed.length; i++)
        corridor(centreCell(placed[i - 1]!), centreCell(placed[i]!), ctx.random.below(2) === 0);
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) if (wall([c, r])) grid.occupancy.setWall([c, r], true);
      return placed;
    }

    function look(): void {
      const grid = ctx.grid;
      if (!grid || !rogue) return;
      const cell = rogue.stepper.cell();
      for (const k of fieldOfView(grid.geometry, cell, SIGHT, wall)) seen.add(k);
      const [x, y] = grid.geometry.center(cell);
      if (stairs && !sighted && seen.has(cellKey(stairs.cell))) {
        sighted = true;
        ctx.emit({ type: SIGHTED, entityId: stairs.id, other: rogue.id, at: { x, y } });
      }
      if (stairs && !descended && sameCell(cell, stairs.cell)) {
        descended = true;
        exploring = false;
        ctx.emit({ type: DESCENDED, entityId: stairs.id, other: rogue.id, at: { x, y } });
      }
    }

    /** Seen floor cells beside a cell not yet seen, nearest first, ties by row then column. */
    function frontier(from: Cell): Cell[] {
      const grid = ctx.grid!;
      const out: Cell[] = [];
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const cell: Cell = [c, r];
          const k = cellKey(cell);
          if (!seen.has(k) || !floor.has(k)) continue;
          if (grid.geometry.neighbors(cell).some((n) => inBounds(n) && !seen.has(cellKey(n))))
            out.push(cell);
        }
      const d = (c: Cell) => grid.geometry.distance(from, c);
      return out.sort((a, b) => d(a) - d(b));
    }

    /** The next cell toward the stairs once seen, else toward the nearest reachable frontier. */
    function nextStep(): Cell | null {
      const grid = ctx.grid;
      if (!grid || !rogue) return null;
      const from = rogue.stepper.cell();
      const passable = (c: Cell) => seen.has(cellKey(c)) && grid.passable(c);
      const goals = sighted && stairs ? [stairs.cell] : frontier(from);
      for (const goal of goals) {
        if (sameCell(goal, from)) continue;
        const path = findPath(grid.geometry, from, goal, { passable });
        const next = path?.cells[1];
        if (next) return next;
      }
      return null;
    }

    function advance(dtMs: number): void {
      if (!rogue || !exploring) return;
      if (rogue.stepper.moving()) {
        rogue.stepper.update(dtMs);
        if (rogue.stepper.moving()) return;
        steps++;
        look();
        if (!exploring) return;
      }
      const next = nextStep();
      if (!next || !rogue.stepper.step(next)) exploring = false;
    }

    return {
      onLoad() {
        const grid = ctx.grid;
        if (!grid) return;
        const placed = generate();
        const first = placed[0];
        if (!first) return;
        const start = centreCell(first);
        const spawned = ctx.spawn({ type: ROGUE, at: grid.geometry.center(start) });
        rogue = {
          id: spawned.id,
          stepper: createGridStepper(ctx, spawned.id, {
            start,
            msPerStep: MS_PER_STEP,
            occupy: true,
          }),
        };
        look();
      },
      onUnload() {
        rooms = [];
        floor = new Set();
        seen = new Set();
        stairs = null;
        rogue = null;
        exploring = false;
        sighted = false;
        descended = false;
        steps = 0;
      },
      beforeStep(dtMs, _actions, commands) {
        advance(dtMs);
        for (const c of commands) {
          if (c.name !== DESCEND || exploring || descended) continue;
          exploring = true;
          advance(0);
        }
      },
      busy: () => exploring,
      snapshot: () => {
        const p = rogue ? ctx.poses.get(rogue.id) : undefined;
        return {
          rooms: rooms.map((r) => ({ id: r.id, cell: r.cell })),
          rogue: rogue ? rogue.stepper.cell() : null,
          stairs: stairs ? stairs.cell : null,
          at: p ? { x: p.x, y: p.y } : null,
          steps,
          seen: seen.size,
          sighted,
          descended,
        };
      },
    };
  },
});

/** An empty floor plan: the game builds every room at load. */
const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: ID,
  bounds: [0, 0, COLS * CELL, ROWS * CELL],
  settings: { physics: "none", grid: GRID },
  entities: [],
};

export const probe: GenreProbe<RoguelikeSnapshot> = {
  id: ID,
  rows: ["roguelike"],
  pending: { roguelike: "M18 (saves), M25 (tilemap writes)" },
  game,
  scene,
  prefabs,
  script: {
    v: 1,
    maxTicks: 4000,
    steps: [{ wait: 5 }, { command: DESCEND }, { wait: 3990 }],
  },
  expect: { result: "won", maxTicks: 4000 },
  variants: [
    { name: "seed-1", seed: 1 },
    { name: "seed-2", seed: 2 },
  ],
  timeoutMs: 60_000,
};

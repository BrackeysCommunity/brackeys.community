import { z } from "zod";

import { defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { EngineContext, GameCommand } from "../../game/types";
import { flowField, type FlowField } from "../../grid/flow";
import { sameCell, type Cell } from "../../grid/geometry";
import { createGridStepper, type GridStepper } from "../../motion/grid-step";
import { ENTITY_DESTROYED, type StepEvent } from "../../runtime/types";
import type { ExpandedScene, GridSettings, Pt, SceneDefinition } from "../../scene/types";
import type { GenreProbe } from "./harness";

const ID = "tower-defense";
const CREEP = "creep";
const TOWER = "tower";
const BOLT = "bolt";
export const BUILD = "build";

/** Raised when a creep's last hit points go, and when one walks out of the exit. */
export const KILLED = `${ID}:killed`;
export const ESCAPED = `${ID}:escaped`;

const GRID: GridSettings = { kind: "square", cell: [1, 1] };
/** px per metre: one 32 px tile a cell. */
const LENGTH_UNIT = 32;

const START_MONEY = 30;
const TOWER_COST = 10;
/** A tower reaches creeps within this many metres of its cell's centre. */
const RANGE = 1.5;
const FIRE_MS = 500;
/** Ticks a bolt flies before its lifetime ends and it lands. */
const BOLT_TICKS = 6;
const MS_PER_STEP = 300;
/** Creeps out of the exit that lose the run. */
export const ESCAPES_TO_LOSE = 5;

type WaveRow = { id: string; startMs: number; everyMs: number; count: number; hp: number };

/** The waves, as a project's data table would hold them: when each starts, its spacing, size and toughness. */
export const WAVES: readonly WaveRow[] = [
  { id: "first", startMs: 1000, everyMs: 700, count: 4, hp: 2 },
  { id: "second", startMs: 5000, everyMs: 600, count: 6, hp: 3 },
  { id: "third", startMs: 9500, everyMs: 500, count: 8, hp: 3 },
];
const TOTAL = WAVES.reduce((n, w) => n + w.count, 0);

export type TowerDefenseSnapshot = {
  money: number;
  /** Towers in build order, by cell. */
  towers: Cell[];
  /** Cells a tower may still go on: off the creeps' path, in row-then-column order. */
  pads: Cell[];
  spawned: number;
  live: number;
  kills: number;
  escaped: number;
  fired: number;
};

type Creep = { id: string; stepper: GridStepper; hp: number };
type Bolt = { from: Pt; target: string; age: number };

const creepType = defineEntityType({
  type: CREEP,
  description: "Walks the flow field to the exit cell; towers' bolts wear it down.",
  base: "marker",
  spawnOnly: true,
  fields: { at: pointField("Where it stands, by its cell's centre.") },
});
const towerType = defineEntityType({
  type: TOWER,
  description: "Fires a bolt at the creep furthest along within its range.",
  base: "marker",
  spawnOnly: true,
  fields: { at: pointField("Its cell's centre.") },
});
const boltType = defineEntityType({
  type: BOLT,
  description: "Flies from a tower to its creep; it lands, and hits, when its lifetime ends.",
  base: "marker",
  spawnOnly: true,
  fields: { at: pointField("Where it is in flight.") },
});

/** The command a run may send to put a tower on `cell`. */
export const build = (cell: Cell): GameCommand => ({
  name: BUILD,
  args: { at: [cell[0], cell[1]] },
});

const markerCell = (
  scene: ExpandedScene,
  tag: string,
  grid: NonNullable<EngineContext["grid"]>,
) => {
  const e = scene.entities.find((x) => x.type === "marker" && (x.tags as string[])?.includes(tag));
  return e ? grid.geometry.cellAt(e.at as Pt) : null;
};

/**
 * Tower defense on a square grid with no physics, at a fixed 60 Hz. Creeps
 * walk a flow field from the entry to the exit; `ctx.timers.every` spawns
 * each wave of the table on its own spacing. `build` puts a tower on a cell
 * off the path while the money lasts, and the game lists exactly those cells
 * as its legal commands. Each tower fires on its own timer at the creep
 * furthest along that `ctx.query.inArea` finds in its range; the bolt it
 * spawns lands when its `lifetime` ends. The run is won when every wave is
 * spawned and gone with fewer than five out of the exit, lost at five.
 */
const game = defineGame<TowerDefenseSnapshot>({
  id: ID,
  types: [creepType, towerType, boltType],
  actions: [],
  time: { kind: "fixed" },
  world: { physics: "none", lengthUnit: LENGTH_UNIT },
  commands: {
    [BUILD]: {
      description: "Build a tower on a cell off the path, if the money covers it.",
      args: z.strictObject({
        at: z.tuple([z.number().int(), z.number().int()]).describe("The cell, [col, row]."),
      }),
    },
  },
  play: {
    results: ["won", "lost"],
    markers: [KILLED, ESCAPED],
    outcome({ snapshot: s }) {
      if (s.escaped >= ESCAPES_TO_LOSE)
        return { result: "lost", cause: `${s.escaped} creeps reached the exit` };
      if (s.spawned === TOTAL && s.live === 0)
        return { result: "won", cause: "every wave was cleared" };
      return null;
    },
    commands: ({ snapshot: s }) => (s.money >= TOWER_COST ? s.pads.map(build) : []),
  },
  createRuntime(ctx: EngineContext) {
    let field: FlowField | null = null;
    let entry: Cell | null = null;
    let exit: Cell | null = null;
    let creeps: Creep[] = [];
    const bolts = new Map<string, Bolt>();
    let landed: Bolt[] = [];
    let pads: Cell[] = [];
    let towers: Cell[] = [];
    let money = START_MONEY;
    let spawned = 0;
    let kills = 0;
    let escaped = 0;
    let fired = 0;

    const centre = (c: Cell): Pt => ctx.grid!.geometry.center(c);
    const progress = (c: Creep) => field?.cost(c.stepper.cell()) ?? Infinity;

    function spawnCreep(hp: number): void {
      if (!entry) return;
      const { id } = ctx.spawn({ type: CREEP, at: centre(entry) });
      creeps.push({
        id,
        stepper: createGridStepper(ctx, id, { start: entry, msPerStep: MS_PER_STEP }),
        hp,
      });
      spawned++;
    }

    function fire(at: Pt): void {
      const [cx, cy] = at;
      const near = ctx.query.inArea({ type: "circle", cx, cy, r: RANGE }, { type: CREEP });
      let target: Creep | undefined;
      for (const c of creeps) {
        if (!near.includes(c.id)) continue;
        if (!target || progress(c) < progress(target)) target = c;
      }
      if (!target) return;
      const { id } = ctx.spawn({ type: BOLT, at, behaviors: { lifetime: { ticks: BOLT_TICKS } } });
      bolts.set(id, { from: at, target: target.id, age: 0 });
      fired++;
    }

    function placeTower(cell: Cell): void {
      const i = pads.findIndex((p) => sameCell(p, cell));
      if (i < 0 || money < TOWER_COST) return;
      money -= TOWER_COST;
      pads.splice(i, 1);
      towers.push([cell[0], cell[1]]);
      const at = centre(cell);
      const { id } = ctx.spawn({ type: TOWER, at });
      ctx.timers.every({ ms: FIRE_MS }, () => fire(at), { owner: id });
    }

    function remove(c: Creep, event: string): void {
      creeps = creeps.filter((x) => x !== c);
      const [x, y] = centre(c.stepper.cell());
      ctx.emit({ type: event, entityId: c.id, at: { x, y } });
      ctx.destroy(c.id);
    }

    /** Hits from bolts that landed since the last step, then each creep's next step along the field. */
    function advance(dtMs: number): void {
      for (const b of landed) {
        const c = creeps.find((x) => x.id === b.target);
        if (!c) continue;
        c.hp--;
        if (c.hp <= 0) {
          kills++;
          remove(c, KILLED);
        }
      }
      landed = [];
      for (const c of [...creeps]) {
        c.stepper.update(dtMs);
        if (c.stepper.moving()) continue;
        if (exit && sameCell(c.stepper.cell(), exit)) {
          escaped++;
          remove(c, ESCAPED);
          continue;
        }
        const next = field?.next(c.stepper.cell());
        if (next) c.stepper.step(next);
      }
      for (const [id, b] of bolts) {
        b.age++;
        const at = ctx.poses.get(b.target);
        if (!at) continue;
        const k = b.age / BOLT_TICKS;
        ctx.poses.set(id, b.from[0] + (at.x - b.from[0]) * k, b.from[1] + (at.y - b.from[1]) * k);
      }
    }

    return {
      onLoad(scene) {
        const grid = ctx.grid;
        creeps = [];
        bolts.clear();
        landed = [];
        towers = [];
        money = START_MONEY;
        spawned = kills = escaped = fired = 0;
        if (!grid) return;
        entry = markerCell(scene, "entry", grid);
        exit = markerCell(scene, "exit", grid);
        if (!entry || !exit) return;
        field = flowField(grid.geometry, [exit], {
          bounds: grid.bounds,
          passable: (c) => grid.passable(c),
        });
        const path: Cell[] = [entry];
        for (let at = field.next(entry); at; at = field.next(at)) path.push(at);
        pads = [];
        for (let r = grid.bounds.r0; r <= grid.bounds.r1; r++)
          for (let c = grid.bounds.c0; c <= grid.bounds.c1; c++)
            if (grid.passable([c, r]) && !path.some((p) => sameCell(p, [c, r]))) pads.push([c, r]);
        for (const wave of WAVES)
          ctx.timers.after({ ms: wave.startMs }, () => {
            spawnCreep(wave.hp);
            if (wave.count > 1)
              ctx.timers.every({ ms: wave.everyMs }, () => spawnCreep(wave.hp), {
                times: wave.count - 1,
              });
          });
        ctx.events.on(ENTITY_DESTROYED, (e: StepEvent) => {
          const b = e.entityId === undefined ? undefined : bolts.get(e.entityId);
          if (!b || !e.entityId) return;
          bolts.delete(e.entityId);
          landed.push(b);
        });
      },
      onUnload() {
        field = null;
        creeps = [];
        bolts.clear();
        landed = [];
      },
      beforeStep(dtMs, _actions, commands) {
        for (const c of commands)
          if (c.name === BUILD) placeTower((c.args as { at: [number, number] }).at);
        advance(dtMs);
      },
      snapshot: () => ({
        money,
        towers: towers.map((t) => [t[0], t[1]] as Cell),
        pads: pads.map((p) => [p[0], p[1]] as Cell),
        spawned,
        live: creeps.length,
        kills,
        escaped,
        fired,
      }),
    };
  },
});

/*
 * Ten columns by six rows of 1 m cells. A wall fills column 4 from row 0 to
 * row 3, so the creeps' path from the entry (0, 2) to the exit (9, 0) bends
 * round its foot along row 4.
 */
const scene: SceneDefinition = {
  v: 4,
  game: ID,
  name: "tower-defense-probe",
  bounds: [0, 0, 10, 6],
  settings: { gravity: [0, 0], physics: "none", grid: GRID },
  entities: [
    { id: "wall", type: "solid", shape: ["box", 4.5, 2, 0.5, 2] },
    { id: "entry", type: "marker", at: [0.5, 2.5], tags: ["entry"] },
    { id: "exit", type: "marker", at: [9.5, 0.5], tags: ["exit"] },
  ],
};

const order = (cell: Cell) => ({ command: BUILD, args: { at: [cell[0], cell[1]] } });

/**
 * Three towers, built before the first wave on cells beside the path's
 * bends, clear all three waves with no creep out; with no towers five are
 * out during the second wave. Fuzz builds on random legal cells.
 */
export const towerDefenseProbe: GenreProbe<TowerDefenseSnapshot> = {
  id: ID,
  rows: ["tower-defense"],
  game,
  scene,
  script: {
    v: 1,
    scene: scene.name,
    maxTicks: 1800,
    steps: [order([2, 3]), order([6, 1]), order([4, 5]), { wait: 1800 }],
  },
  expect: { result: "won", maxTicks: 1200 },
  fuzz: { rollouts: 32, seed: 1, ticks: 1800, expect: { result: "won" }, timeoutMs: 30_000 },
  timeoutMs: 30_000,
};

import { z } from "zod";

import type { ViewportDef } from "../../camera/viewports";
import { createRegistry, defineEntityType, defineGame } from "../../game/define";
import { pointField } from "../../game/fields";
import type { EngineContext } from "../../game/types";
import { pxPerMetreOf } from "../../game/units";
import { flowField, type FlowField } from "../../grid/flow";
import type { Cell } from "../../grid/geometry";
import type { InputScript } from "../../headless/playtest-types";
import type { TilesetFile } from "../../project/kinds/tileset";
import { heldProject, type HeldFile, type ProjectRuntimeView } from "../../project/runtime-view";
import { paintGrid, type CellRect } from "../../scene/grid";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../../scene/types";
import { DEFAULT_TILE_COST } from "../../tiles/chunks";
import type { Vec2 } from "../../types";
import type { GenreProbe } from "./harness";

const ID = "rts";
const UNIT = `${ID}-unit`;
export const SELECT = "select";
export const MOVE = "move";

/** m: one cell. */
const CELL = 0.5;
const COLS = 48;
const ROWS = 32;
/** The army: a block of `ARMY_COLS` × `ARMY_ROWS` units, one a cell, from `ARMY_AT`. */
const ARMY_COLS = 20;
const ARMY_ROWS = 25;
const ARMY_AT: Cell = [2, 4];
export const RTS_UNITS = ARMY_COLS * ARMY_ROWS;
/** m/s on a plain tile; a dearer tile slows a unit by its cost over a plain one's. */
const SPEED = 4;
/** Cells around the `move` target that count as there, each way. */
const GOAL_REACH = 3;

/** Tile values (tile id + 1). */
const WALL = 1;
const MUD = 2;
const MUD_COST = 60;

const TILESET_ID = `${ID}-tileset`;
const TEXTURE_ID = `${ID}-tiles`;

export type RtsSnapshot = {
  /** The selected units' indices, ascending. */
  selected: number[];
  /** The cell the selection was last sent to. */
  to: Cell | null;
  /** Selected units standing in the target's cells. */
  arrived: number;
  /** The selection's centre, for the camera. */
  at: Vec2 | null;
};

const unitType = defineEntityType({
  type: UNIT,
  description: "One unit: it stands on its grid cell and walks where its selection is sent.",
  base: "marker",
  fields: { at: pointField("Where it stands.") },
});

const unitId = (i: number) => `unit-${i}`;
const centre = (c: number) => (c + 0.5) * CELL;
const inRect = (x: number, y: number, [x0, y0, x1, y1]: readonly number[]) =>
  x >= Math.min(x0!, x1!) &&
  x <= Math.max(x0!, x1!) &&
  y >= Math.min(y0!, y1!) &&
  y <= Math.max(y0!, y1!);

/**
 * An RTS skirmish with no physics: 500 occupant units on a tilemap whose
 * wall down the middle leaves a road gap far off and a mud gap straight
 * ahead. `select { rect }` boxes the units standing inside a world-space
 * rectangle; `move { to }` sends them along one flow field over the grid,
 * which prices each cell by its tiles, toward the cells around `to`. Mud
 * also slows a unit by its cost. Won once every selected unit stands there.
 */
export const rtsGame = defineGame<RtsSnapshot>({
  id: ID,
  types: [unitType],
  world: { physics: "none" },
  actions: [],
  commands: {
    [SELECT]: {
      description: "Box-select the units standing inside a rectangle.",
      args: z.strictObject({
        rect: z
          .tuple([z.number(), z.number(), z.number(), z.number()])
          .describe("Opposite corners, [x0, y0, x1, y1] in metres."),
      }),
    },
    [MOVE]: {
      description: "Send the selection to a point, each unit along the flow field.",
      args: z.strictObject({
        to: z.tuple([z.number(), z.number()]).describe("The target, [x, y] in metres."),
      }),
    },
  },
  play: {
    results: ["won"],
    focus: (snap) => snap.at,
    outcome: ({ snapshot }) =>
      snapshot.to !== null &&
      snapshot.selected.length > 0 &&
      snapshot.arrived === snapshot.selected.length
        ? { result: "won", cause: "the selection reached its target" }
        : null,
  },
  createRuntime(ctx: EngineContext) {
    let selected: number[] = [];
    let to: Cell | null = null;
    let field: FlowField | null = null;
    let arrived = 0;

    function send(target: Cell): void {
      const grid = ctx.grid;
      if (!grid) return;
      to = target;
      const goals: Cell[] = [];
      for (let r = target[1] - GOAL_REACH; r <= target[1] + GOAL_REACH; r++)
        for (let c = target[0] - GOAL_REACH; c <= target[0] + GOAL_REACH; c++) goals.push([c, r]);
      field = flowField(grid.geometry, goals, {
        bounds: grid.bounds,
        passable: (c) => grid.passable(c),
        cost: (f, t) => grid.cost?.(f, t) ?? 0,
      });
    }

    function march(dtMs: number): void {
      const grid = ctx.grid;
      arrived = 0;
      if (!grid || !field) return;
      for (const i of selected) {
        const id = unitId(i);
        const p = ctx.poses.get(id);
        if (!p) continue;
        const cell = grid.geometry.cellAt([p.x, p.y]);
        if (field.cost(cell) === 0) {
          arrived++;
          continue;
        }
        const next = field.next(cell);
        if (!next) continue;
        const [tx, ty] = grid.geometry.center(next);
        const extra = grid.cost?.(cell, next) ?? 0;
        let budget = ((SPEED * DEFAULT_TILE_COST) / (DEFAULT_TILE_COST + extra)) * (dtMs / 1000);
        const dx = tx - p.x;
        const dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        if (d <= budget) budget = d;
        if (d > 0) ctx.poses.set(id, p.x + (dx / d) * budget, p.y + (dy / d) * budget);
      }
    }

    return {
      onUnload() {
        selected = [];
        to = null;
        field = null;
        arrived = 0;
      },
      beforeStep(dtMs, _actions, commands) {
        for (const c of commands) {
          if (c.name === SELECT) {
            const { rect } = c.args as { rect: [number, number, number, number] };
            selected = [];
            for (let i = 0; i < RTS_UNITS; i++) {
              const p = ctx.poses.get(unitId(i));
              if (p && inRect(p.x, p.y, rect)) selected.push(i);
            }
          } else if (c.name === MOVE && ctx.grid) {
            const [x, y] = (c.args as { to: [number, number] }).to;
            send(ctx.grid.geometry.cellAt([x, y]));
          }
        }
        march(dtMs);
      },
      busy: () => field !== null && arrived < selected.length,
      snapshot: () => {
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (const i of selected) {
          const p = ctx.poses.get(unitId(i));
          if (!p) continue;
          sx += p.x;
          sy += p.y;
          n++;
        }
        return {
          selected: [...selected],
          to: to ? [to[0], to[1]] : null,
          arrived,
          at: n > 0 ? { x: sx / n, y: sy / n } : null,
        };
      },
      // Unit poses come back with the world save; the field is rebuilt from the target.
      restore(s) {
        selected = [...s.selected];
        arrived = s.arrived;
        field = null;
        to = null;
        if (s.to) send(s.to);
      },
    };
  },
});

const PX_PER_METRE = pxPerMetreOf(createRegistry(rtsGame));
const TILE_PX = Math.round(CELL * PX_PER_METRE);

const TILESET: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: TEXTURE_ID,
  tile: [TILE_PX, TILE_PX],
  columns: 2,
  tiles: [
    { id: 0, solid: true, tags: ["rock"] },
    { id: 1, cost: MUD_COST, tags: ["mud"] },
  ],
};

/** The tileset and its 2 × 1 texture, held as a project holds them. */
export const RTS_FILES: readonly HeldFile[] = [
  {
    path: `art/${TEXTURE_ID}.png`,
    sidecar: {
      kind: "asset-sidecar",
      v: 1,
      key: `key-${TEXTURE_ID}`,
      id: TEXTURE_ID,
      sha256: "c".repeat(64),
      bytes: 256,
      meta: { format: "png", width: TILE_PX * 2, height: TILE_PX },
    },
  },
  {
    path: `art/${ID}.tileset.json`,
    json: TILESET,
    sidecar: { kind: "asset-sidecar", v: 1, key: `key-${TILESET_ID}`, id: TILESET_ID },
  },
];

/** The project the skirmish loads against, outside a probe run. */
export function rtsProject(): ProjectRuntimeView {
  return heldProject(RTS_FILES, createRegistry(rtsGame), { projectId: ID, name: ID }).runtime;
}

/** A rock wall down column 24, open only at the road (rows 2–4) and the mud gap (rows 14–19). */
const TILE_RECTS: readonly CellRect[] = [
  [24, 0, 24, 1, WALL],
  [24, 5, 24, 13, WALL],
  [24, 20, 24, ROWS - 1, WALL],
  [22, 14, 26, 19, MUD],
];

/** Where the selection box and the target sit, in metres. */
export const RTS_BOX: [number, number, number, number] = [
  ARMY_AT[0] * CELL,
  ARMY_AT[1] * CELL,
  (ARMY_AT[0] + ARMY_COLS) * CELL,
  (ARMY_AT[1] + 20) * CELL,
];
export const RTS_TARGET: [number, number] = [centre(40), centre(16)];
/** The army's far side, where the perf case sends it back to. */
export const RTS_HOME: [number, number] = [centre(8), centre(16)];

/** The skirmish: the tilemap and the army, each unit an occupant that blocks no path. */
export function rtsScene(): SceneDefinition {
  const entities: EntityDef[] = [
    {
      id: "ground",
      type: "tilemap",
      at: [0, 0],
      tileset: TILESET_ID,
      cells: paintGrid({}, { rects: TILE_RECTS }).grid,
    },
  ];
  for (let i = 0; i < RTS_UNITS; i++)
    entities.push({
      id: unitId(i),
      type: UNIT,
      at: [centre(ARMY_AT[0] + (i % ARMY_COLS)), centre(ARMY_AT[1] + Math.floor(i / ARMY_COLS))],
      behaviors: { occupant: { blocks: false } },
    });
  return {
    v: SCENE_FORMAT_VERSION,
    game: ID,
    name: ID,
    bounds: [0, 0, COLS * CELL, ROWS * CELL],
    settings: { physics: "none", grid: { kind: "square", cell: [CELL, CELL] } },
    entities,
  };
}

/**
 * The perf case's march: the whole army selected and sent across the wall
 * and back every 200 ticks, under a game that never ends it, so every
 * measured tick walks all 500 units and each order rebuilds the field.
 */
export const RTS_PERF_GAME = { ...rtsGame, play: { ...rtsGame.play, outcome: () => null } };
export function rtsPerfScript(ticks: number): InputScript {
  const steps: InputScript["steps"] = [
    { command: SELECT, args: { rect: [0, 0, COLS * CELL, ROWS * CELL] } },
  ];
  for (let t = 0, i = 0; t < ticks; t += 200, i++)
    steps.push({ command: MOVE, args: { to: i % 2 === 0 ? RTS_TARGET : RTS_HOME } }, { wait: 200 });
  return { v: 1, maxTicks: ticks, steps };
}

/** The main view, and a minimap of the whole field in the corner. */
const VIEWPORTS: readonly ViewportDef[] = [
  { rect: [0, 0, 1, 1], frame: "main" },
  { rect: [0.75, 0.75, 0.25, 0.25], frame: "scene", border: { width: 2, color: 0x101010 } },
];

export const probe: GenreProbe<RtsSnapshot> = {
  id: ID,
  rows: ["rts"],
  game: rtsGame,
  scene: rtsScene(),
  project: { files: RTS_FILES },
  script: {
    v: 1,
    maxTicks: 1200,
    steps: [
      { wait: 5 },
      // The top 400 of the 500: the last five rows stay behind.
      { command: SELECT, args: { rect: RTS_BOX } },
      { command: MOVE, args: { to: RTS_TARGET } },
      { wait: 1190 },
    ],
  },
  expect: { result: "won", maxTicks: 600 },
  viewports: VIEWPORTS,
  view: true,
  variants: [
    // On the march, the front through the gaps and the rear still behind the wall.
    { name: "saved-mid-march", saveAt: 120 },
  ],
  timeoutMs: 120_000,
};

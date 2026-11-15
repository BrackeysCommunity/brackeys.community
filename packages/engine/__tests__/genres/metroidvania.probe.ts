import { defineGame } from "../../game/define";
import type { LibraryScene, SceneLibrary } from "../../game/flow";
import type { EngineContext, JsonValue } from "../../game/types";
import type { HeldFile } from "../../project/runtime-view";
import { paintGrid, type CellEdit, type CellRect, type GridCells } from "../../scene/grid";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import type { GenreProbe } from "./harness";

const ID = "metroidvania";
const HALL = "mv-hall";
const ROOM_A = "mv-room-a";
const ROOM_B = "mv-room-b";
const TILESET = "mv-tiles";
const TILES_IMAGE = "mv-tiles-art";

/** m: one grid cell; a whole 32 px tile at the game's 100 px per metre. */
const CELL = 0.32;
const PX_PER_METRE = 100;
const TILE_PX = Math.round(CELL * PX_PER_METRE);
/** Cells per room; room B attaches one room width east of room A. */
const ROOM_COLS = 10;
const FLOOR_ROW = 4;
/** Ticks per cell walked. */
const STEP_TICKS = 4;

/** Raised when the wanderer picks up the dash, opens the door, and reaches the goal. */
const ABILITY = `${ID}:ability`;
const OPENED = `${ID}:door-opened`;
const ARRIVED = `${ID}:arrived`;

/** Cell values: the tile id + 1. */
const FLOOR = 1;
const ORB = 2;
const DOOR = 3;
const GOAL = 4;

const TILESET_FILE = {
  kind: "tileset",
  v: 1,
  image: TILES_IMAGE,
  tile: [TILE_PX, TILE_PX],
  columns: 4,
  tiles: [
    { id: 0, solid: true, tags: ["floor"] },
    { id: 1, tags: ["orb"] },
    { id: 2, solid: true, tags: ["door"] },
    { id: 3, tags: ["goal"] },
  ],
};

const PROJECT_FILES: readonly HeldFile[] = [
  {
    path: "art/mv-tiles.png",
    sidecar: {
      kind: "asset-sidecar",
      v: 1,
      key: "key-mv-tiles-art",
      id: TILES_IMAGE,
      sha256: "c".repeat(64),
      bytes: 1_024,
      meta: { format: "png", width: TILE_PX * 4, height: TILE_PX },
    },
  },
  { path: `tiles/${TILESET}.json`, json: TILESET_FILE },
];

/** Whether the dash has been picked up, carried in `persist` across rooms, loads and saves. */
export type MetroidvaniaPersist = { dash: boolean };
export type MetroidvaniaSnapshot = { cell: [number, number]; walked: number; room: string };

const hasDash = (value: JsonValue): boolean =>
  !!value && typeof value === "object" && !Array.isArray(value) && value.dash === true;

const game = defineGame<MetroidvaniaSnapshot>({
  id: ID,
  types: [],
  world: { physics: "none", lengthUnit: PX_PER_METRE },
  actions: [{ action: "right", keys: ["ArrowRight"], description: "Walk east." }],
  time: { kind: "fixed" },
  persist: { initial: () => ({ dash: false }) },
  play: {
    focus: (snap) =>
      snap ? { x: (snap.cell[0] + 0.5) * CELL, y: (snap.cell[1] + 0.5) * CELL } : null,
    movementActions: ["right"],
    results: ["won"],
    outcome({ events }) {
      const goal = events.find((e) => e.type === ARRIVED);
      return goal ? { result: "won", cause: "reached the goal" } : null;
    },
  },
  createRuntime(ctx: EngineContext) {
    let cell: [number, number] = [1, FLOOR_ROW - 1];
    let walked = 0;

    const tagged = (c: [number, number], tag: string) =>
      ctx.tiles.at(c).find((t) => t.def?.tags?.includes(tag));
    const solid = (c: [number, number]) => ctx.tiles.at(c).some((t) => t.def?.solid);
    const roomOf = (col: number) => (col < ROOM_COLS ? "a" : "b");

    return {
      onLoad(scene) {
        const start = scene.entities.find((e) => e.type === "marker" && e.id === "start");
        if (start?.at) {
          const [x, y] = start.at as [number, number];
          cell = [Math.floor(x / CELL), Math.floor(y / CELL)];
        }
        walked = 0;
      },
      beforeStep() {
        // Attached on the first step, not at load: a restore brings the save's sublevels back itself.
        if (ctx.flow.sublevels().length === 0) {
          for (const [scene, label, col] of [
            [ROOM_A, "a", 0],
            [ROOM_B, "b", ROOM_COLS],
          ] as const) {
            const attached = ctx.flow.attach(scene, { label, at: [col * CELL, 0] });
            if (!attached.ok) throw new Error(attached.issue.message);
          }
          return;
        }
        if (!ctx.input.held("right") || ctx.tick % STEP_TICKS !== 0) return;
        const next: [number, number] = [cell[0] + 1, cell[1]];
        const door = tagged(next, "door");
        if (door && hasDash(ctx.persist.value)) {
          const edits: CellEdit[] = ctx.tiles
            .find(door.map, "door")
            .map(([c, r]): CellEdit => [c, r, 0]);
          ctx.tiles.paint(door.map, { cells: edits });
          ctx.emit({ type: OPENED, at: { x: next[0] * CELL, y: next[1] * CELL } });
        }
        if (solid(next)) return;
        cell = next;
        walked++;
        const at = { x: (cell[0] + 0.5) * CELL, y: (cell[1] + 0.5) * CELL };
        const orb = tagged(cell, "orb");
        if (orb) {
          ctx.persist.set({ dash: true } satisfies MetroidvaniaPersist);
          ctx.tiles.paint(orb.map, { cells: [[cell[0], cell[1], 0]] });
          ctx.emit({ type: ABILITY, at });
        }
        if (tagged(cell, "goal")) ctx.emit({ type: ARRIVED, at });
      },
      snapshot: () => ({ cell: [cell[0], cell[1]], walked, room: roomOf(cell[0]) }),
      restore(s) {
        cell = [s.cell[0], s.cell[1]];
        walked = s.walked;
      },
    };
  },
});

const grid = (edit: { cells?: readonly CellEdit[]; rects?: readonly CellRect[] }): GridCells =>
  paintGrid({}, edit).grid;

const settings = {
  gravity: [0, 0],
  physics: "none",
  grid: { kind: "square", cell: [CELL, CELL] },
} satisfies SceneDefinition["settings"];

const room = (name: string, cells: GridCells): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name,
  bounds: [0, 0, ROOM_COLS * CELL, (FLOOR_ROW + 1) * CELL],
  settings,
  entities: [{ id: "map", type: "tilemap", at: [0, 0], tileset: TILESET, cells }],
});

/** Room A: a floor and the dash orb on it. */
const roomA = room(
  ROOM_A,
  grid({
    rects: [[0, FLOOR_ROW, ROOM_COLS - 1, FLOOR_ROW, FLOOR]],
    cells: [[5, FLOOR_ROW - 1, ORB]],
  }),
);
/** Room B: a floor, a full-height door only the dash opens, and the goal past it. */
const roomB = room(
  ROOM_B,
  grid({
    rects: [
      [0, FLOOR_ROW, ROOM_COLS - 1, FLOOR_ROW, FLOOR],
      [3, 0, 3, FLOOR_ROW - 1, DOOR],
    ],
    cells: [[8, FLOOR_ROW - 1, GOAL]],
  }),
);

/** The main scene: only where the wanderer starts; both rooms attach beside it. */
const hall: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: HALL,
  bounds: [0, 0, 2 * ROOM_COLS * CELL, (FLOOR_ROW + 1) * CELL],
  settings,
  entities: [{ id: "start", type: "marker", at: [1.5 * CELL, (FLOOR_ROW - 0.5) * CELL] }],
};

export const METROIDVANIA_FLOW: SceneLibrary = {
  list: [{ scene: HALL }, { scene: ROOM_A, sublevel: true }, { scene: ROOM_B, sublevel: true }],
  scenes: new Map<string, LibraryScene>(
    [hall, roomA, roomB].map((def) => [def.name, { def, prefabs: new Map() }]),
  ),
};

/**
 * Walks east through room A, picking up the dash (a runtime tile write and a
 * `persist` flag), into room B, where the door opens only because the flag
 * is set, and on to the goal. Saved mid-run between the orb and the door.
 */
export const metroidvaniaProbe: GenreProbe<MetroidvaniaSnapshot> & { flow: SceneLibrary } = {
  id: ID,
  rows: ["metroidvania"],
  game,
  scene: hall,
  flow: METROIDVANIA_FLOW,
  project: { files: PROJECT_FILES },
  script: {
    v: 1,
    scene: HALL,
    maxTicks: 200,
    steps: [{ hold: ["right"], until: { event: ARRIVED }, max: 180 }],
  },
  expect: { result: "won", maxTicks: 200 },
  variants: [{ name: "saved", saveAt: 40 }],
  view: true,
  viewports: [
    { rect: [0, 0, 1, 1], frame: "main" },
    { rect: [0.75, 0, 0.25, 0.25], frame: "scene", border: { width: 2, color: 0x202020 } },
  ],
};

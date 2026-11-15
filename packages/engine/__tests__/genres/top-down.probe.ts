import { DIALOGUE_ADVANCE_COMMAND } from "../../game/commands";
import { defineGame } from "../../game/define";
import type { EngineContext } from "../../game/types";
import { createMotionBody } from "../../motion/body";
import { createTopDownController, type TopDownController } from "../../motion/top-down";
import { DIALOGUE_KIND, type DialogueFile } from "../../project/kinds/dialogue";
import { STRINGS_KIND, type StringsFile } from "../../project/kinds/strings";
import type { TilesetFile } from "../../project/kinds/tileset";
import type { HeldFile } from "../../project/runtime-view";
import { SENSOR_ENTER } from "../../runtime/types";
import { paintGrid, type CellRect } from "../../scene/grid";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Pt,
  type SceneDefinition,
} from "../../scene/types";
import type { Vec2 } from "../../types";
import type { GenreProbe } from "./harness";

const ID = "top-down";
/** The tag on the marker the rover starts at, on the sensor it drives into, and on the NPC's sensor. */
const ROVER = "rover";
const GOAL = "goal";
const NPC = "npc";
/** Raised when the rover enters a goal sensor. */
const ARRIVED = `${ID}:arrived`;

/** The NPC's conversation, the strings it reads, and the corridor's tileset and its image. */
const TALK = "top-down-npc-talk";
const STRINGS = "top-down-strings";
const TILESET = "top-down-tiles";
const TILE_SHEET = "top-down-tile-sheet";
/** Metres; 16 px tiles at the default 100 px per metre. */
const CELL = 0.16;
/** Cell values: a tile's id + 1. */
const FLOOR = 1;
const WALL = 2;

/** m/s and m/s². */
const TUNING = { maxSpeed: 1.6, accel: 8, decel: 6 };
/** The rover's half width, m. */
const HALF = 0.06;

export type TopDownSnapshot = { position: Vec2; velocity: Vec2 } | null;

const DIRECTIONS: Readonly<Record<string, Vec2>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

const game = defineGame<TopDownSnapshot>({
  id: ID,
  types: [],
  actions: Object.keys(DIRECTIONS).map((action) => ({
    action,
    keys: [`Arrow${action.charAt(0).toUpperCase()}${action.slice(1)}`],
    description: `Steer ${action}.`,
  })),
  collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
  time: { kind: "fixed" },
  play: {
    focus: (snap) => snap?.position ?? null,
    movementActions: Object.keys(DIRECTIONS),
    results: ["won"],
    outcome({ events }) {
      const goal = events.find((e) => e.type === ARRIVED);
      return goal ? { result: "won", cause: "reached the goal", entityId: goal.entityId } : null;
    },
  },
  createRuntime(ctx: EngineContext) {
    let rover: TopDownController | null = null;
    let roverId: string | null = null;
    let position: () => Vec2 = () => ({ x: 0, y: 0 });
    let goals = new Set<string>();
    let npcs = new Set<string>();

    return {
      onLoad(scene) {
        const tagged = (type: string, tag: string) =>
          scene.entities.filter(
            (e) => e.type === type && (e.tags as string[] | undefined)?.includes(tag),
          );
        goals = new Set(tagged("sensor", GOAL).map((e) => e.id));
        npcs = new Set(tagged("sensor", NPC).map((e) => e.id));
        const start = tagged("marker", ROVER)[0];
        if (!start) return;
        const [x, y] = start.at as Pt;
        const at = ctx.play?.at ?? { x, y };
        const body = createMotionBody(ctx, { id: start.id, type: start.type }, at, {
          shape: { type: "box", cx: 0, cy: 0, hw: HALF, hh: HALF, rotDeg: 0 },
        });
        roverId = start.id;
        position = () => body.position();
        rover = createTopDownController(body, TUNING);
      },
      onUnload() {
        rover = null;
        roverId = null;
        goals.clear();
        npcs.clear();
      },
      beforeStep(dtMs) {
        if (!rover) return;
        const intent = { x: 0, y: 0 };
        // The rover stands still while the NPC talks.
        if (!ctx.dialogue.view()) {
          for (const [action, d] of Object.entries(DIRECTIONS)) {
            if (!ctx.input.held(action)) continue;
            intent.x += d.x;
            intent.y += d.y;
          }
        }
        rover.step(dtMs, intent);
      },
      afterStep(_dtMs, events) {
        for (const e of events) {
          if (e.type !== SENSOR_ENTER || e.other !== roverId) continue;
          if (goals.has(e.entityId!)) ctx.emit({ type: ARRIVED, entityId: e.entityId, at: e.at });
          else if (npcs.delete(e.entityId!)) ctx.dialogue.start(TALK);
        }
      },
      snapshot() {
        if (!rover) return null;
        return { position: position(), velocity: rover.velocity() };
      },
      // The rover's body and the conversation come back with the world save, held directions with the input.
      restore() {},
    };
  },
});

/** Each wall as a rect of cells, inclusive: [c0, r0, c1, r1]. */
const WALLS: readonly (readonly [number, number, number, number])[] = [
  [0, 3, 30, 3],
  [30, 3, 30, 25],
  [0, 4, 0, 7],
  [0, 8, 25, 8],
  [25, 8, 25, 25],
  [26, 25, 29, 25],
];

const rects = (
  rs: readonly (readonly [number, number, number, number])[],
  value: number,
): CellRect[] => rs.map(([c0, r0, c1, r1]) => [c0, r0, c1, r1, value]);

/** Floor under the corridor's two legs; drawn only. */
const floor = paintGrid(
  {},
  {
    rects: rects(
      [
        [1, 4, 29, 7],
        [26, 8, 29, 24],
      ],
      FLOOR,
    ),
  },
).grid;
const walls = paintGrid({}, { rects: rects(WALLS, WALL) }).grid;

const TILES: TilesetFile = {
  kind: "tileset",
  v: 1,
  image: TILE_SHEET,
  tile: [16, 16],
  columns: 2,
  tiles: [
    { id: 0, tags: ["floor"] },
    { id: 1, solid: true, tags: ["wall"] },
  ],
};

const TALK_FILE: DialogueFile = {
  kind: DIALOGUE_KIND,
  v: 1,
  start: "greet",
  speakers: [{ id: "keeper", name: "top-down.speaker.keeper" }],
  nodes: [
    {
      id: "greet",
      lines: [
        { speaker: "keeper", text: "top-down.greet" },
        { speaker: "keeper", text: "top-down.way" },
      ],
      end: "greeted",
    },
  ],
};

const STRINGS_FILE: StringsFile = {
  kind: STRINGS_KIND,
  v: 1,
  strings: [
    { key: "top-down.speaker.keeper", en: "Keeper" },
    { key: "top-down.greet", en: "Mind the corner." },
    { key: "top-down.way", en: "The goal is south." },
  ],
};

const FILES: readonly HeldFile[] = [
  { path: `dialogue/${TALK}.json`, json: TALK_FILE },
  { path: `text/${STRINGS}.json`, json: STRINGS_FILE },
  { path: `tiles/${TILESET}.json`, json: TILES },
  {
    path: "art/top-down-tiles.png",
    sidecar: {
      kind: "asset-sidecar",
      v: 1,
      key: "key-top-down-tile-sheet",
      id: TILE_SHEET,
      sha256: "c".repeat(64),
      bytes: 256,
      meta: { format: "png", width: 32, height: 16 },
    },
  },
];

/**
 * An L-shaped corridor four cells (0.64 m) wide, its walls and floor two
 * tilemaps on a 0.16 m grid: east along rows 4–7 from the start, past an
 * NPC who stops the rover to talk, then south along columns 26–29 to a goal
 * sensor near its foot. Wall tiles merge into axis-aligned boxes, so the
 * geometry backend's sweeps are exact.
 */
const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "top-down-probe",
  bounds: [0, 0, 5.12, 4.48],
  settings: {
    gravity: [0, 0],
    physics: "rapier",
    grid: { kind: "square", cell: [CELL, CELL] },
  },
  entities: [
    { id: "floor", type: "tilemap", at: [0, 0], tileset: TILESET, cells: floor, z: -1 },
    { id: "walls", type: "tilemap", at: [0, 0], tileset: TILESET, cells: walls },
    { id: "start", type: "marker", at: [0.48, 0.96], tags: [ROVER] },
    { id: "keeper", type: "sensor", shape: ["box", 2.4, 0.96, 0.08, 0.32], tags: [NPC] },
    { id: "goal", type: "sensor", shape: ["box", 4.48, 3.68, 0.24, 0.16], tags: [GOAL] },
  ] as EntityDef[],
};

const advance = { command: DIALOGUE_ADVANCE_COMMAND };

/**
 * Zero gravity; a top-down controller steers east until the NPC's
 * conversation stops it, talks it through, then slides south along the far
 * wall into the goal.
 */
export const topDownProbe: GenreProbe<TopDownSnapshot> = {
  id: ID,
  rows: ["top-down", "racing"],
  game,
  scene,
  project: { files: FILES },
  script: {
    v: 2,
    scene: scene.name,
    maxTicks: 900,
    steps: [
      { hold: ["right"], until: { dialogue: { active: true } }, max: 200 },
      { wait: 20 },
      advance,
      { wait: 10 },
      advance,
      { hold: ["right"], for: 60 },
      { hold: ["right", "down"], until: { event: ARRIVED }, max: 500 },
    ],
  },
  expect: { result: "won", maxTicks: 900 },
  variants: [
    { name: "physics-none", settings: { physics: "none" } },
    { name: "gravity-sideways", settings: { gravity: [12, 0] } },
    // Mid-conversation; a world save needs the geometry backend.
    { name: "saved-physics-none", settings: { physics: "none" }, saveAt: 100 },
  ],
};

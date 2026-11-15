import { readFileSync } from "node:fs";

import type { InputScriptStepV2, InputScriptV2 } from "../../headless/playtest-types";
import type { HeldFile } from "../../project/runtime-view";
import type { PresentedRequest } from "../../runtime/present";
import { paintGrid } from "../../scene/grid";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../../scene/types";
import type { GenreProbe } from "./harness";
import {
  HERO_HH,
  HERO_HW,
  behaviorsGame,
  entered,
  type BehaviorPoses,
} from "./side-view-behaviors.probe";

const ID = "side-scroller";
const HERO = "hero";
const GOAL = "goal";
const PIT = "pit";
/** m: the scene's grid cell, the kitchen tileset's 25 px tile at the default 100 px per metre. */
const CELL = 0.25;
/** Tile values are the tileset's tile id plus one; 0 is empty. */
const STONE = 1;
const PLANK = 3;
/** The floor's top row and its top, m. */
const FLOOR_ROW = 28;
const FLOOR = FLOOR_ROW * CELL;
/** The one-way plank's row, and the floor gap it bridges, in columns. */
const PLANK_ROW = 20;
const GAP: [number, number] = [44, 55];

const scenesDir = new URL("../../scenes/", import.meta.url);

/** A file of the engine project held as a host holds it: docs with their JSON, binaries by sidecar alone. */
function held(path: string, doc: boolean): HeldFile {
  const read = (p: string) => JSON.parse(readFileSync(new URL(p, scenesDir), "utf8")) as unknown;
  return {
    path,
    ...(doc ? { json: read(path) } : {}),
    sidecar: read(`${path}.asset.json`) as HeldFile["sidecar"],
  };
}

/** The kitchen sink's tileset, hero atlas and clip, and the clink sound, which plays on `character:landed`. */
const FILES: readonly HeldFile[] = [
  held("art/kitchen-tiles.png", false),
  held("art/kitchen.tileset.json", true),
  held("art/hero.png", false),
  held("art/hero.json", false),
  held("art/kitchen.animation.json", true),
  held("audio/clink.wav", false),
  held("audio/clink.synth.json", true),
  held("audio/clink.sound.json", true),
];

/** Stone floor with a gap. */
const ground = paintGrid(
  {},
  {
    rects: [
      [0, FLOOR_ROW, GAP[0] - 1, FLOOR_ROW + 1, STONE],
      [GAP[1] + 1, FLOOR_ROW, 95, FLOOR_ROW + 1, STONE],
    ],
  },
).grid;

/**
 * The one-way plank over the gap, on a map of its own: a character passing a
 * one-way collider leaves out that collider's whole entity from its sweeps.
 */
const planks = paintGrid({}, { rects: [[36, PLANK_ROW, 63, PLANK_ROW, PLANK]] }).grid;

const hero: EntityDef = {
  id: HERO,
  type: "marker",
  at: [1, FLOOR - HERO_HH],
  behaviors: {
    collider: { shape: ["box", 0, 0, HERO_HW, HERO_HH] },
    "character-side-view": { maxSpeed: 5, jumpHeight: 2.4, airControl: 0.8, coyoteMs: 80 },
    "player-input": { seat: 0 },
    "camera-target": {},
    sprite: { asset: "hero", frame: "hero-0", size: [0.4, 0.8] },
    anim: { clip: "idle", source: "kitchen-animation" },
  },
} as EntityDef;

const game = behaviorsGame({
  id: ID,
  seats: 1,
  join: "auto",
  physics: "rapier",
  results: ["won", "fell"],
  focus: HERO,
  outcome(state) {
    if (entered(state, GOAL, [HERO]))
      return { result: "won", cause: "the hero reached the goal", entityId: HERO };
    if (entered(state, PIT, [HERO]))
      return { result: "fell", cause: "the hero fell into the gap", entityId: HERO };
    return null;
  },
});

/**
 * A metric tile course under Rapier: a stone floor with a gap, a one-way
 * plank over it, a pit below the gap, a goal at the far end and a camera
 * region framing the run.
 */
const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "side-scroller-probe",
  bounds: [0, 0, 24, 8],
  settings: { gravity: [0, 20], grid: { kind: "square", cell: [CELL, CELL] } },
  entities: [
    { id: "ground", type: "tilemap", at: [0, 0], tileset: "kitchen-tileset", cells: ground },
    { id: "planks", type: "tilemap", at: [0, 0], tileset: "kitchen-tileset", cells: planks },
    { id: "framing", type: "camera-region", shape: ["box", 12, 4, 12, 4], ease: 0.5, zoom: 1 },
    { id: GOAL, type: "sensor", shape: ["box", 22, FLOOR - 1, 0.5, 1] },
    { id: PIT, type: "sensor", shape: ["box", 12.5, 7.9, 1.5, 0.1] },
    hero,
  ] as EntityDef[],
};

const run = (ticks: number, x = 1): InputScriptStepV2 => ({ set: { move: [x, 0] }, for: ticks });
const jump = (ticks: number, x = 0): InputScriptStepV2 => ({
  hold: ["jump"],
  set: { move: [x, 0] },
  for: ticks,
});

/**
 * Runs to below the plank's near end, jumps straight up through it, lands
 * on top, runs over the gap, drops off its far end to the floor and runs
 * to the goal.
 */
const script: InputScriptV2 = {
  v: 2,
  scene: scene.name,
  maxTicks: 420,
  steps: [{ wait: 10 }, run(110), { wait: 20 }, jump(30), { wait: 30 }, run(160)],
};

/** A side-scrolling platformer on a tilemap with one-way tiles, an animated sprite and a landing sound. */
export const sideScrollerProbe: GenreProbe<BehaviorPoses> = {
  id: ID,
  rows: ["platformer"],
  game,
  scene,
  project: { files: FILES },
  script,
  expect: { result: "won", maxTicks: 420 },
  recordPresentation: true,
};

/** Where the hero lands, in order: settling at spawn, on top of the plank, on the floor past the gap. */
const LANDINGS = [
  { y: FLOOR - HERO_HH, x0: 0, x1: 2 },
  { y: PLANK_ROW * CELL - HERO_HH, x0: 9, x1: 16 },
  { y: FLOOR - HERO_HH, x0: GAP[1] * CELL, x1: 22 },
];

/**
 * Where a run's presentation requests differ from the landings the course
 * makes: the clink sound asked once per `character:landed`, on the hero,
 * at each landing's height and span. Null when they agree.
 */
export function sideScrollerLandingMismatch(present: readonly PresentedRequest[]): string | null {
  const plays = present.flatMap((r) =>
    r.kind === "audio" && r.op.op === "play" && r.op.on === "character:landed" ? [r.op] : [],
  );
  if (plays.length !== LANDINGS.length)
    return `the landing sound played ${plays.length} times, not ${LANDINGS.length}`;
  for (const [i, play] of plays.entries()) {
    const want = LANDINGS[i]!;
    if (play.sound !== "clink" || play.entity !== HERO)
      return `landing ${i} played ${play.sound} on ${play.entity}`;
    const at = play.at;
    if (!at || Math.abs(at.y - want.y) > 0.01 || at.x < want.x0 || at.x > want.x1)
      return `landing ${i} was at ${JSON.stringify(at)}`;
  }
  return null;
}

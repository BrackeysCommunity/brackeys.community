import { readdirSync, readFileSync } from "node:fs";

import { createRegistry, defineGame } from "../../game/define";
import type {
  ActionDef,
  Binding,
  EngineContext,
  GameDefinition,
  GameOutcome,
  PlayState,
} from "../../game/types";
import type { InputScriptStepV2, InputScriptV2 } from "../../headless/playtest-types";
import { SENSOR_ENTER } from "../../runtime/types";
import { parseScene } from "../../scene/parse";
import { parsePrefab, prefabLibrary } from "../../scene/prefab";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Prefab,
  type Pt,
  type SceneDefinition,
} from "../../scene/types";
import type { Vec2 } from "../../types";
import type { GenreProbe } from "./harness";

/** Every carrier of a behavior, by id, at its pose: what a behaviors-only game snapshots. */
export type BehaviorPoses = Record<string, [x: number, y: number, rot: number]>;

const key = (code: string, axis: "x" | "y", value: number, player: number): Binding => ({
  device: "key",
  code,
  axis,
  value,
  player,
});

/** Seat 0 on WASD and Space, seat 1 on the arrows and Enter; a pad drives whichever seat it joined. */
const ACTIONS: readonly ActionDef[] = [
  {
    action: "move",
    kind: "vector",
    bindings: [
      { device: "pad", stick: "left" },
      key("KeyA", "x", -1, 0),
      key("KeyD", "x", 1, 0),
      key("KeyW", "y", -1, 0),
      key("KeyS", "y", 1, 0),
      key("ArrowLeft", "x", -1, 1),
      key("ArrowRight", "x", 1, 1),
      key("ArrowUp", "y", -1, 1),
      key("ArrowDown", "y", 1, 1),
    ],
    description: "Run, or walk in the plane.",
  },
  {
    action: "jump",
    bindings: [
      { device: "pad", button: "south" },
      { device: "key", code: "Space", player: 0 },
      { device: "key", code: "Enter", player: 1 },
    ],
    description: "Jump.",
  },
];

/**
 * A game with no runtime logic of its own: the scene's standard behaviors
 * do everything. Its snapshot is the pose of every entity carrying a
 * behavior, so a run's digest covers what they moved; poses come back with
 * a world save, so its restore has nothing to do. `outcome` reads the
 * tick's events only. Characters sit in the engine's dynamic group, which
 * meets sensors here so a goal can see them.
 */
export function behaviorsGame(opts: {
  id: string;
  seats: number;
  join: "auto" | "press" | "host";
  results: readonly string[];
  outcome: (state: PlayState<BehaviorPoses>) => GameOutcome | null;
  /** The entity the camera and the trail follow. */
  focus?: string;
  /** Default "none". */
  physics?: "none" | "rapier";
}): GameDefinition<BehaviorPoses> {
  return defineGame<BehaviorPoses>({
    id: opts.id,
    types: [],
    actions: ACTIONS.map((a) => ({
      ...a,
      bindings: a.bindings?.filter((b) => !("player" in b) || (b.player ?? 0) < opts.seats),
    })),
    input: { players: { max: opts.seats, join: opts.join } },
    collisionGroups: { dynamic: { collidesWith: ["sensor"] } },
    world: { physics: opts.physics ?? "none" },
    time: { kind: "fixed", rate: 60 },
    play: {
      ...(opts.focus
        ? {
            focus: (snap: BehaviorPoses): Vec2 | null => {
              const at = snap[opts.focus!];
              return at ? { x: at[0], y: at[1] } : null;
            },
          }
        : {}),
      results: opts.results,
      outcome: opts.outcome,
    },
    createRuntime(ctx: EngineContext) {
      return {
        snapshot() {
          const out: BehaviorPoses = {};
          for (const id of ctx.query.select()) {
            if (!ctx.get(id)?.behaviors) continue;
            const p = ctx.poses.get(id);
            if (p) out[id] = [p.x, p.y, p.rot];
          }
          return out;
        },
        restore() {},
      };
    },
  });
}

/** The first `sensor:enter` this tick of `sensor` by one of `who`, with who it was. */
export function entered(
  state: PlayState<unknown>,
  sensor: string,
  who: readonly string[],
): string | null {
  for (const e of state.events)
    if (e.type === SENSOR_ENTER && e.entityId === sensor && e.other && who.includes(e.other))
      return e.other;
  return null;
}

/** Half a side-view hero's box, m. */
export const HERO_HW = 0.2;
export const HERO_HH = 0.4;

/** A hero on `seat`: a collider, the side-view character, its seat and a camera target. */
export function sideHero(id: string, at: Pt, seat: number): EntityDef {
  return {
    id,
    type: "marker",
    at,
    behaviors: {
      collider: { shape: ["box", 0, 0, HERO_HW, HERO_HH] },
      "character-side-view": {},
      "player-input": { seat },
      "camera-target": {},
    },
  } as EntityDef;
}

/** A solid box by its left, top, right and bottom edges, m. */
export function slab(
  id: string,
  x0: number,
  top: number,
  x1: number,
  bottom: number,
  extra: Partial<EntityDef> = {},
): EntityDef {
  const hw = (x1 - x0) / 2;
  const hh = (bottom - top) / 2;
  return { id, type: "solid", shape: ["box", x0 + hw, top + hh, hw, hh], ...extra } as EntityDef;
}

/** A kinematic platform `hw` wide each side of its path, riding `path` at `speed` m/s. */
export function lift(
  id: string,
  pts: readonly Pt[],
  speed: number,
  hw: number,
  hh = 0.1,
): EntityDef {
  return {
    id,
    type: "marker",
    at: pts[0]!,
    behaviors: {
      collider: { shape: ["box", 0, 0, hw, hh] },
      body: { kind: "kinematic" },
      "path-follow": { path: { pts: pts.map((p) => [p[0], p[1]]), mode: "ping_pong", speed } },
    },
  } as EntityDef;
}

const ID = "side-view-behaviors";
const HERO = "hero";
const GOAL = "goal";
const PIT = "pit";
/** The floor's top, m. */
const FLOOR = 9;
/** The hero's centre standing on the floor. */
const STANDING = FLOOR - HERO_HH - 0.0005;

const game = behaviorsGame({
  id: ID,
  seats: 1,
  join: "auto",
  results: ["reached-goal", "fell"],
  focus: HERO,
  outcome(state) {
    if (entered(state, GOAL, [HERO]))
      return { result: "reached-goal", cause: "the hero reached the goal", entityId: HERO };
    if (entered(state, PIT, [HERO]))
      return { result: "fell", cause: "the hero fell into the pit", entityId: HERO };
    return null;
  },
});

/**
 * A run-and-jump course, physics none: a floor with a gap to jump, a
 * one-way plank to hop up through and run off, a lift to ride across a wide
 * pit, and a goal at the far end. Nothing but standard behaviors and
 * primitives.
 */
const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "side-view-behaviors-probe",
  bounds: [0, 0, 36, 12],
  settings: { gravity: [0, 20] },
  entities: [
    slab("floor-a", 0, FLOOR, 8, 10),
    slab("floor-b", 10, FLOOR, 20, 10),
    slab("plank", 13, 7.9, 16, 8, { oneWay: true } as Partial<EntityDef>),
    lift(
      "lift",
      [
        [21, FLOOR + 0.1],
        [27, FLOOR + 0.1],
      ],
      2,
      1,
    ),
    slab("floor-c", 28, FLOOR, 36, 10),
    { id: GOAL, type: "sensor", shape: ["box", 33, 8, 0.5, 1] },
    { id: PIT, type: "sensor", shape: ["box", 18, 11.5, 18, 0.5] },
    sideHero(HERO, [1, STANDING], 0),
  ],
};

const run = (ticks: number, x = 1): InputScriptStepV2 => ({ set: { move: [x, 0] }, for: ticks });
const jump = (ticks: number, x = 1): InputScriptStepV2 => ({
  hold: ["jump"],
  set: { move: [x, 0] },
  for: ticks,
});

/**
 * Runs, jumps the gap, hops up through the plank and off its end, waits at
 * the pit's edge for the lift to come back, rides it across and runs to
 * the goal.
 */
const script: InputScriptV2 = {
  v: 2,
  scene: scene.name,
  maxTicks: 900,
  steps: [
    run(60),
    jump(20),
    run(30),
    jump(20),
    run(54),
    { wait: 161 },
    run(12),
    { wait: 175 },
    run(90),
  ],
};

/** A side-view platformer course built from standard behaviors only, physics none. */
export const sideViewBehaviorsProbe: GenreProbe<BehaviorPoses> = {
  id: ID,
  rows: ["platformer"],
  pending: { platformer: "M22 (animation, cameras), M23 (audio), M25 (tilemaps)" },
  game,
  scene,
  script,
  expect: { result: "reached-goal", maxTicks: 900 },
  variants: [
    { name: "saved-mid-jump", saveAt: 70 },
    { name: "saved-on-the-lift", saveAt: 450 },
  ],
};

// ─── The engine's behavior yard, played from its own script ───

const YARD = "behavior-yard";
const YARD_HERO = "runner/hero";
const scenesDir = new URL("../../scenes/", import.meta.url);

const yardGame = behaviorsGame({
  id: YARD,
  seats: 2,
  join: "auto",
  physics: "rapier",
  results: ["reached-goal"],
  focus: YARD_HERO,
  outcome: (state) =>
    entered(state, "goal", [YARD_HERO])
      ? { result: "reached-goal", cause: "the side hero reached the goal", entityId: YARD_HERO }
      : null,
});

function yardPrefabs() {
  const registry = createRegistry(yardGame);
  const dir = new URL("prefabs/", scenesDir);
  const prefabs: Prefab[] = [];
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    const parsed = parsePrefab(readFileSync(new URL(name, dir), "utf8"), registry);
    if (!parsed.ok) throw new Error(`${name}: ${JSON.stringify(parsed.issues)}`);
    prefabs.push(parsed.prefab);
  }
  return prefabLibrary(prefabs);
}

function yardScene(): SceneDefinition {
  const parsed = parseScene(
    readFileSync(new URL(`${YARD}.json`, scenesDir), "utf8"),
    createRegistry(yardGame),
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return { ...parsed.def, game: YARD };
}

/**
 * The engine project's `behavior-yard` played headless from its input
 * script, under a game with no logic of its own, so its run is pinned with
 * the probes'.
 */
export const behaviorYardProbe: GenreProbe<BehaviorPoses> = {
  id: YARD,
  rows: ["platformer"],
  pending: { platformer: "M22 (animation, cameras), M23 (audio), M25 (tilemaps)" },
  game: yardGame,
  scene: yardScene(),
  prefabs: yardPrefabs(),
  script: JSON.parse(
    readFileSync(new URL(`${YARD}.script.json`, scenesDir), "utf8"),
  ) as InputScriptV2,
  expect: { result: "reached-goal" },
};

import { NAV_AGENT, type NavAgentSystem } from "../../game/behaviors/nav-agent";
import type { InputScriptV2 } from "../../headless/playtest-types";
import type { SeatChange, TickInput } from "../../input/stream";
import type { SceneRuntimeHandle, StepEvent } from "../../runtime/types";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../../scene/types";
import type { InputAction } from "../../types";
import type { GenreProbe } from "./harness";
import {
  behaviorsGame,
  entered,
  HERO_HH,
  lift,
  sideHero,
  slab,
  type BehaviorPoses,
} from "./side-view-behaviors.probe";

const ID = "versus-behaviors";
const SEATS = 2;
const HEROES = ["hero-0", "hero-1"] as const;
const CROWN = "crown";
const WINS = ["seat-0-wins", "seat-1-wins"] as const;
const FLOOR = 8;

const game = behaviorsGame({
  id: ID,
  seats: SEATS,
  join: "press",
  results: WINS,
  focus: HEROES[0],
  outcome(state) {
    const who = entered(state, CROWN, HEROES);
    if (!who) return null;
    const seat = HEROES.indexOf(who as (typeof HEROES)[number]);
    return { result: WINS[seat]!, cause: `seat ${seat} took the crown`, entityId: who };
  },
});

/**
 * A walled 16 × 9 m arena, physics none: the fighters start at either end,
 * an updraft in the middle lifts whoever stands in it to the crown, and a
 * spawner sheds sparks above. Standard behaviors and primitives only.
 */
const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "versus-behaviors-probe",
  bounds: [0, 0, 16, 9],
  settings: { gravity: [0, 20] },
  entities: [
    slab("floor", 0, FLOOR, 16, 9),
    slab("west", 0, 0, 0.2, FLOOR),
    slab("east", 15.8, 0, 16, FLOOR),
    {
      id: "updraft",
      type: "marker",
      at: [8, 5.5],
      behaviors: {
        collider: { shape: ["box", 0, 0, 0.6, 2.5], sensor: true },
        "force-area": { force: [0, -40] },
      },
    } as EntityDef,
    { id: CROWN, type: "sensor", shape: ["box", 8, 3.6, 0.4, 0.3] },
    {
      id: "sparks",
      type: "marker",
      at: [8, 1],
      behaviors: { spawner: { type: "marker", rate: 2, cap: 4, lifeMs: 1000, spread: 1 } },
    } as EntityDef,
    sideHero(HEROES[0], [2, FLOOR - HERO_HH - 0.0005], 0),
    sideHero(HEROES[1], [14, FLOOR - HERO_HH - 0.0005], 1),
  ],
};

/**
 * Seat 1 joins on a pad and runs for the updraft, then its pad leaves and
 * its fighter stops short; seat 0 joins on the keyboard a little later,
 * runs into the updraft and rides it up to the crown.
 */
const script: InputScriptV2 = {
  v: 2,
  scene: scene.name,
  players: SEATS,
  maxTicks: 600,
  tracks: [
    {
      player: 0,
      steps: [
        { wait: 10 },
        { join: "keyboard" },
        { set: { move: [1, 0] }, for: 64 },
        { wait: 200 },
      ],
    },
    {
      player: 1,
      steps: [{ join: "pad:0" }, { set: { move: [-1, 0] }, for: 30 }, { leave: "pad:0" }],
    },
  ],
};

/** Two seats on side-view characters in one arena, one seat leaving mid-run. */
export const versusBehaviorsProbe: GenreProbe<BehaviorPoses> = {
  id: ID,
  rows: ["local-multiplayer"],
  pending: { "local-multiplayer": "M22 (shared multi-target camera, split screen)" },
  game,
  scene,
  script,
  expect: { result: "seat-0-wins", maxTicks: 200 },
  variants: [
    { name: "saved-mid-run", saveAt: 40 },
    { name: "saved-after-the-leave", saveAt: 90 },
  ],
};

// ─── The behavior room: one scene of most standard behaviors, for saves and rollback ───

export const ROOM_ID = "behavior-room";
export const ROOM_HEROES = ["runner", "jumper"] as const;
export const ROOM_WALKER = "walker";
export const ROOM_LIFT = "lift";
export const ROOM_SPAWNER = "sparks";
export const ROOM_SCOUT = "scout";

/** Seat 0 drives the runner; seat 1 the jumper and the top-down walker. */
export const roomGame = behaviorsGame({
  id: ROOM_ID,
  seats: SEATS,
  join: "auto",
  results: ["never"],
  outcome: () => null,
});

/**
 * Physics none, gravity down: two side-view characters on a floor under a
 * one-way plank, a top-down character walking the air above them (it
 * ignores gravity), a lift on a path, a spawner of short-lived markers and
 * a nav agent in a walk area with a pillar in it.
 */
export const roomScene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ROOM_ID,
  name: "behavior-room",
  bounds: [0, 0, 32, 10],
  settings: { gravity: [0, 20] },
  entities: [
    slab("floor", 0, 9, 32, 10),
    slab("plank", 4, 7.6, 9, 7.7, { oneWay: true } as Partial<EntityDef>),
    sideHero(ROOM_HEROES[0], [2, 9 - HERO_HH - 0.0005], 0),
    sideHero(ROOM_HEROES[1], [11, 9 - HERO_HH - 0.0005], 1),
    {
      id: ROOM_WALKER,
      type: "marker",
      at: [10, 3],
      behaviors: {
        collider: { shape: ["box", 0, 0, 0.2, 0.2] },
        "character-top-down": {},
        "player-input": { seat: 1 },
      },
    } as EntityDef,
    lift(
      ROOM_LIFT,
      [
        [14, 7],
        [19, 7],
        [19, 5],
      ],
      1.5,
      0.8,
    ),
    {
      id: ROOM_SPAWNER,
      type: "marker",
      at: [17, 2],
      behaviors: { spawner: { type: "marker", rate: 3, cap: 5, lifeMs: 800, spread: 1.5 } },
    } as EntityDef,
    { id: "walk", type: "nav", shape: ["poly", 22, 0, 32, 0, 32, 7, 22, 7] },
    { id: "pillar", type: "nav", mode: "block", shape: ["poly", 26, 2, 28, 2, 28, 5, 26, 5] },
    {
      id: ROOM_SCOUT,
      type: "marker",
      at: [23, 3.5],
      behaviors: { "nav-agent": { speed: 1.5 } },
    } as EntityDef,
  ],
};

/** Where the scout walks, by the tick it is sent: round the pillar and back. */
export const SCOUT_LEGS: readonly (readonly [tick: number, to: [number, number]])[] = [
  [0, [31, 3.5]],
  [260, [23, 1]],
];

/** The seat-0 edges of the room's run, by tick. */
const RUNNER: Readonly<Record<number, readonly Omit<InputAction, "tick" | "timestamp">[]>> = {
  0: [{ action: "move", pressed: true, x: 1, y: 0 }],
  10: [{ action: "jump", pressed: true }],
  24: [{ action: "jump", pressed: false }],
  70: [{ action: "move", pressed: true, x: -0.5, y: 0 }],
  140: [{ action: "jump", pressed: true }],
  150: [{ action: "jump", pressed: false }],
  200: [{ action: "move", pressed: false, x: 0, y: 0 }],
};

/** Seat 1's edges: two streams that diverge from tick 61 on. */
const JUMPER: Readonly<
  Record<"a" | "b", Readonly<Record<number, readonly Omit<InputAction, "tick" | "timestamp">[]>>>
> = {
  a: {
    2: [{ action: "move", pressed: true, x: -1, y: 0.5 }],
    40: [{ action: "jump", pressed: true }],
    52: [{ action: "jump", pressed: false }],
    64: [{ action: "jump", pressed: true }],
    66: [{ action: "move", pressed: true, x: 1, y: -1 }],
    69: [{ action: "jump", pressed: false }],
    120: [{ action: "move", pressed: false, x: 0, y: 0 }],
  },
  b: {
    2: [{ action: "move", pressed: true, x: -1, y: 0.5 }],
    40: [{ action: "jump", pressed: true }],
    52: [{ action: "jump", pressed: false }],
    61: [{ action: "move", pressed: true, x: 0.3, y: 1 }],
    63: [{ action: "jump", pressed: true }],
    71: [{ action: "jump", pressed: false }],
    120: [{ action: "move", pressed: false, x: 0, y: 0 }],
  },
};

const JOIN: SeatChange = { player: 1, device: "pad:0", joined: true };

/**
 * The room's input on `tick`: seat 0's edges, seat 1's from `stream`, and
 * seat 1's pad joining on tick 0. Seat 0 is the keyboard's from the start.
 */
export function roomInput(tick: number, stream: "a" | "b" = "a"): TickInput {
  const stamp = (player: number) => (a: Omit<InputAction, "tick" | "timestamp">) =>
    ({ ...a, tick, timestamp: 0, ...(player === 0 ? {} : { player }) }) as InputAction;
  return {
    tick,
    actions: [...(RUNNER[tick] ?? []).map(stamp(0)), ...(JUMPER[stream][tick] ?? []).map(stamp(1))],
    commands: [],
    pointers: [],
    joins: tick === 0 ? [JOIN] : [],
  };
}

/** Steps the room once on `stream`, sending the scout on its legs first; what the tick shows. */
export function stepRoom(
  rt: SceneRuntimeHandle,
  stream: "a" | "b" = "a",
): { tick: number; events: StepEvent[]; frame: string } {
  const tick = rt.ctx.tick;
  for (const [at, [x, y]] of SCOUT_LEGS)
    if (at === tick)
      rt.ctx.behavior<NavAgentSystem>(NAV_AGENT.name)!.setDestination(ROOM_SCOUT, { x, y });
  const result = rt.step(rt.ctx.time.tickMs, roomInput(tick, stream));
  const poses = [...rt.ctx.poses.ids()].sort().map((id) => {
    const p = rt.ctx.poses.get(id)!;
    return [id, p.x, p.y, p.rot];
  });
  const frame = JSON.stringify([result.tick, result.events, poses, rt.snapshot()]);
  return { tick: result.tick, events: result.events, frame };
}

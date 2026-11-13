import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COLLIDER,
  createMotionBody,
  createTopDownController,
  defineBehavior,
  defineGame,
  inputFor,
  parseShape,
  type BehaviorSystem,
  type ColliderBlock,
  type ColliderSystem,
  type EngineContext,
  type MotionBody,
  type NavAgentSystem,
  type TopDownController,
} from "@jams/engine/game";
import {
  replayRecording,
  runPlaytest,
  type PlaytestReport,
  type RapierModule,
} from "@jams/engine/headless";
import type { EntityDef, Prefab, SceneDefinition } from "@jams/engine/scene";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { loadCompatRapier } from "../../scene/rapier-compat";
import { thruster, thrusterGame, type ThrusterSnapshot } from "../examples/thruster-behavior";

/**
 * A game's own behavior moves a dynamic body through `ctx.bodies` with no
 * character on the entity, beside every standard behavior that could touch
 * it; and a game-written controller stands in for the engine's.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await loadCompatRapier();
});

type Pt = [number, number];

/** A 0.5 m square, 0.25 kg at the default density: 2 N of thrust is 8 m/s². */
const SHIP_ACCEL = 8;

const shipBehaviors = (extra: Record<string, unknown> = {}) => ({
  collider: { shape: ["box", 0, 0, 0.25, 0.25] },
  body: { kind: "dynamic" },
  "player-input": { seat: 0 },
  [thruster.name]: { force: 2 },
  ...extra,
});

const ship = (id: string, at: Pt, extra?: Record<string, unknown>): EntityDef => ({
  id,
  type: "marker",
  at,
  behaviors: shipBehaviors(extra),
});

const area = (force: Pt): EntityDef => ({
  id: "area",
  type: "marker",
  at: [0, 0],
  behaviors: {
    collider: { shape: ["box", 0, 0, 30, 30], sensor: true },
    "force-area": { kind: "directional", force },
  },
});

/** A static post the ship slides past on a prismatic joint along x. */
const RAIL: EntityDef = {
  id: "rail",
  type: "marker",
  at: [0, -4],
  behaviors: { collider: { shape: ["box", 0, 0, 0.1, 0.1] } },
};
const onRail = { joint: { kind: "prismatic", to: "rail", axis: [1, 0] } };

const DOCK: EntityDef = {
  id: "dock",
  type: "marker",
  at: [0, 6],
  behaviors: { spawner: { prefab: "ship", burst: 1, cap: 1, rate: 0 } },
};
const SHIP_PREFAB: Prefab = {
  kind: "prefab",
  v: 4,
  game: thrusterGame.id,
  id: "ship",
  entities: [{ id: "hull", type: "marker", at: [0, 0], behaviors: shipBehaviors() }],
};
const LIBRARY = new Map([["ship", SHIP_PREFAB]]);

const WALK_TO = { x: -14, y: 10 };
const NAV: EntityDef[] = [
  { id: "floor", type: "nav", shape: ["poly", -20, -20, 20, -20, 20, 20, -20, 20] },
  { id: "walker", type: "marker", at: [-16, 10], behaviors: { "nav-agent": {} } },
];

type Snapshot = ThrusterSnapshot & { walker: Pt | null };

/** The thruster game, sending a nav agent named walker across the room when the scene has one. */
const game = defineGame<Snapshot>({
  ...thrusterGame,
  createRuntime(ctx: EngineContext) {
    const inner = thrusterGame.createRuntime(ctx);
    return {
      ...inner,
      onLoad(scene) {
        inner.onLoad?.(scene);
        if (scene.entities.some((e) => e.id === "walker"))
          ctx.behavior<NavAgentSystem>("nav-agent")?.setDestination("walker", WALK_TO);
      },
      snapshot() {
        const p = ctx.poses.get("walker");
        return { ...inner.snapshot!(), walker: p ? [p.x, p.y] : null };
      },
    };
  },
});

const scene = (entities: EntityDef[]): SceneDefinition => ({
  v: 4,
  game: thrusterGame.id,
  name: "open-yard",
  bounds: [-20, -20, 20, 20],
  settings: { physics: "rapier", gravity: [0, 0] },
  entities,
});

const THRUST_TICKS = 60;
const script = (move: Pt) => ({ v: 2 as const, steps: [{ set: { move }, for: THRUST_TICKS }] });

function play(entities: EntityDef[], move: Pt = [1, 0]): PlaytestReport<Snapshot> {
  const run = runPlaytest({
    rapier,
    game,
    scene: scene(entities),
    library: LIBRARY,
    script: script(move),
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  return run;
}

function replays(entities: EntityDef[], run: PlaytestReport<Snapshot>) {
  const replay = replayRecording({
    rapier,
    game,
    scene: scene(entities),
    library: LIBRARY,
    recording: run.recording,
  });
  if (replay.blocked) throw new Error(`${replay.stage}: ${JSON.stringify(replay.issues)}`);
  expect(replay.divergence).toBeNull();
  expect(replay.matches).toBe(true);
  expect(replay.recording.end).toBe(run.recording.end);
  // Played again from the script, too: the same digest.
  expect(play(entities).recording.end).toBe(run.recording.end);
}

/** What one ship's velocity should be after the thrust, m/s, within one tick's thrust. */
type Expect = { ships: number; v: Record<string, Pt> };

const t = THRUST_TICKS / 60;
const COMBOS: { name: string; entities: EntityDef[]; expect: Expect }[] = [
  {
    name: "on its own",
    entities: [ship("ship", [0, 0])],
    expect: { ships: 1, v: { ship: [SHIP_ACCEL * t, 0] } },
  },
  {
    name: "inside a force-area",
    entities: [area([0, 3]), ship("ship", [0, 0])],
    expect: { ships: 1, v: { ship: [SHIP_ACCEL * t, 3 * t] } },
  },
  {
    name: "on a joint",
    entities: [RAIL, ship("ship", [0, 0], onRail)],
    expect: { ships: 1, v: { ship: [SHIP_ACCEL * t, 0] } },
  },
  {
    name: "spawned by a spawner",
    entities: [DOCK],
    expect: { ships: 1, v: { "*": [SHIP_ACCEL * t, 0] } },
  },
  {
    name: "with a nav-agent elsewhere in the scene",
    entities: [...NAV, ship("ship", [0, 0])],
    expect: { ships: 1, v: { ship: [SHIP_ACCEL * t, 0] } },
  },
  {
    name: "with all of them at once",
    entities: [...NAV, area([0, 3]), RAIL, DOCK, ship("ship", [0, 0], onRail)],
    expect: { ships: 2, v: { ship: [SHIP_ACCEL * t, 0], "*": [SHIP_ACCEL * t, 3 * t] } },
  },
];

describe("thruster-behavior.ts: physics movement with no character", () => {
  it("imports nothing but @jams/engine/game and zod", () => {
    const source = readFileSync(join(HERE, "../examples/thruster-behavior.ts"), "utf8");
    const specifiers = [
      ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g),
      ...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']/g),
      ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
    ].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect([...new Set(specifiers)].sort()).toEqual(["@jams/engine/game", "zod"]);
  });

  it("carries no character behavior on the ship", () => {
    const names = Object.keys(shipBehaviors());
    expect(names.filter((n) => n.startsWith("character"))).toEqual([]);
    expect(names).toEqual(["collider", "body", "player-input", thruster.name]);
  });

  it.each(COMBOS)(
    "accelerates $name, and replays to the same digest",
    ({ entities, expect: want }) => {
      const run = play(entities);
      expect(run.outcome.result).not.toBe("error");
      const ships = run.final!.ships;
      expect(ships).toHaveLength(want.ships);
      const slack = SHIP_ACCEL / 60 + 1e-6;
      for (const s of ships) {
        const v = want.v[s.id] ?? want.v["*"]!;
        expect(Math.abs(s.v[0] - v[0]), `${s.id} vx ${s.v[0]}`).toBeLessThanOrEqual(slack);
        expect(Math.abs(s.v[1] - v[1]), `${s.id} vy ${s.v[1]}`).toBeLessThanOrEqual(slack);
      }
      if (entities.some((e) => e.id === "walker")) {
        const [x, y] = run.final!.walker!;
        expect(x).toBeGreaterThan(-16 + 0.5);
        expect(Math.abs(y - WALK_TO.y)).toBeLessThan(0.2);
      }
      replays(entities, run);
    },
  );

  it("only coasts without input: the thrust comes from the seat", () => {
    const run = play([ship("ship", [0, 0])], [0, 0]);
    expect(run.final!.ships[0]!.v).toEqual([0, 0]);
  });

  it("speeds up with thrust held: twice the time, twice the speed", () => {
    const run = runPlaytest({
      rapier,
      game,
      scene: scene([ship("ship", [0, 0])]),
      script: { v: 2, steps: [{ set: { move: [1, 0] }, for: THRUST_TICKS * 2 }] },
    });
    if (run.blocked) throw new Error(run.stage);
    const once = play([ship("ship", [0, 0])]).final!.ships[0]!.v[0];
    expect(run.final!.ships[0]!.v[0]).toBeCloseTo(once * 2, 3);
  });

  it("refuses only a character on the same dynamic body", () => {
    const run = runPlaytest({
      rapier,
      game,
      scene: scene([ship("ship", [0, 0], { "character-top-down": {} })]),
      script: script([1, 0]),
    });
    expect(run.blocked).toBe(true);
    if (!run.blocked) return;
    expect(run.issues.map((i) => i.code)).toContain("character-body-kind");
  });
});

// ─── A game-written controller in place of character-top-down ──────────

type Walk = { block: Record<string, unknown>; body: MotionBody; controller: TopDownController };

/** The engine's character-top-down, rebuilt from public imports: a motion body walked from the seat. */
const walk = defineBehavior({
  name: "walker-game/walk",
  description: "Walks the entity in the plane from its seat's move action.",
  fields: {
    maxSpeed: z.number().positive().default(4).describe("Top speed, m/s; default 4."),
    accel: z.number().positive().default(40).describe("Speed-up, m/s²; default 40."),
    decel: z.number().positive().default(40).describe("Slow-down, m/s²; default 40."),
  },
  requires: ["collider"],
  system(ctx): BehaviorSystem {
    const walkers = new Map<string, Walk>();
    const colliders = () => ctx.behavior<ColliderSystem>(COLLIDER.name);
    const detach = (id: string) => {
      const w = walkers.get(id);
      if (!w) return;
      walkers.delete(id);
      w.body.destroy();
      colliders()?.enable?.(id);
    };
    return {
      attach(id, block, entity) {
        detach(id);
        const collider = entity.behaviors?.[COLLIDER.name] as ColliderBlock;
        const parsed = parseShape(collider.shape, `${id}.behaviors.collider.shape`);
        if (!parsed.ok) throw new Error(parsed.issue.message);
        const pose = ctx.poses.get(id);
        const body = createMotionBody(
          ctx,
          entity,
          { x: pose?.x ?? 0, y: pose?.y ?? 0 },
          { shape: parsed.shape, group: collider.group ?? "dynamic" },
        );
        const controller = createTopDownController(body, {
          maxSpeed: Number(block.maxSpeed),
          accel: Number(block.accel),
          decel: Number(block.decel),
        });
        walkers.set(id, { block, body, controller });
        // The motion body stands in for the collider system's own.
        colliders()?.disable?.(id);
      },
      detach,
      beforeStep(dtMs) {
        for (const [id, w] of walkers) w.controller.step(dtMs, inputFor(ctx, id).vector("move"));
      },
      clear() {
        for (const id of [...walkers.keys()]) detach(id);
      },
      size: () => walkers.size,
    };
  },
});

type HeroSnapshot = { at: Pt; v: Pt } | null;

const walkerGame = defineGame<HeroSnapshot>({
  id: "walker-game",
  types: [],
  behaviors: [walk],
  actions: [
    {
      action: "move",
      kind: "vector",
      bindings: [{ device: "pad", stick: "left" }],
      description: "Walk.",
    },
  ],
  world: { gravity: [0, 0] },
  createRuntime(ctx: EngineContext) {
    return {
      snapshot() {
        const p = ctx.poses.get("hero");
        if (!p) return null;
        const v = ctx.bodies.velocity("hero");
        return { at: [p.x, p.y], v: [v.x, v.y] };
      },
    };
  },
});

const yard = (
  controller: Record<string, unknown>,
  physics: "rapier" | "none",
): SceneDefinition => ({
  v: 4,
  game: walkerGame.id,
  name: "walk-yard",
  bounds: [0, 0, 6, 4],
  settings: { physics, gravity: [0, 0] },
  entities: [
    { id: "east", type: "solid", shape: ["box", 3, 2, 0.1, 2] },
    {
      id: "hero",
      type: "marker",
      at: [1, 1],
      behaviors: { collider: { shape: ["circle", 0, 0, 0.2] }, "player-input": {}, ...controller },
    },
  ],
});

/** Runs into the wall, slides down it, then stops. */
const WALK_SCRIPT = {
  v: 2 as const,
  steps: [
    { set: { move: [1, 0] as Pt }, for: 60 },
    { set: { move: [0.6, 0.8] as Pt }, for: 30 },
    { wait: 20 },
  ],
};

describe("a game-written controller replaces character-top-down", () => {
  it.each(["rapier", "none"] as const)("walks the same path on %s", (physics) => {
    const runs = [{ "character-top-down": {} }, { [walk.name]: {} }].map((controller) => {
      const run = runPlaytest({
        rapier: physics === "rapier" ? rapier : null,
        game: walkerGame,
        scene: yard(controller, physics),
        script: WALK_SCRIPT,
      });
      if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
      return run;
    });
    const [engine, own] = runs as [PlaytestReport<HeroSnapshot>, PlaytestReport<HeroSnapshot>];
    // Stopped by the wall: its west face at 2.9, less the hero's radius.
    expect(engine.final!.at[0]).toBeLessThanOrEqual(2.7 + 1e-6);
    expect(engine.final!.at[0]).toBeGreaterThan(2.5);
    expect(engine.final!.at[1]).toBeGreaterThan(1.5);
    expect(engine.final!.v).toEqual([0, 0]);
    expect(own.final).toEqual(engine.final);
    expect(own.recording.end).toBe(engine.recording.end);
  });
});

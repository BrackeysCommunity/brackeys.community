import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRegistry,
  defineGame,
  type EngineContext,
  type GameDefinition,
} from "@jams/engine/game";
import {
  replayRecording,
  runPlaytest,
  type PlaytestReport,
  type RapierModule,
} from "@jams/engine/headless";
import {
  SCENE_FORMAT_VERSION,
  type EntityDef,
  type Prefab,
  type SceneDefinition,
} from "@jams/engine/scene";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { z } from "zod";

import { loadCompatRapier } from "../../scene/rapier-compat";
import { thrusterGame, type ThrusterSnapshot } from "../examples/thruster-behavior";
import { thruster as thrusterHooks } from "../examples/thruster-hooks";
import { Thruster } from "../examples/thruster-script";

/**
 * The thruster three ways: the system form, a script class and a function
 * script. Each plays the same input script for 600 ticks over the same
 * scenes and must end on the same digest, and each replays its own
 * recording.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await loadCompatRapier();
});

type Pt = [number, number];

/** A 0.5 m square, 0.25 kg at the default density: 2 N of thrust is 8 m/s². */
const SHIP_ACCEL = 8;

/** The ship's state as the system form's snapshot reports it, for the ids `ships` lists. */
function shipsAt(ctx: EngineContext, ships: readonly string[]): ThrusterSnapshot {
  return {
    ships: ships.map((id) => {
      const p = ctx.poses.get(id);
      const v = ctx.bodies.velocity(id);
      return { id, at: [p?.x ?? 0, p?.y ?? 0], v: [v.x, v.y] };
    }),
  };
}

const classGame = defineGame<ThrusterSnapshot>({
  ...thrusterGame,
  behaviors: [Thruster],
  createRuntime: (ctx) => ({
    snapshot: () =>
      shipsAt(
        ctx,
        ctx.findBehaviors(Thruster).map((t) => t.entity.id),
      ),
  }),
});

const hooksGame = defineGame<ThrusterSnapshot>({
  ...thrusterGame,
  behaviors: [thrusterHooks],
  createRuntime: (ctx) => ({
    snapshot: () =>
      shipsAt(
        ctx,
        ctx.findBehaviors(thrusterHooks).map((t) => t.entity.id),
      ),
  }),
});

const FORMS: [string, GameDefinition<ThrusterSnapshot>][] = [
  ["system", thrusterGame],
  ["class", classGame],
  ["function", hooksGame],
];

const NAME = Thruster.behavior.name;

const ship = (id: string, at: Pt, extra: Record<string, unknown> = {}): EntityDef => ({
  id,
  type: "marker",
  at,
  behaviors: {
    collider: { shape: ["box", 0, 0, 0.25, 0.25] },
    body: { kind: "dynamic" },
    "player-input": { seat: 0 },
    [NAME]: { force: 2 },
    ...extra,
  },
});

const AREA: EntityDef = {
  id: "area",
  type: "marker",
  at: [0, 0],
  behaviors: {
    collider: { shape: ["box", 0, 0, 30, 30], sensor: true },
    "force-area": { kind: "directional", force: [0, 1] },
  },
};
const RAIL: EntityDef = {
  id: "rail",
  type: "marker",
  at: [0, -4],
  behaviors: { collider: { shape: ["box", 0, 0, 0.1, 0.1] } },
};
const ON_RAIL = { joint: { kind: "prismatic", to: "rail", axis: [1, 0] } };
const DOCK: EntityDef = {
  id: "dock",
  type: "marker",
  at: [0, 6],
  behaviors: { spawner: { prefab: "ship", burst: 1, cap: 1, rate: 0 } },
};
const SHIP_PREFAB: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  game: thrusterGame.id,
  id: "ship",
  entities: [ship("hull", [0, 0])],
};
const LIBRARY = new Map([["ship", SHIP_PREFAB]]);

const scene = (entities: EntityDef[]): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  game: thrusterGame.id,
  name: "script-yard",
  bounds: [-20, -20, 20, 20],
  settings: { physics: "rapier", gravity: [0, 0] },
  entities,
});

/** 600 ticks: a push each way on both axes, so the ships turn back and coast. */
const SCRIPT = {
  v: 2 as const,
  steps: [
    { set: { move: [1, 0] as Pt }, for: 150 },
    { set: { move: [-1, 0] as Pt }, for: 150 },
    { set: { move: [0.6, 0.8] as Pt }, for: 150 },
    { set: { move: [0, -1] as Pt }, for: 150 },
  ],
};
const TICKS = 600;

const SCENES: { name: string; entities: EntityDef[]; ships: number }[] = [
  { name: "on its own", entities: [ship("ship", [0, 0])], ships: 1 },
  { name: "inside a force-area", entities: [AREA, ship("ship", [0, 0])], ships: 1 },
  {
    name: "on a joint",
    entities: [RAIL, ship("ship", [0, 0], ON_RAIL)],
    ships: 1,
  },
  {
    name: "inside a force-area and on a joint",
    entities: [AREA, RAIL, ship("ship", [0, 0], ON_RAIL)],
    ships: 1,
  },
];

function play(
  game: GameDefinition<ThrusterSnapshot>,
  entities: EntityDef[],
): PlaytestReport<ThrusterSnapshot> {
  const run = runPlaytest({
    rapier,
    game,
    scene: scene(entities),
    library: LIBRARY,
    script: SCRIPT,
  });
  if (run.blocked) throw new Error(`${run.stage}: ${JSON.stringify(run.issues)}`);
  return run;
}

describe("the thruster as a system, a script class and a function script", () => {
  it.each(["thruster-script.ts", "thruster-hooks.ts"])(
    "%s imports nothing but @jams/engine/game and zod",
    (file) => {
      const source = readFileSync(join(HERE, "../examples", file), "utf8");
      const specifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
      expect(source).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
      expect([...new Set(specifiers)].sort()).toEqual(["@jams/engine/game", "zod"]);
    },
  );

  it("registers under one name with one field schema in every form", () => {
    const forces = FORMS.map(([, game]) => {
      const def = createRegistry(game).behaviors.get(NAME);
      expect(def).toBeDefined();
      return (def!.shape.force as z.ZodType).parse(undefined);
    });
    expect(forces).toEqual([2, 2, 2]);
  });

  it.each(SCENES)(
    "ends on the same digest after 600 ticks $name",
    ({ entities, ships }) => {
      const runs = FORMS.map(([form, game]) => {
        const run = play(game, entities);
        expect(run.outcome.result, form).not.toBe("error");
        expect(run.recording.ticks, form).toBe(TICKS);
        expect(run.final!.ships, form).toHaveLength(ships);
        const replay = replayRecording({
          rapier,
          game,
          scene: scene(entities),
          library: LIBRARY,
          recording: run.recording,
        });
        if (replay.blocked) throw new Error(`${form} ${replay.stage}`);
        expect(replay.divergence, form).toBeNull();
        return run;
      });
      const [system, ...scripts] = runs;
      // The thrust moved them: a digest of ships at rest would prove nothing.
      expect(Math.hypot(...system!.final!.ships[0]!.at)).toBeGreaterThan(1);
      for (const run of scripts) {
        expect(run.final).toEqual(system!.final);
        expect(run.recording.end).toBe(system!.recording.end);
      }
    },
    60_000,
  );

  it("starts a spawned ship's script on the tick after its spawn, one tick of thrust behind", () => {
    // The spawner spawns in its beforeStep, ahead of the thruster's: the system form pushes the
    // new ship that same tick, while a script made mid-tick first runs on the next one.
    const thrust = { v: 2 as const, steps: [{ set: { move: [1, 0] as Pt }, for: 60 }] };
    const vx = FORMS.map(([form, game]) => {
      const run = runPlaytest({
        rapier,
        game,
        scene: scene([DOCK]),
        library: LIBRARY,
        script: thrust,
      });
      if (run.blocked) throw new Error(`${form} ${run.stage}`);
      expect(run.final!.ships, form).toHaveLength(1);
      return run.final!.ships[0]!.v[0];
    });
    const [system, viaClass, viaFunction] = vx as [number, number, number];
    expect(viaClass).toBe(viaFunction);
    expect(system - viaClass).toBeCloseTo(SHIP_ACCEL / 60, 3);
  });

  it("hands out the script itself as the ship's behavior handle", () => {
    let instance: unknown;
    let hooks: unknown;
    for (const [game, read] of [
      [classGame, (ctx: EngineContext) => (instance = ctx.entity("ship")?.getBehavior(Thruster))],
      [hooksGame, (ctx: EngineContext) => (hooks = ctx.entity("ship")?.getBehavior(thrusterHooks))],
    ] as const) {
      const run = runPlaytest({
        rapier,
        game,
        scene: scene([ship("ship", [0, 0])]),
        script: { v: 2, steps: [{ wait: 1 }] },
        onEnd: (runtime) => read(runtime.ctx),
      });
      if (run.blocked) throw new Error(run.stage);
    }
    expect(instance).toBeInstanceOf(Thruster);
    expect((instance as Thruster).entity.id).toBe("ship");
    expect((hooks as { entity: { id: string } }).entity.id).toBe("ship");
    expect(typeof (hooks as { beforeStep: unknown }).beforeStep).toBe("function");
  });
});

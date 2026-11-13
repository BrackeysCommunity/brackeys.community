// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createRegistry, defineGame } from "../../game/define";
import type { GameDefinition, PlayState, Registry } from "../../game/types";
import { CHECKS_FORMAT_VERSION, parseChecks } from "../../scene/checks";
import type { NearMatch } from "../../scene/input-script";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../../scene/types";
import { fuzz } from "../fuzz";
import { runPlaytest, untilHolds } from "../playtest";
import type { InputScriptV2, PlaytestReport, PlaytestRun } from "../playtest-types";
import { runChecks } from "../run-checks";

/** Walks right at 1 m/s from x 0, through x 2 at tick 120 and x 3 at tick 180. */
const glider: EntityDef = {
  id: "glider",
  type: "follower",
  shape: ["box", 0, 0, 0.1, 0.1],
  path: {
    pts: [
      [0, 0],
      [8, 0],
    ],
    mode: "ping_pong",
    speed: 1,
  },
};
const post: EntityDef = { id: "post", type: "marker", at: [3, 0] };

/** A game with a seated hero walked by the standard top-down character, and no code of its own. */
const walker: GameDefinition = defineGame({
  id: "near-walker",
  types: [],
  actions: [
    {
      action: "move",
      kind: "vector",
      bindings: [{ device: "pad", stick: "left" }],
      description: "Walk.",
    },
  ],
  time: { kind: "fixed", rate: 60 },
  createRuntime: () => ({ snapshot: () => null }),
});
const hero: EntityDef = {
  id: "hero",
  type: "marker",
  at: [0, 2],
  behaviors: {
    collider: { shape: ["box", 0, 0, 0.2, 0.2] },
    "character-top-down": { maxSpeed: 2 },
    "player-input": {},
  },
} as EntityDef;

const engine = createRegistry();
const walking = createRegistry(walker);

function scene(entities: EntityDef[], game?: string): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    ...(game ? { game } : {}),
    name: "near",
    bounds: [-10, -10, 10, 10],
    settings: { physics: "none", gravity: [0, 0] },
    entities,
  };
}

function report(run: PlaytestRun): PlaytestReport {
  if (run.blocked) throw new Error(`blocked at ${run.stage}: ${JSON.stringify(run)}`);
  return run;
}

const waitNear = (near: NearMatch, max = 600): InputScriptV2 => ({
  v: 2,
  steps: [{ hold: [], until: { near }, max }],
});

describe("until.near", () => {
  it("parses in a script: an id, a point or an entity id, and a distance", () => {
    for (const to of [[3, 0], "post"] as NearMatch["to"][])
      expect(
        runPlaytest({
          scene: scene([glider, post]),
          script: waitNear({ id: "glider", to, within: 1 }),
        }).blocked,
      ).toBe(false);
    const bad = runPlaytest({
      scene: scene([glider]),
      script: {
        v: 2,
        steps: [{ hold: [], until: { near: { id: "glider", to: [3, 0] } }, max: 10 }],
      },
    } as never);
    expect(bad.blocked).toBe(true);
  });

  describe("without a game", () => {
    it("ends a step once the entity is within the distance of a point", () => {
      const r = report(
        runPlaytest({
          scene: scene([glider]),
          script: waitNear({ id: "glider", to: [2, 0], within: 0.5 }),
        }),
      );
      expect(r.steps[0]).toMatchObject({ end: "until" });
      // 1.5 m at 1 m/s: the 90th tick.
      expect(r.ticks).toBeGreaterThanOrEqual(89);
      expect(r.ticks).toBeLessThanOrEqual(92);
    });

    it("measures to another entity's pose", () => {
      const r = report(
        runPlaytest({
          scene: scene([glider, post]),
          script: waitNear({ id: "glider", to: "post", within: 1 }),
        }),
      );
      expect(r.steps[0]).toMatchObject({ end: "until" });
      expect(r.ticks).toBeGreaterThanOrEqual(119);
      expect(r.ticks).toBeLessThanOrEqual(122);
    });

    it("never holds for an entity or a target that isn't there", () => {
      for (const near of [
        { id: "nobody", to: [0, 0], within: 100 },
        { id: "glider", to: "nobody", within: 100 },
      ] as NearMatch[]) {
        const r = report(runPlaytest({ scene: scene([glider]), script: waitNear(near, 30) }));
        expect(r.steps[0]).toMatchObject({ end: "max" });
      }
    });
  });

  describe("with a game", () => {
    it("ends a step once the walked hero is near a point, and near an entity", () => {
      const walk = (near: NearMatch) =>
        report(
          runPlaytest({
            game: walker,
            scene: scene([hero, post], walker.id),
            script: { v: 2, steps: [{ set: { move: [0.8, -0.6] }, until: { near }, max: 600 }] },
          }),
        );
      const toPoint = walk({ id: "hero", to: [1.6, 0.8], within: 0.3 });
      expect(toPoint.steps[0]).toMatchObject({ end: "until" });
      const toPost = walk({ id: "hero", to: "post", within: 0.5 });
      expect(toPost.steps[0]).toMatchObject({ end: "until" });
      expect(toPost.ticks).toBeGreaterThan(toPoint.ticks);
    });

    it("is judged by untilHolds on the state a playtest's last tick has", () => {
      const judged: Record<string, boolean> = {};
      let x: number | undefined;
      const judge = (state: PlayState) => {
        const near = (to: NearMatch["to"], within: number) =>
          untilHolds({ near: { id: "hero", to, within } }, state, walking);
        const at = state.world.pose?.("hero");
        x = at?.x;
        if (!at) return;
        judged.start = near([0, 2], 0.1);
        judged.post = near("post", 1);
        judged.edge = near([at.x, at.y + 0.5], 0.5);
        judged.past = near([at.x, at.y + 0.5], 0.49);
      };
      report(
        runPlaytest({
          game: walker,
          scene: scene([hero, post], walker.id),
          script: { v: 2, steps: [{ set: { move: [1, 0] }, for: 30 }] },
          onLastTick: judge,
        }),
      );
      expect(x).toBeGreaterThan(0.5);
      expect(judged).toEqual({ start: false, post: false, edge: true, past: false });
    });
  });

  describe("in a reaches check's expect", () => {
    const check = (registry: Registry, entities: EntityDef[], expectNear: NearMatch) => {
      const parsed = parseChecks(
        JSON.stringify({
          v: CHECKS_FORMAT_VERSION,
          checks: [
            {
              id: "arrives",
              kind: "reaches",
              script: { v: 2, steps: [{ wait: 150 }] },
              result: "script-end",
              expect: { near: expectNear },
            },
          ],
        }),
        registry,
      );
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      const game = registry === walking ? walker.id : undefined;
      return runChecks({
        scene: scene(entities, game),
        registry,
        checks: parsed.file,
        readFile: () => {
          throw new Error("no files");
        },
      }).results[0]!;
    };

    it("holds on the last tick without a game, and names near when it doesn't", () => {
      expect(check(engine, [glider, post], { id: "glider", to: "post", within: 1 })).toMatchObject({
        pass: true,
      });
      const miss = check(engine, [glider, post], { id: "glider", to: [0, 0], within: 1 });
      expect(miss).toMatchObject({ pass: false, detail: { expect: { failed: "near" } } });
    });

    it("holds with a game", () => {
      expect(
        check(walking, [glider, post], { id: "glider", to: [2.5, 0], within: 0.1 }),
      ).toMatchObject({ pass: true });
    });
  });

  describe("in fuzz", () => {
    it("ends rollouts when a game's outcome waits on a near", () => {
      const registry = createRegistry();
      const arrived: GameDefinition = defineGame({
        ...walker,
        id: "near-arrival",
        play: {
          results: ["arrived"],
          outcome: (state) =>
            untilHolds({ near: { id: "glider", to: "post", within: 0.5 } }, state, registry)
              ? { result: "arrived" }
              : null,
        },
      });
      const run = fuzz({
        game: arrived,
        scene: scene([glider, post], arrived.id),
        seed: 1,
        rollouts: 3,
        ticks: 300,
      });
      if (run.blocked) throw new Error(`blocked at ${run.stage}`);
      expect(run.results).toMatchObject({ arrived: 3 });
      // Each rollout ends 2.5 m along, at the 150th tick.
      expect(run.ticks).toBeGreaterThanOrEqual(3 * 149);
      expect(run.ticks).toBeLessThanOrEqual(3 * 152);
    });
  });
});

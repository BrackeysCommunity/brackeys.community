// @vitest-environment node
import type { InputAction, RapierModule } from "@jams/engine";
import type { GameDefinition, SceneLibrary } from "@jams/engine/game";
import { createHeadlessRuntime, swapCheck } from "@jams/engine/headless";
import { createRegistry, expandScene } from "@jams/engine/scene";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { platformerGame, PLAYER_HEIGHT, PLAYER_TYPE, type PlayerSnapshot } from "..";
import { createPlatformerRuntime, playerInSolidIssues } from "../runtime";
import {
  SCENE,
  SPAWN_FEET,
  STEP_TOP,
  testYardVersion,
  type LiveFixture,
} from "./fixtures/live/test-yard";

const registry = createRegistry(platformerGame);
const DT = 1000 / 60;

const press = (action: string, pressed = true): InputAction => ({
  action,
  pressed,
  tick: 0,
  timestamp: 0,
});

/** The platformer with no `onSwap`, so a swap leaves the player where it was. */
const withoutOnSwap: GameDefinition<PlayerSnapshot> = {
  ...platformerGame,
  createRuntime(ctx) {
    const runtime = createPlatformerRuntime(ctx);
    delete runtime.onSwap;
    return runtime;
  },
};

const scripts = [
  { name: "stand", script: { v: 1 as const, scene: SCENE, steps: [{ wait: 240 }] } },
  {
    name: "run-right",
    script: { v: 1 as const, scene: SCENE, steps: [{ hold: ["move_right"], for: 240 }] },
  },
];

describe("the platformer goes live", () => {
  let rapier: RapierModule;
  let fixture: LiveFixture;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
    fixture = await testYardVersion();
  });

  function play(game: GameDefinition<PlayerSnapshot> = platformerGame) {
    const library: SceneLibrary = {
      list: [{ scene: SCENE }],
      scenes: new Map([[SCENE, { def: fixture.release, prefabs: new Map() }]]),
    };
    const rt = createHeadlessRuntime({
      rapier,
      game,
      scene: expandScene(fixture.release, registry),
      flow: library,
      project: fixture.project,
    });
    const step = (n = 1, actions: InputAction[] = []) => {
      for (let i = 0; i < n; i++) rt.step(DT, i === 0 ? actions : []);
    };
    const player = () => rt.snapshot() as PlayerSnapshot;
    return { rt, step, player };
  }

  it("declares every timing and registers the check's code", () => {
    expect(platformerGame.live?.timings).toEqual(["next-load", "boundary", "now"]);
    expect(registry.issueCodes["platformer/player-in-solid"]?.severity).toBe("error");
  });

  it("lifts the player onto a solid added where it stands", () => {
    const { rt, step, player } = play();
    try {
      step(30);
      expect(player().grounded).toBe(true);
      expect(player().position.x).toBeCloseTo(SPAWN_FEET.x, 4);
      expect(player().position.y + PLAYER_HEIGHT / 2).toBeCloseTo(SPAWN_FEET.y, 3);
      expect(playerInSolidIssues(rt.ctx)).toEqual([]);

      expect(rt.live.stage(fixture.version)).toEqual({ ok: true });
      rt.live.activate(SCENE, fixture.version.id, "now");
      step();
      expect(rt.ctx.live.version).toBe(fixture.version.id);
      expect(player().position.x).toBeCloseTo(SPAWN_FEET.x, 4);
      expect(player().position.y + PLAYER_HEIGHT / 2).toBeCloseTo(STEP_TOP, 3);
      expect(playerInSolidIssues(rt.ctx)).toEqual([]);

      step(30);
      expect(player().grounded).toBe(true);
      expect(player().position.y + PLAYER_HEIGHT / 2).toBeCloseTo(STEP_TOP, 3);
      expect(playerInSolidIssues(rt.ctx)).toEqual([]);
    } finally {
      rt.destroy();
    }
  });

  it("reports a player left inside the new solid", () => {
    const { rt, step } = play(withoutOnSwap);
    try {
      step(30);
      rt.live.stage(fixture.version);
      rt.live.activate(SCENE, fixture.version.id, "now");
      step();
      const [issue, ...rest] = playerInSolidIssues(rt.ctx);
      expect(rest).toEqual([]);
      expect(issue?.code).toBe("platformer/player-in-solid");
      expect(issue?.entityIds[0]).toBe(rt.ctx.query.select({ type: PLAYER_TYPE })[0]);
    } finally {
      rt.destroy();
    }
  });

  it("marks a boundary when the player lands from the air", () => {
    const { rt, step } = play();
    try {
      step(30);
      rt.live.stage(fixture.version);
      expect(rt.live.activate(SCENE, fixture.version.id, "boundary")).toEqual({
        timing: "boundary",
        clamped: false,
      });
      step(30);
      expect(rt.ctx.live.version).toBeNull();

      step(1, [press("jump")]);
      step(1, [press("jump", false)]);
      let ticks = 0;
      while (rt.ctx.live.version === null && ticks < 120) {
        step();
        ticks++;
      }
      expect(rt.ctx.live.version).toBe(fixture.version.id);
      expect(ticks).toBeGreaterThan(0);
      expect(playerInSolidIssues(rt.ctx)).toEqual([]);
    } finally {
      rt.destroy();
    }
  });

  it("passes swapCheck on the fixture version, which fails without onSwap", () => {
    const opts = {
      from: { def: fixture.release, prefabs: new Map() },
      to: fixture.version,
      scripts,
      rapier,
      project: fixture.project,
    };
    const report = swapCheck({ ...opts, game: platformerGame });
    expect(report.issues).toEqual([]);
    expect(report.runs.map((r) => [r.script, r.at, r.strategy, r.issues])).toEqual([
      ["stand", 0.25, "reconcile", []],
      ["stand", 0.5, "reconcile", []],
      ["stand", 0.75, "reconcile", []],
      ["run-right", 0.25, "reconcile", []],
      ["run-right", 0.5, "reconcile", []],
      ["run-right", 0.75, "reconcile", []],
    ]);
    expect(report.ok).toBe(true);

    const stuck = swapCheck({ ...opts, game: withoutOnSwap });
    expect(stuck.ok).toBe(false);
    // Once right after the swap and again 60 ticks later: the player is still inside.
    const inside = ["platformer/player-in-solid", "platformer/player-in-solid"];
    const stand = stuck.runs.filter((r) => r.script === "stand");
    expect(stand.map((r) => r.issues.map((i) => i.code))).toEqual([inside, inside, inside]);
  });
});

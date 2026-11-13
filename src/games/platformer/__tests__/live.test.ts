// @vitest-environment node
import type { InputAction, RapierModule } from "@jams/engine";
import type { GameDefinition, SceneLibrary } from "@jams/engine/game";
import { createHeadlessRuntime, swapCheck } from "@jams/engine/headless";
import { createRegistry, expandScene, type SceneOp } from "@jams/engine/scene";
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

/** A platform clear of every moving body, moved down by `PLATFORM_DROP`, and a solid added in open air. */
const PLATFORM = "~solid:5";
const PLATFORM_AT = { x: 5, y: 8.4 } as const;
const PLATFORM_DROP = 0.3;
const OPEN_AIR = { x: 24, y: 6 } as const;
const MOVE_AND_ADD: SceneOp[] = [
  { op: "move", refs: [PLATFORM], by: [0, PLATFORM_DROP] },
  { op: "addBulk", key: "solid", shapes: [["box", OPEN_AIR.x, OPEN_AIR.y, 0.5, 0.1]] },
];

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
  let moved: LiveFixture;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
    fixture = await testYardVersion();
    moved = await testYardVersion(MOVE_AND_ADD);
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

  it("moves a platform and adds a solid in the Rapier world, leaving the rest of the run as it was", () => {
    type Run = ReturnType<typeof play>;
    const added = `~solid:${(fixture.release.solid as unknown[]).length}`;
    const collidersOf = ({ rt }: Run, id: string) =>
      rt.ctx.tags.handlesOf(id).map((h) => {
        const at = rt.ctx.physics!.world.getCollider(h)!.translation();
        return [at.x, at.y];
      });
    /** Every pose but the edited two's, and the player, on each of `n` more ticks. */
    const untouched = (run: Run, n: number) =>
      Array.from({ length: n }, () => {
        run.step();
        const poses = [...run.rt.ctx.poses.ids()]
          .filter((id) => id !== PLATFORM && id !== added)
          .sort()
          .map((id) => {
            const p = run.rt.ctx.poses.get(id)!;
            return [id, p.x, p.y, p.rot];
          });
        return JSON.stringify([run.rt.ctx.tick, run.player(), poses]);
      });

    /** A single collider at `at`, to Rapier's f32. */
    const expectOneAt = (run: Run, id: string, at: { x: number; y: number }) => {
      const colliders = collidersOf(run, id);
      expect(colliders).toHaveLength(1);
      expect(colliders[0]![0]).toBeCloseTo(at.x, 5);
      expect(colliders[0]![1]).toBeCloseTo(at.y, 5);
    };

    const swapped = play();
    const still = play();
    try {
      swapped.step(30);
      still.step(30);
      expectOneAt(swapped, PLATFORM, PLATFORM_AT);
      expect(collidersOf(swapped, added)).toEqual([]);

      expect(swapped.rt.live.stage(moved.version)).toEqual({ ok: true });
      swapped.rt.live.activate(SCENE, moved.version.id, "now");
      const after = untouched(swapped, 120);
      expect(swapped.rt.ctx.live.version).toBe(moved.version.id);
      expectOneAt(swapped, PLATFORM, { x: PLATFORM_AT.x, y: PLATFORM_AT.y + PLATFORM_DROP });
      expectOneAt(swapped, added, OPEN_AIR);
      expect(swapped.rt.ctx.query.at(OPEN_AIR)).toContain(added);

      expect(after).toEqual(untouched(still, 120));
    } finally {
      swapped.rt.destroy();
      still.rt.destroy();
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

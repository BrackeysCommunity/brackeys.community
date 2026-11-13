// @vitest-environment node
import type { RapierModule } from "@jams/engine";
import type { SceneLibrary } from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import { createRegistry, expandScene } from "@jams/engine/scene";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { platformerGame, PLAYER_HEIGHT, type PlayerSnapshot } from "..";
import { FREE_RINGS, playerInSolidIssues } from "../runtime";
import { SCENE, SPAWN_FEET, testYardVersion, type LiveFixture } from "./fixtures/live/test-yard";

const casts = vi.hoisted(() => ({ count: 0, excluded: [] as unknown[] }));
vi.mock("@jams/engine/game", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jams/engine/game")>();
  return {
    ...actual,
    castSpawn: (...args: Parameters<typeof actual.castSpawn>) => {
      casts.count++;
      casts.excluded.push(args[3]?.exclude);
      return actual.castSpawn(...args);
    },
  };
});

const registry = createRegistry(platformerGame);
const DT = 1000 / 60;
/** Half the side of a block dropped over the spawn: wider than the search reaches, inside the yard's bounds. */
const BLOCK_HALF = 6;

describe("a swap that boxes the player in", () => {
  let rapier: RapierModule;
  let fixture: LiveFixture;
  beforeAll(async () => {
    rapier = await import("@dimforge/rapier2d");
    fixture = await testYardVersion([
      {
        op: "addBulk",
        key: "solid",
        shapes: [["box", SPAWN_FEET.x, SPAWN_FEET.y - PLAYER_HEIGHT / 2, BLOCK_HALF, BLOCK_HALF]],
      },
    ]);
  });

  it("gives up past the search reach and leaves the player for live.check", () => {
    expect(FREE_RINGS * (PLAYER_HEIGHT / 4)).toBeLessThan(BLOCK_HALF);
    const library: SceneLibrary = {
      list: [{ scene: SCENE }],
      scenes: new Map([[SCENE, { def: fixture.release, prefabs: new Map() }]]),
    };
    const rt = createHeadlessRuntime({
      rapier,
      game: platformerGame,
      scene: expandScene(fixture.release, registry),
      flow: library,
      project: fixture.project,
    });
    try {
      for (let i = 0; i < 30; i++) rt.step(DT, []);
      const before = (rt.snapshot() as PlayerSnapshot).position;

      expect(rt.live.stage(fixture.version)).toEqual({ ok: true });
      rt.live.activate(SCENE, fixture.version.id, "now");
      casts.count = 0;
      casts.excluded = [];
      const players = rt.ctx.query.select({ type: "player" });
      rt.step(DT, []);

      expect(rt.ctx.live.version).toBe(fixture.version.id);
      expect(casts.count).toBeGreaterThan(0);
      expect(casts.count).toBeLessThanOrEqual(FREE_RINGS * 4);
      expect(new Set(casts.excluded.map((e) => JSON.stringify(e)))).toEqual(
        new Set([JSON.stringify(players)]),
      );
      const after = (rt.snapshot() as PlayerSnapshot).position;
      expect(after.x).toBeCloseTo(before.x, 4);
      expect(after.y).toBeCloseTo(before.y, 1);
      expect(playerInSolidIssues(rt.ctx).map((i) => i.code)).toEqual([
        "platformer/player-in-solid",
      ]);
    } finally {
      rt.destroy();
    }
  });
});

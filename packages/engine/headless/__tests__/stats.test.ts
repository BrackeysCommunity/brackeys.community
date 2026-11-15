// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { generateLargeScene, LARGE_5K } from "../../__tests__/fixtures/generate-scene";
import { testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { parseSceneOrThrow } from "../../scene/parse";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import type { RapierModule } from "../../types";
import type { InputScript } from "../playtest-types";
import { runStats } from "../stats";

const registry = createRegistry(testGame);
const yard: SceneDefinition = parseSceneOrThrow(
  readFileSync(new URL("../../scenes/engine-yard.json", import.meta.url), "utf8"),
  registry,
);
const idle: InputScript = { v: 1, steps: [{ wait: 30_000 }] };

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

describe("runStats", () => {
  it("reports the same counts on every run, with wall timings beside them", async () => {
    const opts = {
      rapier,
      game: testGame,
      registry,
      scene: yard,
      script: idle,
      ticks: 90,
      warmup: 10,
    };
    const a = await runStats(opts);
    const b = await runStats(opts);
    expect(a.ticks).toBe(90);
    expect(a.counts).toEqual(b.counts);
    expect(a.counts.entities).toBeGreaterThan(0);
    expect(a.counts.colliders).toBeGreaterThan(0);
    expect(a.wall.ticksPerSecond).toBeGreaterThan(0);
    expect(a.wall.timings.ticks).toBe(90);
    expect(a.wall.machine.arch).toBe(process.arch);
    const { wall: _wa, ...restA } = a;
    const { wall: _wb, ...restB } = b;
    expect(restA).toEqual(restB);
  });

  it("measures on the clock it is given, leaving the warmup out", async () => {
    let now = 0;
    const report = await runStats({
      rapier,
      game: testGame,
      registry,
      scene: yard,
      script: idle,
      ticks: 20,
      warmup: 5,
      timings: { clock: () => (now += 1) },
    });
    expect(report.ticks).toBe(20);
    expect(report.wall.timings.ticks).toBe(20);
    expect(report.wall.ticksPerSecond).toBeGreaterThan(0);
  });

  it("rejects a blocked run", async () => {
    await expect(
      runStats({
        game: testGame,
        registry,
        scene: yard,
        script: { v: 1, steps: [] } as never,
        ticks: 5,
      }),
    ).rejects.toThrow(/blocked/);
  });
});

describe("generateLargeScene", () => {
  it("writes a metric scene in the current format, the same for one seed", () => {
    const scene = generateLargeScene(7, { solids: 30, sensors: 15, followers: 5 });
    expect(scene.v).toBe(SCENE_FORMAT_VERSION);
    expect(scene.entities).toHaveLength(50);
    expect(generateLargeScene(7, { solids: 30, sensors: 15, followers: 5 })).toEqual(scene);
    expect(LARGE_5K.solids + LARGE_5K.sensors + LARGE_5K.followers).toBe(5000);
  });

  it("runs gameless on Rapier and its physics-free twin on the geometry backend", async () => {
    const mix = { solids: 60, sensors: 30, followers: 10 };
    const script = idle;
    const physical = await runStats({
      rapier,
      scene: generateLargeScene(3, mix),
      script,
      ticks: 30,
    });
    const twin = await runStats({ scene: generateLargeScene(3, mix, "none"), script, ticks: 30 });
    expect(physical.counts.entities).toBe(100);
    expect(twin.counts.entities).toBe(100);
    expect(twin.counts.events).toBe(0);
  });
});

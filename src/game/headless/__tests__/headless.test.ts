// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { testYard } from "../../__tests__/fixtures/test-yard.expanded";
import type { RapierModule } from "../../types";
import { createHeadlessRuntime, runProbe } from "../headless";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

describe("headless runtime", () => {
  it("runs without a DOM", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("holding move_right on test-yard moves right and lands on an entity id", () => {
    const report = runProbe({ rapier, scene: testYard(), ticks: 120, hold: ["move_right"] });

    expect(report.load.ok).toBe(true);
    expect(report.ticks).toBe(120);
    expect(report.tickRate).toBe(60);
    expect(report.final.position.x).toBeGreaterThan(960);

    const landed = report.events.find((e) => e.type === "landed");
    expect(landed?.entityId).toBe("~solid:0");
    expect(report.landings[0]).toMatchObject({ tick: 0, on: "~solid:0" });
    expect(typeof document).toBe("undefined");
  });

  it("is deterministic", () => {
    const opts = {
      rapier,
      scene: testYard(),
      ticks: 90,
      hold: ["move_right"],
      inputs: [
        [10, "jump", 1],
        [24, "jump", 0],
      ] as [number, string, 0 | 1][],
    };
    expect(runProbe(opts)).toEqual(runProbe(opts));
  });

  it("applies scripted edges at their tick", () => {
    const report = runProbe({
      rapier,
      scene: testYard(),
      ticks: 40,
      inputs: [
        [5, "jump", 1],
        [30, "jump", 0],
      ],
    });
    const left = report.events.find((e) => e.type === "left-ground");
    expect(left).toMatchObject({ tick: 5, entityId: "~solid:0" });
  });

  it("caps events and flags truncation", () => {
    const report = runProbe({ rapier, scene: testYard(), ticks: 10, maxEvents: 0 });
    expect(report.events).toEqual([]);
    expect(report.truncated).toBe(true);
    expect(report.landings).toHaveLength(1);
  });

  it("returns the load report instead of running a broken scene", () => {
    const scene = testYard();
    scene.entities.push({ ...scene.entities[0] });
    const report = runProbe({ rapier, scene, ticks: 60 });
    expect(report.load).toMatchObject({ ok: false, entityId: "~solid:0" });
    expect(report.ticks).toBe(0);
    expect(report.stats.bodies).toBe(0);
  });

  it("createHeadlessRuntime loads the scene it is given", () => {
    const rt = createHeadlessRuntime({ rapier, scene: testYard() });
    expect(rt.stats().entities).toBe(32);
    expect(rt.step(1000 / 60, []).player.grounded).toBe(true);
    rt.destroy();
  });

  it("createHeadlessRuntime throws on a scene that fails to load", () => {
    const scene = testYard();
    scene.entities.push({ ...scene.entities[0] });
    expect(() => createHeadlessRuntime({ rapier, scene })).toThrow(/~solid:0/);
  });
});

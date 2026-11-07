// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { engineYard } from "../../__tests__/fixtures/engine-yard.expanded";
import { testGame } from "../../__tests__/fixtures/test-game";
import { SENSOR_ENTER } from "../../runtime/types";
import type { RapierModule } from "../../types";
import { createHeadlessRuntime, probeConfigHash, runProbe, unknownActionError } from "../headless";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

describe("headless runtime", () => {
  it("runs without a DOM", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });

  it("holding right on the test game moves the avatar into the zone", () => {
    const report = runProbe({
      rapier,
      game: testGame,
      scene: engineYard(),
      ticks: 150,
      hold: ["right"],
    });

    expect(report.load.ok).toBe(true);
    expect(report.ticks).toBe(150);
    expect(report.tickRate).toBe(60);
    expect(report.final?.position.x).toBeGreaterThan(300);
    expect(report.events).toContainEqual(
      expect.objectContaining({ type: SENSOR_ENTER, entityId: "zone", other: "avatar" }),
    );
    expect(typeof document).toBe("undefined");
  });

  it("is deterministic", () => {
    const opts = {
      rapier,
      game: testGame,
      scene: engineYard(),
      ticks: 90,
      hold: ["right"],
      inputs: [
        [10, "push", 1],
        [24, "push", 0],
      ] as [number, string, 0 | 1][],
    };
    expect(runProbe(opts)).toEqual(runProbe(opts));
  });

  it("applies scripted edges at their tick", () => {
    const final = (inputs: [number, string, 0 | 1][]) =>
      runProbe({ rapier, game: testGame, scene: engineYard(), ticks: 40, inputs }).final!;
    expect(final([]).position.x).toBe(300);
    expect(final([[5, "right", 1]]).position.x).toBeGreaterThan(
      final([[20, "right", 1]]).position.x,
    );
  });

  it("caps events and flags truncation", () => {
    const report = runProbe({
      rapier,
      game: testGame,
      scene: engineYard(),
      ticks: 150,
      hold: ["right"],
      maxEvents: 0,
    });
    expect(report.events).toEqual([]);
    expect(report.truncated).toBe(true);
  });

  it("returns the load report instead of running a broken scene", () => {
    const scene = engineYard();
    scene.entities.push({ ...scene.entities[0]! });
    const report = runProbe({ rapier, game: testGame, scene, ticks: 60 });
    expect(report.load).toMatchObject({ ok: false, entityId: "~solid:0" });
    expect(report.ticks).toBe(0);
    expect(report.stats.bodies).toBe(0);
    expect(report.final).toBeNull();
  });

  it("runs primitives alone without a game", () => {
    const report = runProbe({ rapier, scene: engineYard(), ticks: 10 });
    expect(report.load.ok).toBe(true);
    expect(report.final).toBeNull();
    expect(() => runProbe({ rapier, scene: engineYard(), ticks: 1, hold: ["right"] })).toThrow(
      /unknown action "right" \(actions: none\)/,
    );
  });

  it("rejects actions the game doesn't declare, with a guess", () => {
    expect(
      unknownActionError(
        "right",
        testGame.actions.map((a) => a.action),
      ),
    ).toBeNull();
    expect(() =>
      runProbe({ rapier, game: testGame, scene: engineYard(), ticks: 1, hold: ["rght"] }),
    ).toThrow('unknown action "rght"; did you mean "right"? (actions: left, right, push)');
  });

  it("asks the game for an outcome after every tick and keeps the first", () => {
    const report = runProbe({
      rapier,
      game: testGame,
      scene: engineYard(),
      ticks: 150,
      hold: ["right"],
      maxEvents: 0,
    });
    expect(report.outcome).toMatchObject({ result: "won", entityId: "zone" });
    expect(report.outcome!.tick).toBeGreaterThan(0);
    expect(report.ticks).toBe(150);
    expect(runProbe({ rapier, game: testGame, scene: engineYard(), ticks: 5 }).outcome).toBe(
      undefined,
    );
  });

  it("hashes the engine, tick rate, game and its tuning", () => {
    expect(probeConfigHash(testGame)).toBe(probeConfigHash(testGame));
    expect(probeConfigHash(testGame)).not.toBe(probeConfigHash(null));
    expect(probeConfigHash({ ...testGame, configHash: "x" })).not.toBe(probeConfigHash(testGame));
    expect(runProbe({ rapier, game: testGame, scene: engineYard(), ticks: 1 }).configHash).toBe(
      probeConfigHash(testGame),
    );
  });

  it("createHeadlessRuntime loads the scene it is given", () => {
    const rt = createHeadlessRuntime({ rapier, game: testGame, scene: engineYard() });
    expect(rt.stats().entities).toBe(9);
    expect(rt.step(1000 / 60, []).game).toMatchObject({ position: { x: 300 } });
    rt.destroy();
  });

  it("createHeadlessRuntime throws on a scene that fails to load", () => {
    const scene = engineYard();
    scene.entities.push({ ...scene.entities[0]! });
    expect(() => createHeadlessRuntime({ rapier, game: testGame, scene })).toThrow(/~solid:0/);
  });
});

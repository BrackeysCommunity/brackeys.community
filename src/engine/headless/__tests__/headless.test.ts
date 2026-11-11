// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { engineYard } from "../../__tests__/fixtures/engine-yard.expanded";
import {
  testGame,
  type TestGameOptions,
  type TestGameSnapshot,
} from "../../__tests__/fixtures/test-game";
import { createRegistry, defineGame } from "../../game/define";
import type { GameCommand, PlayState } from "../../game/types";
import { SENSOR_ENTER } from "../../runtime/types";
import { expandScene } from "../../scene/expand";
import { prefabLibrary } from "../../scene/prefab";
import { SCENE_FORMAT_VERSION, type Prefab } from "../../scene/types";
import type { RapierModule } from "../../types";
import { createHeadlessRuntime, probeConfigHash, runProbe, unknownActionError } from "../headless";
import { runLoop, startRun } from "../play-loop";

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
    expect(report.final?.position.x).toBeGreaterThan(3);
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
    expect(final([]).position.x).toBe(3);
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

  it("steps on the game's clock and reports its rate", () => {
    const at30 = { ...testGame, time: { kind: "fixed" as const, rate: 30 } };
    const dts: number[] = [];
    const timed = {
      ...at30,
      createRuntime(ctx: Parameters<typeof testGame.createRuntime>[0]) {
        const inner = testGame.createRuntime(ctx);
        return {
          ...inner,
          beforeStep(...args: Parameters<NonNullable<typeof inner.beforeStep>>) {
            dts.push(args[0]);
            for (const a of args[1]) dts.push(a.timestamp);
            inner.beforeStep?.(...args);
          },
        };
      },
    };
    const report = runProbe({
      rapier,
      game: timed,
      scene: engineYard(),
      ticks: 3,
      inputs: [[2, "right", 1]],
    });
    expect(report.tickRate).toBe(30);
    expect(dts).toEqual([1000 / 30, 1000 / 30, 1000 / 30, 2 * (1000 / 30)]);
    expect(report.configHash).toBe(probeConfigHash(at30));
    expect(probeConfigHash(at30)).not.toBe(probeConfigHash(testGame));
    expect(probeConfigHash(testGame, { rate: 30 })).toBe(probeConfigHash(at30));
  });

  it("steps every tick of an event game, as the shell's step(n) does", () => {
    const event = { ...testGame, time: { kind: "event" as const } };
    expect(runProbe({ rapier, game: event, scene: engineYard(), ticks: 10 }).ticks).toBe(10);
  });

  it("createHeadlessRuntime loads the scene it is given", () => {
    const rt = createHeadlessRuntime({ rapier, game: testGame, scene: engineYard() });
    expect(rt.stats().entities).toBe(9);
    expect(rt.step(1000 / 60, []).game).toMatchObject({ position: { x: 3 } });
    rt.destroy();
  });

  it("createHeadlessRuntime throws on a scene that fails to load", () => {
    const scene = engineYard();
    scene.entities.push({ ...scene.entities[0]! });
    expect(() => createHeadlessRuntime({ rapier, game: testGame, scene })).toThrow(/~solid:0/);
  });

  it("without Rapier, refuses a Rapier scene in the probe and in createHeadlessRuntime", () => {
    expect(runProbe({ game: testGame, scene: engineYard(), ticks: 3 })).toMatchObject({
      ticks: 0,
      load: { ok: false, reason: "physics-not-loaded" },
    });
    expect(() => createHeadlessRuntime({ game: testGame, scene: engineYard() })).toThrow(
      /no Rapier module/,
    );
  });
});

const BEACON: Prefab = {
  kind: "prefab",
  v: 4,
  id: "beacon",
  entities: [{ id: "light", type: "marker", at: [0, 0] }],
};
const PLACE = "place";

/** What a state's world answered while the run was live. */
type Seen = { tick: number; avatar: boolean; markers: number };
const seenOf = (state: PlayState): Seen => ({
  tick: state.tick,
  avatar: state.world?.exists("avatar") ?? false,
  markers: state.world?.count({ type: "marker" }) ?? -1,
});

/**
 * The test game with a `place` command that instantiates the beacon, and an
 * outcome hook that records what each state's world answers and wins once the beacon is live.
 */
function beaconGame(seen: Seen[]) {
  return defineGame<TestGameSnapshot, TestGameOptions>({
    ...testGame,
    commands: { ...testGame.commands, [PLACE]: { description: "Places a beacon." } },
    play: {
      ...testGame.play,
      results: [...(testGame.play?.results ?? []), "lit"],
      outcome: (state) => {
        seen.push(seenOf(state));
        return state.world?.exists("beacon#1") ? { result: "lit", entityId: "beacon#1" } : null;
      },
    },
    createRuntime(ctx) {
      const base = testGame.createRuntime(ctx);
      return {
        ...base,
        beforeStep(dt, actions, commands) {
          base.beforeStep?.(dt, actions, commands);
          if (commands.some((c) => c.name === PLACE)) ctx.instantiate("beacon", [1, 1]);
        },
      };
    },
  });
}

describe("the world a run's states carry", () => {
  const placeAt = (tick: number): [number, GameCommand][] => [[tick, { name: PLACE }]];

  it("runProbe gives the outcome hook the live world on every tick", () => {
    const seen: Seen[] = [];
    const game = beaconGame(seen);
    const report = runProbe({
      rapier,
      game,
      registry: createRegistry(game),
      scene: engineYard(),
      ticks: 6,
      commands: placeAt(3),
      library: prefabLibrary([BEACON]),
    });
    expect(report.blocked).toBeUndefined();
    expect(report.outcome).toMatchObject({ result: "lit", tick: 3, entityId: "beacon#1" });
    expect(seen).toEqual([
      { tick: 0, avatar: true, markers: 1 },
      { tick: 1, avatar: true, markers: 1 },
      { tick: 2, avatar: true, markers: 1 },
      { tick: 3, avatar: true, markers: 2 },
    ]);
  });

  it("the run loop playtest, fuzz and replay share gives every state the live world", () => {
    const seen: Seen[] = [];
    const game = beaconGame([]);
    const registry = createRegistry(game);
    const started = startRun({ rapier, game, registry, scene: engineYard(), play: {} });
    if (!started.ok) throw new Error(started.load.ok ? "" : started.load.error);
    try {
      runLoop({
        runtime: started.runtime,
        game,
        maxTicks: 4,
        input: { done: () => false, after: (s) => seen.push(seenOf(s)) },
      });
    } finally {
      started.runtime.destroy();
    }
    expect(seen.map((s) => s.tick)).toEqual([0, 1, 2, 3]);
    expect(seen.every((s) => s.avatar && s.markers === 1)).toBe(true);
  });
});

describe("runProbe blocked", () => {
  it("ends at stage run with the code of an EngineError out of a step, keeping the ticks before it", () => {
    const game = beaconGame([]);
    const report = runProbe({
      rapier,
      game,
      registry: createRegistry(game),
      scene: engineYard(),
      ticks: 10,
      hold: ["right"],
      commands: [[4, { name: PLACE }]],
    });
    expect(report.ticks).toBe(4);
    expect(report.blocked).toMatchObject({
      blocked: true,
      stage: "run",
      scene: "engine-yard",
      scriptIssues: [],
    });
    const issue = report.blocked!.issues.at(-1)!;
    expect(issue).toMatchObject({ severity: "error", code: "prefab-not-spawnable" });
    expect(issue.message).toContain('"beacon"');
    expect(report.final?.position.x).toBeGreaterThan(3);
    expect(report.outcome).toBeUndefined();
  });

  it("rethrows an error that isn't an EngineError", () => {
    const game = defineGame<TestGameSnapshot, TestGameOptions>({
      ...testGame,
      createRuntime(ctx) {
        return {
          ...testGame.createRuntime(ctx),
          afterStep() {
            throw new Error("game bug");
          },
        };
      },
    });
    expect(() =>
      runProbe({ rapier, game, registry: createRegistry(game), scene: engineYard(), ticks: 3 }),
    ).toThrow("game bug");
  });
});

describe("runProbe's legal commands", () => {
  /** A physics-free turns game listing one `pick` per tick it has seen. */
  const counting = (lists: boolean) =>
    defineGame<{ seen: number }>({
      id: "counting",
      types: [],
      actions: [],
      time: { kind: "turns" },
      world: { physics: "none" },
      commands: { pick: { description: "Picks i.", args: z.strictObject({ i: z.number() }) } },
      createRuntime() {
        let seen = 0;
        return {
          beforeStep() {
            seen++;
          },
          snapshot: () => ({ seen }),
        };
      },
      play: lists
        ? {
            commands: ({ snapshot, tick }) =>
              Array.from({ length: snapshot.seen * 40 }, (_, i) => ({
                name: "pick",
                args: { i: i + tick / 1000 },
              })),
          }
        : {},
    });
  const probe = (ticks: number, lists = true) => {
    const game = counting(lists);
    const registry = createRegistry(game);
    const scene = expandScene(
      {
        v: SCENE_FORMAT_VERSION,
        name: "count-yard",
        game: "counting",
        bounds: [0, 0, 10, 10],
        entities: [{ id: "start", type: "marker", at: [1, 1] }],
      },
      registry,
    );
    const report = runProbe({ game, registry, ticks, scene });
    expect(report.load.ok, JSON.stringify(report.load)).toBe(true);
    return report;
  };

  it("lists the commands legal after the last tick, cut at 64", () => {
    const one = probe(1);
    expect(one.legal).toHaveLength(40);
    expect(one.legal![0]).toEqual({ name: "pick", args: { i: 0 } });
    expect(one.legalTruncated).toBeUndefined();
    const two = probe(2);
    expect(two.legal).toHaveLength(64);
    expect(two.legal![1]).toEqual({ name: "pick", args: { i: 1.001 } });
    expect(two.legalTruncated).toBe(true);
    expect("legal" in probe(2, false)).toBe(false);
  });
});

// @vitest-environment node
import { readFileSync } from "node:fs";

import { runProbe, SENSOR_ENTER, SENSOR_EXIT, type StepEvent } from "@jams/engine/headless";
import { createRegistry, expandScene, parseSceneOrThrow } from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { platformerGame } from "..";
import golden from "./fixtures/m1-golden.json";

/**
 * The platformer must play exactly as it did before the engine/game split.
 * `m1-golden.json` was captured from the pre-split engine on the same scene:
 * `final` and the landings must match bit for bit; events match after M1's
 * sensor event names map onto `sensor:enter`, compared per tick as a
 * multiset because engine events now come before the game's within a tick.
 * The actor is the spawned entity `player#1`.
 */

type Script = (typeof golden.scripts)[keyof typeof golden.scripts];
type M1Event = { tick: number; type: string; entityId?: string; at: { x: number; y: number } };

const M1_SENSOR_EVENTS = new Set(["cheese", "hole", "lava"]);

const registry = createRegistry(platformerGame);
const scene = expandScene(
  parseSceneOrThrow(
    readFileSync(new URL("../scenes/test-yard.json", import.meta.url), "utf8"),
    registry,
  ),
  registry,
);

const comparable = (e: M1Event | StepEvent) =>
  JSON.stringify({
    tick: e.tick,
    type: M1_SENSOR_EVENTS.has(e.type) ? SENSOR_ENTER : e.type,
    entityId: e.entityId,
    at: e.at,
  });

const perTick = (events: readonly (M1Event | StepEvent)[]) => events.map(comparable).sort();

const landingsOf = (events: readonly StepEvent[]) =>
  events
    .filter((e) => e.type === "landed")
    .map((e) => ({ tick: e.tick, on: e.entityId ?? "", at: e.at }));

async function standardRapier() {
  return import("@dimforge/rapier2d");
}

describe("platformer golden trace", () => {
  for (const [name, script] of Object.entries(golden.scripts) as [string, Script][]) {
    it(`reproduces M1's ${name} script`, async () => {
      const report = runProbe({
        rapier: await standardRapier(),
        game: platformerGame,
        registry,
        scene,
        ticks: script.ticks,
        inputs: script.inputs as [number, string, 0 | 1][],
      });
      expect(report.load.ok).toBe(true);
      expect(report.final).toEqual(script.final);
      const events = report.events.filter((e) => e.type !== SENSOR_EXIT);
      expect(landingsOf(events)).toEqual(script.landings);
      expect(perTick(events)).toEqual(perTick(script.events as M1Event[]));
      expect(report.stats.perType.player).toBe(1);
      for (const e of events.filter((e) => e.type === SENSOR_ENTER))
        expect(e.other).toBe("player#1");
    });
  }
});

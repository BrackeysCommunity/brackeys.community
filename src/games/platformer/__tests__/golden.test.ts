// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";

import { runProbe } from "@jams/engine/headless";
import { createRegistry, expandScene, parseSceneOrThrow, sceneHash } from "@jams/engine/scene";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { platformerGame } from "..";
import golden from "./fixtures/m1-golden.json";
import { LENGTH_UNITS, platformerLengthUnitRows } from "./probes/length-unit-probe";

/**
 * The platformer must replay these traces bit for bit: the final state and
 * every event of each script on `test-yard`, in order. The scripts are the
 * ones the traces were first captured with; the traces were recaptured when
 * the simulation moved to metres at Rapier's
 * default length unit, whose tolerances suit a metre world (px-scale
 * tolerances made the px world's contacts differ). A trace that moves means
 * replays break: recapture only for a change that is meant to move it, with
 * `UPDATE_GOLDENS=1`, and say why in the CHANGELOG.
 */

type Script = (typeof golden.scripts)[keyof typeof golden.scripts];

const GOLDEN = new URL("./fixtures/m1-golden.json", import.meta.url);
const UPDATE = Boolean(process.env.UPDATE_GOLDENS);

const registry = createRegistry(platformerGame);
const def = parseSceneOrThrow(
  readFileSync(new URL("../scenes/test-yard.json", import.meta.url), "utf8"),
  registry,
);
const scene = expandScene(def, registry);

/** Through JSON, as the file holds it (no `undefined` fields, `-0` as `0`). */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function standardRapier() {
  return import("@dimforge/rapier2d");
}

const captured: Record<string, Script> = {};
let configHash = golden.configHash;

describe("platformer golden trace", () => {
  for (const [name, script] of Object.entries(golden.scripts) as [string, Script][]) {
    it(`replays the ${name} script`, async () => {
      const report = runProbe({
        rapier: await standardRapier(),
        game: platformerGame,
        registry,
        scene,
        ticks: script.ticks,
        inputs: script.inputs as [number, string, 0 | 1][],
      });
      expect(report.load.ok).toBe(true);
      expect(report.stats.perType.player).toBe(1);
      const final = plain(report.final) as Script["final"];
      const events = plain(report.events) as Script["events"];
      if (UPDATE) {
        captured[name] = { ticks: script.ticks, inputs: script.inputs, final, events };
        configHash = report.configHash;
        return;
      }
      expect(final).toEqual(script.final);
      expect(events).toEqual(script.events);
      expect(events.some((e) => e.type === "landed")).toBe(true);
      for (const e of report.events.filter((e) => e.type.startsWith("sensor:")))
        expect(e.other).toBe("player#1");
    });
  }

  it.skipIf(UPDATE)(
    `replays every script at ${LENGTH_UNITS.join(", ")} px per metre`,
    async () => {
      const rows = platformerLengthUnitRows(await standardRapier());
      expect(rows).toStrictEqual(
        Object.fromEntries(Object.keys(golden.scripts).map((n) => [n, []])),
      );
    },
    60_000,
  );

  afterAll(() => {
    if (!UPDATE || Object.keys(captured).length !== Object.keys(golden.scripts).length) return;
    const scripts = Object.fromEntries(Object.keys(golden.scripts).map((n) => [n, captured[n]]));
    const file = { scene: golden.scene, sceneHash: sceneHash(def), configHash, scripts };
    writeFileSync(GOLDEN, `${JSON.stringify(file, null, 2)}\n`);
  });
});

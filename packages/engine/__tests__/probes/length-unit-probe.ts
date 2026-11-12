/**
 * The length-unit probe: `engine-yard`'s parity script and fuzz under the
 * test game at several px per metre (`GameDefinition.world.lengthUnit`),
 * each reduced to a digest. The simulation runs in metres at Rapier's
 * default length unit and px per metre only reaches drawing, so every
 * digest must match the game's default.
 *
 * `determinism.test.ts` runs it; under Bun it prints the verdict as JSON:
 * `bun packages/engine/__tests__/probes/length-unit-probe.ts` (the `-compat`
 * builds only, as for the determinism probe).
 */
import { readFileSync } from "node:fs";

import { createRegistry } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { fuzz } from "../../headless/fuzz";
import { runProbe } from "../../headless/headless";
import { expandScene } from "../../scene/expand";
import { hashText } from "../../scene/hash";
import { parseSceneOrThrow } from "../../scene/parse";
import type { RapierModule } from "../../types";
import { ENGINE_PARITY_SCRIPT } from "../fixtures/parity-script";
import { testGame } from "../fixtures/test-game";
import { loadFlavour, type Flavour } from "./determinism-probe";

export const LENGTH_UNITS = [100, 32, 48] as const;

export type LengthUnitDigests = { script: string; fuzz: string };

const baseRegistry = createRegistry(testGame);
const def = parseSceneOrThrow(
  readFileSync(new URL("../../scenes/engine-yard.json", import.meta.url), "utf8"),
  baseRegistry,
);
const scene = expandScene(def, baseRegistry);

/** The test game drawn at `lengthUnit` px per metre; `null` leaves the game's default. */
export function testGameAt(lengthUnit: number | null): GameDefinition {
  if (lengthUnit === null) return testGame;
  return { ...testGame, world: { ...testGame.world, lengthUnit } };
}

/**
 * Everything the run simulated. `configHash` is left out: it names the game's
 * configuration, px per metre included, not what the simulation did.
 */
export function lengthUnitDigests(rapier: RapierModule, game: GameDefinition): LengthUnitDigests {
  const registry = createRegistry(game);
  const report = runProbe({ rapier, game, registry, scene, ...ENGINE_PARITY_SCRIPT });
  if (!report.load.ok) throw new Error("engine-yard failed to load");
  const run = fuzz({ rapier, game, registry, scene: def, seed: 6, rollouts: 20, ticks: 600 });
  if (run.blocked) throw new Error("engine-yard blocked the fuzz");
  const { touched, untouched, results, ticks } = run;
  return {
    script: hashText(JSON.stringify([report.final, report.events, report.stats, report.ticks])),
    fuzz: hashText(JSON.stringify([touched, untouched, results, ticks])),
  };
}

export type LengthUnitFlavour = {
  /** The game's default, `world.lengthUnit` unset. */
  unset: LengthUnitDigests;
  /** The px per metre values whose digests differ from `unset`. */
  changed: number[];
} & Record<`${(typeof LENGTH_UNITS)[number]}`, LengthUnitDigests>;

export type LengthUnitVerdict = {
  /** Any digest under any flavour moved with px per metre. */
  changed: boolean;
  per: Partial<Record<Flavour, LengthUnitFlavour>>;
};

export function lengthUnitFlavour(rapier: RapierModule): LengthUnitFlavour {
  const unset = lengthUnitDigests(rapier, testGameAt(null));
  const rows = {} as Record<`${(typeof LENGTH_UNITS)[number]}`, LengthUnitDigests>;
  const changed: number[] = [];
  for (const unit of LENGTH_UNITS) {
    const digests = lengthUnitDigests(rapier, testGameAt(unit));
    rows[`${unit}`] = digests;
    if (digests.script !== unset.script || digests.fuzz !== unset.fuzz) changed.push(unit);
  }
  return { unset, changed, ...rows };
}

export async function runLengthUnitProbe(
  flavours: readonly Flavour[] = ["rapier2d-compat", "rapier2d-deterministic-compat"],
): Promise<LengthUnitVerdict> {
  const per: Partial<Record<Flavour, LengthUnitFlavour>> = {};
  for (const flavour of flavours) {
    const rapier = await loadFlavour(flavour);
    if (rapier) per[flavour] = lengthUnitFlavour(rapier);
  }
  return { changed: Object.values(per).some((f) => f.changed.length > 0), per };
}

if ((import.meta as { main?: boolean }).main) {
  const verdict = await runLengthUnitProbe();
  console.log(
    JSON.stringify(
      {
        platform: `${process.platform}-${process.arch}`,
        runtime: `bun ${process.versions.bun}`,
        ...verdict,
      },
      null,
      2,
    ),
  );
}

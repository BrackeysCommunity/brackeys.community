/**
 * The length-unit probe for the platformer: each golden script on
 * `test-yard` (`m1-golden.json`) with the game drawn at several px per metre
 * (`GameDefinition.world.lengthUnit`). The simulation runs in metres and px
 * per metre only reaches drawing, so every run must reproduce the golden
 * trace: the final state and every event.
 *
 * `golden.test.ts` runs it; under Bun it prints the verdict as JSON:
 * `bun src/games/platformer/__tests__/probes/length-unit-probe.ts` (only the
 * `-compat` builds run under Bun).
 */
import { readFileSync } from "node:fs";

import type { RapierModule } from "@jams/engine";
import { runProbe } from "@jams/engine/headless";
import { createRegistry, expandScene, parseSceneOrThrow } from "@jams/engine/scene";

import { platformerGame } from "../..";
import golden from "../fixtures/m1-golden.json";

type Flavour = "rapier2d-compat" | "rapier2d-deterministic-compat";
type Script = (typeof golden.scripts)[keyof typeof golden.scripts];

export const LENGTH_UNITS = [100, 32, 48] as const;

async function loadFlavour(flavour: Flavour): Promise<RapierModule | null> {
  try {
    const mod =
      flavour === "rapier2d-compat"
        ? await import("@dimforge/rapier2d-compat")
        : await import("@dimforge/rapier2d-deterministic-compat");
    const warn = console.warn;
    console.warn = () => {};
    try {
      await mod.default.init();
    } finally {
      console.warn = warn;
    }
    return mod.default as unknown as RapierModule;
  } catch {
    return null;
  }
}

const baseRegistry = createRegistry(platformerGame);
const scene = expandScene(
  parseSceneOrThrow(
    readFileSync(new URL("../../scenes/test-yard.json", import.meta.url), "utf8"),
    baseRegistry,
  ),
  baseRegistry,
);

/** The platformer drawn at `lengthUnit` px per metre. */
export function platformerAt(lengthUnit: number): typeof platformerGame {
  return { ...platformerGame, world: { ...platformerGame.world, lengthUnit } };
}

/** The script's final state and events, through JSON as the golden file holds them. */
export function traceOf(rapier: RapierModule, game: typeof platformerGame, script: Script) {
  const report = runProbe({
    rapier,
    game,
    registry: createRegistry(game),
    scene,
    ticks: script.ticks,
    inputs: script.inputs as [number, string, 0 | 1][],
  });
  if (!report.load.ok) throw new Error("test-yard failed to load");
  return JSON.parse(JSON.stringify({ final: report.final, events: report.events })) as {
    final: Script["final"];
    events: Script["events"];
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Per script, the px per metre values whose trace differs from the golden one. */
export function platformerLengthUnitRows(rapier: RapierModule): Record<string, number[]> {
  const rows: Record<string, number[]> = {};
  for (const [name, script] of Object.entries(golden.scripts) as [string, Script][]) {
    const want = { final: script.final, events: script.events };
    rows[name] = LENGTH_UNITS.filter(
      (unit) => !same(traceOf(rapier, platformerAt(unit), script), want),
    );
  }
  return rows;
}

export async function runPlatformerLengthUnitProbe(
  flavours: readonly Flavour[] = ["rapier2d-compat", "rapier2d-deterministic-compat"],
) {
  const per: Partial<Record<Flavour, Record<string, number[]>>> = {};
  for (const flavour of flavours) {
    const rapier = await loadFlavour(flavour);
    if (rapier) per[flavour] = platformerLengthUnitRows(rapier);
  }
  const changed = Object.values(per).some((rows) => Object.values(rows).some((u) => u.length > 0));
  return { changed, per };
}

if ((import.meta as { main?: boolean }).main) {
  const verdict = await runPlatformerLengthUnitProbe();
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

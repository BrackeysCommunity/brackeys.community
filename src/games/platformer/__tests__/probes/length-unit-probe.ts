/**
 * The length-unit probe for the platformer: each golden script on
 * `test-yard` (`m1-golden.json`) with Rapier's `world.lengthUnit` unset and
 * set to 50 and 100 px per metre, comparing the final state and the landings
 * with the unset run. The unset run is also checked against the golden file,
 * so the baseline is the trace the golden test holds.
 *
 * A script, not a test: `bun src/games/platformer/__tests__/probes/length-unit-probe.ts`
 * prints `{ changed, per }` as JSON. Only the `-compat` builds run under Bun.
 */
import { readFileSync } from "node:fs";

import type { RapierModule } from "@jams/engine";
import { runProbe, type StepEvent } from "@jams/engine/headless";
import { createRegistry, expandScene, parseSceneOrThrow } from "@jams/engine/scene";

import { platformerGame } from "../..";
import golden from "../fixtures/m1-golden.json";

type Flavour = "rapier2d-compat" | "rapier2d-deterministic-compat";
type Unit = "unset" | "50" | "100";
type Landing = { tick: number; on: string; at: { x: number; y: number } };

const UNITS: Record<Unit, number | null> = { unset: null, "50": 50, "100": 100 };

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

/** `rapier` with every new `World` created at `unit` px per metre, before any body exists. */
function withLengthUnit(rapier: RapierModule, unit: number | null): RapierModule {
  if (unit === null) return rapier;
  const perMetre = unit;
  class World extends rapier.World {
    constructor(...args: ConstructorParameters<typeof rapier.World>) {
      super(...args);
      this.lengthUnit = perMetre;
      if (this.lengthUnit !== perMetre) throw new Error(`lengthUnit did not take ${perMetre}`);
    }
  }
  return { ...rapier, World } as RapierModule;
}

const registry = createRegistry(platformerGame);
const scene = expandScene(
  parseSceneOrThrow(
    readFileSync(new URL("../../scenes/test-yard.json", import.meta.url), "utf8"),
    registry,
  ),
  registry,
);

const landingsOf = (events: readonly StepEvent[]): Landing[] =>
  events
    .filter((e) => e.type === "landed")
    .map((e) => ({ tick: e.tick, on: e.entityId ?? "", at: e.at }));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function run(rapier: RapierModule, script: (typeof golden.scripts)[keyof typeof golden.scripts]) {
  const report = runProbe({
    rapier,
    game: platformerGame,
    registry,
    scene,
    ticks: script.ticks,
    inputs: script.inputs as [number, string, 0 | 1][],
  });
  if (!report.load.ok) throw new Error("test-yard failed to load");
  return { final: report.final, landings: landingsOf(report.events) };
}

type Row = {
  final: unknown;
  landings: number;
  finalChanged: boolean;
  landingsChanged: boolean;
  /** The first landing that differs from the unset run's, by index. */
  firstLandingDiff?: { index: number; unset: Landing | null; got: Landing | null };
};

export async function runPlatformerLengthUnitProbe(
  flavours: readonly Flavour[] = ["rapier2d-compat", "rapier2d-deterministic-compat"],
) {
  const per: Partial<
    Record<Flavour, Record<string, Record<Unit, Row> & { goldenHolds: boolean }>>
  > = {};
  let changed = false;
  for (const flavour of flavours) {
    const rapier = await loadFlavour(flavour);
    if (!rapier) continue;
    const scripts: Record<string, Record<Unit, Row> & { goldenHolds: boolean }> = {};
    for (const [name, script] of Object.entries(golden.scripts)) {
      const base = run(rapier, script);
      const rows = {} as Record<Unit, Row>;
      for (const [unit, value] of Object.entries(UNITS) as [Unit, number | null][]) {
        const got = value === null ? base : run(withLengthUnit(rapier, value), script);
        const finalChanged = !same(got.final, base.final);
        const landingsChanged = !same(got.landings, base.landings);
        changed ||= finalChanged || landingsChanged;
        const row: Row = {
          final: got.final,
          landings: got.landings.length,
          finalChanged,
          landingsChanged,
        };
        if (landingsChanged) {
          const n = Math.max(got.landings.length, base.landings.length);
          let index = 0;
          while (index < n && same(got.landings[index], base.landings[index])) index++;
          row.firstLandingDiff = {
            index,
            unset: base.landings[index] ?? null,
            got: got.landings[index] ?? null,
          };
        }
        rows[unit] = row;
      }
      scripts[name] = {
        ...rows,
        goldenHolds: same(base.final, script.final) && same(base.landings, script.landings),
      };
    }
    per[flavour] = scripts;
  }
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

/**
 * The length-unit probe: the determinism probe's digests on `engine-yard`
 * with Rapier's `world.lengthUnit` unset (1, metre-scale tolerances) and set
 * to 50 and 100 px per metre. A digest that moves means setting the unit is
 * a replay-breaking change.
 *
 * A script, not a test: `bun src/engine/__tests__/probes/length-unit-probe.ts`
 * prints `{ changed, per }` as JSON. The engine creates its world with no
 * hook to reach it first, so the probe hands the engine a Rapier module whose
 * `World` sets the unit in its constructor, before any body exists.
 */
import type { RapierModule } from "../../types";
import { loadFlavour, probeDigests, type Flavour, type ProbeDigests } from "./determinism-probe";

export const LENGTH_UNITS = [50, 100] as const;

/** `rapier` with every new `World` created at `unit` px per metre; `null` leaves it as is. */
export function withLengthUnit(rapier: RapierModule, unit: number | null): RapierModule {
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

/** The unit a world gets when nothing sets it. */
export function defaultLengthUnit(rapier: RapierModule): number {
  const world = new rapier.World({ x: 0, y: 0 });
  const unit = world.lengthUnit;
  world.free();
  return unit;
}

type Digest = keyof ProbeDigests;

export type LengthUnitRow = ProbeDigests & { changed: Digest[] };

export type LengthUnitFlavour = {
  defaultLengthUnit: number;
  unset: ProbeDigests;
} & Record<`${(typeof LENGTH_UNITS)[number]}`, LengthUnitRow>;

export type LengthUnitVerdict = {
  /** Any digest under any flavour differs from the unset run. */
  changed: boolean;
  per: Partial<Record<Flavour, LengthUnitFlavour>>;
};

function row(unset: ProbeDigests, digests: ProbeDigests): LengthUnitRow {
  const changed = (Object.keys(unset) as Digest[]).filter((k) => digests[k] !== unset[k]);
  return { ...digests, changed };
}

export async function runLengthUnitProbe(
  flavours: readonly Flavour[] = ["rapier2d-compat", "rapier2d-deterministic-compat"],
): Promise<LengthUnitVerdict> {
  const per: Partial<Record<Flavour, LengthUnitFlavour>> = {};
  for (const flavour of flavours) {
    const rapier = await loadFlavour(flavour);
    if (!rapier) continue;
    const unset = probeDigests(rapier);
    per[flavour] = {
      defaultLengthUnit: defaultLengthUnit(rapier),
      unset,
      "50": row(unset, probeDigests(withLengthUnit(rapier, 50))),
      "100": row(unset, probeDigests(withLengthUnit(rapier, 100))),
    };
  }
  const changed = Object.values(per).some((f) =>
    LENGTH_UNITS.some((u) => f[`${u}`].changed.length > 0),
  );
  return { changed, per };
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

// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { pxPerMetreOf } from "../../game/units";
import type { RapierModule } from "../../types";
import {
  loadFlavour,
  probeDigests,
  scriptReport,
  type Flavour,
  type ProbeDigests,
} from "./determinism-probe";
import { LENGTH_UNITS, lengthUnitFlavour, testGameAt } from "./length-unit-probe";

/**
 * The digests every machine probed so far printed: macOS arm64 (Node and
 * Bun) and Linux arm64 (Bun, `oven/bun:1.4.3-slim`). CI's `test` job runs
 * this on Linux x86_64 under Node; a mismatch there means recordings don't
 * replay across machines on that build. A change to what the engine
 * simulates changes `script` and `fuzz` everywhere at once: re-pin them, and
 * rerun the probe under Bun on another machine to keep the comparison.
 * `script` and `fuzz` were re-pinned when the simulation moved to metres at
 * Rapier's default length unit; `pile` is plain Rapier and didn't move.
 */
const PINNED: Record<Flavour, ProbeDigests> = {
  rapier2d: { script: "4f2826bab91c676f", fuzz: "319584c2c406e711", pile: "0f9f997ba5e4ee6e" },
  "rapier2d-compat": {
    script: "4f2826bab91c676f",
    fuzz: "319584c2c406e711",
    pile: "0f9f997ba5e4ee6e",
  },
  "rapier2d-deterministic-compat": {
    script: "4f2826bab91c676f",
    fuzz: "319584c2c406e711",
    pile: "2ca6d47ad105bbe5",
  },
};

const FLAVOURS = Object.keys(PINNED) as Flavour[];
const loaded = new Map<Flavour, RapierModule>();

beforeAll(async () => {
  for (const flavour of FLAVOURS) {
    const rapier = await loadFlavour(flavour);
    if (!rapier) throw new Error(`${flavour} did not load`);
    loaded.set(flavour, rapier);
  }
});

describe("the determinism probe", () => {
  it.each(FLAVOURS)("%s replays bit for bit on one machine", (flavour) => {
    const rapier = loaded.get(flavour)!;
    expect(probeDigests(rapier)).toStrictEqual(probeDigests(rapier));
  });

  it("the standard and -compat builds agree on every workload", () => {
    expect(probeDigests(loaded.get("rapier2d")!)).toStrictEqual(
      probeDigests(loaded.get("rapier2d-compat")!),
    );
  });

  it("the parity script runs no behaviors, so its digest leaves their stats out", () => {
    expect(scriptReport(loaded.get("rapier2d")!).stats.behaviors).toStrictEqual({});
  });

  it.each(FLAVOURS)("%s matches the digests other machines printed", (flavour) => {
    expect(probeDigests(loaded.get(flavour)!)).toStrictEqual(PINNED[flavour]);
  });

  it.each(FLAVOURS)(
    `%s gives the same digests at ${LENGTH_UNITS.join(", ")} px per metre`,
    (flavour) => {
      for (const unit of LENGTH_UNITS)
        expect(pxPerMetreOf(createRegistry(testGameAt(unit)))).toBe(unit);
      const verdict = lengthUnitFlavour(loaded.get(flavour)!);
      expect(verdict.changed).toStrictEqual([]);
      for (const unit of LENGTH_UNITS) expect(verdict[`${unit}`]).toStrictEqual(verdict.unset);
    },
    60_000,
  );
});

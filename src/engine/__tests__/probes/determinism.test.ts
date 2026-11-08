// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { RapierModule } from "../../types";
import {
  loadFlavour,
  probeDigests,
  scriptReport,
  type Flavour,
  type ProbeDigests,
} from "./determinism-probe";

/**
 * The digests every machine probed so far printed: macOS arm64 (Node and
 * Bun) and Linux arm64 (Bun, `oven/bun:1.4.3-slim`). CI's `test` job runs
 * this on Linux x86_64 under Node; a mismatch there means recordings don't
 * replay across machines on that build. A change to what the engine
 * simulates changes `script` and `fuzz` everywhere at once: re-pin them, and
 * rerun the probe under Bun on another machine to keep the comparison.
 */
const PINNED: Record<Flavour, ProbeDigests> = {
  rapier2d: { script: "ec60f220d6590d0d", fuzz: "cede7d80dbf9a1bb", pile: "0f9f997ba5e4ee6e" },
  "rapier2d-compat": {
    script: "ec60f220d6590d0d",
    fuzz: "cede7d80dbf9a1bb",
    pile: "0f9f997ba5e4ee6e",
  },
  "rapier2d-deterministic-compat": {
    script: "ec60f220d6590d0d",
    fuzz: "cede7d80dbf9a1bb",
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
});

// @vitest-environment node
import { readFileSync } from "node:fs";

import type { RapierModule } from "@jams/engine";
import { runProbe, type ProbeReport } from "@jams/engine/headless";
import { createRegistry, expandScene, parseSceneOrThrow } from "@jams/engine/scene";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { platformerGame } from "..";
import { PARITY_SCRIPT } from "./fixtures/parity-script";

const registry = createRegistry(platformerGame);
const scene = expandScene(
  parseSceneOrThrow(
    readFileSync(new URL("../scenes/test-yard.json", import.meta.url), "utf8"),
    registry,
  ),
  registry,
);

let standard: RapierModule;
let compat: RapierModule;

beforeAll(async () => {
  standard = await import("@dimforge/rapier2d");
  const mod = await import("@dimforge/rapier2d-compat");
  const warn = console.warn;
  console.warn = () => {};
  try {
    await mod.default.init();
  } finally {
    console.warn = warn;
  }
  compat = mod.default as unknown as RapierModule;
});

const probe = (rapier: RapierModule): ProbeReport =>
  runProbe({ rapier, game: platformerGame, registry, scene, ...PARITY_SCRIPT });

describe("Rapier flavour parity on test-yard", () => {
  it("runs the 600-tick script identically under rapier2d and rapier2d-compat", () => {
    const a = probe(standard);
    const b = probe(compat);
    expect(a.load.ok).toBe(true);
    expect(a.ticks).toBe(600);
    expect(a.truncated).toBe(false);
    expect(a.events.filter((e) => e.type === "landed").length).toBeGreaterThanOrEqual(5);
    expect(b.final).toStrictEqual(a.final);
    expect(b.events).toStrictEqual(a.events);
    expect(b.stats).toStrictEqual(a.stats);
  });
});

// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import { runProbe } from "../headless/headless";
import type { ProbeReport } from "../headless/types";
import { SENSOR_ENTER, SENSOR_EXIT } from "../runtime/types";
import { expandScene } from "../scene/expand";
import { parseSceneOrThrow } from "../scene/parse";
import type { RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { ENGINE_PARITY_SCRIPT } from "./fixtures/parity-script";
import { testGame } from "./fixtures/test-game";

const registry = createRegistry(testGame);
const scene = expandScene(
  parseSceneOrThrow(
    readFileSync(new URL("../scenes/engine-yard.json", import.meta.url), "utf8"),
    registry,
  ),
  registry,
);

let standard: RapierModule;
let compat: RapierModule;

beforeAll(async () => {
  standard = await import("@dimforge/rapier2d");
  compat = await loadCompatRapier();
});

const probe = (rapier: RapierModule): ProbeReport =>
  runProbe({ rapier, game: testGame, registry, scene, ...ENGINE_PARITY_SCRIPT });

describe("Rapier flavour parity", () => {
  it("runs the 600-tick script identically under rapier2d and rapier2d-compat", () => {
    const a = probe(standard);
    const b = probe(compat);
    expect(a.load.ok).toBe(true);
    expect(a.ticks).toBe(600);
    expect(a.truncated).toBe(false);
    const zone = (type: string) => a.events.filter((e) => e.type === type && e.entityId === "zone");
    expect(zone(SENSOR_ENTER).length).toBeGreaterThanOrEqual(2);
    expect(zone(SENSOR_EXIT).length).toBeGreaterThanOrEqual(2);
    expect(b.final).toStrictEqual(a.final);
    expect(b.events).toStrictEqual(a.events);
    expect(b.stats).toStrictEqual(a.stats);
  });
});

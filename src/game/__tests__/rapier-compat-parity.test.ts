// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { runProbe } from "../headless/headless";
import type { ProbeReport } from "../headless/types";
import { expandScene } from "../scene/expand";
import { parseSceneOrThrow } from "../scene/parse";
import type { RapierModule } from "../types";

const scene = expandScene(
  parseSceneOrThrow(readFileSync(new URL("../scenes/test-yard.json", import.meta.url), "utf8")),
);

const INPUTS: [number, string, 0 | 1][] = [
  [0, "move_right", 1],
  [40, "jump", 1],
  [54, "jump", 0],
  [100, "jump", 1],
  [106, "jump", 0],
  [112, "jump", 1],
  [126, "jump", 0],
  [150, "move_right", 0],
  [150, "move_left", 1],
  [170, "dash", 1],
  [172, "dash", 0],
  [200, "jump", 1],
  [214, "jump", 0],
];

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
  runProbe({ rapier, scene, ticks: 240, inputs: INPUTS });

describe("Rapier flavour parity", () => {
  it("runs the same probe identically under rapier2d and rapier2d-compat", () => {
    const a = probe(standard);
    const b = probe(compat);
    expect(a.load.ok).toBe(true);
    expect(b.load.ok).toBe(true);
    expect(a.events.length).toBeGreaterThan(2);
    expect(b.final).toEqual(a.final);
    expect(b.events).toEqual(a.events);
    expect(b.landings).toEqual(a.landings);
    expect(b.stats).toEqual(a.stats);
  });
});

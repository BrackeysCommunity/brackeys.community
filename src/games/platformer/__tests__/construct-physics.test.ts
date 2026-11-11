// @vitest-environment node
import { readFileSync } from "node:fs";

import {
  createRegistry,
  parseSceneOrThrow,
  validateScene,
  type SceneDefinition,
} from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { platformerGame } from "..";

const registry = createRegistry(platformerGame);
const yard = parseSceneOrThrow(
  readFileSync(new URL("../scenes/test-yard.json", import.meta.url), "utf8"),
  registry,
);

const withConstruct = (physics?: "rapier" | "none"): SceneDefinition => ({
  ...yard,
  settings: { ...yard.settings, ...(physics ? { physics } : {}) },
  entities: [
    ...(yard.entities ?? []),
    { id: "pad", type: "construct", construct: "bounce_pad", at: [300, 400] },
  ],
});

const physicsRequired = (def: SceneDefinition) =>
  validateScene(def, registry).filter((i) => i.code === "physics-required");

describe("construct physics", () => {
  it("refuses a construct in a scene with physics none", () => {
    const issues = physicsRequired(withConstruct("none"));
    expect(issues.some((i) => i.entityIds?.includes("pad"))).toBe(true);
  });

  it("accepts a construct where the scene simulates bodies", () => {
    expect(physicsRequired(withConstruct())).toEqual([]);
    expect(physicsRequired(withConstruct("rapier"))).toEqual([]);
  });
});

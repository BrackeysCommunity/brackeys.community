// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { migrationHarness } from "@jams/engine-testing";
import {
  createRegistry,
  parseScene,
  SCENE_FORMAT_VERSION,
  validateScene,
} from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { platformerGame } from "..";

const registry = createRegistry(platformerGame);
const FIXTURES = new URL("./fixtures/", import.meta.url);

/**
 * sha-256 of each frozen platformer scene; a new format version adds a `v<n>`
 * folder holding what each older file migrates to.
 */
const FROZEN: Record<string, string> = {
  "v1/test-yard.json": "260018d8eda8bfb320c3b4fdb2b2f9ff9f0cfde132e95ddedb0662c9aad5ff4d",
  "v3/test-yard.json": "3bc7281ee33c12bdb7473bfc5ce9dd7524f1e841f6b6b746801c68332bbf70f1",
};

const frozenText = (file: string) => readFileSync(new URL(file, FIXTURES), "utf8");

describe("frozen platformer scenes", () => {
  it("are unchanged", () => {
    const files = readdirSync(FIXTURES)
      .filter((f) => /^v\d+$/.test(f))
      .flatMap((v) => readdirSync(new URL(`${v}/`, FIXTURES)).map((f) => `${v}/${f}`));
    expect(files.sort()).toEqual(Object.keys(FROZEN).sort());
    for (const [file, sha] of Object.entries(FROZEN))
      expect(createHash("sha256").update(frozenText(file)).digest("hex"), file).toBe(sha);
  });

  migrationHarness({ fixtures: FIXTURES, registryOf: () => registry });

  for (const file of Object.keys(FROZEN)) {
    it(`${file} validates once migrated`, () => {
      const parsed = parseScene(frozenText(file), registry);
      expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.def.v).toBe(SCENE_FORMAT_VERSION);
      expect(validateScene(parsed.def, registry).filter((i) => i.severity === "error")).toEqual([]);
    });
  }
});

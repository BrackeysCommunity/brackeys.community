import { existsSync, readdirSync } from "node:fs";

import { expect, test } from "vite-plus/test";

import { familyOf, registered } from "../src/shell/registry.ts";
import { GOLDEN_DIR } from "./golden.ts";

const vectors = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

test("every registered family has its vectors", () => {
  expect(registered().length).toBeGreaterThan(0);
  for (const id of registered()) {
    expect(existsSync(`${GOLDEN_DIR}/${id}.json`), `${id} has no golden vectors`).toBe(true);
    expect(familyOf(id)?.id).toBe(id);
  }
});

// The integrator's gate: every family the world can draw has a scene.
test.runIf(process.env.MMO_ALL_FAMILIES === "1")("every family with vectors is registered", () => {
  expect(registered()).toEqual(vectors);
});

test("every scene folder holds the files a family is made of", () => {
  const scenes = `${import.meta.dirname}/../src/scenes`;
  for (const id of readdirSync(scenes)) {
    for (const file of ["index.ts", "model.ts", "scene.ts", "golden.test.ts"])
      expect(existsSync(`${scenes}/${id}/${file}`), `src/scenes/${id}/${file}`).toBe(true);
    expect(registered()).toContain(id);
  }
});

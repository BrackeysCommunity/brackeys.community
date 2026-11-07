import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { sceneHash } from "../hash";
import { parseSceneOrThrow } from "../parse";

const yard = parseSceneOrThrow(
  readFileSync(new URL("../../scenes/test-yard.json", import.meta.url), "utf8"),
);

describe("sceneHash", () => {
  it("is 16 lowercase hex characters and stable", () => {
    const h = sceneHash(yard);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(sceneHash(structuredClone(yard))).toBe(h);
    expect(sceneHash(parseSceneOrThrow(JSON.stringify(yard)))).toBe(h);
  });

  it("ignores key order but changes on any edit", () => {
    const h = sceneHash(yard);
    const { entities, ...rest } = yard;
    expect(sceneHash({ entities, ...rest })).toBe(h);
    const moved = structuredClone(yard);
    moved.solid![0][1] += 1;
    expect(sceneHash(moved)).not.toBe(h);
    expect(sceneHash({ ...yard, name: "test-yard-2" })).not.toBe(h);
  });

  it("is FNV-1a 32 over the canonical text, with two offset bases", () => {
    expect(sceneHash({ v: 1, name: "a", bounds: [0, 0, 1, 1], spawn: [] })).toBe(
      "e722f13842a5247f",
    );
  });
});

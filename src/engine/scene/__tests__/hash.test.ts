import { describe, expect, it } from "vite-plus/test";

import { sceneHash } from "../hash";
import { parseSceneOrThrow } from "../parse";
import { engine, engineYardText } from "./fixtures/fake-game";

const yard = parseSceneOrThrow(engineYardText, engine);

describe("sceneHash", () => {
  it("is 16 lowercase hex characters and stable", () => {
    const h = sceneHash(yard);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(sceneHash(structuredClone(yard))).toBe(h);
    expect(sceneHash(parseSceneOrThrow(JSON.stringify(yard), engine))).toBe(h);
  });

  it("ignores key order but changes on any edit", () => {
    const h = sceneHash(yard);
    const { entities, ...rest } = yard;
    expect(sceneHash({ entities, ...rest })).toBe(h);
    const moved = structuredClone(yard);
    (moved.solid as number[][])[0]![1]! += 1;
    expect(sceneHash(moved)).not.toBe(h);
    expect(sceneHash({ ...yard, name: "engine-yard-2" })).not.toBe(h);
    expect(sceneHash({ ...yard, settings: { gravity: [0, 1000] } })).not.toBe(h);
  });

  it("is FNV-1a 32 over the canonical text, with two offset bases", () => {
    expect(sceneHash({ v: 1, name: "a", bounds: [0, 0, 1, 1] })).toBe("5f4713e7d34e54f2");
  });
});

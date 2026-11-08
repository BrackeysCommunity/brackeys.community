import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { sceneHash } from "../hash";
import { parseSceneOrThrow } from "../parse";
import { parsePrefab, prefabLibrary, prefabsUsedBy, sceneHashWith } from "../prefab";
import type { Prefab, SceneDefinition } from "../types";
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

const fixture = (name: string): Prefab => {
  const text = readFileSync(new URL(`./fixtures/prefabs/${name}.json`, import.meta.url), "utf8");
  const parsed = parsePrefab(text, engine);
  if (!parsed.ok) throw new Error(parsed.issues[0]!.message);
  return parsed.prefab;
};

describe("prefabs used through nesting", () => {
  const library = prefabLibrary(["gate", "door", "room"].map(fixture));
  const scene: SceneDefinition = {
    v: 3,
    name: "hall",
    bounds: [0, 0, 1000, 1000],
    instances: [{ id: "room-1", prefab: "room", at: [500, 500] }],
  };
  const edit = (id: string, change: (p: Prefab) => Prefab) =>
    prefabLibrary([...library.values()].map((p) => (p.id === id ? change(p) : p)));

  it("lists only the scene's own instances without a library", () => {
    expect(prefabsUsedBy(scene)).toEqual(["room"]);
  });

  it("lists every prefab reached through nested instances, sorted, each once", () => {
    expect(prefabsUsedBy(scene, library)).toEqual(["door", "gate", "room"]);
  });

  it("follows variant bases and stops at a cycle or a missing prefab", () => {
    const red: Prefab = { kind: "prefab", v: 3, id: "red-door", base: "door", entities: [] };
    const loop: Prefab = {
      kind: "prefab",
      v: 3,
      id: "loop",
      instances: [
        { id: "self", prefab: "loop", at: [0, 0] },
        { id: "gone", prefab: "nowhere", at: [0, 0] },
      ],
      entities: [],
    };
    const lib = prefabLibrary([...library.values(), red, loop]);
    const placed = (prefab: string): SceneDefinition => ({
      ...scene,
      instances: [{ id: "x", prefab, at: [0, 0] }],
    });
    expect(prefabsUsedBy(placed("red-door"), lib)).toEqual(["door", "gate", "red-door"]);
    expect(prefabsUsedBy(placed("loop"), lib)).toEqual(["loop", "nowhere"]);
  });

  it("hashes every prefab it reaches, so an edit three levels down marks the scene stale", () => {
    const h = sceneHashWith(scene, library);
    expect(sceneHashWith(structuredClone(scene), prefabLibrary([...library.values()]))).toBe(h);
    const moved = edit("gate", (p) => ({
      ...p,
      entities: p.entities.map((e) => (e.id === "trigger" ? { ...e, tags: ["moved"] } : e)),
    }));
    expect(sceneHashWith(scene, moved)).not.toBe(h);
    const door = edit("door", (p) => ({ ...p, instances: [] }));
    expect(sceneHashWith(scene, door)).not.toBe(h);
    expect(sceneHashWith(scene, prefabLibrary([fixture("room")]))).not.toBe(h);
  });

  it("reaches and hashes a variant's base, and the base's own nested prefabs", () => {
    const lib = prefabLibrary([...library.values(), fixture("red-gate")]);
    const yardWithVariant: SceneDefinition = {
      ...scene,
      instances: [{ id: "red-1", prefab: "red-gate", at: [0, 0] }],
    };
    expect(prefabsUsedBy(yardWithVariant, lib)).toEqual(["gate", "red-gate"]);
    const deep: Prefab = { kind: "prefab", v: 3, id: "red-room", base: "room", entities: [] };
    const placedDeep: SceneDefinition = {
      ...scene,
      instances: [{ id: "r", prefab: "red-room", at: [0, 0] }],
    };
    expect(prefabsUsedBy(placedDeep, prefabLibrary([...lib.values(), deep]))).toEqual([
      "door",
      "gate",
      "red-room",
      "room",
    ]);
    const h = sceneHashWith(yardWithVariant, lib);
    const baseEdited = prefabLibrary(
      [...lib.values()].map((p) =>
        p.id === "gate" ? { ...p, bulk: { solid: [["box", 0, 50, 40, 8]] as never } } : p,
      ),
    );
    expect(sceneHashWith(yardWithVariant, baseEdited)).not.toBe(h);
    const overrideEdited = prefabLibrary(
      [...lib.values()].map((p) =>
        p.id === "red-gate" ? { ...p, overrides: { ...p.overrides, "door.z": 2 } } : p,
      ),
    );
    expect(sceneHashWith(yardWithVariant, overrideEdited)).not.toBe(h);
    const paramEdited = prefabLibrary(
      [...lib.values()].map((p) =>
        p.id === "red-gate"
          ? { ...p, params: { speed: { ...p.params!.speed!, default: 120 } } }
          : p,
      ),
    );
    expect(sceneHashWith(yardWithVariant, paramEdited)).not.toBe(h);
  });

  it("hashes a scene without instances as sceneHash does", () => {
    expect(sceneHashWith(yard, library)).toBe(sceneHash(yard));
  });
});

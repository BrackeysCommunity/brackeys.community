// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { prefabLibraryFor, prefabReader } from "../prefab";
import type { SceneDefinition, SceneIssue } from "../types";
import door from "./fixtures/prefabs/door.json";
import gate from "./fixtures/prefabs/gate.json";
import room from "./fixtures/prefabs/room.json";
import { engine } from "./fixtures/random-ops";

const scene: SceneDefinition = {
  v: 4,
  name: "reader",
  bounds: [0, 0, 100, 100],
  instances: [{ id: "r", prefab: "room", at: [0, 0] }],
} as unknown as SceneDefinition;

function reading(texts: Map<string, string>) {
  const asked: string[] = [];
  const failed: [string, SceneIssue[]][] = [];
  const missing: string[] = [];
  const reader = prefabReader(engine, {
    text: (id) => {
      asked.push(id);
      return texts.get(id);
    },
    failed: (id, issues) => failed.push([id, issues]),
    missing: (id) => missing.push(id),
  });
  return { reader, asked, failed, missing };
}

const all = () =>
  new Map(Object.entries({ room, door, gate }).map(([id, p]) => [id, JSON.stringify(p)]));

describe("prefabReader", () => {
  it("reads the library a scene reaches, each prefab parsed once", () => {
    const { reader, asked } = reading(all());
    const library = reader.library(scene);
    expect([...library.keys()].sort()).toEqual(["door", "gate", "room"]);
    const first = reader.get("room");
    expect(reader.get("room")).toBe(first);
    expect(reader.library(scene).get("door")).toBe(library.get("door"));
    expect(asked.filter((id) => id === "room")).toEqual(["room"]);
    expect([...reader.read.keys()].sort()).toEqual(["door", "gate", "room"]);
    const direct = prefabLibraryFor(scene, (id) => reader.get(id));
    expect([...direct.keys()].sort()).toEqual([...library.keys()].sort());
  });

  it("hands a failed parse's issues over once and reads the id as undefined after", () => {
    const texts = all();
    texts.set("gate", "{ not json");
    const { reader, failed, asked } = reading(texts);
    reader.library(scene);
    expect(reader.get("gate")).toBeUndefined();
    expect(failed.map(([id]) => id)).toEqual(["gate"]);
    expect(failed[0]![1].length).toBeGreaterThan(0);
    expect(asked.filter((id) => id === "gate")).toEqual(["gate"]);
  });

  it("tells of a missing text once and finds the text once it arrives", () => {
    const texts = all();
    const doorText = texts.get("door")!;
    texts.delete("door");
    const { reader, missing } = reading(texts);
    expect(reader.library(scene).has("door")).toBe(false);
    expect(reader.get("door")).toBeUndefined();
    expect(missing).toEqual(["door"]);
    texts.set("door", doorText);
    expect(reader.get("door")?.id).toBe("door");
    expect(missing).toEqual(["door"]);
  });
});

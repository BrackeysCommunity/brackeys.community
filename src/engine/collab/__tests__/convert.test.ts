import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { generateScene } from "../../__tests__/fixtures/generate-scene";
import { formatScene } from "../../scene/format";
import { sceneHash } from "../../scene/hash";
import type { SceneDefinition } from "../../scene/types";
import { docToScene, readDoc, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const FIXTURES: [string, string][] = [
  ["scenes/engine-yard.json", read("../../scenes/engine-yard.json")],
  ["frozen v1/engine-yard.json", read("../../scene/__tests__/fixtures/v1/engine-yard.json")],
];

const roundTrip = (text: string) =>
  formatScene(docToScene(sceneToDoc(JSON.parse(text) as SceneDefinition))).text;

describe("sceneToDoc and docToScene", () => {
  for (const [name, text] of FIXTURES) {
    it(`round-trips ${name} byte for byte`, () => {
      expect(roundTrip(text)).toBe(text);
    });
  }

  it("round-trips generated scenes, through an encoded update too", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const def = generateScene(seed, {
        bulkSolids: seed * 3,
        solids: seed,
        props: seed % 7,
        sensors: seed % 5,
        followers: seed % 4,
      });
      const text = formatScene(def).text;
      const doc = sceneToDoc(def, { key: sequentialKeys(`s${seed}-`) });
      expect(formatScene(docToScene(doc)).text).toBe(text);

      const copy = new Y.Doc();
      Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
      expect(formatScene(docToScene(copy)).text).toBe(text);
      expect(sceneHash(docToScene(copy))).toBe(sceneHash(def));
    }
  });

  it("stores shapes and path points as atomic values and paths as maps", () => {
    const doc = sceneToDoc(JSON.parse(FIXTURES[0]![1]) as SceneDefinition);
    const view = readDoc(doc);
    const lift = view.entityKeys[view.def.entities!.findIndex((e) => e.id === "lift")]!;
    const map = doc.getMap<Y.Map<unknown>>("entities").get(lift)!;
    expect(Array.isArray(map.get("shape"))).toBe(true);
    expect(map.get("path")).toBeInstanceOf(Y.Map);
    expect(Array.isArray((map.get("path") as Y.Map<unknown>).get("pts"))).toBe(true);
    const bulk = view.bulkKeys.get("solid")![0]!;
    expect(doc.getMap<Y.Map<unknown>>("entities").get(bulk)!.toJSON()).toMatchObject({
      bulk: "solid",
      type: "solid",
      shape: ["box", 1000, 980, 1000, 20],
    });
  });

  it("refuses to seed a doc twice", () => {
    const doc = sceneToDoc(JSON.parse(FIXTURES[0]![1]) as SceneDefinition);
    expect(() => sceneToDoc(JSON.parse(FIXTURES[0]![1]) as SceneDefinition, { doc })).toThrow(
      /isn't empty/,
    );
  });

  it("orders ties in z by key", () => {
    const doc = new Y.Doc();
    doc.getMap("meta").set("schemaVersion", 1);
    doc.getMap("scene").set("name", "tie");
    doc.getMap("scene").set("bounds", [0, 0, 10, 10]);
    const entities = doc.getMap<Y.Map<unknown>>("entities");
    for (const [key, id] of [
      ["b", "second"],
      ["a", "first"],
    ]) {
      const m = new Y.Map<unknown>();
      m.set("z", "a0");
      m.set("id", id);
      m.set("type", "marker");
      m.set("at", [1, 1]);
      entities.set(key!, m);
    }
    expect(docToScene(doc).entities!.map((e) => e.id)).toEqual(["first", "second"]);
  });
});

import { COLLAB_LAYOUT_VERSION, docToScene } from "@jams/engine/collab";
import {
  formatScene,
  sceneHash,
  SCENE_FORMAT_VERSION as V,
  type SceneDefinition,
} from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  emptyScene,
  prepareLoadedState,
  type SceneFormat,
  sceneSnapshot,
  seedState,
  stateLayout,
  stateSchemaVersion,
} from "../doc-bytes";

const SCENE: SceneDefinition = {
  v: V,
  game: "test",
  name: "bytes",
  bounds: [0, 0, 640, 360],
  solid: [
    ["box", 0, 300, 320, 20],
    ["circle", 100, 100, 8],
  ],
  entities: [
    { id: "spawn", type: "marker", at: [10, 280] },
    { id: "goal", type: "marker", at: [600, 180] },
  ],
};

const docOf = (...states: Uint8Array[]) => {
  const doc = new Y.Doc();
  for (const state of states) Y.applyUpdate(doc, state);
  return doc;
};

describe("seeding", () => {
  it("is deterministic, so two instances seeding at once write one copy", () => {
    const one = seedState("test.bytes", SCENE);
    const two = seedState("test.bytes", SCENE);
    expect(two).toEqual(one);
    const merged = docOf(one, two);
    expect(merged.getMap("entities").size).toBe(4);
    expect(formatScene(docToScene(merged)).text).toBe(formatScene(SCENE).text);
  });

  it("writes as another client for another scene or other content", () => {
    const clientOf = (state: Uint8Array) => [
      ...Y.decodeStateVector(Y.encodeStateVector(docOf(state))).keys(),
    ];
    const base = clientOf(seedState("test.bytes", SCENE));
    expect(clientOf(seedState("test.other", SCENE))).not.toEqual(base);
    expect(clientOf(seedState("test.bytes", { ...SCENE, name: "renamed" }))).not.toEqual(base);
  });

  it("fills an empty doc from the seed, or an empty scene of the id's name", () => {
    const seeded = prepareLoadedState("test.bytes", null, JSON.stringify(SCENE));
    expect(seeded).toMatchObject({ seeded: true, migratedFrom: null, schemaVersion: V });
    expect(docToScene(docOf(seeded.state))).toEqual(SCENE);

    const empty = prepareLoadedState("engine.blank", null, null);
    expect(docToScene(docOf(empty.state))).toEqual(emptyScene("engine.blank"));
    expect(emptyScene("engine.blank")).toEqual({ v: V, name: "blank", bounds: [0, 0, 1920, 1080] });
    expect(emptyScene("platformer.blank")).toMatchObject({ game: "platformer" });
  });

  it("refuses a seed that isn't a scene", () => {
    expect(() => prepareLoadedState("test.bytes", null, "[1]")).toThrow(/bad seed/);
    expect(() =>
      prepareLoadedState("test.bytes", null, JSON.stringify({ ...SCENE, v: V + 1 })),
    ).toThrow(/bad seed/);
  });
});

describe("loading a stored doc", () => {
  it("leaves a current doc's bytes alone", () => {
    const state = seedState("test.bytes", SCENE);
    expect(prepareLoadedState("test.bytes", state, null)).toEqual({
      state,
      schemaVersion: V,
      seeded: false,
      migratedFrom: null,
    });
  });

  it("migrates an older doc in place, keeping every surviving entry's key", () => {
    const state = seedState("test.bytes", SCENE);
    const before = docOf(state);
    const byId = (doc: Y.Doc, id: string) =>
      [...doc.getMap<Y.Map<unknown>>("entities").entries()].find(
        ([, m]) => m.get("id") === id,
      )?.[0];
    const next: SceneFormat = {
      version: V + 1,
      migrations: {
        [V]: (raw) => {
          const doc = raw as SceneDefinition & { solid: unknown[] };
          return {
            ...doc,
            v: V + 1,
            settings: { lifted: true },
            solid: [doc.solid[0], ["box", 1, 2, 3, 4], ["box", 5, 6, 7, 8]],
            entities: [
              { ...doc.entities![0]!, tag: "lifted" },
              { id: "door", type: "marker", at: [1, 1] },
            ],
          };
        },
      },
    };
    const prepared = prepareLoadedState("test.bytes", state, null, next);
    expect(prepared).toMatchObject({ seeded: false, migratedFrom: V, schemaVersion: V + 1 });
    const after = docOf(prepared.state);
    expect(stateSchemaVersion(prepared.state)).toBe(V + 1);
    expect(byId(after, "spawn")).toBe(byId(before, "spawn"));
    expect(byId(after, "goal")).toBeUndefined();
    expect(byId(after, "door")).toBeDefined();
    const scene = docToScene(after);
    expect(scene.settings).toEqual({ lifted: true });
    expect(scene.solid).toEqual([
      ["box", 0, 300, 320, 20],
      ["box", 1, 2, 3, 4],
      ["box", 5, 6, 7, 8],
    ]);
    expect(scene.entities).toEqual([
      { id: "spawn", type: "marker", at: [10, 280], tag: "lifted" },
      { id: "door", type: "marker", at: [1, 1] },
    ]);
    // An edit made against the old version still merges onto the same entries.
    const stale = docOf(state);
    const spawnKey = byId(stale, "spawn")!;
    stale.getMap<Y.Map<unknown>>("entities").get(spawnKey)!.set("at", [50, 50]);
    const merged = docOf(prepared.state, Y.encodeStateAsUpdate(stale));
    expect(docToScene(merged).entities?.find((e) => e.id === "spawn")).toMatchObject({
      at: [50, 50],
      tag: "lifted",
    });
  });

  it("leaves a doc newer than this side reads untouched", () => {
    const state = seedState("test.bytes", { ...SCENE, v: V + 1 });
    expect(prepareLoadedState("test.bytes", state, null)).toMatchObject({
      state,
      schemaVersion: V + 1,
      migratedFrom: null,
    });
  });
});

describe("collab layout", () => {
  it("seeds at the engine's layout, reads an older doc with no meta.layout as layout 1", () => {
    expect(stateLayout(seedState("test.bytes", SCENE))).toBe(COLLAB_LAYOUT_VERSION);
    expect(stateLayout(prepareLoadedState("engine.blank", null, null).state)).toBe(
      COLLAB_LAYOUT_VERSION,
    );
    const old = docOf(seedState("test.bytes", SCENE));
    old.getMap("meta").delete("layout");
    expect(stateLayout(Y.encodeStateAsUpdate(old))).toBe(1);
    expect(stateLayout(null)).toBeNull();
    expect(docOf(seedState("test.bytes", SCENE)).share.has("prefabs")).toBe(false);
  });

  it("seeds every record's order and bulk keys under the layout's own names", () => {
    const records = [
      ...docOf(seedState("test.bytes", SCENE)).getMap<Y.Map<unknown>>("entities").values(),
    ];
    expect(records).toHaveLength(4);
    for (const rec of records) {
      expect(typeof rec.get("@z")).toBe("string");
      expect(rec.has("z")).toBe(false);
      expect(rec.has("bulk")).toBe(false);
    }
    expect(records.filter((rec) => typeof rec.get("@bulk") === "string")).toHaveLength(2);
  });
});

describe("snapshots", () => {
  it("are the canonical text and sceneHash of the doc", () => {
    const doc = docOf(seedState("test.bytes", SCENE));
    doc.getMap("settings").set("gravity", [0, 900]);
    const snapshot = sceneSnapshot(Y.encodeStateAsUpdate(doc))!;
    const def = docToScene(doc);
    expect(snapshot.text).toBe(formatScene(def).text);
    expect(snapshot.hash).toBe(sceneHash(def));
    expect(snapshot.schemaVersion).toBe(V);
  });

  it("are left out for a doc in a newer format, and absent before seeding", () => {
    expect(sceneSnapshot(seedState("test.bytes", { ...SCENE, v: V + 1 }))).toEqual({
      schemaVersion: V + 1,
    });
    expect(sceneSnapshot(Y.encodeStateAsUpdate(new Y.Doc()))).toBeNull();
  });
});

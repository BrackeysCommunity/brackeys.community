import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { generateScene } from "../../__tests__/fixtures/generate-scene";
import door from "../../scene/__tests__/fixtures/prefabs/door.json";
import gate from "../../scene/__tests__/fixtures/prefabs/gate.json";
import room from "../../scene/__tests__/fixtures/prefabs/room.json";
import { engine } from "../../scene/__tests__/fixtures/random-ops";
import { formatScene } from "../../scene/format";
import { fragmentBounds } from "../../scene/fragment";
import { sceneHash } from "../../scene/hash";
import { prefabLibrary } from "../../scene/prefab";
import { resolveScene } from "../../scene/resolve";
import type { Bounds, Prefab, SceneDefinition } from "../../scene/types";
import {
  assetsMap,
  contentMaps,
  docLayout,
  docMeta,
  docToScene,
  entitiesMap,
  entityRecord,
  instancesMap,
  metaMap,
  paramsMap,
  patchRecord,
  prefabHeaderMap,
  prefabOverridesMap,
  prefabSceneBounds,
  prefabsMap,
  readDoc,
  recordMap,
  recordOf,
  sceneMap,
  sceneToDoc,
  writeAssets,
} from "../convert";
import { sequentialKeys } from "../keys";
import { fingerprint } from "../log";
import { prefabToDoc } from "../prefab-doc";
import {
  BULK_FIELD,
  COLLAB_LAYOUT_VERSION,
  DOC_MAPS,
  GRID_ROW_KEY,
  NESTED2_FIELDS,
  NESTED_FIELDS,
  PARAMS_FIELD,
  Z_FIELD,
  type EntityRecord,
} from "../types";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const FIXTURES: [string, string][] = [
  ["scenes/engine-yard.json", read("../../scenes/engine-yard.json")],
  ["frozen v1/engine-yard.json", read("../../scene/__tests__/fixtures/v1/engine-yard.json")],
  ["scenes/kitchen-sink.json", read("../../scenes/kitchen-sink.json")],
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
      [BULK_FIELD]: "solid",
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
      m.set(Z_FIELD, "a0");
      m.set("id", id);
      m.set("type", "marker");
      m.set("at", [1, 1]);
      entities.set(key!, m);
    }
    expect(docToScene(doc).entities!.map((e) => e.id)).toEqual(["first", "second"]);
  });
});

describe("layout 3", () => {
  it("seeds meta at this layout, with the project and key when given, and no prefabs map", () => {
    const def = JSON.parse(FIXTURES[0]![1]) as SceneDefinition;
    const doc = sceneToDoc(def, { project: "engine", assetKey: "engine-yard" });
    expect(docMeta(doc)).toMatchObject({
      schemaVersion: def.v,
      layout: COLLAB_LAYOUT_VERSION,
      project: "engine",
      key: "engine-yard",
    });
    expect(COLLAB_LAYOUT_VERSION).toBe(3);
    expect(docLayout(doc)).toBe(3);
    expect(doc.share.has(DOC_MAPS.prefabs)).toBe(false);
    expect(contentMaps(doc)).not.toContain(prefabsMap(doc));
    expect(readDoc(doc)).toMatchObject({ kind: "scene" });
    expect("prefabs" in readDoc(doc)).toBe(false);
  });

  it("reads a doc with no meta.layout as layout 1", () => {
    const doc = sceneToDoc(JSON.parse(FIXTURES[0]![1]) as SceneDefinition);
    metaMap(doc).delete("layout");
    expect(docLayout(doc)).toBe(1);
  });

  it("reads a prefab doc as a scene of its children, with bounds it never writes", () => {
    const doc = prefabToDoc({
      kind: "prefab",
      v: 2,
      id: "post",
      entities: [{ id: "top", type: "marker", at: [0, -40] }],
    });
    const view = readDoc(doc, { parentBounds: [0, 0, 200, 100] });
    expect(view.kind).toBe("prefab");
    expect(view.prefab).toEqual({ id: "post" });
    expect(view.def).toEqual({
      v: 2,
      name: "post",
      bounds: [-100, -50, 100, 50],
      entities: [{ id: "top", type: "marker", at: [0, -40] }],
    });
    expect(sceneMap(doc).size).toBe(0);
  });
});

const base = (extra: Partial<SceneDefinition> = {}): SceneDefinition => ({
  v: 2,
  name: "records",
  bounds: [0, 0, 100, 100],
  ...extra,
});

/** Two docs synced both ways, so concurrent edits can be made on each and then merged. */
function pair(def: SceneDefinition): [Y.Doc, Y.Doc] {
  const a = sceneToDoc(def, { key: sequentialKeys("k") });
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return [a, b];
}

function merge(a: Y.Doc, b: Y.Doc): void {
  const ua = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const ub = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, ua);
  Y.applyUpdate(a, ub);
}

const onlyEntity = (doc: Y.Doc) => [...entitiesMap(doc).values()][0]!;

/** A record's map, in a doc so it can be read. */
function stored(rec: EntityRecord): Y.Map<unknown> {
  const doc = new Y.Doc();
  entitiesMap(doc).set("k", recordMap(rec));
  return entitiesMap(doc).get("k")!;
}

/** Writes `edit` of the doc's only entity as a patch, the way a batch would. */
function patchOnly(doc: Y.Doc, edit: (fields: Record<string, unknown>) => void): void {
  const map = onlyEntity(doc);
  const prev = recordOf(map);
  const next = structuredClone(prev);
  edit(next);
  doc.transact(() => patchRecord(map, prev, next));
}

describe("layout 3 records", () => {
  it("keeps the layout's keys under @z and @bulk, so a draw z and a field named bulk are fields", () => {
    const def = base({
      entities: [{ id: "roof", type: "marker", at: [1, 2], z: 5, bulk: 3 } as never],
      instances: [{ id: "p", prefab: "post", at: [0, 0], z: -2 }],
      solid: [["box", 1, 1, 1, 1]],
    });
    const doc = sceneToDoc(def);
    const view = readDoc(doc);
    expect(view.def.entities).toEqual([{ id: "roof", type: "marker", at: [1, 2], z: 5, bulk: 3 }]);
    expect(view.def.instances).toEqual([{ id: "p", prefab: "post", at: [0, 0], z: -2 }]);
    expect(view.def.solid).toEqual([["box", 1, 1, 1, 1]]);
    const roof = entitiesMap(doc).get(view.entityKeys[0]!)!;
    expect(typeof roof.get(Z_FIELD)).toBe("string");
    expect(roof.get("z")).toBe(5);
    const bulk = entitiesMap(doc).get(view.bulkKeys.get("solid")![0]!)!;
    expect(bulk.get(BULK_FIELD)).toBe("solid");
    expect(bulk.has("bulk")).toBe(false);
    expect(instancesMap(doc).get(view.instanceKeys[0]!)!.get("z")).toBe(-2);
    expect(formatScene(docToScene(doc)).text).toBe(formatScene(def).text);
  });

  it("strips only @-keys when reading", () => {
    const doc = sceneToDoc(base({ entities: [{ id: "a", type: "marker", at: [0, 0] }] }));
    doc.transact(() => onlyEntity(doc).set("@later", 1));
    expect(docToScene(doc).entities).toEqual([{ id: "a", type: "marker", at: [0, 0] }]);
    expect(recordOf(onlyEntity(doc))["@later"]).toBe(1);
  });

  it("leaves the order out of a record's fingerprint", () => {
    const rec = { [Z_FIELD]: "a0", id: "a", type: "marker", at: [0, 0], z: 1 };
    expect(fingerprint(rec)).toBe(fingerprint({ ...rec, [Z_FIELD]: "b5" }));
    expect(fingerprint(rec)).not.toBe(fingerprint({ ...rec, z: 2 }));
  });

  it("holds behaviors as two levels of maps and params as one", () => {
    expect(NESTED2_FIELDS).toContain("behaviors");
    expect(NESTED_FIELDS).toContain(PARAMS_FIELD);
    const behaviors = { sprite: { tint: "#ff0000", frame: 2 }, bob: { amp: 4 } };
    const def = base({
      entities: [{ id: "a", type: "marker", at: [0, 0], behaviors } as never],
      instances: [{ id: "p", prefab: "post", at: [0, 0], params: { speed: 3, label: "hi" } }],
    });
    const doc = sceneToDoc(def);
    const map = onlyEntity(doc);
    const block = map.get("behaviors") as Y.Map<unknown>;
    expect(block).toBeInstanceOf(Y.Map);
    expect(block.get("sprite")).toBeInstanceOf(Y.Map);
    expect((block.get("sprite") as Y.Map<unknown>).get("tint")).toBe("#ff0000");
    expect([...instancesMap(doc).values()][0]!.get("params")).toBeInstanceOf(Y.Map);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    expect(docToScene(copy)).toEqual(docToScene(doc));
    expect(docToScene(copy).entities![0]).toMatchObject({ behaviors });
    expect(docToScene(copy).instances![0]!.params).toEqual({ speed: 3, label: "hi" });
  });

  it("merges concurrent edits to different behavior fields and behaviors", () => {
    const behaviors = { sprite: { tint: "#ff0000", frame: 2 } };
    const [a, b] = pair(
      base({ entities: [{ id: "e", type: "marker", at: [0, 0], behaviors } as never] }),
    );
    patchOnly(
      a,
      (f) => ((f.behaviors as Record<string, Record<string, unknown>>).sprite!.tint = "#00ff00"),
    );
    patchOnly(
      b,
      (f) => ((f.behaviors as Record<string, Record<string, unknown>>).sprite!.frame = 7),
    );
    patchOnly(b, (f) => ((f.behaviors as Record<string, unknown>).bob = { amp: 1 }));
    merge(a, b);
    for (const d of [a, b])
      expect(docToScene(d).entities![0]!.behaviors).toEqual({
        sprite: { tint: "#00ff00", frame: 7 },
        bob: { amp: 1 },
      });
  });

  it("lets removing a behavior win over a concurrent edit inside it", () => {
    const behaviors = { sprite: { tint: "#ff0000" }, bob: { amp: 4 } };
    const [a, b] = pair(
      base({ entities: [{ id: "e", type: "marker", at: [0, 0], behaviors } as never] }),
    );
    patchOnly(a, (f) => delete (f.behaviors as Record<string, unknown>).sprite);
    patchOnly(
      b,
      (f) => ((f.behaviors as Record<string, Record<string, unknown>>).sprite!.tint = "#0000ff"),
    );
    merge(a, b);
    for (const d of [a, b])
      expect(docToScene(d).entities![0]!.behaviors).toEqual({ bob: { amp: 4 } });
  });

  it("merges concurrent params of one instance", () => {
    const [a, b] = pair(
      base({ instances: [{ id: "p", prefab: "post", at: [0, 0], params: { x: 1 } }] }),
    );
    for (const [doc, name, value] of [
      [a, "x", 2],
      [b, "y", 3],
    ] as const) {
      const map = [...instancesMap(doc).values()][0]!;
      const prev = recordOf(map);
      doc.transact(() =>
        patchRecord(map, prev, { ...prev, params: { ...(prev.params as object), [name]: value } }),
      );
    }
    merge(a, b);
    for (const d of [a, b]) expect(docToScene(d).instances![0]!.params).toEqual({ x: 2, y: 3 });
  });
});

describe("layout 3 assets", () => {
  it("holds the assets header as a set and reads it sorted", () => {
    const doc = sceneToDoc(base({ assets: ["boom", "hud-font"] }));
    expect(assetsMap(doc).toJSON()).toEqual({ boom: true, "hud-font": true });
    expect(sceneMap(doc).has("assets")).toBe(false);
    expect(docToScene(doc).assets).toEqual(["boom", "hud-font"]);
    expect(contentMaps(doc)).toContain(assetsMap(doc));
  });

  it("merges two concurrent additions", () => {
    const [a, b] = pair(base({ assets: ["boom"] }));
    a.transact(() => writeAssets(a, ["boom", "zap"]));
    b.transact(() => writeAssets(b, ["alarm", "boom"]));
    merge(a, b);
    for (const d of [a, b]) expect(docToScene(d).assets).toEqual(["alarm", "boom", "zap"]);
    a.transact(() => writeAssets(a, []));
    expect("assets" in docToScene(a)).toBe(false);
  });
});

describe("layout 3 grid rows", () => {
  const tiles = { "0,0": ["1*3", "", "2"], "1,-1": ["0*4,5"] };
  const gridDef = () =>
    base({ entities: [{ id: "map", type: "marker", at: [0, 0], tiles } as never] });

  it("writes each non-empty chunk row as its own key and reads the grid back", () => {
    const doc = sceneToDoc(gridDef());
    const map = onlyEntity(doc);
    const rows = [...map.keys()].filter((k) => GRID_ROW_KEY.test(k)).sort();
    expect(rows).toEqual(["tiles@0,0/0", "tiles@0,0/2", "tiles@1,-1/0"]);
    expect(map.has("tiles")).toBe(false);
    expect(map.get("tiles@0,0/2")).toBe("2");
    expect(recordOf(map).tiles).toEqual(tiles);
    expect(docToScene(doc).entities![0]).toEqual({ id: "map", type: "marker", at: [0, 0], tiles });
    expect(formatScene(docToScene(doc)).text).toBe(formatScene(gridDef()).text);
  });

  it("writes only the rows a paint changed", () => {
    const doc = sceneToDoc(gridDef());
    const map = onlyEntity(doc);
    const changed: string[] = [];
    map.observe((e) => changed.push(...e.keysChanged));
    patchOnly(doc, (f) => {
      f.tiles = { "0,0": ["1*3", "4", "2"], "1,-1": ["0*4,5"] };
    });
    expect(changed).toEqual(["tiles@0,0/1"]);
    changed.length = 0;
    patchOnly(doc, (f) => {
      f.tiles = { "0,0": ["1*3", "4"] };
    });
    expect(changed.sort()).toEqual(["tiles@0,0/2", "tiles@1,-1/0"]);
    expect(recordOf(map).tiles).toEqual({ "0,0": ["1*3", "4"] });
  });

  it("merges painters in different rows of one chunk", () => {
    const [a, b] = pair(gridDef());
    patchOnly(a, (f) => (f.tiles = { ...tiles, "0,0": ["7", "", "2"] }));
    patchOnly(b, (f) => (f.tiles = { ...tiles, "0,0": ["1*3", "8", "2"] }));
    merge(a, b);
    for (const d of [a, b])
      expect(docToScene(d).entities![0]!.tiles).toEqual({ ...tiles, "0,0": ["7", "8", "2"] });
  });

  it("keeps a grid with no painted rows whole, and reads rows canonical", () => {
    const empty = { "0,0": [] as string[] };
    const rec = entityRecord({ id: "m", type: "marker", at: [0, 0], tiles: empty } as never, "a0");
    expect(stored(rec).get("tiles")).toEqual(empty);
    const doc = new Y.Doc();
    const loose = new Y.Map<unknown>();
    entitiesMap(doc).set("k", loose);
    loose.set(Z_FIELD, "a0");
    loose.set("tiles@0,0/1", "3,3");
    expect(recordOf(loose).tiles).toEqual({ "0,0": ["", "3*2"] });
    loose.set("tiles@0,0/2", "nope");
    expect(recordOf(loose).tiles).toEqual({ "0,0": ["", "3,3", "nope"] });
  });

  it("round-trips a record from its map", () => {
    const rec: EntityRecord = {
      [Z_FIELD]: "a0",
      id: "m",
      type: "marker",
      at: [0, 0],
      z: 3,
      tiles,
      behaviors: { sprite: { frame: 1 } },
      path: { pts: [[0, 0]], speed: 2 },
    };
    expect(recordOf(stored(rec))).toEqual(rec);
  });
});

describe("layout 3 prefab docs", () => {
  it("reads base, params, overrides, instances and assets, and watches their maps", () => {
    const doc = prefabToDoc({
      kind: "prefab",
      v: 2,
      id: "gate-red",
      entities: [{ id: "top", type: "marker", at: [0, -40] }],
    });
    const param = { description: "How fast", targets: ["top.at"] };
    doc.transact(() => {
      prefabHeaderMap(doc).set("base", "gate");
      paramsMap(doc).set("speed", param);
      prefabOverridesMap(doc).set("bar.color", "red");
      writeAssets(doc, ["clang"]);
      instancesMap(doc).set(
        "i0",
        recordMap({ [Z_FIELD]: "a0", id: "inner", prefab: "post", at: [4, 0] }),
      );
    });
    const view = readDoc(doc);
    expect(view.prefab).toEqual({
      id: "gate-red",
      base: "gate",
      params: { speed: param },
      overrides: { "bar.color": "red" },
    });
    expect(view.def.instances).toEqual([{ id: "inner", prefab: "post", at: [4, 0] }]);
    expect(view.instanceKeys).toEqual(["i0"]);
    expect(view.def.assets).toEqual(["clang"]);
    for (const m of [paramsMap(doc), prefabOverridesMap(doc), instancesMap(doc), assetsMap(doc)])
      expect(contentMaps(doc)).toContain(m);
  });
});

describe("prefabSceneBounds", () => {
  const lib = prefabLibrary([room, door, gate] as unknown as Prefab[]);
  const parent: Bounds = [0, 0, 20, 20];
  const wrap: Prefab = {
    kind: "prefab",
    v: 3,
    id: "wrap",
    entities: [],
    instances: [{ id: "room-1", prefab: "room", at: [300, -50], rot: 1 }],
  };

  it("holds a nested instance's resolved children when given the library", () => {
    const resolved = resolveScene(
      { v: 3, name: "w", bounds: [0, 0, 1, 1], instances: wrap.instances },
      engine,
      lib,
    );
    const box = fragmentBounds(
      { kind: "scene-fragment", v: 3, entities: resolved.entities ?? [] },
      engine,
    )!;
    const atOnly: Bounds = [-10, -114, 364, 14];
    const held: Bounds = [
      Math.min(atOnly[0], Math.floor(box.minX) - 64),
      Math.min(atOnly[1], Math.floor(box.minY) - 64),
      Math.max(atOnly[2], Math.ceil(box.maxX) + 64),
      Math.max(atOnly[3], Math.ceil(box.maxY) + 64),
    ];
    expect(held).not.toEqual(atOnly);
    expect(prefabSceneBounds(wrap, parent, engine, lib)).toEqual(held);
    expect(prefabSceneBounds(wrap, parent, engine)).toEqual(atOnly);
    expect(
      readDoc(prefabToDoc(wrap), { registry: engine, parentBounds: parent, prefabs: lib }).def
        .bounds,
    ).toEqual(held);
  });
});

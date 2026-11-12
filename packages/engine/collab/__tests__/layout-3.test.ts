import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { generateScene } from "../../__tests__/fixtures/generate-scene";
import type { DocLayout } from "../../project/kinds";
import type { Prefab, SceneDefinition } from "../../scene/types";
import { SCENE_FORMAT_VERSION } from "../../scene/types";
import {
  docLayout,
  entitiesMap,
  instancesMap,
  metaMap,
  prefabsMap,
  readDoc,
  sceneToDoc,
} from "../convert";
import { sequentialKeys } from "../keys";
import { KEYED_ITEM, KEYED_Z, contentMap, layoutFromDoc, layoutToDoc } from "../layout";
import { migrateDoc } from "../migrate";
import { migrateDocLayout, migrateLayout, type ProjectWriter } from "../migrate-layout";
import { docToPrefab, prefabToDoc } from "../prefab-doc";
import {
  BULK_FIELD,
  COLLAB_LAYOUT_VERSION,
  LEGACY_BULK_FIELD,
  LEGACY_Z_FIELD,
  Z_FIELD,
} from "../types";
import { deckKind } from "./fixtures/deck-kind";

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

/** No project: a layout-2 scene's migration never needs one. */
const noProject: ProjectWriter = {
  scenePath: "levels/yard.json",
  prefab: () => {
    throw new Error("a layout-2 migration doesn't read the project");
  },
  createPrefab: () => {
    throw new Error("a layout-2 migration doesn't write the project");
  },
};

function rename(map: Y.Map<unknown>, from: string, to: string): void {
  if (!map.has(from)) return;
  const v = map.get(from);
  map.delete(from);
  map.set(to, v);
}

/** Rewrites a doc's records and keyed entries the way a layout-2 server wrote them. */
function asLayoutTwo(doc: Y.Doc): Y.Doc {
  const walk = (held: unknown) => {
    if (held instanceof Y.Array) held.forEach(walk);
    if (!(held instanceof Y.Map)) return;
    if (held.has(KEYED_ITEM) && held.has(KEYED_Z)) rename(held, KEYED_Z, LEGACY_Z_FIELD);
    for (const v of held.values()) walk(v);
  };
  doc.transact(() => {
    for (const map of [entitiesMap(doc), instancesMap(doc)])
      for (const rec of map.values()) {
        rename(rec, Z_FIELD, LEGACY_Z_FIELD);
        rename(rec, BULK_FIELD, LEGACY_BULK_FIELD);
      }
    walk(contentMap(doc));
    metaMap(doc).set("layout", 2);
  });
  return doc;
}

const recordKeys = (map: Y.Map<Y.Map<unknown>>) =>
  Object.fromEntries([...map.entries()].map(([k, rec]) => [k, [...rec.keys()].sort()]));

const zOf = (map: Y.Map<Y.Map<unknown>>, field: string) =>
  Object.fromEntries([...map.entries()].map(([k, rec]) => [k, rec.get(field)]));

/** Origins of every transaction on `doc` while `fn` runs. */
function transactions(doc: Y.Doc, fn: () => void): unknown[] {
  const origins: unknown[] = [];
  const on = (tr: Y.Transaction) => origins.push(tr.origin);
  doc.on("afterTransaction", on);
  fn();
  doc.off("afterTransaction", on);
  return origins;
}

const SCENE: SceneDefinition = {
  ...generateScene(3, { bulkSolids: 6, solids: 3, props: 2, sensors: 1, followers: 1 }),
  v: SCENE_FORMAT_VERSION,
  instances: [
    { id: "post-1", prefab: "post", at: [10, 10] },
    { id: "post-2", prefab: "post", at: [50, 10] },
  ],
};

const POST: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "post",
  entities: [
    { id: "top", type: "marker", at: [0, -40] },
    { id: "base", type: "marker", at: [0, 0] },
  ],
  bulk: { solid: [["box", 0, 0, 40, 6]] },
  instances: [{ id: "cap-1", prefab: "cap", at: [0, -50] }],
};

describe("layout 2 → 3", () => {
  it("lifts a layout-2 scene in one migration transaction, keeping every key and its order", () => {
    const fresh = sceneToDoc(SCENE, { key: sequentialKeys("s") });
    const want = readDoc(fresh);
    const order = zOf(entitiesMap(fresh), Z_FIELD);
    const instanceOrder = zOf(instancesMap(fresh), Z_FIELD);
    const doc = asLayoutTwo(fresh);
    expect(docLayout(doc)).toBe(2);
    expect(zOf(entitiesMap(doc), Z_FIELD)).not.toEqual(order);

    let result: ReturnType<typeof migrateLayout> | undefined;
    const origins = transactions(doc, () => (result = migrateLayout(doc, noProject)));
    expect(result).toMatchObject({ migrated: true, from: 2, to: COLLAB_LAYOUT_VERSION });
    expect(result!.entry).toBeUndefined();
    expect(origins).toEqual([{ kind: "migration" }]);
    expect(docLayout(doc)).toBe(COLLAB_LAYOUT_VERSION);

    expect(zOf(entitiesMap(doc), Z_FIELD)).toEqual(order);
    expect(zOf(instancesMap(doc), Z_FIELD)).toEqual(instanceOrder);
    for (const rec of [...entitiesMap(doc).values(), ...instancesMap(doc).values()]) {
      expect(rec.has(LEGACY_Z_FIELD)).toBe(false);
      expect(rec.has(LEGACY_BULK_FIELD)).toBe(false);
    }
    const bulk = [...entitiesMap(doc).values()].filter((r) => r.has(BULK_FIELD));
    expect(bulk.length).toBeGreaterThan(0);

    const view = readDoc(doc);
    expect(view.def).toEqual(want.def);
    expect(view.entityKeys).toEqual(want.entityKeys);
    expect(view.instanceKeys).toEqual(want.instanceKeys);
    expect(view.bulkKeys).toEqual(want.bulkKeys);
  });

  it("takes a layout-1 scene through the prefab move, then 2 → 3, in one scene transaction", () => {
    const doc = asLayoutTwo(sceneToDoc(SCENE, { key: sequentialKeys("s") }));
    const want = readDoc(sceneToDoc(SCENE, { key: sequentialKeys("s") }));
    doc.transact(() => {
      metaMap(doc).delete("layout");
      prefabsMap(doc).set("post", {
        kind: "prefab",
        v: POST.v,
        id: "post",
        entities: POST.entities,
      });
    });
    expect(docLayout(doc)).toBe(1);
    const created: string[] = [];
    const writer: ProjectWriter = {
      scenePath: "levels/yard.json",
      prefab: () => null,
      createPrefab: ({ id }) => void created.push(id),
    };
    let result: ReturnType<typeof migrateLayout> | undefined;
    const origins = transactions(doc, () => (result = migrateLayout(doc, writer)));
    expect(result).toMatchObject({ migrated: true, from: 1, created: ["post"] });
    expect(result!.entry).toMatchObject({ actor: { kind: "migration" } });
    expect(created).toEqual(["post"]);
    expect(origins).toEqual([{ kind: "migration" }]);
    expect(prefabsMap(doc).size).toBe(0);
    expect(docLayout(doc)).toBe(COLLAB_LAYOUT_VERSION);
    const view = readDoc(doc);
    expect(view.def).toEqual(want.def);
    expect(view.entityKeys).toEqual(want.entityKeys);
  });

  it("lifts a layout-2 prefab doc, children and nested instances, keeping every key", () => {
    const fresh = prefabToDoc(POST, { key: sequentialKeys("p") });
    const want = docToPrefab(fresh);
    const order = zOf(entitiesMap(fresh), Z_FIELD);
    const fields = recordKeys(entitiesMap(fresh));
    const doc = asLayoutTwo(fresh);

    let result: ReturnType<typeof migrateDocLayout> | undefined;
    const origins = transactions(doc, () => (result = migrateDocLayout(doc)));
    expect(result).toEqual({ migrated: true, from: 2, to: COLLAB_LAYOUT_VERSION });
    expect(origins).toEqual([{ kind: "migration" }]);
    expect(zOf(entitiesMap(doc), Z_FIELD)).toEqual(order);
    expect(recordKeys(entitiesMap(doc))).toEqual(fields);
    expect(instancesMap(doc).size).toBe(1);
    for (const rec of instancesMap(doc).values()) {
      expect(typeof rec.get(Z_FIELD)).toBe("string");
      expect(rec.has(LEGACY_Z_FIELD)).toBe(false);
    }
    expect(docToPrefab(doc)).toEqual(want);
  });

  it("lifts a layout-2 keyed doc at every depth, keeping every key and its order", () => {
    const layout: DocLayout = {
      as: "map",
      fields: {
        cards: { as: "keyed", item: { as: "map", fields: { note: { as: "text" } } } },
        lanes: {
          as: "keyed",
          item: { as: "map", fields: { cards: { as: "keyed", item: { as: "map" } } } },
        },
        boards: {
          as: "list",
          item: { as: "map", fields: { rows: { as: "keyed", item: { as: "map" } } } },
        },
      },
    };
    const value = {
      cards: [{ id: "c", note: "x" }, { id: "a" }, { id: "b" }],
      lanes: [
        { id: "l2", cards: [{ id: "z" }, { id: "y" }] },
        { id: "l1", cards: [] },
      ],
      boards: [{ rows: [{ id: "r2" }, { id: "r1" }] }],
    };
    const doc = new Y.Doc();
    doc.transact(() => {
      metaMap(doc).set("kind", "test-game/deck");
      metaMap(doc).set("schemaVersion", 1);
      metaMap(doc).set("layout", COLLAB_LAYOUT_VERSION);
    });
    layoutToDoc(doc, layout, value, "seed", { key: sequentialKeys("k") });
    const keys = () =>
      (contentMap(doc).get("cards") as Y.Map<Y.Map<unknown>>).toJSON() as Record<
        string,
        Record<string, unknown>
      >;
    const before = keys();
    asLayoutTwo(doc);

    let result: ReturnType<typeof migrateDocLayout> | undefined;
    const origins = transactions(doc, () => (result = migrateDocLayout(doc, layout)));
    expect(result).toEqual({ migrated: true, from: 2, to: COLLAB_LAYOUT_VERSION });
    expect(origins).toEqual([{ kind: "migration" }]);
    expect(keys()).toEqual(before);
    expect(layoutFromDoc(doc, layout)).toEqual(json(value));
    expect(JSON.stringify(contentMap(doc).toJSON())).not.toContain(`"${LEGACY_Z_FIELD}":`);
  });

  it("keeps an entity's draw z through readDoc, beside its order key", () => {
    const def: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      name: "z",
      bounds: [0, 0, 100, 100],
      entities: [
        { id: "roof", type: "marker", at: [0, 0], z: 4 } as never,
        { id: "floor", type: "marker", at: [0, 0] },
      ],
    };
    const seeded = sceneToDoc(def, { key: sequentialKeys("s") });
    const roofOf = (doc: Y.Doc) =>
      [...entitiesMap(doc).values()].find((r) => r.get("id") === "roof")!;
    expect(roofOf(seeded).get("z")).toBe(4);
    expect(typeof roofOf(seeded).get(Z_FIELD)).toBe("string");
    expect(readDoc(seeded).def.entities).toEqual(def.entities);

    const old = asLayoutTwo(
      sceneToDoc({
        ...def,
        entities: [{ id: "roof", type: "marker", at: [0, 0] }, def.entities![1]!],
      }),
    );
    migrateLayout(old, noProject);
    expect(typeof roofOf(old).get(Z_FIELD)).toBe("string");
    roofOf(old).set("z", 4);
    expect(readDoc(old).def.entities).toEqual(def.entities);
  });

  it("is idempotent, and leaves an unseeded doc alone", () => {
    const scene = asLayoutTwo(sceneToDoc(SCENE));
    const prefab = asLayoutTwo(prefabToDoc(POST));
    const keyed = new Y.Doc();
    metaMap(keyed).set("schemaVersion", 1);
    metaMap(keyed).set("layout", 2);
    layoutToDoc(keyed, deckKind.layout, {
      v: 1,
      title: "",
      style: {},
      tags: [],
      cards: [{ id: "a" }],
    });
    expect(migrateLayout(scene, noProject).migrated).toBe(true);
    expect(migrateDocLayout(prefab).migrated).toBe(true);
    expect(migrateDocLayout(keyed, deckKind.layout).migrated).toBe(true);
    for (const [doc, run] of [
      [scene, () => migrateLayout(scene, noProject)],
      [prefab, () => migrateDocLayout(prefab)],
      [keyed, () => migrateDocLayout(keyed, deckKind.layout)],
    ] as const) {
      const vector = Y.encodeStateVector(doc);
      expect(run().migrated).toBe(false);
      expect(Y.encodeStateVector(doc)).toEqual(vector);
    }
    expect(migrateDocLayout(new Y.Doc()).migrated).toBe(false);
  });

  it("sends a layout-1 scene that still holds prefabs to migrateLayout", () => {
    const doc = sceneToDoc(SCENE);
    doc.transact(() => {
      metaMap(doc).delete("layout");
      prefabsMap(doc).set("post", POST);
    });
    expect(() => migrateDocLayout(doc)).toThrow(/migrateLayout/);
  });
});

describe("migrateDoc", () => {
  const from = SCENE_FORMAT_VERSION;
  const migrations = { [from]: (raw: unknown) => ({ ...(raw as object), v: from + 1 }) };

  it("writes only meta for a step that changes only v, on scene and prefab docs", () => {
    for (const doc of [sceneToDoc(SCENE), prefabToDoc(POST)]) {
      const records = JSON.stringify([entitiesMap(doc).toJSON(), instancesMap(doc).toJSON()]);
      const meta = metaMap(doc).toJSON();
      const changed: string[] = [];
      doc.on("afterTransaction", (tr: Y.Transaction) => {
        for (const type of tr.changed.keys())
          changed.push((type as unknown) === metaMap(doc) ? "meta" : "other");
      });
      expect(migrateDoc(doc, { migrations, target: from + 1 })).toEqual({ from, to: from + 1 });
      expect(changed).toEqual(["meta"]);
      expect(metaMap(doc).toJSON()).toEqual({ ...meta, schemaVersion: from + 1 });
      expect(JSON.stringify([entitiesMap(doc).toJSON(), instancesMap(doc).toJSON()])).toBe(records);
    }
  });
});

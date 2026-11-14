import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { engine, prefabFixture, prefabFixtures } from "../../scene/__tests__/fixtures/fake-game";
import { migrate } from "../../scene/migrate";
import { SCENE_FORMAT_VERSION, type Prefab, type SceneDefinition } from "../../scene/types";
import { entitiesMap, groupsMap, instancesMap, metaMap, readDoc, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { migrateDoc } from "../migrate";
import { docToPrefab, prefabToDoc } from "../prefab-doc";

const env = { registry: engine, prefab: prefabFixture };

/** A v3 scene with entities, bulk entries, a group and instances, one with an override in px. */
const V3 = {
  v: 3,
  name: "yard",
  bounds: [0, 0, 2000, 1000],
  settings: { gravity: [0, 1200] },
  groups: { east: { at: [1200, 0] } },
  instances: [
    { id: "room-1", prefab: "room", at: [500, 500], overrides: { "door-1/panel.path.speed": 50 } },
    { id: "gate-1", prefab: "gate", group: "east", at: [200, 900] },
  ],
  solid: [
    ["box", 1000, 980, 1000, 20],
    ["box", 20, 500, 20, 500],
  ],
  entities: [
    { id: "ledge", type: "solid", shape: ["box", 1400, 800, 120, 10], oneWay: true },
    { id: "crate", type: "prop", shape: ["circle", 1200, 940, 20], density: 2 },
    {
      id: "lift",
      type: "follower",
      shape: ["box", 0, 0, 60, 8],
      path: {
        pts: [
          [1700, 900],
          [1700, 600],
        ],
        mode: "ping_pong",
        speed: 80,
      },
    },
    { id: "start", type: "marker", at: [300, 960], tags: ["spawn"] },
  ],
} as unknown as SceneDefinition;

/** A format 4 scene with what format 5 replaced: a turned group, an attached collider, an instance's quarter turns. */
const V4 = {
  v: 4,
  name: "yard",
  bounds: [0, 0, 20, 10],
  groups: { shelf: { at: [14, 7], rot: 1, name: "Shelf" } },
  instances: [{ id: "gate-1", prefab: "gate", at: [5, 9], rot: 2 }],
  entities: [
    { id: "board", type: "solid", group: "shelf", shape: ["box", 0, 0, 1, 0.1] },
    {
      id: "carrier",
      type: "follower",
      shape: ["box", 0, 0, 0.6, 0.08],
      path: {
        pts: [
          [7, 4],
          [12, 4],
        ],
        mode: "ping_pong",
        speed: 0.8,
      },
    },
    { id: "deck", type: "solid", shape: ["box", 7, 3.8, 0.2, 0.12], attach: "carrier" },
  ],
} as unknown as SceneDefinition;

/** A doc of `def` as an engine before format 5 seeded it: its groups in the `groups` map. */
function legacyDoc(def: SceneDefinition, key = sequentialKeys("k")): Y.Doc {
  const doc = sceneToDoc(def, { key });
  const groups = (def as { groups?: Record<string, Record<string, unknown>> }).groups ?? {};
  doc.transact(() => {
    for (const [id, group] of Object.entries(groups)) {
      const map = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(group)) map.set(k, structuredClone(v));
      groupsMap(doc).set(id, map);
    }
  });
  return doc;
}

const keysOf = (map: { keys(): IterableIterator<string> }) => [...map.keys()].sort();

describe("migrateDoc from v3 to the current version", () => {
  it("moves a scene doc's lengths to metres and its groups to nodes, keeping every entity's and instance's key", () => {
    const doc = legacyDoc(V3);
    const before = readDoc(doc);
    expect(before.def).toMatchObject({ groups: { east: { at: [1200, 0] } } });
    const entities = keysOf(entitiesMap(doc));
    const instances = keysOf(instancesMap(doc));
    expect(migrateDoc(doc, { env, key: sequentialKeys("new") })).toEqual({
      from: 3,
      to: SCENE_FORMAT_VERSION,
    });

    const expected = migrate(structuredClone(V3), undefined, undefined, env);
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    const after = readDoc(doc);
    expect(after.def).toEqual(expected.raw);
    expect(after.def.v).toBe(SCENE_FORMAT_VERSION);
    expect(after.def.instances?.[0]?.overrides).toEqual({ "door-1/panel.path.speed": 0.5 });
    expect(metaMap(doc).get("schemaVersion")).toBe(SCENE_FORMAT_VERSION);
    expect(keysOf(entitiesMap(doc))).toEqual([...entities, "new0000"].sort());
    expect(keysOf(instancesMap(doc))).toEqual(instances);
    expect(after.entityKeys).toEqual(["new0000", ...before.entityKeys]);
    expect(after.instanceKeys).toEqual(before.instanceKeys);
    expect([...after.bulkKeys]).toEqual([...before.bulkKeys]);
    expect(groupsMap(doc).size).toBe(0);
    expect(migrateDoc(doc, { env })).toBeNull();
  });

  it("moves a prefab doc's lengths to metres, keeping every child's key", () => {
    const room = prefabFixtures.room as Prefab;
    const doc = prefabToDoc(room, { key: sequentialKeys("p") });
    const entities = keysOf(entitiesMap(doc));
    const instances = keysOf(instancesMap(doc));
    expect(migrateDoc(doc, { env })).toEqual({ from: 3, to: SCENE_FORMAT_VERSION });
    const expected = migrate(structuredClone(room), undefined, undefined, env);
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(docToPrefab(doc)).toEqual(expected.raw);
    expect(keysOf(entitiesMap(doc))).toEqual(entities);
    expect(keysOf(instancesMap(doc))).toEqual(instances);
  });

  it("refuses without env and leaves the doc as it was", () => {
    for (const doc of [sceneToDoc(V3), prefabToDoc(prefabFixtures.room as Prefab)]) {
      const state = Y.encodeStateAsUpdate(doc);
      expect(() => migrateDoc(doc)).toThrow(/registry/);
      expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
    }
  });

  it("refuses an override whose prefab env lacks, and leaves the doc as it was", () => {
    const doc = sceneToDoc(V3);
    const state = Y.encodeStateAsUpdate(doc);
    expect(() => migrateDoc(doc, { env: { registry: engine } })).toThrow(/prefab "room"/);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
  });
});

describe("migrateDoc from v4", () => {
  it("lifts a v4 doc's groups to nodes and its attached collider under its follower, in place", () => {
    const doc = legacyDoc(V4);
    const before = readDoc(doc);
    expect(migrateDoc(doc, { env, key: sequentialKeys("new") })).toEqual({
      from: 4,
      to: SCENE_FORMAT_VERSION,
    });
    const expected = migrate(structuredClone(V4), undefined, undefined, env);
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    const after = readDoc(doc);
    expect(after.def).toEqual(expected.raw);
    const byId = new Map((after.def.entities ?? []).map((e) => [e.id, e]));
    expect(byId.get("shelf")).toEqual({
      id: "shelf",
      type: "node",
      name: "Shelf",
      at: [14, 7],
      rot: 90,
    });
    expect(byId.get("board")).toMatchObject({ parent: "shelf" });
    expect(byId.get("deck")).toEqual({
      id: "deck",
      type: "solid",
      shape: ["box", 0, -0.2, 0.2, 0.12],
      parent: "carrier",
    });
    expect(after.def.instances?.[0]?.rot).toBe(180);
    expect(after.entityKeys).toEqual(["new0000", ...before.entityKeys]);
    expect(after.instanceKeys).toEqual(before.instanceKeys);
    expect(groupsMap(doc).size).toBe(0);
    expect("groups" in after.def).toBe(false);
  });

  it("refuses without env and leaves the doc and its groups as they were", () => {
    const doc = legacyDoc(V4);
    const state = Y.encodeStateAsUpdate(doc);
    expect(() => migrateDoc(doc)).toThrow(/registry/);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
    expect(groupsMap(doc).size).toBe(1);
  });
});

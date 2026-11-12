import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { engine, prefabFixture, prefabFixtures } from "../../scene/__tests__/fixtures/fake-game";
import { migrate } from "../../scene/migrate";
import { SCENE_FORMAT_VERSION, type Prefab, type SceneDefinition } from "../../scene/types";
import { entitiesMap, instancesMap, metaMap, readDoc, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { migrateDoc } from "../migrate";
import { docToPrefab, prefabToDoc } from "../prefab-doc";

const env = { registry: engine, prefab: prefabFixture };

/** A v3 scene with entities, bulk entries and instances, one with an override in px. */
const V3: SceneDefinition = {
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
};

const keysOf = (map: { keys(): IterableIterator<string> }) => [...map.keys()].sort();

describe("migrateDoc from v3 to v4", () => {
  it("moves a scene doc's lengths to metres, keeping every entity's and instance's key", () => {
    const doc = sceneToDoc(V3, { key: sequentialKeys("k") });
    const before = readDoc(doc);
    const entities = keysOf(entitiesMap(doc));
    const instances = keysOf(instancesMap(doc));
    expect(migrateDoc(doc, { env, key: sequentialKeys("new") })).toEqual({ from: 3, to: 4 });

    const expected = migrate(structuredClone(V3), undefined, undefined, env);
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    const after = readDoc(doc);
    expect(after.def).toEqual(expected.raw);
    expect(after.def.v).toBe(SCENE_FORMAT_VERSION);
    expect(after.def.instances?.[0]?.overrides).toEqual({ "door-1/panel.path.speed": 0.5 });
    expect(metaMap(doc).get("schemaVersion")).toBe(SCENE_FORMAT_VERSION);
    expect(keysOf(entitiesMap(doc))).toEqual(entities);
    expect(keysOf(instancesMap(doc))).toEqual(instances);
    expect(after.entityKeys).toEqual(before.entityKeys);
    expect(after.instanceKeys).toEqual(before.instanceKeys);
    expect([...after.bulkKeys]).toEqual([...before.bulkKeys]);
    expect(migrateDoc(doc, { env })).toBeNull();
  });

  it("moves a prefab doc's lengths to metres, keeping every child's key", () => {
    const room = prefabFixtures.room as Prefab;
    const doc = prefabToDoc(room, { key: sequentialKeys("p") });
    const entities = keysOf(entitiesMap(doc));
    const instances = keysOf(instancesMap(doc));
    expect(migrateDoc(doc, { env })).toEqual({ from: 3, to: 4 });
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

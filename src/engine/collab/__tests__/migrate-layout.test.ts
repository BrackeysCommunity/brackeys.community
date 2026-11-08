import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { ID_PATTERN } from "../../game/fields";
import type { AssetEntry, AssetKey } from "../../project/types";
import { projectView } from "../../project/view";
import type { Prefab, SceneDefinition } from "../../scene/types";
import { docLayout, docPrefabs, metaMap, prefabsMap, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { readLog } from "../log";
import { migrateLayout, projectDocWriter } from "../migrate-layout";
import { docToPrefab, prefabToDoc } from "../prefab-doc";
import { readProject, seedProjectDoc, writeEntry } from "../project-doc";
import { COLLAB_LAYOUT_VERSION } from "../types";

const prefab = (id: string, at: [number, number]): Prefab => ({
  kind: "prefab",
  v: 2,
  id,
  entities: [{ id: "top", type: "marker", at }],
});

const SCENE: SceneDefinition = {
  v: 2,
  name: "yard",
  bounds: [0, 0, 1000, 1000],
  instances: [
    { id: "post-1", prefab: "post", at: [10, 10] },
    { id: "gate-1", prefab: "gate", at: [50, 10] },
  ],
};

/** A scene doc as a layout-1 server wrote it: prefabs in its own map, no `meta.layout`. */
function layoutOne(prefabs: Prefab[]): Y.Doc {
  const doc = sceneToDoc(SCENE, { key: sequentialKeys("s") });
  doc.transact(() => {
    metaMap(doc).delete("layout");
    for (const p of prefabs) prefabsMap(doc).set(p.id, p);
  });
  return doc;
}

function project(prefabs: Record<AssetKey, Prefab> = {}) {
  const doc = new Y.Doc();
  const entry = (key: string, kind: string, path: string): AssetEntry => ({
    key,
    id: key,
    kind,
    path,
    created: { at: 0, by: "seed" },
  });
  seedProjectDoc(doc, {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: {
      yard: entry("yard", "scene", "levels/yard.json"),
      ...Object.fromEntries(
        Object.keys(prefabs).map((k) => [k, entry(k, "prefab", `shared/${k}.json`)]),
      ),
    },
    history: {},
    code: {},
    build: {},
  });
  const docs = new Map<AssetKey, Y.Doc>();
  for (const [key, value] of Object.entries(prefabs))
    docs.set(key, prefabToDoc(value, { key: sequentialKeys(key) }));
  const writer = projectDocWriter(doc, {
    scene: "yard",
    now: () => 7,
    key: sequentialKeys("m"),
    prefabDoc(key) {
      let d = docs.get(key);
      if (!d) docs.set(key, (d = new Y.Doc()));
      return d;
    },
  });
  return { doc, docs, writer };
}

describe("migrateLayout", () => {
  it("moves a layout-1 scene's prefabs into prefab assets beside it, then clears the map", () => {
    const scene = layoutOne([prefab("post", [0, -40]), prefab("gate", [0, -10])]);
    const { doc, docs, writer } = project();
    const origins: unknown[] = [];
    for (const d of [scene, doc])
      d.on("afterTransaction", (tr: Y.Transaction) => origins.push(tr.origin));
    expect(docLayout(scene)).toBe(1);

    const result = migrateLayout(scene, writer);
    expect(result).toMatchObject({
      migrated: true,
      from: 1,
      to: COLLAB_LAYOUT_VERSION,
      created: ["gate", "post"],
      kept: [],
      diverged: [],
    });
    const assets = readProject(doc).assets;
    expect(assets.post).toMatchObject({
      key: "post",
      id: "post",
      kind: "prefab",
      path: "levels/prefabs/post.json",
    });
    expect(assets.gate!.path).toBe("levels/prefabs/gate.json");
    expect(docToPrefab(docs.get("post")!)).toEqual(prefab("post", [0, -40]));
    expect(docs.get("post")!.getMap("meta").toJSON()).toMatchObject({
      project: "p",
      key: "post",
      layout: 2,
    });
    expect(docPrefabs(scene).size).toBe(0);
    expect(docLayout(scene)).toBe(COLLAB_LAYOUT_VERSION);
    expect(origins.every((o) => (o as { kind?: string }).kind === "migration")).toBe(true);
    expect(readLog(scene).at(-1)).toMatchObject({ actor: { kind: "migration" } });
    expect(readLog(scene).at(-1)!.warnings).toBeUndefined();
  });

  it("keeps the project's prefab when it has one, noting prefab-diverged when the bodies differ", () => {
    const scene = layoutOne([prefab("post", [0, -40]), prefab("gate", [0, -10])]);
    const { doc, docs, writer } = project({
      post: prefab("post", [0, -40]),
      gate: prefab("gate", [9, 9]),
    });
    const before = Y.encodeStateVector(docs.get("gate")!);
    const result = migrateLayout(scene, writer);
    expect(result).toMatchObject({ created: [], kept: ["post"], diverged: ["gate"] });
    expect(Y.encodeStateVector(docs.get("gate")!)).toEqual(before);
    expect(docToPrefab(docs.get("gate")!).entities[0]!.at).toEqual([9, 9]);
    expect(Object.keys(readProject(doc).assets).sort()).toEqual(["gate", "post", "yard"]);
    const warnings = readLog(scene).at(-1)!.warnings!;
    expect(warnings).toEqual([
      {
        code: "prefab-diverged",
        message: expect.stringContaining("shared/gate.json"),
        ids: ["gate"],
      },
    ]);
    expect(docPrefabs(scene).size).toBe(0);
  });

  it("takes a free key when the id's key is used by a trashed entry", () => {
    const scene = layoutOne([prefab("post", [0, -40])]);
    const { doc, writer } = project({ post: prefab("post", [0, 0]) });
    writeEntry(doc, { ...readProject(doc).assets.post!, deleted: { at: 1, by: "x" } });
    expect(migrateLayout(scene, writer).created).toEqual(["post"]);
    expect(readProject(doc).assets["post-2"]).toMatchObject({ id: "post", kind: "prefab" });
  });

  it("keeps a live asset of another kind with the prefab's id, adding no second one", () => {
    const scene = layoutOne([prefab("post", [0, -40]), prefab("gate", [0, -10])]);
    const { doc, docs, writer } = project();
    writeEntry(doc, {
      key: "post",
      id: "post",
      kind: "material",
      path: "materials/post.json",
      created: { at: 0, by: "seed" },
    });
    const result = migrateLayout(scene, writer);
    expect(result).toMatchObject({ created: ["gate"], kept: [], diverged: ["post"] });
    const assets = readProject(doc).assets;
    expect(Object.keys(assets).sort()).toEqual(["gate", "post", "yard"]);
    expect(assets.post!.kind).toBe("material");
    expect(projectView(readProject(doc)).repairs.size).toBe(0);
    expect(docs.has("post")).toBe(false);
    expect(readLog(scene).at(-1)!.warnings).toEqual([
      {
        code: "prefab-diverged",
        message: expect.stringContaining("is a material, not a prefab"),
        ids: ["post"],
      },
    ]);
  });

  it("keeps a fallback key for a 48-character id within the id pattern", () => {
    const id = "a".repeat(48);
    const scene = layoutOne([prefab(id, [0, -40])]);
    const { doc, writer } = project({ [id]: prefab(id, [0, 0]) });
    writeEntry(doc, { ...readProject(doc).assets[id]!, deleted: { at: 1, by: "x" } });
    expect(migrateLayout(scene, writer).created).toEqual([id]);
    const key = `${"a".repeat(46)}-2`;
    expect(readProject(doc).assets[key]).toMatchObject({ id, kind: "prefab" });
    expect(ID_PATTERN.test(key)).toBe(true);
  });

  it("leaves a doc at this layout, or one never seeded, alone", () => {
    const { writer } = project();
    const current = sceneToDoc(SCENE);
    const vector = Y.encodeStateVector(current);
    expect(migrateLayout(current, writer).migrated).toBe(false);
    expect(Y.encodeStateVector(current)).toEqual(vector);
    expect(migrateLayout(new Y.Doc(), writer).migrated).toBe(false);
    const old = layoutOne([prefab("post", [0, -40])]);
    migrateLayout(old, writer);
    expect(migrateLayout(old, writer).migrated).toBe(false);
  });
});

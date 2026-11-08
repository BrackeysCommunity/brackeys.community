import { readDoc } from "@jams/engine/collab";
import {
  formatAssetDoc,
  materialKind,
  sha256,
  type AssetEntry,
  type ProjectState,
} from "@jams/engine/project";
import { formatPrefab, type Prefab, type SceneDefinition } from "@jams/engine/scene";
import { ID_PATTERN, SCENE_FORMAT_VERSION } from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { seedState } from "../doc-bytes";
import {
  applyProjectDuties,
  AssetSeedError,
  assetDocMeta,
  assetDocValue,
  assetItemCount,
  assetSchemaVersion,
  assetSnapshot,
  COLLAB_LAYOUT_VERSION,
  emptyProjectState,
  migrateAssetLayoutState,
  migrateSceneLayoutState,
  prefabDocValue,
  projectSeeded,
  readProjectState,
  sceneDocValue,
  sceneLayoutNeeds,
  seedAssetState,
  seedPrefabState,
  seedProjectState,
  stateDiff,
} from "../project-bytes";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const entry = (key: string, fields: Partial<AssetEntry> & Pick<AssetEntry, "id" | "path">) =>
  ({ key, kind: "material", created: { at: 1, by: "alice" }, ...fields }) as AssetEntry;

const STATE: ProjectState = {
  ...emptyProjectState("demo", "Demo"),
  assets: {
    rubber: entry("rubber", { id: "rubber", path: "materials/rubber.json" }),
    crate: entry("crate", {
      id: "crate",
      kind: "texture",
      path: "art/crate.png",
      sha256: HASH_A,
      bytes: 10,
      meta: { format: "png", width: 8, height: 8 },
      import: { filter: "nearest" },
    }),
  },
};

const MATERIAL = formatAssetDoc(materialKind, {
  kind: "material",
  v: 1,
  description: "Bouncy rubber.",
  physics: { friction: 0.4, restitution: 0.9 },
});

const TABLE = JSON.stringify({
  kind: "data-table",
  v: 1,
  table: "card",
  rows: [
    { id: "fireball", cost: 3 },
    { id: "heal", cost: 2 },
  ],
});

const docOf = (...states: Uint8Array[]) => {
  const doc = new Y.Doc();
  for (const state of states) Y.applyUpdate(doc, state);
  return doc;
};

describe("project docs", () => {
  it("seed the same bytes whatever the state's key order", () => {
    const shuffled: ProjectState = {
      ...STATE,
      assets: { crate: STATE.assets.crate!, rubber: STATE.assets.rubber! },
    };
    expect(seedProjectState(shuffled)).toEqual(seedProjectState(STATE));
  });

  it("read back as the state they were seeded with, with a history array per blob", () => {
    const state = seedProjectState(STATE);
    expect(projectSeeded(state)).toBe(true);
    const read = readProjectState(state);
    expect(read.meta).toEqual({ projectId: "demo", layout: 1, name: "Demo" });
    expect(read.assets).toEqual(STATE.assets);
    expect(read.history).toEqual({ crate: [] });
  });

  it("two writers seeding at once hold one copy", () => {
    const seed = seedProjectState(STATE);
    const doc = docOf(seed, seedProjectState(STATE));
    expect(Y.encodeStateAsUpdate(doc)).toEqual(Y.encodeStateAsUpdate(docOf(seed)));
    expect(doc.getMap("assets").size).toBe(2);
  });

  it("aren't seeded until their meta names the project", () => {
    expect(projectSeeded(null)).toBe(false);
    expect(projectSeeded(Y.encodeStateAsUpdate(new Y.Doc()))).toBe(false);
    expect(projectSeeded(seedProjectState(emptyProjectState("demo", "Demo")))).toBe(true);
  });
});

describe("applyProjectDuties", () => {
  const seeded = seedProjectState({
    ...STATE,
    history: { crate: [{ sha256: HASH_B, bytes: 4, at: 1, by: "alice" }] },
  });
  const log = (state: Uint8Array) => docOf(state).getArray("log").toArray() as { actor: unknown }[];

  it("writes nothing when there is nothing to do", () => {
    const result = applyProjectDuties(seeded, { now: 5 });
    expect(result.wrote).toBe(false);
    expect(result.state).toBe(seeded);
  });

  it("puts an unknown hash back, with hash-mismatch in the log", () => {
    const result = applyProjectDuties(seeded, {
      now: 5,
      hashes: [{ key: "crate", to: { sha256: HASH_B, bytes: 4 } }],
    });
    expect(result.wrote).toBe(true);
    const crate = readProjectState(result.state).assets.crate!;
    expect(crate.sha256).toBe(HASH_B);
    expect(crate.bytes).toBe(4);
    expect(crate.meta).toBeUndefined();
    expect(crate.deleted).toBeUndefined();
    expect(log(result.state).map((e) => e.actor)).toEqual([
      { kind: "repair", reason: "hash-mismatch" },
    ]);
  });

  it("gives a reverted entry the meta of the hash it goes back to", () => {
    const meta = { format: "png", width: 2, height: 2 };
    const result = applyProjectDuties(seeded, {
      now: 5,
      hashes: [{ key: "crate", to: { sha256: HASH_B, bytes: 4, meta } }],
    });
    const crate = readProjectState(result.state).assets.crate!;
    expect(crate).toMatchObject({ sha256: HASH_B, bytes: 4, meta, import: { filter: "nearest" } });
  });

  it("trashes an entry with no hash to go back to, and one the quota refused", () => {
    const result = applyProjectDuties(seeded, {
      now: 5,
      hashes: [{ key: "crate", to: null }],
      refused: [{ key: "rubber", message: "too many docs" }],
    });
    const assets = readProjectState(result.state).assets;
    expect(assets.crate!.deleted).toEqual({ at: 5, by: "repair" });
    expect(assets.rubber!.deleted).toEqual({ at: 5, by: "repair" });
    const entries = log(result.state) as { actor: unknown; label: string }[];
    expect(entries.map((e) => e.actor)).toEqual([
      { kind: "repair", reason: "hash-mismatch" },
      { kind: "repair", reason: "quota-exceeded" },
    ]);
    expect(entries[1]!.label).toContain("too many docs");
  });

  it("restores referenced trash and repairs a path it now shares, in one update", () => {
    const state = seedProjectState({
      ...STATE,
      assets: {
        ...STATE.assets,
        old: entry("old", {
          id: "bouncy",
          path: "materials/rubber.json",
          created: { at: 9, by: "bob" },
          deleted: { at: 10, by: "bob" },
        }),
      },
    });
    const result = applyProjectDuties(state, { now: 11, restore: ["old"] });
    const old = readProjectState(result.state).assets.old!;
    expect(old.deleted).toBeUndefined();
    expect(old.path).toBe("materials/rubber-2.json");
    expect(log(result.state).map((e) => e.actor)).toEqual([
      { kind: "repair", reason: "asset-in-use" },
    ]);
    // Applied to a doc holding the old state, the diff alone gives the same registry.
    const doc = docOf(state);
    Y.applyUpdate(doc, stateDiff(result.state, state));
    expect(readProjectState(Y.encodeStateAsUpdate(doc))).toEqual(readProjectState(result.state));
  });
});

describe("asset docs", () => {
  const seedOf = (seed: string | null, kind = "material", key = "rubber") =>
    seedAssetState({ project: "demo", key, kind, seed });

  it("seed meta and the file's content, deterministically", () => {
    const state = seedOf(MATERIAL);
    expect(seedOf(MATERIAL)).toEqual(state);
    expect(assetDocMeta(state)).toEqual({
      kind: "material",
      schemaVersion: 1,
      layout: COLLAB_LAYOUT_VERSION,
      project: "demo",
      key: "rubber",
    });
    expect(assetDocValue(state)).toEqual(JSON.parse(MATERIAL));
    expect(assetSchemaVersion(state)).toBe(1);
  });

  it("snapshot as the canonical text and its SHA-256", async () => {
    const snapshot = await assetSnapshot(seedOf(MATERIAL));
    expect(snapshot).toEqual({ text: MATERIAL, sha256: await sha256(MATERIAL) });
  });

  it("two seeds of one table merge into one copy of each row", () => {
    const doc = docOf(seedOf(TABLE, "data-table", "deck"), seedOf(TABLE, "data-table", "deck"));
    const state = Y.encodeStateAsUpdate(doc);
    // The engine alone has no `card` table, so the seed is laid out as written.
    expect(assetDocValue(state)).toEqual(JSON.parse(TABLE));
    expect(assetItemCount(state)).toBe(2);
  });

  it("seed meta only without a seed: the creating client writes the content", async () => {
    const state = seedOf(null);
    expect(assetDocMeta(state)?.kind).toBe("material");
    expect(assetDocValue(state)).toBeUndefined();
    expect(await assetSnapshot(state)).toBeNull();
  });

  it("seed a kind this side doesn't know with meta only, and refuse its seed", () => {
    const state = seedOf(null, "platformer/deck");
    expect(assetDocMeta(state)).toEqual({
      kind: "platformer/deck",
      layout: COLLAB_LAYOUT_VERSION,
      project: "demo",
      key: "rubber",
    });
    expect(assetSchemaVersion(state)).toBeNull();
    expect(() => seedOf("{}", "platformer/deck")).toThrow(AssetSeedError);
    expect(() => seedOf("[1]")).toThrow(AssetSeedError);
    expect(() => seedOf("not json")).toThrow(AssetSeedError);
  });

  it("read a scene doc's value", () => {
    const def = {
      v: SCENE_FORMAT_VERSION,
      name: "level",
      bounds: [0, 0, 64, 64] as [number, number, number, number],
      instances: [{ id: "c1", prefab: "crate", at: [0, 0] as [number, number] }],
    };
    const state = seedState("demo.level", def);
    expect(sceneDocValue(state)).toEqual(readDoc(docOf(state)).def);
    expect(sceneDocValue(state)?.instances?.[0]?.prefab).toBe("crate");
    expect(sceneDocValue(Y.encodeStateAsUpdate(new Y.Doc()))).toBeUndefined();
  });
});

describe("prefab docs", () => {
  const CRATE: Prefab = {
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    id: "crate",
    entities: [
      { id: "lid", type: "marker", at: [0, -8] },
      { id: "base", type: "marker", at: [0, 0] },
    ],
  };
  const seedOf = (seed: string | null) =>
    seedAssetState({ project: "demo", key: "crate", kind: "prefab", seed });

  it("seed from a prefab file as the prefab codec lays one out, deterministically", () => {
    const state = seedOf(JSON.stringify(CRATE));
    expect(prefabDocValue(state)).toEqual(CRATE);
    expect(assetDocMeta(state)).toMatchObject({ kind: "prefab", project: "demo", key: "crate" });
    expect(state).toEqual(seedOf(JSON.stringify(CRATE)));
    expect(state).toEqual(seedPrefabState({ project: "demo", key: "crate", prefab: CRATE }));
    const merged = docOf(state);
    Y.applyUpdate(merged, seedPrefabState({ project: "demo", key: "crate", prefab: CRATE }));
    expect(merged.getMap("entities").size).toBe(2);
  });

  it("read, count and snapshot as the prefab it holds", async () => {
    const state = seedOf(JSON.stringify(CRATE));
    expect(assetDocValue(state)).toEqual(CRATE);
    expect(assetItemCount(state)).toBe(2);
    const text = formatPrefab(CRATE);
    expect(await assetSnapshot(state)).toEqual({ text, sha256: await sha256(text) });
  });

  it("seed meta only without a seed, and refuse a seed that isn't a prefab", async () => {
    const empty = seedOf(null);
    expect(assetDocMeta(empty)).toMatchObject({ kind: "prefab", key: "crate" });
    expect(prefabDocValue(empty)).toBeNull();
    expect(await assetSnapshot(empty)).toBeNull();
    expect(() => seedOf("not json")).toThrow(AssetSeedError);
    expect(() => seedOf(JSON.stringify({ kind: "material", v: 1 }))).toThrow(AssetSeedError);
  });
});

describe("migrateSceneLayoutState", () => {
  const prefab = (id: string, x: number): Prefab => ({
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    id,
    entities: [{ id: "top", type: "marker", at: [x, 0] }],
  });
  const SCENE: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: "yard",
    bounds: [0, 0, 100, 100],
    instances: [{ id: "post-1", prefab: "post", at: [1, 1] }],
  };
  const layoutOne = (prefabs: Prefab[]) => {
    const doc = docOf(seedState("demo.yard", SCENE));
    doc.transact(() => {
      doc.getMap("meta").delete("layout");
      for (const p of prefabs) doc.getMap("prefabs").set(p.id, p);
    });
    return Y.encodeStateAsUpdate(doc);
  };
  const project = (assets: Record<string, AssetEntry> = {}) =>
    seedProjectState({
      ...emptyProjectState("demo", "Demo"),
      assets: {
        yard: entry("yard", { id: "yard", kind: "scene", path: "levels/yard.json" }),
        ...assets,
      },
    });

  it("needs nothing for a doc at this layout or an unseeded one", () => {
    const current = seedState("demo.yard", SCENE);
    expect(sceneLayoutNeeds(current, null)).toBeNull();
    expect(sceneLayoutNeeds(Y.encodeStateAsUpdate(new Y.Doc()), null)).toBeNull();
    const input = {
      projectId: "demo",
      sceneKey: "yard",
      project: null,
      prefabDocs: new Map(),
      now: 1,
    };
    expect(migrateSceneLayoutState({ ...input, scene: current })).toBeNull();
  });

  it("names the project's prefab docs a migration compares against", () => {
    const registry = project({
      post: entry("post", { id: "post", kind: "prefab", path: "shared/post.json" }),
    });
    expect(sceneLayoutNeeds(layoutOne([prefab("post", 0), prefab("gate", 1)]), registry)).toEqual({
      prefabs: ["gate", "post"],
      keys: ["post"],
    });
    expect(sceneLayoutNeeds(layoutOne([]), null)).toEqual({ prefabs: [], keys: [] });
  });

  it("adds new prefabs beside the scene, keeps the project's and seeds the empty ones", () => {
    const registry = project({
      post: entry("post", { id: "post", kind: "prefab", path: "shared/post.json" }),
      gate: entry("gate", { id: "gate", kind: "prefab", path: "shared/gate.json" }),
    });
    const result = migrateSceneLayoutState({
      scene: layoutOne([prefab("post", 0), prefab("gate", 1), prefab("crate", 2)]),
      projectId: "demo",
      sceneKey: "yard",
      project: registry,
      prefabDocs: new Map([
        [
          "post",
          {
            state: seedPrefabState({ project: "demo", key: "post", prefab: prefab("post", 0) }),
            seed: null,
          },
        ],
      ]),
      now: 5,
    })!;
    expect(result.created.sort()).toEqual(["crate", "gate"]);
    expect(result.kept).toEqual(["post"]);
    expect(result.diverged).toEqual([]);
    expect(result.prefabs.map((p) => p.key).sort()).toEqual(["crate", "gate"]);
    expect(prefabDocValue(result.prefabs.find((p) => p.key === "crate")!.state)).toEqual(
      prefab("crate", 2),
    );
    const assets = readProjectState(result.project).assets;
    expect(assets.crate).toMatchObject({ kind: "prefab", path: "levels/prefabs/crate.json" });
    expect(assets.gate!.path).toBe("shared/gate.json");
    const scene = docOf(result.scene);
    expect(scene.getMap("meta").get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    expect(scene.getMap("prefabs").size).toBe(0);
  });

  it("keeps a live asset of another kind with the prefab's id, adding no second one", () => {
    const registry = project({
      post: entry("post", { id: "post", path: "materials/post.json" }),
    });
    const result = migrateSceneLayoutState({
      scene: layoutOne([prefab("post", 0)]),
      projectId: "demo",
      sceneKey: "yard",
      project: registry,
      prefabDocs: new Map(),
      now: 5,
    })!;
    expect(result).toMatchObject({ created: [], kept: [], diverged: ["post"], prefabs: [] });
    expect(result.project).toBeNull();
    expect(result.entry!.warnings).toEqual([
      expect.objectContaining({
        code: "prefab-diverged",
        message: expect.stringContaining("is a material, not a prefab"),
      }),
    ]);
  });

  it("takes a fallback key for a 48-character id that is still an id", () => {
    const id = "a".repeat(48);
    const registry = project({
      [id]: entry(id, {
        id,
        kind: "prefab",
        path: "old.json",
        deleted: { at: 2, by: "bob" },
      }),
    });
    const result = migrateSceneLayoutState({
      scene: layoutOne([prefab(id, 0)]),
      projectId: "demo",
      sceneKey: "yard",
      project: registry,
      prefabDocs: new Map(),
      now: 5,
    })!;
    const key = `${"a".repeat(46)}-2`;
    expect(result.prefabs.map((p) => p.key)).toEqual([key]);
    expect(readProjectState(result.project).assets[key]).toMatchObject({ id, kind: "prefab" });
    expect(ID_PATTERN.test(key)).toBe(true);
  });
});

/** A state as a layout-2 engine wrote it: the layout's own record keys under their old names. */
function layoutTwo(state: Uint8Array): Uint8Array {
  const doc = docOf(state);
  const rename = (map: Y.Map<unknown>, from: string, to: string) => {
    if (!map.has(from)) return;
    const value = map.get(from);
    map.delete(from);
    map.set(to, value);
  };
  const keyed = (value: unknown) => {
    if (value instanceof Y.Map) {
      if (value.has("item")) rename(value, "@z", "z");
      for (const v of value.values()) keyed(v);
    } else if (value instanceof Y.Array) for (const v of value.toArray()) keyed(v);
  };
  doc.transact(() => {
    for (const name of ["entities", "instances"])
      for (const rec of doc.getMap(name).values())
        if (rec instanceof Y.Map) {
          rename(rec, "@z", "z");
          rename(rec, "@bulk", "bulk");
        }
    keyed(doc.getMap("content"));
    doc.getMap("meta").set("layout", 2);
  });
  return Y.encodeStateAsUpdate(doc);
}

const recordKeys = (state: Uint8Array, map: string) =>
  [...docOf(state).getMap<Y.Map<unknown>>(map).entries()]
    .map(
      ([key, rec]) =>
        `${key}:${[...rec.keys()]
          .filter((k) => /z|bulk/.test(k))
          .sort()
          .join(",")}`,
    )
    .sort();

describe("layout 2 → 3", () => {
  const CRATE: Prefab = {
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    id: "crate",
    entities: [
      { id: "lid", type: "marker", at: [0, -8] },
      { id: "base", type: "marker", at: [0, 0] },
    ],
  };
  const SCENE: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: "yard",
    bounds: [0, 0, 100, 100],
    solid: [["box", 0, 90, 100, 10]],
    entities: [{ id: "spawn", type: "marker", at: [10, 80] }],
    instances: [{ id: "crate-1", prefab: "crate", at: [40, 80] }],
  };

  it("lifts a prefab doc at load, keeping every key, and reads one before that", async () => {
    const current = seedPrefabState({ project: "demo", key: "crate", prefab: CRATE });
    const old = layoutTwo(current);
    expect(recordKeys(old, "entities").every((k) => k.endsWith(":z"))).toBe(true);
    const lifted = migrateAssetLayoutState(old)!;
    expect(assetDocMeta(lifted)?.layout).toBe(COLLAB_LAYOUT_VERSION);
    expect(recordKeys(lifted, "entities")).toEqual(recordKeys(current, "entities"));
    expect(prefabDocValue(lifted)).toEqual(CRATE);
    expect(migrateAssetLayoutState(lifted)).toBeNull();
    // Unloaded, a stored layout-2 doc still reads, counts and snapshots as its prefab.
    expect(prefabDocValue(old)).toEqual(CRATE);
    expect(assetItemCount(old)).toBe(2);
    expect(await assetSnapshot(old)).toEqual(await assetSnapshot(current));
  });

  it("lifts a declarative doc's keyed rows at load, keeping each row's key and place", async () => {
    const current = seedAssetState({
      project: "demo",
      key: "deck",
      kind: "data-table",
      seed: TABLE,
    });
    const old = layoutTwo(current);
    const rows = (state: Uint8Array) =>
      [...(docOf(state).getMap("content").get("rows") as Y.Map<Y.Map<unknown>>).entries()]
        .map(([key, row]): [string, unknown, boolean] => [key, row.get("@z") ?? null, row.has("z")])
        .sort((a, b) => a[0].localeCompare(b[0]));
    expect(rows(old).every(([, z, legacy]) => z === null && legacy)).toBe(true);
    const lifted = migrateAssetLayoutState(old)!;
    expect(rows(lifted)).toEqual(rows(current));
    expect(assetDocValue(lifted)).toEqual(JSON.parse(TABLE));
    expect(assetDocValue(old)).toEqual(JSON.parse(TABLE));
    expect(await assetSnapshot(old)).toEqual(await assetSnapshot(current));
    expect(migrateAssetLayoutState(lifted)).toBeNull();
  });

  it("leaves unseeded docs, docs at this layout and kinds this side doesn't know alone", () => {
    expect(migrateAssetLayoutState(null)).toBeNull();
    expect(
      migrateAssetLayoutState(seedPrefabState({ project: "demo", key: "crate", prefab: CRATE })),
    ).toBeNull();
    const game = seedAssetState({ project: "demo", key: "x", kind: "platformer/deck", seed: null });
    expect(migrateAssetLayoutState(layoutTwo(game))).toBeNull();
  });

  it("a layout-2 scene needs the step without its project, and keeps every key", () => {
    const current = seedState("demo.yard", SCENE);
    const old = layoutTwo(current);
    expect(sceneLayoutNeeds(old, null)).toEqual({ prefabs: [], keys: [] });
    const result = migrateSceneLayoutState({
      scene: old,
      projectId: "demo",
      sceneKey: "yard",
      project: null,
      prefabDocs: new Map(),
      now: 1,
    })!;
    expect(result).toMatchObject({
      project: null,
      prefabs: [],
      created: [],
      kept: [],
      diverged: [],
    });
    expect(docOf(result.scene).getMap("meta").get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    for (const map of ["entities", "instances"])
      expect(recordKeys(result.scene, map)).toEqual(recordKeys(current, map));
    expect(sceneDocValue(result.scene)).toEqual(sceneDocValue(current));
    expect(sceneDocValue(old)).toEqual(sceneDocValue(current));
    expect(sceneLayoutNeeds(result.scene, null)).toBeNull();
  });
});

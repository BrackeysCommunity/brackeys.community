import { formatPrefab, SCENE_FORMAT_VERSION, type Prefab } from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  assetSchemaVersion,
  assetSnapshot,
  COLLAB_LAYOUT_VERSION,
  migrateAssetLayoutState,
  prefabDocValue,
  seedPrefabState,
} from "../project-bytes";

const CRATE: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "crate",
  entities: [
    { id: "lid", type: "marker", at: [0, -8] },
    { id: "base", type: "marker", at: [0, 0] },
  ],
};

const docOf = (state: Uint8Array) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
};

/** The seeded crate with `meta` rewritten, as an older or newer engine stored it. */
function storedAs(meta: Record<string, number>): Uint8Array {
  const doc = docOf(seedPrefabState({ project: "demo", key: "crate", prefab: CRATE }));
  doc.transact(() => {
    for (const [k, v] of Object.entries(meta)) doc.getMap("meta").set(k, v);
  });
  return Y.encodeStateAsUpdate(doc);
}

const entityKeys = (state: Uint8Array) => [...docOf(state).getMap("entities").keys()].sort();

describe("prefab doc format version at load", () => {
  it("leaves a doc whose next step needs its game at its version, with no snapshot", async () => {
    expect(SCENE_FORMAT_VERSION).toBe(5);
    const old = storedAs({ schemaVersion: SCENE_FORMAT_VERSION - 1 });
    expect(migrateAssetLayoutState(old)).toBeNull();
    expect(prefabDocValue(old)?.v).toBe(SCENE_FORMAT_VERSION - 1);
    expect(assetSchemaVersion(old)).toBe(SCENE_FORMAT_VERSION - 1);
    expect(await assetSnapshot(old)).toBeNull();
  });

  it("lifts an older doc as far as this side can, writing only meta", async () => {
    // v2 to v3 needs nothing; v3 to v4 needs the game
    const old = storedAs({ schemaVersion: 2 });
    const lifted = migrateAssetLayoutState(old)!;
    expect(lifted).not.toBeNull();
    expect(assetSchemaVersion(lifted)).toBe(3);
    expect(entityKeys(lifted)).toEqual(entityKeys(old));
    expect(prefabDocValue(lifted)).toEqual({ ...CRATE, v: 3 });
    expect(await assetSnapshot(lifted)).toBeNull();
    expect(migrateAssetLayoutState(lifted)).toBeNull();
  });

  it("snapshots a current doc", async () => {
    const current = storedAs({});
    expect(migrateAssetLayoutState(current)).toBeNull();
    expect((await assetSnapshot(current))?.text).toBe(formatPrefab(CRATE));
  });

  it("lifts the layout and the format version of an older doc together", () => {
    const lifted = migrateAssetLayoutState(
      storedAs({ schemaVersion: 2, layout: COLLAB_LAYOUT_VERSION - 1 }),
    )!;
    const meta = docOf(lifted).getMap("meta");
    expect(meta.get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    expect(meta.get("schemaVersion")).toBe(3);
  });

  it("leaves a doc from a newer engine's format as stored", () => {
    expect(
      migrateAssetLayoutState(storedAs({ schemaVersion: SCENE_FORMAT_VERSION + 1 })),
    ).toBeNull();
  });
});

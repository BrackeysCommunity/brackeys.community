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
  it("lifts a v2 prefab doc at this layout to v3, writing only meta", async () => {
    const old = storedAs({ schemaVersion: 2 });
    expect(prefabDocValue(old)?.v).toBe(SCENE_FORMAT_VERSION);
    const lifted = migrateAssetLayoutState(old)!;
    expect(lifted).not.toBeNull();
    expect(assetSchemaVersion(lifted)).toBe(SCENE_FORMAT_VERSION);
    expect(entityKeys(lifted)).toEqual(entityKeys(old));
    expect(prefabDocValue(lifted)).toEqual(CRATE);
    expect((await assetSnapshot(lifted))?.text).toBe(formatPrefab(CRATE));
    expect(migrateAssetLayoutState(lifted)).toBeNull();
  });

  it("lifts the layout and the format version of an older doc together", () => {
    const lifted = migrateAssetLayoutState(
      storedAs({ schemaVersion: 2, layout: COLLAB_LAYOUT_VERSION - 1 }),
    )!;
    const meta = docOf(lifted).getMap("meta");
    expect(meta.get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    expect(meta.get("schemaVersion")).toBe(SCENE_FORMAT_VERSION);
  });

  it("leaves a doc from a newer engine's format as stored", () => {
    expect(
      migrateAssetLayoutState(storedAs({ schemaVersion: SCENE_FORMAT_VERSION + 1 })),
    ).toBeNull();
  });
});

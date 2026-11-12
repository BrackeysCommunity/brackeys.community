import { describe, expect, it } from "bun:test";

import { PREFAB_KIND, SCENE_FORMAT_VERSION } from "../../../../packages/engine/scene/index.ts";
import type { CanvasTokenClaims } from "../../../../src/lib/canvas/token.ts";
import { COLLAB_LAYOUT_VERSION } from "../../../../src/lib/scene/project-bytes.ts";
import { SyncMetrics } from "../telemetry.ts";
import { createAssetKind } from "./asset-kind.ts";
import { MemoryAssetDocStore } from "./doc-store.ts";

const EMPTY_UPDATE = new Uint8Array([0, 0]);

async function storedAt(schemaVersion: number) {
  const store = new MemoryAssetDocStore();
  store.create("jam.door", PREFAB_KIND);
  await store.write("jam.door", async () => ({ state: EMPTY_UPDATE, schemaVersion }), {
    editorId: null,
    now: new Date(0),
  });
  return createAssetKind({
    store,
    documents: () => new Map(),
    now: Date.now,
    metrics: new SyncMetrics(),
  });
}

describe("asset admit", () => {
  const claims: CanvasTokenClaims = {
    c: "project:jam",
    u: "alice",
    a: "write",
    e: Date.now() + 60_000,
    v: 1,
    k: "project",
    s: "project",
    l: COLLAB_LAYOUT_VERSION,
    f: SCENE_FORMAT_VERSION,
  };

  it("admits a current client read-only on a prefab doc stored at an older format", async () => {
    const asset = await storedAt(SCENE_FORMAT_VERSION - 1);
    const grant = await asset.admit("jam.door", claims);
    expect(grant.readOnly).toBe(true);
    expect(JSON.parse(grant.notice!)).toEqual({
      type: "scene-read-only",
      reason: "migration-unresolved",
      schemaVersion: SCENE_FORMAT_VERSION - 1,
    });
  });

  it("admits a current client writable on a prefab doc at the current format", async () => {
    const asset = await storedAt(SCENE_FORMAT_VERSION);
    expect(await asset.admit("jam.door", claims)).toEqual({});
  });
});

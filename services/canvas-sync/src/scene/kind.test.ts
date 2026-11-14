import { describe, expect, it } from "bun:test";

import type { onLoadDocumentPayload } from "@hocuspocus/server";
import * as Y from "yjs";

import { stampSeedState } from "../../../../packages/engine/collab/seed-identity.ts";
import { SCENE_FORMAT_VERSION } from "../../../../packages/engine/scene/types.ts";
import { signCanvasToken, verifyCanvasToken } from "../../../../src/lib/canvas/token.ts";
import { seedState, stateSchemaVersion } from "../../../../src/lib/scene/doc-bytes.ts";
import { COLLAB_LAYOUT_VERSION } from "../../../../src/lib/scene/project-bytes.ts";
import { formatReadOnlyReason } from "../kinds.ts";
import { SyncMetrics } from "../telemetry.ts";
import { createSceneKind } from "./kind.ts";
import { MemorySceneStore } from "./store.ts";

const SECRET = "scene-kind-test-secret-1234";

async function claims(l?: number, f = SCENE_FORMAT_VERSION, c = "scene:jam.level-1") {
  const token = await signCanvasToken({ c, u: "alice", a: "write", k: "scene", f, l }, SECRET);
  const verified = await verifyCanvasToken(token, SECRET);
  if (!verified) throw new Error("the token didn't verify");
  return verified;
}

describe("the scene kind's layout check", () => {
  const store = new MemorySceneStore();
  store.create("jam.level-1");
  const scene = createSceneKind({
    store,
    documents: () => new Map(),
    now: Date.now,
    metrics: new SyncMetrics(),
  });

  it("admits a client on this layout for writing", async () => {
    expect(await scene.admit("jam.level-1", await claims(COLLAB_LAYOUT_VERSION))).toEqual({});
  });

  it("connects a client on the layout before this one read-only, told to reload", async () => {
    expect(COLLAB_LAYOUT_VERSION).toBe(3);
    const grant = await scene.admit("jam.level-1", await claims(COLLAB_LAYOUT_VERSION - 1));
    expect(grant.readOnly).toBe(true);
    expect(JSON.parse(grant.notice ?? "null")).toEqual({
      type: "scene-read-only",
      reason: "engine-outdated",
      schemaVersion: SCENE_FORMAT_VERSION,
      layout: COLLAB_LAYOUT_VERSION,
    });
  });

  it("connects a client on a newer layout read-only until this instance can migrate", async () => {
    const grant = await scene.admit("jam.level-1", await claims(COLLAB_LAYOUT_VERSION + 1));
    expect(grant.readOnly).toBe(true);
    expect(JSON.parse(grant.notice ?? "null")).toMatchObject({
      reason: "server-outdated",
      layout: COLLAB_LAYOUT_VERSION,
    });
  });

  it("reads a scene token without `l` as layout 1, so it connects read-only instead of being refused", async () => {
    const grant = await scene.admit("jam.level-1", await claims());
    expect(grant.readOnly).toBe(true);
    expect(JSON.parse(grant.notice ?? "null")).toEqual({
      type: "scene-read-only",
      reason: "engine-outdated",
      schemaVersion: SCENE_FORMAT_VERSION,
      layout: COLLAB_LAYOUT_VERSION,
    });
  });
});

const V = SCENE_FORMAT_VERSION;

const scene = (v: number, game: string | null = "jam") => ({
  v,
  ...(game ? { game } : {}),
  name: "hosted",
  bounds: [0, 0, 640, 360] as [number, number, number, number],
  entities: [{ id: "spawn", type: "marker", at: [10, 280] as [number, number] }],
});

describe("formatReadOnlyReason", () => {
  it("names who has to move for a client and a doc on different formats", () => {
    expect(formatReadOnlyReason(V, V, V)).toBeNull();
    expect(formatReadOnlyReason(V - 1, V, V)).toBe("engine-outdated");
    expect(formatReadOnlyReason(V + 1, V, V)).toBe("server-outdated");
    expect(formatReadOnlyReason(V, V - 1, V)).toBe("migration-unresolved");
  });
});

describe("a hosted doc whose next format step needs its game", () => {
  const store = new MemorySceneStore();
  const live = new Map<string, Y.Doc>();
  const kind = createSceneKind({
    store,
    documents: () => live,
    now: Date.now,
    metrics: new SyncMetrics(),
  });
  const load = (sceneId: string) =>
    kind.persistence.onLoadDocument!({
      documentName: `scene:${sceneId}`,
    } as onLoadDocumentPayload) as Promise<Uint8Array>;
  const admit = async (sceneId: string, f: number) =>
    kind.admit(sceneId, await claims(COLLAB_LAYOUT_VERSION, f, `scene:${sceneId}`));
  const storedAt = (sceneId: string, v: number) => {
    store.create(sceneId);
    const row = store.rows.get(sceneId)!;
    row.state = seedState(sceneId, scene(v) as never);
    row.schemaVersion = v;
    return row;
  };

  it("loads and stays at v4, its stored bytes untouched", async () => {
    expect(V).toBe(5);
    const row = storedAt("jam.old", V - 1);
    const before = row.state;
    const state = await load("jam.old");
    expect(stateSchemaVersion(state)).toBe(V - 1);
    // The live doc gains only its seed stamp.
    expect(state).toEqual(stampSeedState(before!));
    expect(store.rows.get("jam.old")!.schemaVersion).toBe(V - 1);
    expect(store.rows.get("jam.old")!.state).toBe(before);
  });

  it("is served read-only to a v5 client with migration-unresolved, before and after load", async () => {
    storedAt("jam.stuck", V - 1);
    const expected = {
      type: "scene-read-only",
      reason: "migration-unresolved",
      schemaVersion: V - 1,
    };
    const before = await admit("jam.stuck", V);
    expect(before.readOnly).toBe(true);
    expect(JSON.parse(before.notice ?? "null")).toEqual(expected);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, await load("jam.stuck"));
    live.set("scene:jam.stuck", doc);
    const after = await admit("jam.stuck", V);
    expect(after.readOnly).toBe(true);
    expect(JSON.parse(after.notice ?? "null")).toEqual(expected);
    live.delete("scene:jam.stuck");
  });

  it("lifts an older doc as far as it can without the game, then holds it there", async () => {
    storedAt("jam.older", V - 3);
    const grant = await admit("jam.older", V);
    expect(JSON.parse(grant.notice ?? "null")).toEqual({
      type: "scene-read-only",
      reason: "migration-unresolved",
      schemaVersion: V - 2,
    });
    expect(stateSchemaVersion(await load("jam.older"))).toBe(V - 2);
    expect(store.rows.get("jam.older")!.schemaVersion).toBe(V - 2);
  });

  it("stores no snapshot text for it", async () => {
    storedAt("jam.unsnapped", V - 2);
    await load("jam.unsnapped");
    expect(store.rows.get("jam.unsnapped")!.snapshot).toBeNull();
  });

  it("seeds a new doc at v5, which a v5 client writes", async () => {
    store.create("jam.fresh");
    expect(await admit("jam.fresh", V)).toEqual({});
    const seeded = await load("jam.fresh");
    expect(stateSchemaVersion(seeded)).toBe(V);
    expect(store.rows.get("jam.fresh")!.schemaVersion).toBe(V);
    store.create("jam.seeded", JSON.stringify(scene(V)));
    expect(stateSchemaVersion(await load("jam.seeded"))).toBe(V);
  });

  it("keeps a v4 client from writing a v5 doc", async () => {
    storedAt("jam.current", V);
    const grant = await admit("jam.current", V - 1);
    expect(grant.readOnly).toBe(true);
    expect(JSON.parse(grant.notice ?? "null")).toEqual({
      type: "scene-read-only",
      reason: "engine-outdated",
      schemaVersion: V,
    });
  });

  it("lets a v4 client write the v4 doc, its own format", async () => {
    storedAt("jam.v4-client", V - 1);
    expect(await admit("jam.v4-client", V - 1)).toEqual({});
  });
});

describe("a hosted doc that names no game", () => {
  const store = new MemorySceneStore();
  const live = new Map<string, Y.Doc>();
  const kind = createSceneKind({
    store,
    documents: () => live,
    now: Date.now,
    metrics: new SyncMetrics(),
  });
  const storedAt = (sceneId: string, v: number) => {
    store.create(sceneId);
    const row = store.rows.get(sceneId)!;
    row.state = seedState(sceneId, scene(v, null) as never);
    row.schemaVersion = v;
    return row;
  };

  it("lifts to v5 with the engine's own registry, lengths in metres, and a v5 client writes it", async () => {
    storedAt("p-yard.old", V - 2);
    expect(
      await kind.admit("p-yard.old", await claims(COLLAB_LAYOUT_VERSION, V, "scene:p-yard.old")),
    ).toEqual({});
    const state = (await kind.persistence.onLoadDocument!({
      documentName: "scene:p-yard.old",
    } as onLoadDocumentPayload)) as Uint8Array;
    expect(stateSchemaVersion(state)).toBe(V);
    const row = store.rows.get("p-yard.old")!;
    expect(row.schemaVersion).toBe(V);
    expect(JSON.parse(row.snapshot!)).toMatchObject({
      v: V,
      bounds: [0, 0, 6.4, 3.6],
      entities: [{ id: "spawn", at: [0.1, 2.8] }],
    });
  });
});

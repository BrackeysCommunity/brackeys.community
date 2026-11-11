import { afterAll, afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";

import * as Y from "yjs";

import {
  BULK_FIELD,
  LEGACY_BULK_FIELD,
  LEGACY_Z_FIELD,
  Z_FIELD,
  type LogEntry,
} from "../../../src/engine/collab/types.ts";
import type { AssetEntry } from "../../../src/engine/project/types.ts";
import { formatPrefab } from "../../../src/engine/scene/format.ts";
import type { Prefab, SceneDefinition } from "../../../src/engine/scene/types.ts";
import { documentName } from "../../../src/lib/canvas/sync-channels.ts";
import { seedState } from "../../../src/lib/scene/doc-bytes.ts";
import {
  emptyProjectState,
  readProjectState,
  seedPrefabState,
  seedProjectState,
} from "../../../src/lib/scene/project-bytes.ts";
import type { LayoutReadOnlyNotice } from "../src/engine/asset-kind.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import type { SceneReadOnlyNotice } from "../src/scene/kind.ts";
import {
  addSolid,
  COLLAB_LAYOUT_VERSION,
  connectDoc,
  connectScene,
  createMemoryProject,
  type EngineClient,
  layoutOneState,
  layoutTwoState,
  memoryEngineStores,
  newProjectId,
  prefabOfState,
  projectToken,
  SCENE_FORMAT_VERSION,
  sceneSynced as synced,
  SECRET,
  sleep,
  until,
} from "./harness.ts";

setDefaultTimeout(30_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };

const prefab = (id: string, x: number, children = 1): Prefab => ({
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id,
  entities: Array.from({ length: children }, (_, i) => ({
    id: `part-${i}`,
    type: "marker",
    at: [x + i, -10] as [number, number],
  })),
});

const POST = prefab("post", 0);
const GATE = prefab("gate", 5);
const CRATE = prefab("crate", 9, 3);

const YARD: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "yard",
  bounds: [0, 0, 1000, 1000],
  instances: [
    { id: "post-1", prefab: "post", at: [10, 10] },
    { id: "gate-1", prefab: "gate", at: [50, 10] },
    { id: "crate-1", prefab: "crate", at: [90, 10] },
  ],
};

const entry = (key: string, kind: string, path: string): AssetEntry => ({
  key,
  id: key,
  kind,
  path,
  created: { at: 1, by: "alice" },
});

const docOf = (state: Uint8Array | null) => {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state);
  return doc;
};

const LAYOUT_KEYS = new Set([Z_FIELD, BULK_FIELD, LEGACY_Z_FIELD, LEGACY_BULK_FIELD]);

/** Each record's key with the order and bulk keys it holds. */
const recordKeys = (doc: Y.Doc, map: string) =>
  [...doc.getMap<Y.Map<unknown>>(map).entries()]
    .map(
      ([key, rec]) =>
        `${key}:${[...rec.keys()]
          .filter((k) => LAYOUT_KEYS.has(k))
          .sort()
          .join(",")}`,
    )
    .sort();

const notice = (client: EngineClient): SceneReadOnlyNotice | null =>
  client.notices.length > 0 ? (JSON.parse(client.notices[0]!) as SceneReadOnlyNotice) : null;

describe("hosted scene layouts", () => {
  const stores = memoryEngineStores();
  const servers: SyncServer[] = [];
  const clients: EngineClient[] = [];

  const instance = async (id: string) => {
    const server = await startServer({
      port: 0,
      secret: SECRET,
      ...stores.options,
      instanceId: id,
      telemetry: quiet,
      debounceMs: 50,
      maxDebounceMs: 200,
    });
    servers.push(server);
    return server;
  };
  const track = <C extends EngineClient>(client: C) => {
    clients.push(client);
    return client;
  };

  /**
   * A project as a layout-1 server left it: the scene `yard` holds post,
   * gate and crate in its own map; the project already has post (the same
   * body, stored) and gate (another body, a seed only).
   */
  const layoutOneProject = () => {
    const projectId = newProjectId();
    createMemoryProject(
      stores,
      {
        ...emptyProjectState(projectId, projectId),
        assets: {
          yard: entry("yard", "scene", "levels/yard.json"),
          post: entry("post", "prefab", "shared/post.json"),
          gate: entry("gate", "prefab", "shared/gate.json"),
        },
      },
      { gate: JSON.stringify(prefab("gate", 77)) },
    );
    stores.assets.rows.get(`${projectId}.post`)!.state = seedPrefabState({
      project: projectId,
      key: "post",
      prefab: POST,
    });
    const sceneId = `${projectId}.yard`;
    stores.scenes.rows.get(sceneId)!.state = layoutOneState(sceneId, YARD, [POST, GATE, CRATE]);
    return { projectId, sceneId };
  };

  const registry = (projectId: string) =>
    readProjectState(stores.projects.rowsById.get(projectId)?.state ?? null);
  const scoped = (projectId: string) => () => projectToken(projectId, "alice", { scoped: true });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.destroy();
    for (const server of servers.splice(0)) await server.stop(3000);
  });

  afterAll(async () => {
    for (const server of servers) await server.stop(3000);
  });

  it("a layout-1 scene's prefabs become prefab docs of its project at load", async () => {
    const server = await instance("layout-a");
    const { projectId, sceneId } = layoutOneProject();
    const scene = track(connectScene(server.port, sceneId, "alice", { token: scoped(projectId) }));
    expect(await synced(scene)).toBe(true);

    expect(scene.doc.getMap("meta").get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    expect(scene.doc.getMap("prefabs").size).toBe(0);
    expect(scene.doc.getMap("instances").size).toBe(3);
    const log = scene.doc.getArray<LogEntry>("log").toArray();
    const migration = log[log.length - 1]!;
    expect(migration.actor).toEqual({ kind: "migration" });
    expect(migration.warnings).toEqual([
      expect.objectContaining({ code: "prefab-diverged", ids: ["gate"] }),
    ]);

    const stored = docOf(stores.scenes.rows.get(sceneId)!.state);
    expect(stored.getMap("meta").get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    expect(stored.getMap("prefabs").size).toBe(0);

    const assets = registry(projectId).assets;
    expect(Object.keys(assets).sort()).toEqual(["crate", "gate", "post", "yard"]);
    expect(assets.crate).toMatchObject({
      id: "crate",
      kind: "prefab",
      path: "levels/prefabs/crate.json",
    });
    expect(assets.post!.path).toBe("shared/post.json");

    const crate = stores.assets.rows.get(`${projectId}.crate`)!;
    expect(crate.kind).toBe("prefab");
    expect(prefabOfState(crate.state)).toEqual(CRATE);
    expect(crate.snapshot).toBe(formatPrefab(CRATE));
    expect(crate.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    // The project's own copies are kept, the diverged one included.
    expect(stores.assets.rows.get(`${projectId}.gate`)!.state).toBeNull();
    expect(prefabOfState(stores.assets.rows.get(`${projectId}.post`)!.state)).toEqual(POST);

    const doc = track(
      connectDoc(server.port, documentName("asset", `${projectId}.crate`), scoped(projectId)),
    );
    expect(await synced(doc)).toBe(true);
    expect(prefabOfState(Y.encodeStateAsUpdate(doc.doc))).toEqual(CRATE);
    expect(doc.scope()).toBe("read-write");

    // Loaded again, it is already at this layout: nothing moves twice.
    scene.destroy();
    const name = documentName("scene", sceneId);
    expect(await until(() => !server.hocuspocus.documents.has(name), 5000)).toBe(true);
    const again = track(connectScene(server.port, sceneId, "bob", { token: scoped(projectId) }));
    expect(await synced(again)).toBe(true);
    expect(again.doc.getArray("log").length).toBe(log.length);
    expect(Object.keys(registry(projectId).assets).sort()).toEqual([
      "crate",
      "gate",
      "post",
      "yard",
    ]);
  });

  it("two instances migrating one scene at once agree on one copy of each prefab", async () => {
    const one = await instance("layout-one");
    const two = await instance("layout-two");
    const { projectId, sceneId } = layoutOneProject();
    const a = track(connectScene(one.port, sceneId, "alice", { token: scoped(projectId) }));
    const b = track(connectScene(two.port, sceneId, "bob", { token: scoped(projectId) }));
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);

    const keys = Object.keys(registry(projectId).assets).sort();
    expect(keys).toEqual(["crate", "gate", "post", "yard"]);
    const crate = docOf(stores.assets.rows.get(`${projectId}.crate`)!.state);
    expect(crate.getMap("entities").size).toBe(CRATE.entities.length);
    expect(prefabOfState(Y.encodeStateAsUpdate(crate))).toEqual(CRATE);
    expect(docOf(stores.scenes.rows.get(sceneId)!.state).getMap("prefabs").size).toBe(0);
  });

  it("finishes a migration cut short after the registry gained the prefab's entry", async () => {
    const server = await instance("layout-resume");
    const { projectId, sceneId } = layoutOneProject();
    // A first load that stopped after the registry write: crate's entry and row, no content.
    const row = stores.projects.rowsById.get(projectId)!;
    const state = readProjectState(row.state);
    const assets = {
      ...state.assets,
      crate: entry("crate", "prefab", "levels/prefabs/crate.json"),
    };
    stores.projects.create(projectId, projectId, seedProjectState({ ...state, assets }));
    stores.assets.create(`${projectId}.crate`, "prefab");

    const scene = track(connectScene(server.port, sceneId, "alice", { token: scoped(projectId) }));
    expect(await synced(scene)).toBe(true);
    expect(Object.keys(registry(projectId).assets).sort()).toEqual([
      "crate",
      "gate",
      "post",
      "yard",
    ]);
    expect(prefabOfState(stores.assets.rows.get(`${projectId}.crate`)!.state)).toEqual(CRATE);
  });

  it("opens a prefab row made from a file as the prefab it holds", async () => {
    const server = await instance("layout-prefab-row");
    const { projectId } = layoutOneProject();
    const gate = track(
      connectDoc(server.port, documentName("asset", `${projectId}.gate`), scoped(projectId)),
    );
    expect(await synced(gate)).toBe(true);
    expect(prefabOfState(Y.encodeStateAsUpdate(gate.doc))).toEqual(prefab("gate", 77));
    const row = stores.assets.rows.get(`${projectId}.gate`)!;
    expect(prefabOfState(row.state)).toEqual(prefab("gate", 77));
    expect(row.snapshot).toBe(formatPrefab(prefab("gate", 77)));
  });

  it("migrates a layout-1 scene that holds no prefabs without its project", async () => {
    const server = await instance("layout-lone");
    const sceneId = `${newProjectId()}.lone`;
    stores.scenes.create(sceneId);
    stores.scenes.rows.get(sceneId)!.state = layoutOneState(
      sceneId,
      { ...YARD, instances: [] },
      [],
    );
    const scene = track(connectScene(server.port, sceneId, "alice"));
    expect(await synced(scene)).toBe(true);
    expect(scene.doc.getMap("meta").get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    expect(docOf(stores.scenes.rows.get(sceneId)!.state).getMap("meta").get("layout")).toBe(
      COLLAB_LAYOUT_VERSION,
    );
  });

  it("refuses a layout-1 scene with prefabs whose project is gone, and leaves it as stored", async () => {
    const server = await instance("layout-orphan");
    const sceneId = `${newProjectId()}.orphan`;
    stores.scenes.create(sceneId);
    const before = layoutOneState(sceneId, YARD, [POST]);
    stores.scenes.rows.get(sceneId)!.state = before;
    const scene = track(connectScene(server.port, sceneId, "alice"));
    expect(await until(() => scene.authFailures.length > 0 || scene.closes.length > 0, 5000)).toBe(
      true,
    );
    expect(scene.provider.isSynced).toBe(false);
    expect(stores.scenes.rows.get(sceneId)!.state).toBe(before);
  });

  it("a layout-2 scene moves to layout 3 at load without its project, keeping every key", async () => {
    const server = await instance("layout-two-scene");
    const sceneId = `${newProjectId()}.yard`;
    stores.scenes.create(sceneId);
    const def: SceneDefinition = {
      ...YARD,
      solid: [
        ["box", 0, 900, 1000, 100],
        ["circle", 500, 500, 20],
      ],
      entities: [{ id: "spawn", type: "marker", at: [20, 880] }],
    };
    const current = docOf(seedState(sceneId, def));
    const before = layoutTwoState(Y.encodeStateAsUpdate(current), 2);
    const legacy = [`:${LEGACY_BULK_FIELD},${LEGACY_Z_FIELD}`, `:${LEGACY_Z_FIELD}`];
    expect(
      recordKeys(docOf(before), "entities").every((k) => legacy.some((end) => k.endsWith(end))),
    ).toBe(true);
    stores.scenes.rows.get(sceneId)!.state = before;

    const scene = track(connectScene(server.port, sceneId, "alice"));
    expect(await synced(scene)).toBe(true);
    expect(scene.scope()).toBe("read-write");
    expect(scene.doc.getMap("meta").get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    expect(scene.doc.getMap("meta").get("schemaVersion")).toBe(SCENE_FORMAT_VERSION);
    for (const map of ["entities", "instances"])
      expect(recordKeys(scene.doc, map)).toEqual(recordKeys(current, map));

    const stored = docOf(stores.scenes.rows.get(sceneId)!.state);
    expect(stored.getMap("meta").get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    for (const map of ["entities", "instances"])
      expect(recordKeys(stored, map)).toEqual(recordKeys(current, map));
  });

  it("a layout-2, v2 prefab doc moves to layout 3 and v3 at load, keeping every key", async () => {
    // A prefab doc lifts only as far as this side can without a registry: a step short of current.
    const lifted = SCENE_FORMAT_VERSION - 1;
    const server = await instance("layout-two-prefab");
    const projectId = newProjectId();
    createMemoryProject(stores, {
      ...emptyProjectState(projectId, projectId),
      assets: { crate: entry("crate", "prefab", "prefabs/crate.json") },
    });
    const current = docOf(seedPrefabState({ project: projectId, key: "crate", prefab: CRATE }));
    const row = stores.assets.rows.get(`${projectId}.crate`)!;
    row.state = layoutTwoState(Y.encodeStateAsUpdate(current), 2);

    const doc = track(
      connectDoc(server.port, documentName("asset", `${projectId}.crate`), scoped(projectId)),
    );
    expect(await synced(doc)).toBe(true);
    expect(doc.scope()).toBe("read-write");
    expect(doc.doc.getMap("meta").get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    expect(doc.doc.getMap("meta").get("schemaVersion")).toBe(lifted);
    expect(recordKeys(doc.doc, "entities")).toEqual(recordKeys(current, "entities"));
    expect(prefabOfState(Y.encodeStateAsUpdate(doc.doc))).toEqual({ ...CRATE, v: lifted });

    const stored = stores.assets.rows.get(`${projectId}.crate`)!;
    expect(docOf(stored.state).getMap("meta").get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    expect(docOf(stored.state).getMap("meta").get("schemaVersion")).toBe(lifted);
    expect(stored.schemaVersion).toBe(lifted);
    expect(recordKeys(docOf(stored.state), "entities")).toEqual(recordKeys(current, "entities"));
    // Snapshot text is only written at the current format.
    expect(stored.snapshot).toBeNull();
  });

  it("a layout-2 client is read-only on a layout-3 scene and asset doc", async () => {
    const server = await instance("layout-two-client");
    const { projectId, sceneId } = layoutOneProject();
    const older = COLLAB_LAYOUT_VERSION - 1;
    const scene = track(connectScene(server.port, sceneId, "bob", { layout: older }));
    const asset = track(
      connectDoc(server.port, documentName("asset", `${projectId}.post`), () =>
        projectToken(projectId, "bob", { scoped: true, layout: older }),
      ),
    );
    for (const client of [scene, asset]) {
      expect(await synced(client)).toBe(true);
      expect(client.scope()).toBe("readonly");
      expect(await until(() => client.notices.length > 0, 2000)).toBe(true);
    }
    expect(notice(scene)).toEqual({
      type: "scene-read-only",
      reason: "engine-outdated",
      schemaVersion: SCENE_FORMAT_VERSION,
      layout: COLLAB_LAYOUT_VERSION,
    });
    expect(JSON.parse(asset.notices[0]!) as LayoutReadOnlyNotice).toEqual({
      type: "layout-read-only",
      reason: "engine-outdated",
      layout: COLLAB_LAYOUT_VERSION,
    });
  });

  it("an older-layout client connects read-only and is told to reload", async () => {
    const server = await instance("layout-readonly");
    const { projectId, sceneId } = layoutOneProject();
    const current = track(
      connectScene(server.port, sceneId, "alice", { token: scoped(projectId) }),
    );
    const older = track(connectScene(server.port, sceneId, "bob", { layout: 1 }));
    const unstamped = track(connectScene(server.port, sceneId, "carol", { layout: null }));
    const newer = track(
      connectScene(server.port, sceneId, "dave", { layout: COLLAB_LAYOUT_VERSION + 1 }),
    );
    for (const client of [current, older, unstamped, newer])
      expect(await synced(client)).toBe(true);

    expect(current.scope()).toBe("read-write");
    expect(current.notices).toEqual([]);
    for (const client of [older, unstamped]) {
      expect(client.scope()).toBe("readonly");
      expect(await until(() => client.notices.length > 0, 2000)).toBe(true);
      expect(notice(client)).toEqual({
        type: "scene-read-only",
        reason: "engine-outdated",
        schemaVersion: SCENE_FORMAT_VERSION,
        layout: COLLAB_LAYOUT_VERSION,
      });
    }
    expect(newer.scope()).toBe("readonly");
    expect(await until(() => newer.notices.length > 0, 2000)).toBe(true);
    expect(notice(newer)).toMatchObject({
      reason: "server-outdated",
      layout: COLLAB_LAYOUT_VERSION,
    });

    addSolid(older.doc, "stale-write", 99);
    addSolid(current.doc, "fresh-write", 1);
    expect(await until(() => older.doc.getMap("entities").has("fresh-write"), 3000)).toBe(true);
    await sleep(300);
    expect(current.doc.getMap("entities").has("stale-write")).toBe(false);
    const stored = docOf(stores.scenes.rows.get(sceneId)!.state).getMap("entities");
    expect(stored.has("stale-write")).toBe(false);
  });
});

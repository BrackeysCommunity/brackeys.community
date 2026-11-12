import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import * as Y from "yjs";

import {
  LEGACY_BULK_FIELD,
  LEGACY_Z_FIELD,
  Z_FIELD,
} from "../../../packages/engine/collab/types.ts";
import { seedState, type SceneFormat } from "../../../src/lib/scene/doc-bytes.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import type { SceneReadOnlyNotice } from "../src/scene/kind.ts";
import { MemorySceneStore } from "../src/scene/store.ts";
import {
  addSolid,
  COLLAB_LAYOUT_VERSION,
  connectScene,
  layoutTwoState,
  newSceneId,
  SCENE_FORMAT_VERSION as V,
  sceneSynced,
  SECRET,
  type SceneClient,
  sleep,
  until,
} from "./harness.ts";

setDefaultTimeout(30_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };

const scene = (v: number) => ({
  v,
  game: "test",
  name: "versions",
  bounds: [0, 0, 640, 360] as [number, number, number, number],
  solid: [["box", 0, 300, 320, 20]],
  entities: [{ id: "spawn", type: "marker", at: [10, 280] }],
});

/** The next format: every entity gains a field, the settings a flag. */
const NEXT: SceneFormat = {
  version: V + 1,
  migrations: {
    [V]: (raw) => {
      const doc = raw as ReturnType<typeof scene> & { settings?: Record<string, unknown> };
      return {
        ...doc,
        v: V + 1,
        settings: { ...doc.settings, lifted: true },
        entities: doc.entities.map((e) => ({ ...e, tag: "lifted" })),
      };
    },
  },
};

const keysOf = (state: Uint8Array) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return [...doc.getMap("entities").keys()].sort();
};

const notice = (client: SceneClient): SceneReadOnlyNotice | null =>
  client.notices.length > 0 ? (JSON.parse(client.notices[0]!) as SceneReadOnlyNotice) : null;

describe("scene format versions", () => {
  const store = new MemorySceneStore();
  const servers: SyncServer[] = [];
  const clients: SceneClient[] = [];
  const instance = async (id: string, sceneFormat?: SceneFormat) => {
    const server = await startServer({
      port: 0,
      secret: SECRET,
      sceneStore: store,
      ...(sceneFormat ? { sceneFormat } : {}),
      instanceId: id,
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 500,
    });
    servers.push(server);
    return server;
  };
  const open = (...args: Parameters<typeof connectScene>) => {
    const client = connectScene(...args);
    clients.push(client);
    return client;
  };
  /** A scene stored at `v` by an instance that read `v`. */
  const stored = (v: number) => {
    const sceneId = newSceneId();
    store.create(sceneId);
    const row = store.rows.get(sceneId)!;
    row.state = seedState(sceneId, scene(v) as never);
    row.schemaVersion = v;
    return sceneId;
  };

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await Promise.all(servers.map((server) => server.stop(3000)));
  });

  it("a client on an older schemaVersion connects read-only and is told to reload", async () => {
    const server = await instance("ro-current");
    const sceneId = stored(V);
    const current = open(server.port, sceneId, "alice");
    const outdated = open(server.port, sceneId, "bob", { format: V - 1 });
    expect(await sceneSynced(current)).toBe(true);
    expect(await sceneSynced(outdated)).toBe(true);
    expect(current.scope()).toBe("read-write");
    expect(outdated.scope()).toBe("readonly");
    expect(await until(() => outdated.notices.length > 0, 2000)).toBe(true);
    expect(notice(outdated)).toEqual({
      type: "scene-read-only",
      reason: "engine-outdated",
      schemaVersion: V,
    });
    expect(current.notices).toEqual([]);

    addSolid(outdated.doc, "stale-write", 99);
    addSolid(current.doc, "fresh-write", 1);
    expect(await until(() => outdated.entities.has("fresh-write"), 3000)).toBe(true);
    await sleep(300);
    expect(current.entities.has("stale-write")).toBe(false);
  });

  it("migrates an older doc in place at load; the old engine reads it read-only", async () => {
    const server = await instance("ro-next", NEXT);
    const sceneId = stored(V);
    const before = keysOf(store.rows.get(sceneId)!.state!);

    const next = open(server.port, sceneId, "alice", { format: V + 1 });
    const old = open(server.port, sceneId, "bob", { format: V });
    expect(await sceneSynced(next)).toBe(true);
    expect(await sceneSynced(old)).toBe(true);
    expect(next.scope()).toBe("read-write");
    expect(old.scope()).toBe("readonly");
    expect(notice(old)).toMatchObject({ reason: "engine-outdated", schemaVersion: V + 1 });

    expect(next.doc.getMap("meta").get("schemaVersion")).toBe(V + 1);
    expect([...next.entities.keys()].sort()).toEqual(before);
    expect(next.doc.getMap("settings").get("lifted")).toBe(true);
    expect(
      [...next.entities.values()].filter((e) => e.get("id") === "spawn").map((e) => e.get("tag")),
    ).toEqual(["lifted"]);
    // Stored at once, so the next load and other instances start migrated.
    expect(store.rows.get(sceneId)!.schemaVersion).toBe(V + 1);
    expect(keysOf(store.rows.get(sceneId)!.state!)).toEqual(before);
  });

  it("a client on an older layout connects read-only though its format matches", async () => {
    const server = await instance("ro-layout");
    const sceneId = stored(V);
    const older = open(server.port, sceneId, "bob", { layout: COLLAB_LAYOUT_VERSION - 1 });
    expect(await sceneSynced(older)).toBe(true);
    expect(older.scope()).toBe("readonly");
    expect(await until(() => older.notices.length > 0, 2000)).toBe(true);
    expect(notice(older)).toEqual({
      type: "scene-read-only",
      reason: "engine-outdated",
      schemaVersion: V,
      layout: COLLAB_LAYOUT_VERSION,
    });
  });

  it("lifts a layout-2 doc's layout before its format, so the migration reads every record", async () => {
    const server = await instance("ro-layout-next", NEXT);
    const sceneId = stored(V);
    const row = store.rows.get(sceneId)!;
    const before = keysOf(row.state!);
    row.state = layoutTwoState(row.state!);

    const next = open(server.port, sceneId, "alice", { format: V + 1 });
    expect(await sceneSynced(next)).toBe(true);
    expect(next.scope()).toBe("read-write");
    expect(next.doc.getMap("meta").get("schemaVersion")).toBe(V + 1);
    expect(next.doc.getMap("meta").get("layout")).toBe(COLLAB_LAYOUT_VERSION);
    expect([...next.entities.keys()].sort()).toEqual(before);
    for (const rec of next.entities.values()) {
      expect(typeof rec.get(Z_FIELD)).toBe("string");
      expect(rec.has(LEGACY_Z_FIELD)).toBe(false);
      expect(rec.has(LEGACY_BULK_FIELD)).toBe(false);
    }
    expect(
      [...next.entities.values()].filter((e) => e.get("id") === "spawn").map((e) => e.get("tag")),
    ).toEqual(["lifted"]);
    expect(keysOf(store.rows.get(sceneId)!.state!)).toEqual(before);
  });

  it("a client newer than the doc connects read-only until an instance can migrate it", async () => {
    const server = await instance("ro-ahead");
    const sceneId = stored(V);
    const ahead = open(server.port, sceneId, "alice", { format: V + 1 });
    expect(await sceneSynced(ahead)).toBe(true);
    expect(ahead.scope()).toBe("readonly");
    expect(await until(() => ahead.notices.length > 0, 2000)).toBe(true);
    expect(notice(ahead)).toMatchObject({ reason: "server-outdated", schemaVersion: V });
  });

  it("an instance older than the stored doc serves it as it is, to clients that read it", async () => {
    const server = await instance("ro-behind");
    const sceneId = stored(V + 1);
    const ahead = open(server.port, sceneId, "alice", { format: V + 1 });
    const behind = open(server.port, sceneId, "bob", { format: V });
    expect(await sceneSynced(ahead)).toBe(true);
    expect(await sceneSynced(behind)).toBe(true);
    expect(ahead.scope()).toBe("read-write");
    expect(behind.scope()).toBe("readonly");
    expect(ahead.doc.getMap("meta").get("schemaVersion")).toBe(V + 1);

    addSolid(ahead.doc, "from-ahead", 5);
    ahead.destroy();
    behind.destroy();
    expect(await until(() => keysOf(store.rows.get(sceneId)!.state!).includes("from-ahead"))).toBe(
      true,
    );
    const row = store.rows.get(sceneId)!;
    expect(row.schemaVersion).toBe(V + 1);
    // It can't read a newer format, so it leaves the snapshot to an instance that can.
    expect(row.snapshot).toBeNull();
  });
});

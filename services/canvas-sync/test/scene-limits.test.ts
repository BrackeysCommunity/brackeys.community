import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import * as Y from "yjs";

import { SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { MemorySceneStore } from "../src/scene/store.ts";
import {
  addSolid,
  connectScene,
  newSceneId,
  sceneSynced,
  SECRET,
  type SceneClient,
  sleep,
  until,
} from "./harness.ts";

setDefaultTimeout(30_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };
const LIMITS = { maxEntities: 20, maxStateBytes: 16_000, maxMessageBytes: 4_000 };

describe("scene limits", () => {
  const store = new MemorySceneStore();
  const servers: SyncServer[] = [];
  const clients: SceneClient[] = [];
  const instance = async (id: string, debounceMs = 100) => {
    const server = await startServer({
      port: 0,
      secret: SECRET,
      sceneStore: store,
      sceneLimits: LIMITS,
      instanceId: id,
      telemetry: quiet,
      debounceMs,
      maxDebounceMs: Math.max(500, debounceMs),
    });
    servers.push(server);
    return server;
  };
  const open = (...args: Parameters<typeof connectScene>) => {
    const client = connectScene(...args);
    clients.push(client);
    return client;
  };
  const storedCount = (sceneId: string) => {
    const state = store.rows.get(sceneId)?.state;
    if (!state) return 0;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return doc.getMap("entities").size;
  };
  /** Gave up on 4413 and never came back. */
  const stayedAway = async (client: SceneClient) => {
    const authenticated = client.authentications();
    await sleep(1500);
    return client.stopped() === SYNC_CLOSE.tooLarge && client.authentications() === authenticated;
  };

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await Promise.all(servers.map((server) => server.stop(3000)));
  });

  it("refuses a store over the entity cap, closes everyone with 4413, and the clients stop", async () => {
    const server = await instance("limits-entities");
    const sceneId = newSceneId();
    store.create(sceneId);
    const a = open(server.port, sceneId, "alice");
    const b = open(server.port, sceneId, "bob");
    expect(await sceneSynced(a)).toBe(true);
    expect(await sceneSynced(b)).toBe(true);

    for (let i = 0; i < LIMITS.maxEntities; i++) addSolid(a.doc, `ok-${i}`, i);
    expect(await until(() => storedCount(sceneId) === LIMITS.maxEntities, 5000)).toBe(true);
    for (let i = 0; i < 5; i++) addSolid(a.doc, `over-${i}`, i);

    expect(
      await until(
        () => a.stopped() === SYNC_CLOSE.tooLarge && b.stopped() === SYNC_CLOSE.tooLarge,
        5000,
      ),
    ).toBe(true);
    expect(await stayedAway(a)).toBe(true);
    expect(await stayedAway(b)).toBe(true);
    expect(storedCount(sceneId)).toBe(LIMITS.maxEntities);
    expect(await until(() => !server.hocuspocus.documents.has(`scene:${sceneId}`), 3000)).toBe(
      true,
    );
  });

  it("closes a doc that grows past the byte cap live with 4413, before any store", async () => {
    const server = await instance("limits-bytes", 60_000);
    const sceneId = newSceneId();
    store.create(sceneId);
    const writer = open(server.port, sceneId, "alice");
    const peer = open(server.port, sceneId, "bob");
    expect(await sceneSynced(writer)).toBe(true);
    expect(await sceneSynced(peer)).toBe(true);
    const seeded = store.rows.get(sceneId)!.state;

    for (let i = 0; i < 20 && writer.stopped() === null; i++) {
      writer.doc.transact(() => {
        addSolid(writer.doc, `big-${i}`, i);
        writer.entities.get(`big-${i}`)!.set("note", "x".repeat(3_000));
      });
      await sleep(50);
    }
    expect(await until(() => writer.stopped() === SYNC_CLOSE.tooLarge, 5000)).toBe(true);
    expect(await until(() => peer.stopped() === SYNC_CLOSE.tooLarge, 5000)).toBe(true);
    expect(await stayedAway(writer)).toBe(true);
    expect(store.rows.get(sceneId)!.state).toEqual(seeded);
  });

  it("closes an oversize message with 4413 before anyone sees it", async () => {
    const server = await instance("limits-message");
    const sceneId = newSceneId();
    store.create(sceneId);
    const writer = open(server.port, sceneId, "alice");
    const peer = open(server.port, sceneId, "bob");
    expect(await sceneSynced(writer)).toBe(true);
    expect(await sceneSynced(peer)).toBe(true);

    writer.doc.transact(() => {
      addSolid(writer.doc, "huge", 1);
      writer.entities.get("huge")!.set("note", "x".repeat(LIMITS.maxMessageBytes + 100));
    });
    expect(await until(() => writer.stopped() === SYNC_CLOSE.tooLarge, 3000)).toBe(true);
    await sleep(300);
    expect(peer.entities.has("huge")).toBe(false);
    expect(peer.closes).toEqual([]);
    expect(await stayedAway(writer)).toBe(true);
  });
});

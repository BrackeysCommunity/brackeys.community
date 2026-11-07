import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import * as Y from "yjs";

import { syncEnvPrefix } from "../../../src/lib/canvas/sync-channels.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { createRedisExtension, redisChannels, redisLedger } from "../src/redis.ts";
import { MemorySceneStore } from "../src/scene/store.ts";
import { FakeRedis } from "./fake-redis.ts";
import {
  addSolid,
  connectScene,
  newSceneId,
  sceneOf,
  sceneSynced,
  SECRET,
  type SceneClient,
  TEST_REDIS_URL,
  until,
} from "./harness.ts";

setDefaultTimeout(60_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };

/**
 * A deploy overlaps the old instance and the new one for a few seconds, both
 * on the same Redis and the same store. Runs on the in-process fake Redis,
 * or a real one when CANVAS_SYNC_TEST_REDIS_URL is set.
 */
describe("two instances sharing Redis during a deploy", () => {
  const store = new MemorySceneStore();
  const fake = TEST_REDIS_URL ? null : new FakeRedis();
  const servers: SyncServer[] = [];
  const clients: SceneClient[] = [];
  let url = TEST_REDIS_URL ?? "";

  const instance = async (id: string, prefix: string) => {
    const server = await startServer({
      port: 0,
      secret: SECRET,
      sceneStore: store,
      instanceId: id,
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 500,
      redis: createRedisExtension(url, prefix, id),
      channels: redisChannels(url, prefix),
      ledger: redisLedger(url, prefix, id),
    });
    servers.push(server);
    return server;
  };
  const open = (...args: Parameters<typeof connectScene>) => {
    const client = connectScene(...args);
    clients.push(client);
    return client;
  };
  const storedScene = (sceneId: string) => {
    const state = store.rows.get(sceneId)?.state;
    if (!state) return null;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    return sceneOf(doc);
  };

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await Promise.all(servers.map((server) => server.stop(3000)));
    await fake?.stop();
  });

  it("converge: live across instances, then through the old one leaving", async () => {
    if (fake) url = (await fake.start()).url;
    const prefix = syncEnvPrefix(`deploy-${crypto.randomUUID().slice(0, 8)}`);
    const old = await instance("deploy-old", prefix);
    const next = await instance("deploy-new", prefix);
    const sceneId = newSceneId();
    store.create(sceneId);

    const a = open(old.port, sceneId, "alice");
    const b = open(next.port, sceneId, "bob");
    expect(await sceneSynced(a)).toBe(true);
    expect(await sceneSynced(b)).toBe(true);

    // Both live at once: each sees the other's edits before any reconnect.
    addSolid(a.doc, "on-old", 1);
    addSolid(b.doc, "on-new", 2);
    expect(await until(() => b.entities.has("on-old") && a.entities.has("on-new"), 8000)).toBe(
      true,
    );

    // The old instance drains: its pending store lands, its sockets drop.
    addSolid(a.doc, "while-draining", 3);
    expect(await until(() => b.entities.has("while-draining"), 8000)).toBe(true);
    await old.stop(5000);
    a.provider.disconnect();
    expect(store.rows.get(sceneId)!.state).not.toBeNull();

    // Edits made while between instances arrive with the reconnect.
    addSolid(a.doc, "offline", 4);
    a.entities.delete("on-new");
    const again = open(next.port, sceneId, "alice", { doc: a.doc });
    expect(await sceneSynced(again)).toBe(true);
    expect(await until(() => b.entities.has("offline") && !b.entities.has("on-new"), 8000)).toBe(
      true,
    );

    expect(sceneOf(a.doc)).toEqual(sceneOf(b.doc));
    expect([...b.entities.keys()].sort()).toEqual(["offline", "on-old", "while-draining"]);
    b.destroy();
    again.destroy();
    expect(await until(() => storedScene(sceneId)?.hash === sceneOf(a.doc)!.hash, 8000)).toBe(true);
  });
});

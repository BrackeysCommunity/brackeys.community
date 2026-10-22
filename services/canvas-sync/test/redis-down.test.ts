import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { createServer, type Server, type Socket } from "node:net";

import { syncEnvPrefix } from "../../../src/lib/canvas/sync-channels.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { createRedisExtension, redisChannels, redisLedger } from "../src/redis.ts";
import {
  addCard,
  connect,
  SECRET,
  seedCanvas,
  storedNodeIds,
  synced,
  TEST_DATABASE_URL,
  testDb,
  type TestClient,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(30_000);

/** Nothing listens here: Redis is down from the start. */
const DEAD_REDIS = "redis://127.0.0.1:1";

describe("the Redis ledger with Redis down", () => {
  it("fails open, fast", async () => {
    const ledger = redisLedger(DEAD_REDIS, syncEnvPrefix("test"), "dead");
    const started = performance.now();
    expect(await ledger.othersCount("alice")).toBe(0);
    await ledger.record("alice", 3);
    expect(performance.now() - started).toBeLessThan(2500);
    await ledger.close();
  });
});

if (!TEST_DATABASE_URL) warnSkipped("canvas-sync with Redis down", "CANVAS_SYNC_TEST_DATABASE_URL");

/**
 * The README and redis.ts say Redis is a relay and a soft cap: losing it
 * should cost cross-instance convergence and revokes, not editing itself.
 */
describe.skipIf(!TEST_DATABASE_URL)("canvas-sync with Redis down", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  const clients: TestClient[] = [];

  beforeAll(async () => {
    ({ db, end } = testDb());
    const prefix = syncEnvPrefix("test");
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "redis-down",
      telemetry: { captureException() {}, capture() {}, async shutdown() {} },
      debounceMs: 200,
      maxDebounceMs: 1000,
      redis: createRedisExtension(DEAD_REDIS, prefix, "redis-down"),
      channels: redisChannels(DEAD_REDIS, prefix),
      ledger: redisLedger(DEAD_REDIS, prefix, "redis-down"),
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    const stopped = await Promise.race([
      server.stop(3000).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
    ]);
    if (!stopped) console.warn("  !! stop() did not return within 8s with Redis down");
    await end();
  });

  it("still serves a canvas and stores its edits", async () => {
    const canvasId = await seedCanvas(db);
    const a = connect(server.port, canvasId, "alice");
    clients.push(a);
    const isSynced = await synced(a, 5000);
    console.log(`  Redis down: synced=${isSynced}`);
    expect(isSynced).toBe(true);
    addCard(a, "no-redis");
    expect(
      await until(async () => (await storedNodeIds(db, canvasId)).includes("no-redis"), 5000),
    ).toBe(true);
  });
});

/** Accepts connections and never answers: Redis hung rather than gone. */
async function blackhole(): Promise<{ url: string; close(): void }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `redis://127.0.0.1:${port}`,
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

describe.skipIf(!TEST_DATABASE_URL)("canvas-sync with Redis hung", () => {
  it("serves, stores and shuts down promptly", async () => {
    const hole = await blackhole();
    const { db, end } = testDb();
    const prefix = syncEnvPrefix("test");
    const server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "redis-hung",
      telemetry: { captureException() {}, capture() {}, async shutdown() {} },
      debounceMs: 30_000,
      maxDebounceMs: 60_000,
      redis: createRedisExtension(hole.url, prefix, "redis-hung"),
      channels: redisChannels(hole.url, prefix),
      ledger: redisLedger(hole.url, prefix, "redis-hung"),
    });
    const canvasId = await seedCanvas(db);
    const a = connect(server.port, canvasId, "alice");
    try {
      expect(await synced(a, 5000)).toBe(true);
      addCard(a, "hung");
      expect(await until(() => !a.provider.hasUnsyncedChanges, 3000)).toBe(true);
      // The store is still debounced: only the shutdown flush can write it.
      const started = performance.now();
      await server.stop(10_000);
      const ms = performance.now() - started;
      console.log(`  Redis hung: stop took ${ms.toFixed(0)}ms`);
      expect(ms).toBeLessThan(8000);
      expect(await storedNodeIds(db, canvasId)).toContain("hung");
    } finally {
      a.destroy();
      hole.close();
      await end();
    }
  });
});

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import IORedis from "ioredis";

import { SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { revokeChannel, SYNC_CLOSE, syncEnvPrefix } from "../../../src/lib/canvas/sync-channels.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { createRedisExtension, redisChannels, redisLedger } from "../src/redis.ts";
import {
  addCard,
  connect,
  SECRET,
  seedCanvas,
  sleep,
  storedNodeIds,
  synced,
  TEST_DATABASE_URL,
  TEST_REDIS_URL,
  testDb,
  type TestClient,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(30_000);

const enabled = Boolean(TEST_DATABASE_URL && TEST_REDIS_URL);
if (!enabled) {
  warnSkipped(
    "canvas-sync across instances over Redis",
    "CANVAS_SYNC_TEST_DATABASE_URL and CANVAS_SYNC_TEST_REDIS_URL",
  );
}

/** Two instances on one database and one Redis, as during a deploy overlap. */
describe.skipIf(!enabled)("canvas-sync across instances over Redis", () => {
  const prefix = syncEnvPrefix(`test-${crypto.randomUUID().slice(0, 8)}`);
  let db: ServiceDb;
  let end: () => Promise<void>;
  let one: SyncServer;
  let two: SyncServer;
  let publisher: IORedis;
  const clients: TestClient[] = [];
  const open = (...args: Parameters<typeof connect>) => {
    const client = connect(...args);
    clients.push(client);
    return client;
  };

  const instance = (id: string) =>
    startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: id,
      telemetry: { captureException() {}, capture() {}, async shutdown() {} },
      debounceMs: 200,
      maxDebounceMs: 1000,
      redis: createRedisExtension(TEST_REDIS_URL!, prefix, id),
      channels: redisChannels(TEST_REDIS_URL!, prefix),
      ledger: redisLedger(TEST_REDIS_URL!, prefix, id),
    });

  beforeAll(async () => {
    ({ db, end } = testDb());
    one = await instance("redis-one");
    two = await instance("redis-two");
    publisher = new IORedis(TEST_REDIS_URL!);
    // Let both subscribers come up before anything is published.
    await sleep(500);
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await Promise.all([one.stop(5000), two.stop(5000)]);
    publisher.disconnect();
    await end();
  });

  it("relays edits between instances live, before any reconnect", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(one.port, canvasId, "alice");
    const b = open(two.port, canvasId, "bob");
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    const started = performance.now();
    addCard(a, "from-one");
    expect(await until(() => b.nodes.has("from-one"), 2000)).toBe(true);
    console.log(`  relayed across instances in ${(performance.now() - started).toFixed(1)}ms`);
    addCard(b, "from-two");
    expect(await until(() => a.nodes.has("from-two"), 2000)).toBe(true);
    expect(a.closes).toEqual([]);
    expect(b.closes).toEqual([]);
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 2, 5000)).toBe(
      true,
    );
  });

  it("closes a revoked member on whichever instance holds them, within a second", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(one.port, canvasId, "alice");
    const b = open(two.port, canvasId, "bob");
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    const started = performance.now();
    await publisher.publish(revokeChannel(prefix), JSON.stringify({ canvasId, userId: "bob" }));
    expect(await until(() => b.closes.includes(SYNC_CLOSE.revoked), 1000)).toBe(true);
    console.log(`  revoke over Redis in ${(performance.now() - started).toFixed(1)}ms`);
    expect(a.closes).toEqual([]);
  });

  it("caps one person's connections across instances", async () => {
    const ids = await Promise.all(
      Array.from({ length: SYNC_LIMITS.connectionsPerUser }, () => seedCanvas(db)),
    );
    const mine = ids.map((id, i) => open(i % 2 ? two.port : one.port, id, "frank"));
    expect(await until(() => mine.every((c) => c.provider.isSynced), 10_000)).toBe(true);
    // Each instance writes its count to Redis once a connection is established.
    await sleep(300);
    const extra = open(one.port, await seedCanvas(db), "frank");
    expect(await until(() => extra.authFailures.length > 0, 3000)).toBe(true);
    expect(extra.authFailures[0]).toStartWith(`${SYNC_CLOSE.rateLimited}`);
  });
});

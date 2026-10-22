import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import IORedis from "ioredis";

import { SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import {
  applyChannel,
  documentName,
  revokeChannel,
  SYNC_CLOSE,
  syncEnvPrefix,
} from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import {
  createRedisExtension,
  LEDGER_TTL_SECONDS,
  redisChannels,
  redisLedger,
} from "../src/redis.ts";
import { FakeRedis } from "./fake-redis.ts";
import {
  addCard,
  connect,
  SECRET,
  seedCanvas,
  sleep,
  storedNodeIds,
  synced,
  TEST_DATABASE_URL,
  testDb,
  type TestClient,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(60_000);

if (!TEST_DATABASE_URL)
  warnSkipped("canvas-sync over a relay Redis", "CANVAS_SYNC_TEST_DATABASE_URL");

const quiet = { captureException() {}, capture() {}, async shutdown() {} };

/**
 * Two instances on one database, relaying through an in-process RESP
 * server that can go down, hang and come back: the deploy overlap and the
 * outage paths the real-Redis suite can't stage.
 */
describe.skipIf(!TEST_DATABASE_URL)("canvas-sync over a relay Redis that comes and goes", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  const redis = new FakeRedis();
  const servers: SyncServer[] = [];
  const clients: TestClient[] = [];
  const open = (...args: Parameters<typeof connect>) => {
    const client = connect(...args);
    clients.push(client);
    return client;
  };

  async function instance(id: string, prefix: string, debounceMs = 200): Promise<SyncServer> {
    const server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: id,
      telemetry: quiet,
      debounceMs,
      maxDebounceMs: Math.max(1000, debounceMs),
      redis: createRedisExtension(redis.url, prefix, id),
      channels: redisChannels(redis.url, prefix),
      ledger: redisLedger(redis.url, prefix, id),
    });
    servers.push(server);
    return server;
  }

  const newPrefix = () => syncEnvPrefix(`relay-${crypto.randomUUID().slice(0, 8)}`);

  beforeAll(async () => {
    ({ db, end } = testDb());
    await redis.start();
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    redis.hung = false;
    if (!redis.connectedClients) await redis.start().catch(() => {});
    await Promise.all(servers.map((s) => s.stop(5000)));
    await redis.stop();
    await end();
  });

  it("two instances started while Redis is down converge, without a reconnect, once it comes up", async () => {
    const port = redis.port;
    await redis.stop();
    const prefix = newPrefix();
    // Stores merge the row back into the live doc, so instances also converge
    // through Postgres; a long debounce keeps that out of the picture.
    const one = await instance("late-one", prefix, 30_000);
    const two = await instance("late-two", prefix, 30_000);
    const canvasId = await seedCanvas(db);
    const a = open(one.port, canvasId, "alice");
    const b = open(two.port, canvasId, "bob");
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    addCard(a, "a-offline-relay");
    addCard(b, "b-offline-relay");
    await sleep(500);
    // No relay yet: each instance holds only its own client's card.
    expect(b.nodes.has("a-offline-relay")).toBe(false);
    expect(a.nodes.has("b-offline-relay")).toBe(false);

    await redis.start(port);
    const started = performance.now();
    expect(
      await until(() => a.nodes.has("b-offline-relay") && b.nodes.has("a-offline-relay"), 15_000),
    ).toBe(true);
    console.log(`  converged ${(performance.now() - started).toFixed(0)}ms after Redis came up`);
    expect(a.closes).toEqual([]);
    expect(b.closes).toEqual([]);

    // And from then on, live.
    const live = performance.now();
    addCard(b, "b-live");
    expect(await until(() => a.nodes.has("b-live"), 1000)).toBe(true);
    console.log(`  then relayed live in ${(performance.now() - live).toFixed(1)}ms`);
    for (const server of [one, two]) {
      servers.splice(servers.indexOf(server), 1);
      await server.stop(10_000);
    }
    expect(await storedNodeIds(db, canvasId)).toEqual([
      "a-offline-relay",
      "b-live",
      "b-offline-relay",
    ]);
  });

  it("an outage mid-session keeps both instances storing, and they converge when it ends", async () => {
    const prefix = newPrefix();
    const one = await instance("blip-one", prefix, 30_000);
    const two = await instance("blip-two", prefix, 30_000);
    await sleep(300);
    const canvasId = await seedCanvas(db);
    const a = open(one.port, canvasId, "alice");
    const b = open(two.port, canvasId, "bob");
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    addCard(a, "before");
    expect(await until(() => b.nodes.has("before"), 2000)).toBe(true);

    const port = redis.port;
    await redis.stop();
    addCard(a, "during-a");
    addCard(b, "during-b");
    await sleep(500);
    expect(b.nodes.has("during-a")).toBe(false);

    await redis.start(port);
    expect(await until(() => a.nodes.has("during-b") && b.nodes.has("during-a"), 15_000)).toBe(
      true,
    );
    expect(a.closes).toEqual([]);
    expect(b.closes).toEqual([]);
    // Each instance flushes on stop; the row lock merges them in Postgres.
    await redis.stop();
    await Promise.all(
      [one, two].map((server) => {
        servers.splice(servers.indexOf(server), 1);
        return server.stop(10_000);
      }),
    );
    await redis.start(port);
    expect(await storedNodeIds(db, canvasId)).toEqual(["before", "during-a", "during-b"]);
  });

  it("a hung Redis delays nothing past the relay timeout: loads, stores and stop() all finish", async () => {
    const prefix = newPrefix();
    const one = await instance("hung-one", prefix, 30_000);
    await sleep(300);
    const canvasId = await seedCanvas(db);
    redis.hung = true;
    const started = performance.now();
    const a = open(one.port, canvasId, "alice");
    expect(await synced(a, 10_000)).toBe(true);
    const syncedIn = performance.now() - started;
    console.log(`  first sync with Redis hung: ${syncedIn.toFixed(0)}ms`);
    expect(syncedIn).toBeLessThan(5000);
    for (let i = 0; i < 5; i++) addCard(a, `hung-${i}`);
    await until(() => !a.provider.hasUnsyncedChanges, 3000);
    // The 30s debounce is still pending; stop() must flush it with Redis hung.
    const stopping = performance.now();
    servers.splice(servers.indexOf(one), 1);
    await one.stop(10_000);
    const stopMs = performance.now() - stopping;
    console.log(`  stop() with Redis hung and a store pending: ${stopMs.toFixed(0)}ms`);
    expect(stopMs).toBeLessThan(8000);
    expect((await storedNodeIds(db, canvasId)).length).toBe(5);
    redis.hung = false;
  });

  it("deploy overlap: the stopping instance's pending edits reach the other live and in Postgres", async () => {
    const prefix = newPrefix();
    const old = await instance("overlap-old", prefix, 30_000);
    const next = await instance("overlap-new", prefix, 200);
    await sleep(300);
    const canvasId = await seedCanvas(db);
    const a = open(old.port, canvasId, "alice");
    const b = open(next.port, canvasId, "bob");
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    for (let i = 0; i < 10; i++) addCard(a, `old-${i}`);
    for (let i = 0; i < 10; i++) addCard(b, `new-${i}`);
    expect(await until(() => a.nodes.size === 20 && b.nodes.size === 20, 3000)).toBe(true);

    servers.splice(servers.indexOf(old), 1);
    await old.stop(10_000);
    // a's instance is gone; a client reconnecting to the new one gets everything.
    const moved = open(next.port, canvasId, "alice");
    expect(await synced(moved)).toBe(true);
    expect(moved.nodes.size).toBe(20);
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 20, 5000)).toBe(
      true,
    );
  });

  it("a revoke published once closes the user on every instance and refuses their old token on both", async () => {
    const prefix = newPrefix();
    const one = await instance("revoke-one", prefix);
    const two = await instance("revoke-two", prefix);
    await sleep(300);
    const canvasId = await seedCanvas(db);
    const name = documentName("canvas", canvasId);
    const bobToken = await signCanvasToken({ c: name, u: "bob", a: "write" }, SECRET);
    const a = open(one.port, canvasId, "alice");
    const b1 = open(one.port, canvasId, "bob", { token: async () => bobToken });
    const b2 = open(two.port, canvasId, "bob", { token: async () => bobToken });
    for (const c of [a, b1, b2]) expect(await synced(c)).toBe(true);

    const publisher = new IORedis(redis.url);
    try {
      const started = performance.now();
      expect(
        await publisher.publish(revokeChannel(prefix), JSON.stringify({ canvasId, userId: "bob" })),
      ).toBe(2);
      expect(
        await until(
          () => b1.closes.includes(SYNC_CLOSE.revoked) && b2.closes.includes(SYNC_CLOSE.revoked),
          1000,
        ),
      ).toBe(true);
      console.log(`  revoke on both instances in ${(performance.now() - started).toFixed(1)}ms`);
      expect(a.closes).toEqual([]);

      // The replay of the token bob already held, on either instance.
      for (const server of [one, two]) {
        const replay = open(server.port, canvasId, "bob", { token: async () => bobToken });
        expect(await until(() => replay.authFailures.length > 0, 3000)).toBe(true);
        expect(replay.authFailures[0]).toStartWith(`${SYNC_CLOSE.revoked}`);
        replay.destroy();
      }

      // An apply published once reaches both instances.
      const applied = { one: one.metrics.applies, two: two.metrics.applies };
      await publisher.publish(applyChannel(prefix), JSON.stringify({ canvasId }));
      expect(
        await until(
          () => one.metrics.applies > applied.one && two.metrics.applies > applied.two,
          2000,
        ),
      ).toBe(true);
    } finally {
      publisher.disconnect();
    }
  });

  it("the per-user cap spans instances, frees seats on leave, and an instance's count expires", async () => {
    const prefix = newPrefix();
    const one = await instance("cap-one", prefix);
    const two = await instance("cap-two", prefix);
    await sleep(300);
    const ids = await Promise.all(
      Array.from({ length: SYNC_LIMITS.connectionsPerUser }, () => seedCanvas(db)),
    );
    const mine = ids.map((id, i) => open(i % 2 ? two.port : one.port, id, "gina"));
    expect(await until(() => mine.every((c) => c.provider.isSynced), 10_000)).toBe(true);
    await sleep(300);

    const extra = open(two.port, await seedCanvas(db), "gina");
    expect(await until(() => extra.authFailures.length > 0, 3000)).toBe(true);
    expect(extra.authFailures[0]).toStartWith(`${SYNC_CLOSE.rateLimited}`);
    extra.destroy();

    // Every count key carries a TTL, so a crashed instance's seats come back.
    const countKeys = redis.keys().filter((k) => k.startsWith(`${prefix}:conns:gina:`));
    expect(countKeys.length).toBe(2);
    for (const key of [...countKeys, `${prefix}:conn-instances:gina`]) {
      const ttl = redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(LEDGER_TTL_SECONDS);
    }

    // Leaving on instance one frees a seat for a connect on instance two.
    mine[0]!.destroy();
    await sleep(300);
    const after = open(two.port, await seedCanvas(db), "gina");
    expect(await synced(after)).toBe(true);

    // A clean stop clears that instance's count.
    servers.splice(servers.indexOf(one), 1);
    await one.stop(5000);
    expect(redis.keys().filter((k) => k.endsWith(":cap-one"))).toEqual([]);
  });
});

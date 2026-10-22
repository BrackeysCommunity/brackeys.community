import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import IORedis from "ioredis";

import { readPresence, syncEnvPrefix } from "../../../src/lib/canvas/sync-channels.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { createRedisExtension, redisRoster } from "../src/redis.ts";
import type { PresenceRoster } from "../src/roster.ts";
import {
  connect,
  SECRET,
  seedCanvas,
  seedUser,
  synced,
  TEST_DATABASE_URL,
  TEST_REDIS_URL,
  testDb,
  type TestClient,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(30_000);

const noTelemetry = { captureException() {}, capture() {}, async shutdown() {} };

if (!TEST_DATABASE_URL) warnSkipped("canvas-sync presence", "CANVAS_SYNC_TEST_DATABASE_URL");

describe.skipIf(!TEST_DATABASE_URL)("presence on one instance", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  const recorded = new Map<string, string[]>();
  const roster: PresenceRoster = {
    record: (name, ids) => void recorded.set(name, ids),
    close: async () => {},
  };
  const clients: TestClient[] = [];
  const open = (...args: Parameters<typeof connect>) => {
    const client = connect(...args);
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    ({ db, end } = testDb());
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "presence-a",
      telemetry: noTelemetry,
      roster,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(5000);
    await end();
  });

  it("relays awareness between editors and drops a peer that leaves", async () => {
    const canvasId = await seedCanvas(db);
    await seedUser(db, "bob");
    const a = open(server.port, canvasId, "alice");
    const b = open(server.port, canvasId, "bob");
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);

    a.provider.awareness!.setLocalState({
      user: { id: "alice", name: "Alice" },
      pointer: { x: 10, y: 20 },
    });
    const seen = () =>
      [...b.provider.awareness!.getStates().values()].find(
        (s) => (s.user as { id?: string } | undefined)?.id === "alice",
      );
    expect(await until(() => seen()?.pointer?.x === 10, 2000)).toBe(true);

    a.provider.awareness!.setLocalStateField("pointer", { x: 11, y: 20 });
    expect(await until(() => seen()?.pointer?.x === 11, 2000)).toBe(true);

    a.destroy();
    expect(await until(() => seen() === undefined, 5000)).toBe(true);
  });

  it("records who is connected to each document, and clears it when they leave", async () => {
    const canvasId = await seedCanvas(db);
    await seedUser(db, "bob");
    const name = `canvas:${canvasId}`;
    const a = open(server.port, canvasId, "alice");
    const a2 = open(server.port, canvasId, "alice");
    const b = open(server.port, canvasId, "bob");
    await Promise.all([synced(a), synced(a2), synced(b)]);
    expect(await until(() => recorded.get(name)?.join() === "alice,bob", 2000)).toBe(true);

    b.destroy();
    expect(await until(() => recorded.get(name)?.join() === "alice", 2000)).toBe(true);
    a.destroy();
    a2.destroy();
    expect(await until(() => recorded.get(name)?.length === 0, 2000)).toBe(true);
  });
});

const withRedis = Boolean(TEST_DATABASE_URL && TEST_REDIS_URL);
if (!withRedis) {
  warnSkipped(
    "canvas-sync presence across instances",
    "CANVAS_SYNC_TEST_DATABASE_URL and CANVAS_SYNC_TEST_REDIS_URL",
  );
}

describe.skipIf(!withRedis)("presence across instances over Redis", () => {
  const prefix = syncEnvPrefix(`test-${crypto.randomUUID().slice(0, 8)}`);
  let db: ServiceDb;
  let end: () => Promise<void>;
  let one: SyncServer;
  let two: SyncServer;
  let reader: IORedis;
  const clients: TestClient[] = [];

  const start = (instanceId: string) =>
    startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId,
      telemetry: noTelemetry,
      redis: createRedisExtension(TEST_REDIS_URL!, prefix, instanceId),
      roster: redisRoster(TEST_REDIS_URL!, prefix, instanceId),
    });

  beforeAll(async () => {
    ({ db, end } = testDb());
    one = await start("one");
    two = await start("two");
    reader = new IORedis(TEST_REDIS_URL!);
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await one.stop(5000);
    await two.stop(5000);
    reader.disconnect();
    await end();
  });

  it("reads everyone on a canvas whichever instance they reached, and sees peers' awareness", async () => {
    const canvasId = await seedCanvas(db);
    await seedUser(db, "bob");
    const name = `canvas:${canvasId}`;
    const a = connect(one.port, canvasId, "alice");
    const b = connect(two.port, canvasId, "bob");
    clients.push(a, b);
    await Promise.all([synced(a), synced(b)]);

    const here = async () => (await readPresence(reader, prefix, [name])).get(name)?.sort().join();
    expect(await until(async () => (await here()) === "alice,bob", 3000)).toBe(true);

    b.provider.awareness!.setLocalState({
      user: { id: "bob", name: "Bob" },
      pointer: { x: 1, y: 2 },
    });
    expect(
      await until(
        () =>
          [...a.provider.awareness!.getStates().values()].some(
            (s) => (s.user as { id?: string } | undefined)?.id === "bob",
          ),
        3000,
      ),
    ).toBe(true);

    b.destroy();
    expect(await until(async () => (await here()) === "alice", 3000)).toBe(true);
  });
});

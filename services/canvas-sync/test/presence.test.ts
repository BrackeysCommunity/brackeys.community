import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import IORedis from "ioredis";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";

import { presenceColor } from "../../../src/lib/canvas/presence.ts";
import {
  documentName,
  readPresence,
  syncEnvPrefix,
} from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
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

  it("pins what a writer publishes to the face its token names", async () => {
    const canvasId = await seedCanvas(db);
    await seedUser(db, "bob");
    const a = open(server.port, canvasId, "alice", {
      token: () =>
        signCanvasToken(
          {
            c: documentName("canvas", canvasId),
            u: "alice",
            a: "write",
            n: "Alice",
            p: "https://cdn.test/alice.png",
          },
          SECRET,
        ),
    });
    const b = open(server.port, canvasId, "bob");
    await Promise.all([synced(a), synced(b)]);

    a.provider.awareness!.setLocalState({
      user: { id: "bob", name: "Bob", avatarUrl: "https://evil.test/x.png", color: "red;x:y" },
      pointer: { x: 5, y: 5 },
    });
    const fromA = () => b.provider.awareness!.getStates().get(a.doc.clientID);
    expect(await until(() => fromA()?.pointer?.x === 5, 2000)).toBe(true);
    expect(fromA()!.user).toEqual({
      id: "alice",
      name: "Alice",
      avatarUrl: "https://cdn.test/alice.png",
      ...presenceColor("alice"),
    });
  });

  it("drops a state for another connection's client id", async () => {
    const canvasId = await seedCanvas(db);
    await seedUser(db, "bob");
    await seedUser(db, "carol");
    const a = open(server.port, canvasId, "alice");
    const b = open(server.port, canvasId, "bob");
    const c = open(server.port, canvasId, "carol");
    await Promise.all([synced(a), synced(b), synced(c)]);
    b.provider.awareness!.setLocalState({ user: { id: "bob" }, pointer: { x: 1, y: 1 } });
    const bAt = () => c.provider.awareness!.getStates().get(b.doc.clientID)?.pointer?.x;
    expect(await until(() => bAt() === 1, 2000)).toBe(true);

    const forgedDoc = new Y.Doc();
    forgedDoc.clientID = b.doc.clientID;
    const forged = new Awareness(forgedDoc);
    for (let i = 0; i < 10; i++)
      forged.setLocalState({ user: { id: "bob" }, pointer: { x: 99, y: i } });
    applyAwarenessUpdate(
      a.provider.awareness!,
      encodeAwarenessUpdate(forged, [b.doc.clientID]),
      "forged",
    );
    a.provider.awareness!.setLocalStateField("pointer", { x: 2, y: 2 });
    const aAt = () => c.provider.awareness!.getStates().get(a.doc.clientID)?.pointer?.x;
    expect(await until(() => aAt() === 2, 2000)).toBe(true);
    expect(bAt()).toBe(1);
    forged.destroy();
    forgedDoc.destroy();
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

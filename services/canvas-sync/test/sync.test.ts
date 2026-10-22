import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { eq } from "drizzle-orm";
import * as Y from "yjs";

import { canvasDocs, canvases, canvasDocVersions } from "../../../src/db/schema.ts";
import { CANVAS_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import {
  addCard,
  canvasRow,
  connect,
  SECRET,
  seedCanvas,
  seedUser,
  sleep,
  storedNodeIds,
  storedState,
  synced,
  TEST_DATABASE_URL,
  testDb,
  type TestClient,
  until,
  versionCount,
  warnSkipped,
} from "./harness.ts";

const noTelemetry = { captureException() {}, capture() {}, async shutdown() {} };

if (!TEST_DATABASE_URL)
  warnSkipped("canvas-sync integration tests", "CANVAS_SYNC_TEST_DATABASE_URL");

describe.skipIf(!TEST_DATABASE_URL)("canvas-sync against Postgres", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  let clock = Date.now();
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
      instanceId: "test-a",
      telemetry: noTelemetry,
      debounceMs: 200,
      maxDebounceMs: 1000,
      now: () => clock,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(5000);
    await end();
  });

  it("answers /health", async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      documents: expect.any(Number),
      connections: expect.any(Number),
    });
  });

  it("relays edits between two clients and stores the merge", async () => {
    clock = Date.now();
    const canvasId = await seedCanvas(db);
    await seedUser(db, "bob");
    const a = open(server.port, canvasId, "alice");
    const b = open(server.port, canvasId, "bob");
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    const latencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      addCard(a, `a${i}`);
      expect(await until(() => b.nodes.has(`a${i}`), 1000)).toBe(true);
      latencies.push(performance.now() - started);
    }
    addCard(b, "from-b");
    expect(await until(() => a.nodes.has("from-b"), 1000)).toBe(true);
    latencies.sort((x, y) => x - y);
    console.log(`  A→B p50 ${latencies[10]!.toFixed(1)}ms, max ${latencies.at(-1)!.toFixed(1)}ms`);

    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 21, 3000)).toBe(
      true,
    );
    const row = await canvasRow(db, canvasId);
    expect(row.lastEditedById).toBe("bob");
    expect(row.byteSize).toBeGreaterThan(0);
  });

  it("keeps a reader's writes from peers and Postgres", async () => {
    const canvasId = await seedCanvas(db);
    const writer = open(server.port, canvasId, "alice");
    const reader = open(server.port, canvasId, "rita", { access: "read" });
    await synced(writer);
    await synced(reader);
    addCard(writer, "w");
    expect(await until(() => reader.nodes.has("w"))).toBe(true);
    addCard(reader, "from-reader");
    await sleep(600);
    expect(writer.nodes.has("from-reader")).toBe(false);
    expect(await storedNodeIds(db, canvasId)).toEqual(["w"]);
  });

  it("refuses forged, foreign, expired and deleted", async () => {
    const canvasId = await seedCanvas(db);
    const forged = open(server.port, canvasId, "mallory", { token: async () => "garbage.token" });
    const foreign = open(server.port, canvasId, "mallory", {
      token: () => signCanvasToken({ c: "canvas:someone-elses", u: "mallory", a: "write" }, SECRET),
    });
    const expired = open(server.port, canvasId, "mallory", {
      token: () =>
        signCanvasToken(
          { c: `canvas:${canvasId}`, u: "mallory", a: "write" },
          SECRET,
          Date.now() - 120_000,
        ),
    });
    for (const client of [forged, foreign, expired]) {
      expect(await until(() => client.authFailures.length > 0, 3000)).toBe(true);
      expect(client.authFailures[0]).toStartWith(`${SYNC_CLOSE.unauthorized}`);
    }

    const deleted = await seedCanvas(db);
    await db.update(canvases).set({ deletedAt: new Date() }).where(eq(canvases.id, deleted));
    const late = open(server.port, deleted, "alice");
    expect(await until(() => late.authFailures.length > 0, 3000)).toBe(true);
    expect(late.authFailures[0]).toStartWith(`${SYNC_CLOSE.revoked}`);
  });

  it("revokes one user's socket and leaves the other", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    const b = open(server.port, canvasId, "bob");
    await synced(a);
    await synced(b);
    const started = performance.now();
    expect(server.handleRevoke({ canvasId, userId: "bob" })).toBe(1);
    expect(await until(() => b.closes.includes(SYNC_CLOSE.revoked), 1000)).toBe(true);
    console.log(`  revoke reached the client in ${(performance.now() - started).toFixed(1)}ms`);
    expect(a.closes).toEqual([]);
    addCard(a, "after-revoke");
    expect(
      await until(async () => (await storedNodeIds(db, canvasId)).includes("after-revoke"), 3000),
    ).toBe(true);
  });

  it("refuses a token minted before a revoke, and only for whom it covers", async () => {
    const canvasId = await seedCanvas(db);
    const name = `canvas:${canvasId}`;
    const mint = (u: string) => signCanvasToken({ c: name, u, a: "write" }, SECRET, clock);
    const bobBefore = await mint("bob");
    const aliceBefore = await mint("alice");
    const b = open(server.port, canvasId, "bob", { token: async () => bobBefore });
    expect(await synced(b)).toBe(true);
    clock += 100;
    server.handleRevoke({ canvasId, userId: "bob" });
    expect(await until(() => b.closes.includes(SYNC_CLOSE.revoked), 1000)).toBe(true);

    // Replaying the token held before the revoke.
    const replay = open(server.port, canvasId, "bob", { token: async () => bobBefore });
    expect(await until(() => replay.authFailures.length > 0, 3000)).toBe(true);
    expect(replay.authFailures[0]).toStartWith(`${SYNC_CLOSE.revoked}`);
    replay.destroy();

    // Someone else's older token is unaffected.
    const a = open(server.port, canvasId, "alice", { token: async () => aliceBefore });
    expect(await synced(a)).toBe(true);

    // A token minted once the revoke is safely past connects (access lives in the mint).
    clock += 3_000;
    const bobAfter = await mint("bob");
    const again = open(server.port, canvasId, "bob", { token: async () => bobAfter });
    expect(await synced(again)).toBe(true);
  });

  it("refuses older tokens after a canvas-wide or user-wide revoke", async () => {
    const canvasId = await seedCanvas(db);
    const other = await seedCanvas(db);
    const mint = (id: string, u: string) =>
      signCanvasToken({ c: `canvas:${id}`, u, a: "write" }, SECRET, clock);
    const carolOther = await mint(other, "carol");
    const daveHere = await mint(canvasId, "dave");
    const erinHere = await mint(canvasId, "erin");
    clock += 100;
    server.handleRevoke({ canvasId });
    server.handleRevoke({ userId: "carol" });
    for (const [id, user, token] of [
      [canvasId, "dave", daveHere],
      [canvasId, "erin", erinHere],
      [other, "carol", carolOther],
    ] as const) {
      const client = open(server.port, id, user, { token: async () => token });
      expect(await until(() => client.authFailures.length > 0, 3000)).toBe(true);
      expect(client.authFailures[0]).toStartWith(`${SYNC_CLOSE.revoked}`);
      client.destroy();
    }
    clock += 3_000;
  });

  it("closes an oversize message with 4413 before anyone sees it", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    const b = open(server.port, canvasId, "bob");
    await synced(a);
    await synced(b);
    addCard(a, "huge", "x".repeat(CANVAS_LIMITS.maxMessageBytes + 200 * 1024));
    expect(await until(() => a.closes.includes(SYNC_CLOSE.tooLarge), 3000)).toBe(true);
    await sleep(300);
    expect(b.nodes.has("huge")).toBe(false);
    expect(await storedNodeIds(db, canvasId)).toEqual([]);
  });

  it("closes a flood with 4429", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    await synced(a);
    for (let i = 0; i < 400; i++) a.nodes.set(`f${i}`, new Y.Map());
    expect(await until(() => a.closes.includes(SYNC_CLOSE.rateLimited), 3000)).toBe(true);
  });

  it("refuses the 51st connection on a canvas", async () => {
    const canvasId = await seedCanvas(db);
    const crowd: TestClient[] = [];
    for (let i = 0; i < 50; i++) crowd.push(open(server.port, canvasId, `u${i % 5}-${i}`));
    expect(await until(() => crowd.every((c) => c.provider.isSynced), 10_000)).toBe(true);
    const late = open(server.port, canvasId, "late");
    expect(await until(() => late.authFailures.length > 0, 3000)).toBe(true);
    expect(late.authFailures[0]).toStartWith(`${SYNC_CLOSE.rateLimited}`);
    for (const client of crowd) client.destroy();
  });

  it("refuses the 11th connection for one user", async () => {
    const ids = await Promise.all(Array.from({ length: 11 }, () => seedCanvas(db)));
    const mine = ids.slice(0, 10).map((id) => open(server.port, id, "busy"));
    expect(await until(() => mine.every((c) => c.provider.isSynced), 10_000)).toBe(true);
    const eleventh = open(server.port, ids[10]!, "busy");
    expect(await until(() => eleventh.authFailures.length > 0, 3000)).toBe(true);
    expect(eleventh.authFailures[0]).toStartWith(`${SYNC_CLOSE.rateLimited}`);
    for (const client of mine) client.destroy();
  });

  it("refuses a store over the card cap and closes the doc with 4413", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    const b = open(server.port, canvasId, "bob");
    await synced(a);
    await synced(b);
    addCard(a, "kept");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 1, 3000)).toBe(
      true,
    );
    const before = await storedState(db, canvasId);
    // Chunks under the message cap and the rate limit, slower than the debounce
    // so the store sees the whole lot at once only at the end.
    for (let chunk = 0; chunk < 11; chunk++) {
      a.doc.transact(() => {
        for (let i = 0; i < 200; i++) a.nodes.set(`n${chunk}-${i}`, new Y.Map());
      });
    }
    expect(
      await until(
        () => a.closes.includes(SYNC_CLOSE.tooLarge) && b.closes.includes(SYNC_CLOSE.tooLarge),
        5000,
      ),
    ).toBe(true);
    expect(await storedState(db, canvasId)).toEqual(before);
  });

  it("takes an hourly version only when the newest is over an hour old", async () => {
    clock = Date.now();
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    await synced(a);
    addCard(a, "v1");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 1, 3000)).toBe(
      true,
    );
    expect(await versionCount(db, canvasId)).toBe(0);

    addCard(a, "v2");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 2, 3000)).toBe(
      true,
    );
    expect(await versionCount(db, canvasId)).toBe(1);

    clock += 30 * 60 * 1000;
    addCard(a, "v3");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 3, 3000)).toBe(
      true,
    );
    expect(await versionCount(db, canvasId)).toBe(1);

    clock += 31 * 60 * 1000;
    addCard(a, "v4");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 4, 3000)).toBe(
      true,
    );
    expect(await versionCount(db, canvasId)).toBe(2);
  });

  it("writes the snapshot at most every 30s while live, and as the last person leaves", async () => {
    clock = Date.now();
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    await synced(a);
    addCard(a, "s1");
    expect(await until(async () => (await canvasRow(db, canvasId)).nodeCount === 1, 3000)).toBe(
      true,
    );

    clock += 5_000;
    addCard(a, "s2");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 2, 3000)).toBe(
      true,
    );
    expect((await canvasRow(db, canvasId)).nodeCount).toBe(1);

    clock += 30_000;
    addCard(a, "s3");
    expect(await until(async () => (await canvasRow(db, canvasId)).nodeCount === 3, 3000)).toBe(
      true,
    );

    clock += 1_000;
    addCard(a, "s4");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 4, 3000)).toBe(
      true,
    );
    expect((await canvasRow(db, canvasId)).nodeCount).toBe(3);
    a.destroy();
    expect(await until(async () => (await canvasRow(db, canvasId)).nodeCount === 4, 3000)).toBe(
      true,
    );
  });

  it("applies a server-side write to a connected client", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    await synced(a);
    addCard(a, "live");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 1, 3000)).toBe(
      true,
    );

    const restored = new Y.Doc();
    Y.applyUpdate(restored, (await storedState(db, canvasId))!);
    restored.getMap("nodes").set("from-server", new Y.Map());
    await db
      .update(canvasDocs)
      .set({ state: Buffer.from(Y.encodeStateAsUpdate(restored)) })
      .where(eq(canvasDocs.canvasId, canvasId));

    expect(await server.handleApply({ canvasId })).toBe(true);
    expect(await until(() => a.nodes.has("from-server"), 1000)).toBe(true);
  });

  it("merges a first store into a missing doc row", async () => {
    const canvasId = await seedCanvas(db);
    await db.delete(canvasDocs).where(eq(canvasDocs.canvasId, canvasId));
    const a = open(server.port, canvasId, "alice");
    await synced(a);
    addCard(a, "first");
    expect(
      await until(async () => (await storedNodeIds(db, canvasId)).includes("first"), 3000),
    ).toBe(true);
    await db.delete(canvasDocVersions).where(eq(canvasDocVersions.docId, canvasId));
  });
});

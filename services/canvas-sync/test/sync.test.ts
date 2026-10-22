import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { eq } from "drizzle-orm";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";

import { canvasDocs, canvases, canvasDocVersions, teams, user } from "../../../src/db/schema.ts";
import { CANVAS_LIMITS, SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import type { SyncChannelHandlers, SyncChannelSource } from "../src/redis.ts";
import {
  addCard,
  authFrame,
  canvasRow,
  connect,
  rawSocket,
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

setDefaultTimeout(30_000);

const noTelemetry = { captureException() {}, capture() {}, async shutdown() {} };

/** A token signed with the right secret but carrying whatever payload the test wants. */
async function rawToken(payload: unknown, secret = SECRET): Promise<string> {
  const b64 = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const body = b64(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${b64(new Uint8Array(sig))}`;
}

async function healthy(port: number): Promise<boolean> {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  return response.status === 200;
}

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

  it("answers /health with live counts, and 404 off it", async () => {
    expect((await fetch(`http://127.0.0.1:${server.port}/`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${server.port}/health/x`)).status).toBe(404);
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    expect(await synced(a)).toBe(true);
    const body = (await (await fetch(`http://127.0.0.1:${server.port}/health`)).json()) as {
      documents: number;
      connections: number;
    };
    expect(body).toEqual({ documents: expect.any(Number), connections: expect.any(Number) });
    expect(body.documents).toBeGreaterThanOrEqual(1);
    expect(body.connections).toBeGreaterThanOrEqual(1);
    a.destroy();
  });

  it("relays a card add, a move and a text edit both ways within 1s, and stores the result", async () => {
    clock = Date.now();
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    const b = open(server.port, canvasId, "bob");
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    const timed = async (label: string, change: () => void, seen: () => boolean) => {
      const started = performance.now();
      change();
      expect(await until(seen, 1000)).toBe(true);
      console.log(`  ${label}: ${(performance.now() - started).toFixed(1)}ms`);
    };
    const nodeOn = (client: TestClient, id: string) => client.nodes.get(id) as Y.Map<unknown>;
    await timed(
      "add A→B",
      () => addCard(a, "card", "hello"),
      () => b.nodes.has("card"),
    );
    await timed(
      "move B→A",
      () =>
        b.doc.transact(() => {
          nodeOn(b, "card").set("x", 420);
          nodeOn(b, "card").set("y", -80);
        }),
      () => nodeOn(a, "card").get("x") === 420 && nodeOn(a, "card").get("y") === -80,
    );
    await timed(
      "text A→B",
      () => (nodeOn(a, "card").get("text") as Y.Text).insert(5, " world"),
      () => (nodeOn(b, "card").get("text") as Y.Text).toString() === "hello world",
    );
    await timed(
      "concurrent text both ways",
      () => {
        (nodeOn(a, "card").get("text") as Y.Text).insert(0, "[a]");
        (nodeOn(b, "card").get("text") as Y.Text).insert(11, "[b]");
      },
      () =>
        (nodeOn(a, "card").get("text") as Y.Text).toString() ===
          (nodeOn(b, "card").get("text") as Y.Text).toString() &&
        (nodeOn(a, "card").get("text") as Y.Text).toString().includes("[a]") &&
        (nodeOn(a, "card").get("text") as Y.Text).toString().includes("[b]"),
    );
    const finalText = (nodeOn(a, "card").get("text") as Y.Text).toString();
    expect(
      await until(async () => {
        const state = await storedState(db, canvasId);
        if (!state) return false;
        const doc = new Y.Doc();
        Y.applyUpdate(doc, state);
        const node = doc.getMap("nodes").get("card") as Y.Map<unknown> | undefined;
        return node?.get("x") === 420 && (node.get("text") as Y.Text).toString() === finalText;
      }, 3000),
    ).toBe(true);
    a.destroy();
    b.destroy();
  });

  it("keeps a reader's offline content (sent in its first sync) from peers and Postgres", async () => {
    const canvasId = await seedCanvas(db);
    const writer = open(server.port, canvasId, "alice");
    expect(await synced(writer)).toBe(true);
    addCard(writer, "w");

    // The reader's doc already holds a card before it connects, so its
    // SyncStep2 carries a write.
    const readerDoc = new Y.Doc();
    const pre = new Y.Map<unknown>();
    readerDoc.getMap("nodes").set("smuggled", pre);
    const reader = open(server.port, canvasId, "rita", { access: "read" });
    Y.applyUpdate(reader.doc, Y.encodeStateAsUpdate(readerDoc));
    expect(await synced(reader)).toBe(true);
    expect(await until(() => reader.nodes.has("w"))).toBe(true);
    await sleep(700);
    expect(writer.nodes.has("smuggled")).toBe(false);
    expect(await storedNodeIds(db, canvasId)).toEqual(["w"]);
  });

  it("refuses a version-skewed token, a wrong secret, and a note document", async () => {
    const canvasId = await seedCanvas(db);
    const name = `canvas:${canvasId}`;
    const v2 = open(server.port, canvasId, "mallory", {
      token: () => rawToken({ c: name, u: "mallory", a: "write", e: Date.now() + 60_000, v: 2 }),
    });
    const wrongSecret = open(server.port, canvasId, "mallory", {
      token: () =>
        signCanvasToken({ c: name, u: "mallory", a: "write" }, "another-secret-entirely"),
    });
    const badAccess = open(server.port, canvasId, "mallory", {
      token: () => rawToken({ c: name, u: "mallory", a: "owner", e: Date.now() + 60_000, v: 1 }),
    });
    const note = open(server.port, canvasId, "alice", { name: `note:${canvasId}` });
    for (const client of [v2, wrongSecret, badAccess]) {
      expect(await until(() => client.authFailures.length > 0, 3000)).toBe(true);
      expect(client.authFailures[0]).toStartWith(`${SYNC_CLOSE.unauthorized}`);
      expect(client.provider.isSynced).toBe(false);
    }
    expect(await until(() => note.authFailures.length > 0, 3000)).toBe(true);
    expect(note.authFailures[0]).toStartWith(`${SYNC_CLOSE.revoked}`);
    for (const client of [v2, wrongSecret, badAccess, note]) client.destroy();
  });

  it("never admits more than 50 to one canvas, even when they all arrive at once", async () => {
    const canvasId = await seedCanvas(db);
    const crowd: TestClient[] = [];
    for (let i = 0; i < 60; i++) crowd.push(open(server.port, canvasId, `burst-${i}`));
    await until(
      () => crowd.filter((c) => c.provider.isSynced || c.authFailures.length > 0).length === 60,
      15_000,
    );
    const admitted = crowd.filter((c) => c.provider.isSynced).length;
    const refused = crowd.filter((c) => c.authFailures.length > 0).length;
    console.log(`  simultaneous 60: ${admitted} admitted, ${refused} refused`);
    expect(admitted).toBeLessThanOrEqual(SYNC_LIMITS.connectionsPerCanvas);
    expect(refused).toBeGreaterThanOrEqual(10);
    for (const client of crowd) client.destroy();
    await until(() => server.hocuspocus.getConnectionsCount() === 0, 5000);
  });

  it("never admits more than 10 for one user, even when they all arrive at once", async () => {
    const ids = await Promise.all(Array.from({ length: 15 }, () => seedCanvas(db)));
    const mine = ids.map((id) => open(server.port, id, "burst-user"));
    await until(
      () => mine.filter((c) => c.provider.isSynced || c.authFailures.length > 0).length === 15,
      15_000,
    );
    const admitted = mine.filter((c) => c.provider.isSynced).length;
    console.log(`  simultaneous 15 for one user: ${admitted} admitted`);
    expect(admitted).toBeLessThanOrEqual(SYNC_LIMITS.connectionsPerUser);
    for (const client of mine) client.destroy();
    await until(() => server.hocuspocus.getConnectionsCount() === 0, 5000);
  });

  it("frees a canvas seat when someone leaves", async () => {
    const canvasId = await seedCanvas(db);
    const crowd: TestClient[] = [];
    for (let i = 0; i < 50; i++) crowd.push(open(server.port, canvasId, `seat-${i}`));
    expect(await until(() => crowd.every((c) => c.provider.isSynced), 15_000)).toBe(true);
    crowd[0]!.destroy();
    await until(
      () =>
        (server.hocuspocus.documents.get(`canvas:${canvasId}`)?.getConnectionsCount() ?? 0) === 49,
    );
    const late = open(server.port, canvasId, "seat-late");
    expect(await synced(late, 5000)).toBe(true);
    expect(late.authFailures).toEqual([]);
    for (const client of [...crowd, late]) client.destroy();
    await until(() => server.hocuspocus.getConnectionsCount() === 0, 5000);
  });

  it("revokes by canvas, by user everywhere, and ignores an unknown canvas", async () => {
    const one = await seedCanvas(db);
    const two = await seedCanvas(db);
    const a1 = open(server.port, one, "alice");
    const b1 = open(server.port, one, "roaming-bob");
    const b2 = open(server.port, two, "roaming-bob");
    const c2 = open(server.port, two, "carol");
    for (const c of [a1, b1, b2, c2]) expect(await synced(c)).toBe(true);

    expect(server.handleRevoke({ canvasId: crypto.randomUUID() })).toBe(0);

    expect(server.handleRevoke({ userId: "roaming-bob" })).toBe(2);
    expect(
      await until(
        () => b1.closes.includes(SYNC_CLOSE.revoked) && b2.closes.includes(SYNC_CLOSE.revoked),
        1000,
      ),
    ).toBe(true);
    expect(a1.closes).toEqual([]);
    expect(c2.closes).toEqual([]);

    // The test clients reconnect on their own; wait for that before the next revoke.
    b1.destroy();
    b2.destroy();
    expect(server.handleRevoke({ canvasId: one })).toBe(1);
    expect(await until(() => a1.closes.includes(SYNC_CLOSE.revoked), 1000)).toBe(true);
    expect(c2.closes).toEqual([]);
    a1.destroy();
    c2.destroy();
  });

  it("survives garbage frames, an oversize unauthenticated frame and a frame over Bun's cap", async () => {
    const garbage = rawSocket(server.port);
    await until(() => garbage.state.open);
    garbage.socket.send(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x02]));
    garbage.socket.send(new Uint8Array(0));
    garbage.socket.send("not binary at all");
    await sleep(200);
    expect(await healthy(server.port)).toBe(true);

    const flooded = rawSocket(server.port);
    await until(() => flooded.state.open);
    // Unauthenticated, addressed to a document: Hocuspocus queues it until auth.
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, `canvas:${crypto.randomUUID()}`);
    encoding.writeVarUint(encoder, 0);
    encoding.writeUint8Array(encoder, new Uint8Array(6 * 1024 * 1024));
    flooded.socket.send(encoding.toUint8Array(encoder));
    expect(await until(() => flooded.state.closed !== null, 5000)).toBe(true);

    const huge = rawSocket(server.port);
    await until(() => huge.state.open);
    huge.socket.send(new Uint8Array(2 * CANVAS_LIMITS.maxStateBytes + 1024));
    expect(await until(() => huge.state.closed !== null, 5000)).toBe(true);
    console.log(`  over-cap frame closed with ${huge.state.closed?.code}`);

    expect(await healthy(server.port)).toBe(true);
    const canvasId = await seedCanvas(db);
    const fine = open(server.port, canvasId, "alice");
    expect(await synced(fine)).toBe(true);
    fine.destroy();
    garbage.socket.close();
  });

  // Bun drops a frame over its cap without a close code, so the server can't
  // tell the client to stop; the editor refuses to send such an update
  // instead (use-canvas-sync's size guard). Here: the server shrugs it off.
  it("drops an update over Bun's frame cap without harm to the server, the peer or Postgres", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    const b = open(server.port, canvasId, "bob");
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    addCard(a, "enormous", "z".repeat(2 * CANVAS_LIMITS.maxStateBytes + 1024));
    expect(await until(() => a.closes.length > 0, 5000)).toBe(true);
    a.destroy();
    await sleep(500);
    console.log(`  over-cap update: closes ${JSON.stringify(a.closes)}`);
    expect(a.closes).not.toContain(SYNC_CLOSE.tooLarge);
    expect(b.nodes.has("enormous")).toBe(false);
    expect(b.closes).toEqual([]);
    expect(await storedNodeIds(db, canvasId)).not.toContain("enormous");
    expect(await healthy(server.port)).toBe(true);
  });

  it("closes a session whose authenticated stream turns to garbage, and no one else", async () => {
    const canvasId = await seedCanvas(db);
    const peer = open(server.port, canvasId, "alice");
    expect(await synced(peer)).toBe(true);
    const name = `canvas:${canvasId}`;
    const raw = rawSocket(server.port);
    await until(() => raw.state.open);
    raw.socket.send(
      authFrame(name, await signCanvasToken({ c: name, u: "mallory", a: "write" }, SECRET)),
    );
    await until(
      () => (server.hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0) === 2,
      3000,
    );
    // A sync message with an unknown sync type.
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, name);
    encoding.writeVarUint(encoder, 0);
    encoding.writeVarUint(encoder, 99);
    raw.socket.send(encoding.toUint8Array(encoder));
    // A Yjs update that isn't one.
    const bad = encoding.createEncoder();
    encoding.writeVarString(bad, name);
    encoding.writeVarUint(bad, 0);
    encoding.writeVarUint(bad, 2);
    encoding.writeVarUint8Array(bad, new Uint8Array([1, 2, 3, 250, 250, 250]));
    raw.socket.send(encoding.toUint8Array(bad));
    await sleep(300);
    expect(peer.closes).toEqual([]);
    addCard(peer, "still-fine");
    expect(
      await until(async () => (await storedNodeIds(db, canvasId)).includes("still-fine"), 3000),
    ).toBe(true);
    expect(await healthy(server.port)).toBe(true);
    raw.socket.close();
    peer.destroy();
  });

  it("closes everyone with 4403 when the canvas row disappears under a live doc", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    expect(await synced(a)).toBe(true);
    addCard(a, "before");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 1, 3000)).toBe(
      true,
    );
    await db.delete(canvases).where(eq(canvases.id, canvasId));
    addCard(a, "after");
    expect(await until(() => a.closes.includes(SYNC_CLOSE.revoked), 3000)).toBe(true);
    expect(await storedState(db, canvasId)).toBeNull();
    expect(await healthy(server.port)).toBe(true);
    a.destroy();
  });

  it("stops storing into a canvas trashed under a live doc, even with no revoke", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    expect(await synced(a)).toBe(true);
    addCard(a, "before");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 1, 3000)).toBe(
      true,
    );
    await db.update(canvases).set({ deletedAt: new Date() }).where(eq(canvases.id, canvasId));
    addCard(a, "after");
    expect(await until(() => a.closes.includes(SYNC_CLOSE.revoked), 3000)).toBe(true);
    expect(await storedNodeIds(db, canvasId)).toEqual(["before"]);
    a.destroy();
  });

  it("refuses a store over 5 MB, keeps Postgres as it was and closes with 4413", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    const b = open(server.port, canvasId, "bob");
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    // Each card is just under the message cap; six of them pass 5 MB.
    const chunk = Math.floor(CANVAS_LIMITS.maxMessageBytes * 0.9);
    let lastGood: Uint8Array | null = null;
    for (let i = 0; i < 7 && !a.closes.includes(SYNC_CLOSE.tooLarge); i++) {
      addCard(a, `big${i}`, String.fromCharCode(97 + i).repeat(chunk));
      await until(
        async () =>
          (await storedNodeIds(db, canvasId)).includes(`big${i}`) ||
          a.closes.includes(SYNC_CLOSE.tooLarge),
        5000,
      );
      if (!a.closes.includes(SYNC_CLOSE.tooLarge)) lastGood = await storedState(db, canvasId);
    }
    expect(
      await until(
        () => a.closes.includes(SYNC_CLOSE.tooLarge) && b.closes.includes(SYNC_CLOSE.tooLarge),
        5000,
      ),
    ).toBe(true);
    const stored = await storedState(db, canvasId);
    expect(stored!.length).toBeLessThanOrEqual(CANVAS_LIMITS.maxStateBytes);
    expect(stored).toEqual(lastGood);
    expect((await canvasRow(db, canvasId)).byteSize).toBeLessThanOrEqual(
      CANVAS_LIMITS.maxStateBytes,
    );
    a.destroy();
    b.destroy();
    // The oversize doc was dropped: the next person gets what Postgres has.
    await until(() => !server.hocuspocus.documents.has(`canvas:${canvasId}`), 3000);
    const late = open(server.port, canvasId, "carol", { access: "read" });
    expect(await synced(late)).toBe(true);
    expect([...late.nodes.keys()].sort()).toEqual(await storedNodeIds(db, canvasId));
    late.destroy();
  });

  it("applies a stored deletion (a restore) to a connected client", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    expect(await synced(a)).toBe(true);
    addCard(a, "keep");
    addCard(a, "drop");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 2, 3000)).toBe(
      true,
    );
    const restored = new Y.Doc();
    Y.applyUpdate(restored, (await storedState(db, canvasId))!);
    restored.getMap("nodes").delete("drop");
    await db
      .update(canvasDocs)
      .set({ state: Buffer.from(Y.encodeStateAsUpdate(restored)) })
      .where(eq(canvasDocs.canvasId, canvasId));
    expect(await server.handleApply({ canvasId })).toBe(true);
    expect(await until(() => !a.nodes.has("drop"), 1000)).toBe(true);
    expect(a.nodes.has("keep")).toBe(true);
    // And the apply doesn't resurrect it at the next store.
    addCard(a, "later");
    expect(
      await until(async () => (await storedNodeIds(db, canvasId)).includes("later"), 3000),
    ).toBe(true);
    expect(await storedNodeIds(db, canvasId)).toEqual(["keep", "later"]);
    expect(await server.handleApply({ canvasId: crypto.randomUUID() })).toBe(false);
    a.destroy();
  });

  it("keeps storing after the last editor's account is deleted", async () => {
    const canvasId = await seedCanvas(db);
    await seedUser(db, "ghost");
    const ghost = open(server.port, canvasId, "ghost");
    expect(await synced(ghost)).toBe(true);
    addCard(ghost, "g1");
    expect(
      await until(async () => (await canvasRow(db, canvasId)).lastEditedById === "ghost", 3000),
    ).toBe(true);
    await db.delete(user).where(eq(user.id, "ghost"));
    const failuresBefore = server.metrics.storeFailures;
    addCard(ghost, "g2");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).includes("g2"), 3000)).toBe(
      true,
    );
    expect(server.metrics.storeFailures).toBe(failuresBefore);
    expect((await canvasRow(db, canvasId)).lastEditedById).toBeNull();
    ghost.destroy();
  });

  it("touches the team's last activity at most every 10 minutes", async () => {
    clock = Date.now();
    await seedUser(db, "alice");
    const teamId = crypto.randomUUID();
    const old = new Date(Date.now() - 24 * 3600 * 1000);
    await db.insert(teams).values({
      id: teamId,
      slug: `t-${teamId.slice(0, 8)}`,
      name: "Team",
      createdBy: "alice",
      lastActivityAt: old,
    });
    const canvasId = crypto.randomUUID();
    await db.insert(canvases).values({ id: canvasId, teamId, ownerId: "alice", path: "T.canvas" });
    const a = open(server.port, canvasId, "alice");
    expect(await synced(a)).toBe(true);
    addCard(a, "t1");
    const touched = async () => {
      const [row] = await db.select().from(teams).where(eq(teams.id, teamId));
      return row!.lastActivityAt.getTime();
    };
    expect(await until(async () => (await touched()) > old.getTime(), 3000)).toBe(true);
    const first = await touched();

    clock += 5 * 60 * 1000;
    addCard(a, "t2");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).includes("t2"), 3000)).toBe(
      true,
    );
    expect(await touched()).toBe(first);

    clock += 6 * 60 * 1000;
    addCard(a, "t3");
    expect(await until(async () => (await touched()) > first, 3000)).toBe(true);
    a.destroy();
    // Tokens are checked against the same clock.
    clock = Date.now();
  });

  it("rate-limits awareness floods too", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    expect(await synced(a)).toBe(true);
    for (let i = 0; i < 400; i++) a.provider.setAwarenessField("cursor", { x: i, y: i });
    expect(await until(() => a.closes.includes(SYNC_CLOSE.rateLimited), 3000)).toBe(true);
    a.destroy();
  });

  it("lets a steady editor well under 60/s keep going", async () => {
    const canvasId = await seedCanvas(db);
    const a = open(server.port, canvasId, "alice");
    expect(await synced(a)).toBe(true);
    // 300 messages at ~40/s: more than the burst, slower than the refill.
    for (let i = 0; i < 300; i++) {
      // The server's clock is the test's; let it run.
      clock = Date.now();
      a.nodes.set(`s${i}`, new Y.Map());
      await sleep(25);
    }
    expect(a.closes).toEqual([]);
    a.destroy();
  });
});

describe.skipIf(!TEST_DATABASE_URL)(
  "canvas-sync revoke and apply through its channel source",
  () => {
    let db: ServiceDb;
    let end: () => Promise<void>;
    let server: SyncServer;
    let handlers: SyncChannelHandlers | null = null;
    let stopped = false;
    const channels: SyncChannelSource = {
      async start(h) {
        handlers = h;
        return async () => {
          stopped = true;
        };
      },
    };

    beforeAll(async () => {
      ({ db, end } = testDb());
      server = await startServer({
        port: 0,
        secret: SECRET,
        db,
        instanceId: "channels",
        telemetry: noTelemetry,
        debounceMs: 200,
        maxDebounceMs: 1000,
        channels,
      });
    });

    afterAll(async () => {
      await server.stop(5000);
      expect(stopped).toBe(true);
      await end();
    });

    it("closes a revoked member within a second and leaves the rest", async () => {
      const canvasId = await seedCanvas(db);
      const a = connect(server.port, canvasId, "alice");
      const b = connect(server.port, canvasId, "bob");
      expect(await synced(a)).toBe(true);
      expect(await synced(b)).toBe(true);
      const started = performance.now();
      handlers!.revoke({ canvasId, userId: "bob" });
      expect(await until(() => b.closes.includes(SYNC_CLOSE.revoked), 1000)).toBe(true);
      console.log(
        `  channel revoke → client close in ${(performance.now() - started).toFixed(1)}ms`,
      );
      expect(a.closes).toEqual([]);
      a.destroy();
      b.destroy();
    });

    it("loads a server-side write announced on the apply channel into connected editors", async () => {
      const canvasId = await seedCanvas(db);
      const a = connect(server.port, canvasId, "alice");
      const b = connect(server.port, canvasId, "bob", { access: "read" });
      expect(await synced(a)).toBe(true);
      expect(await synced(b)).toBe(true);
      addCard(a, "live");
      expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 1, 3000)).toBe(
        true,
      );
      const solo = new Y.Doc();
      Y.applyUpdate(solo, (await storedState(db, canvasId))!);
      solo.getMap("nodes").set("solo-save", new Y.Map());
      await db
        .update(canvasDocs)
        .set({ state: Buffer.from(Y.encodeStateAsUpdate(solo)) })
        .where(eq(canvasDocs.canvasId, canvasId));
      const started = performance.now();
      handlers!.apply({ canvasId });
      expect(await until(() => a.nodes.has("solo-save") && b.nodes.has("solo-save"), 1000)).toBe(
        true,
      );
      console.log(
        `  channel apply → both clients in ${(performance.now() - started).toFixed(1)}ms`,
      );
      a.destroy();
      b.destroy();
    });
  },
);

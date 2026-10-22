import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";

import { CANVAS_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { documentName, SYNC_CLOSE, syncCloseCode } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import {
  addCard,
  authFrame,
  connect,
  rawSocket,
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

setDefaultTimeout(90_000);

if (!TEST_DATABASE_URL) warnSkipped("live doc growth caps", "CANVAS_SYNC_TEST_DATABASE_URL");

const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;
const MESSAGE_CLOSE = 7;

function syncFrame(name: string, step: number, update: Uint8Array): Uint8Array<ArrayBuffer> {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, name);
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarUint(encoder, step);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** A writer that skips the provider and sends whatever updates it likes. */
async function rawWriter(server: SyncServer, canvasId: string) {
  const name = documentName("canvas", canvasId);
  const raw = rawSocket(server.port);
  await until(() => raw.state.open);
  raw.socket.send(
    authFrame(name, await signCanvasToken({ c: name, u: "mallory", a: "write" }, SECRET)),
  );
  // A refusal closes this document's connection with a Close message; the socket stays open.
  const closes: (number | null)[] = [];
  raw.socket.addEventListener("message", (event) => {
    const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
    decoding.readVarString(decoder);
    if (decoding.readVarUint(decoder) !== MESSAGE_CLOSE) return;
    closes.push(syncCloseCode({ code: 1000, reason: decoding.readVarString(decoder) }));
  });
  const doc = new Y.Doc();
  /** A valid update adding one card of `bytes` distinct characters. */
  const card = (id: string, bytes: number): Uint8Array => {
    const before = Y.encodeStateVector(doc);
    const text = Array.from({ length: bytes }, (_, i) =>
      String.fromCharCode(97 + ((i * 7 + id.length) % 26)),
    ).join("");
    doc.transact(() => {
      const node = new Y.Map<unknown>();
      node.set("type", "text");
      node.set("text", new Y.Text(text));
      doc.getMap("nodes").set(id, node);
    });
    return Y.encodeStateAsUpdate(doc, before);
  };
  return { name, raw, card, closes };
}

/** A standalone update adding one text card of `bytes` distinct characters. */
function bigCard(id: string, bytes: number): Uint8Array {
  const doc = new Y.Doc();
  const text = Array.from({ length: bytes }, (_, i) =>
    String.fromCharCode(97 + ((i * 7 + id.length * 3) % 26)),
  ).join("");
  doc.transact(() => {
    const node = new Y.Map<unknown>();
    node.set("type", "text");
    node.set("text", new Y.Text(text));
    doc.getMap("nodes").set(id, node);
  });
  return Y.encodeStateAsUpdate(doc);
}

async function authedRaw(server: SyncServer, name: string, userId: string) {
  const raw = rawSocket(server.port);
  await until(() => raw.state.open);
  raw.socket.send(
    authFrame(name, await signCanvasToken({ c: name, u: userId, a: "write" }, SECRET)),
  );
  return raw;
}

describe.skipIf(!TEST_DATABASE_URL)("live doc growth", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  const clients: TestClient[] = [];

  beforeAll(async () => {
    ({ db, end } = testDb());
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "growth",
      telemetry: { captureException() {}, capture() {}, async shutdown() {} },
      // Long enough that no store runs mid-test: only the live guard can stop the growth.
      debounceMs: 30_000,
      maxDebounceMs: 60_000,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(10_000);
    await end();
  });

  const liveBytes = (name: string) => {
    const doc = server.hocuspocus.documents.get(name);
    return doc ? Y.encodeStateAsUpdate(doc).byteLength : 0;
  };

  it("allows one whole-canvas sync step 2 per connection, and the message cap after it", async () => {
    const canvasId = await seedCanvas(db);
    const peer = connect(server.port, canvasId, "alice");
    clients.push(peer);
    expect(await synced(peer)).toBe(true);
    const writer = await rawWriter(server, canvasId);
    await until(
      () => (server.hocuspocus.documents.get(writer.name)?.getConnectionsCount() ?? 0) === 2,
      3000,
    );

    writer.raw.socket.send(syncFrame(writer.name, SYNC_STEP_2, writer.card("backlog", 3_000_000)));
    expect(await until(() => peer.nodes.has("backlog"), 5000)).toBe(true);

    writer.raw.socket.send(syncFrame(writer.name, SYNC_STEP_2, writer.card("again", 2_000_000)));
    expect(await until(() => writer.closes.length > 0, 3000)).toBe(true);
    expect(writer.closes).toEqual([SYNC_CLOSE.tooLarge]);
    await sleep(200);
    expect(peer.nodes.has("again")).toBe(false);
    expect(peer.closes).toEqual([]);
    writer.raw.socket.close();
    peer.destroy();
  });

  it("closes the doc with 4413 once it passes 5 MB live, before any store, and keeps Postgres as it was", async () => {
    const canvasId = await seedCanvas(db);
    const peer = connect(server.port, canvasId, "alice");
    clients.push(peer);
    expect(await synced(peer)).toBe(true);
    const writer = await rawWriter(server, canvasId);
    await until(
      () => (server.hocuspocus.documents.get(writer.name)?.getConnectionsCount() ?? 0) === 2,
      3000,
    );

    const chunk = Math.floor(CANVAS_LIMITS.maxMessageBytes * 0.9);
    let sent = 0;
    for (; sent < 30 && writer.closes.length === 0; sent++) {
      writer.raw.socket.send(syncFrame(writer.name, SYNC_UPDATE, writer.card(`big${sent}`, chunk)));
      await sleep(40);
    }
    expect(await until(() => writer.closes.length > 0, 3000)).toBe(true);
    expect(writer.closes).toEqual([SYNC_CLOSE.tooLarge]);
    expect(await until(() => peer.closes.includes(SYNC_CLOSE.tooLarge), 3000)).toBe(true);
    const received = peer.nodes.size;
    console.log(`  growth guard: sent ${sent}, peer received ${received}`);
    // At most the cap's worth past the cap, plus the message that crossed it.
    expect(received * chunk).toBeLessThanOrEqual(2 * CANVAS_LIMITS.maxStateBytes + chunk);
    expect(sent).toBeLessThan(30);
    writer.raw.socket.close();
    peer.destroy();
    expect(await until(() => !server.hocuspocus.documents.has(writer.name), 5000)).toBe(true);
    expect(await storedNodeIds(db, canvasId)).toEqual([]);
  });

  it("ten writers each sending a 4 MB first step 2 at the same moment can't take the doc far past the cap", async () => {
    const canvasId = await seedCanvas(db);
    const name = documentName("canvas", canvasId);
    const peer = connect(server.port, canvasId, "alice");
    clients.push(peer);
    expect(await synced(peer)).toBe(true);
    const writers = await Promise.all(
      Array.from({ length: 10 }, (_, i) => authedRaw(server, name, `crowd${i}`)),
    );
    await until(() => (server.hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0) === 11);
    const frames = writers.map((_, i) => syncFrame(name, SYNC_STEP_2, bigCard(`w${i}`, 4_000_000)));
    let peak = 0;
    const sampler = setInterval(() => (peak = Math.max(peak, liveBytes(name))), 5);
    writers.forEach((w, i) => w.socket.send(frames[i]!));
    await until(() => peer.closes.includes(SYNC_CLOSE.tooLarge), 8000);
    await sleep(500);
    clearInterval(sampler);
    console.log(
      `  concurrent step 2s: peak live doc ${(peak / 1e6).toFixed(1)} MB, peer received ${peer.nodes.size}, peer closes ${JSON.stringify(peer.closes)}`,
    );
    expect(peer.closes).toContain(SYNC_CLOSE.tooLarge);
    expect(peak).toBeLessThanOrEqual(2 * CANVAS_LIMITS.maxStateBytes + 4_100_000);
    for (const w of writers) w.socket.close();
    peer.destroy();
    expect(await until(() => !server.hocuspocus.documents.has(name), 10_000)).toBe(true);
    expect(await storedNodeIds(db, canvasId)).toEqual([]);
  });

  it("a writer reconnecting for a fresh first step 2 each time is still stopped by the doc guard", async () => {
    const canvasId = await seedCanvas(db);
    const name = documentName("canvas", canvasId);
    const peer = connect(server.port, canvasId, "alice");
    clients.push(peer);
    expect(await synced(peer)).toBe(true);
    let peak = 0;
    let attempts = 0;
    for (; attempts < 6 && !peer.closes.includes(SYNC_CLOSE.tooLarge); attempts++) {
      const w = await authedRaw(server, name, "mallory");
      await until(() => (server.hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0) === 2);
      w.socket.send(syncFrame(name, SYNC_STEP_2, bigCard(`r${attempts}`, 3_000_000)));
      await sleep(400);
      peak = Math.max(peak, liveBytes(name));
      w.socket.close();
      await sleep(100);
    }
    console.log(
      `  reconnecting writer: ${attempts} attempts, peak ${(peak / 1e6).toFixed(1)} MB, peer received ${peer.nodes.size}`,
    );
    expect(peer.closes).toContain(SYNC_CLOSE.tooLarge);
    expect(peak).toBeLessThanOrEqual(2 * CANVAS_LIMITS.maxStateBytes + 3_100_000);
    peer.destroy();
  });

  it("heavy legitimate editing of a 4 MB canvas (rewriting a big card over and over) never trips the guard", async () => {
    const canvasId = await seedCanvas(db);
    const a = connect(server.port, canvasId, "alice");
    const b = connect(server.port, canvasId, "bob");
    clients.push(a, b);
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    // 4 MB of content in 0.8 MB cards: under the per-message cap each.
    for (let i = 0; i < 5; i++) {
      Y.applyUpdate(a.doc, bigCard(`base${i}`, 800_000));
      await sleep(150);
    }
    expect(await until(() => b.nodes.size === 5, 10_000)).toBe(true);
    // ~30 rewrites of a 300 KB card: about 9 MB of traffic, the doc stays near 4.3 MB.
    addCard(a, "draft", "x");
    const text = () => a.nodes.get("draft")!.get("text") as Y.Text;
    for (let i = 0; i < 30; i++) {
      a.doc.transact(() => {
        text().delete(0, text().length);
        text().insert(0, String.fromCharCode(97 + (i % 26)).repeat(300_000));
      });
      await sleep(60);
    }
    expect(await until(() => !a.provider.hasUnsyncedChanges, 10_000)).toBe(true);
    const name = documentName("canvas", canvasId);
    console.log(`  heavy editing: live doc ${(liveBytes(name) / 1e6).toFixed(2)} MB`);
    expect(a.closes).toEqual([]);
    expect(b.closes).toEqual([]);
    expect(
      await until(
        () => (b.nodes.get("draft")?.get("text") as Y.Text | undefined)?.length === 300_000,
        5000,
      ),
    ).toBe(true);
    a.destroy();
    b.destroy();
    expect(await until(() => !server.hocuspocus.documents.has(name), 10_000)).toBe(true);
    expect((await storedNodeIds(db, canvasId)).length).toBe(6);
  });
});

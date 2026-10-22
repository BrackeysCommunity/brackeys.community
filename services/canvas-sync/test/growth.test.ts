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

setDefaultTimeout(60_000);

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
    await server.stop(5000);
    await end();
  });

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
});

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import * as encoding from "lib0/encoding";
import * as Y from "yjs";

import type { RevokeMessage } from "../../../src/lib/canvas/sync-channels.ts";
import {
  documentName,
  REVOKE_CLOCK_SKEW_MS,
  SYNC_CLOSE,
} from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken, type SyncAccess } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import type { UserConnectionLedger } from "../src/limits.ts";
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

setDefaultTimeout(30_000);

if (!TEST_DATABASE_URL) warnSkipped("revoke variants", "CANVAS_SYNC_TEST_DATABASE_URL");

/** A sync update frame (messageSync, update) carrying `update`. */
function updateFrame(name: string, update: Uint8Array): Uint8Array<ArrayBuffer> {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, name);
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

function cardUpdate(id: string): Uint8Array {
  const doc = new Y.Doc();
  doc.transact(() => {
    const node = new Y.Map<unknown>();
    node.set("type", "text");
    node.set("text", new Y.Text(id));
    doc.getMap("nodes").set(id, node);
  });
  return Y.encodeStateAsUpdate(doc);
}

describe.skipIf(!TEST_DATABASE_URL)("revokes racing a connect, other shapes", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  let ledgerDelayMs = 0;
  let onLedger: ((userId: string) => void) | null = null;
  const clients: TestClient[] = [];

  const slowLedger: UserConnectionLedger = {
    async othersCount(userId) {
      onLedger?.(userId);
      await sleep(ledgerDelayMs);
      return 0;
    },
    async record() {},
    async close() {},
  };

  beforeAll(async () => {
    ({ db, end } = testDb());
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "revoke-variants",
      telemetry: { captureException() {}, capture() {}, async shutdown() {} },
      debounceMs: 200,
      maxDebounceMs: 1000,
      ledger: slowLedger,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(5000);
    await end();
  });

  /** Connects `userId`, and lands `message` 100ms into its 400ms ledger read. */
  async function connectWhileRevoked(
    canvasId: string,
    userId: string,
    message: RevokeMessage,
    access: SyncAccess = "write",
  ) {
    const name = documentName("canvas", canvasId);
    const token = await signCanvasToken({ c: name, u: userId, a: access }, SECRET);
    ledgerDelayMs = 400;
    onLedger = (who) => {
      if (who !== userId) return;
      onLedger = null;
      setTimeout(() => server.handleRevoke(message), 100);
    };
    const client = connect(server.port, canvasId, userId, { access, token: async () => token });
    clients.push(client);
    await sleep(1500);
    ledgerDelayMs = 0;
    return client;
  }

  const shutOut = (client: TestClient) =>
    client.authFailures.some((r) => r.startsWith(`${SYNC_CLOSE.revoked}`)) ||
    client.closes.includes(SYNC_CLOSE.revoked);

  it("a read token revoked mid-connect is shut out", async () => {
    const canvasId = await seedCanvas(db);
    const m = await connectWhileRevoked(canvasId, "reader", { canvasId, userId: "reader" }, "read");
    expect(shutOut(m)).toBe(true);
    expect(await until(() => !m.provider.isSynced, 1000)).toBe(true);
  });

  it("a user-wide revoke (ban) mid-connect is shut out", async () => {
    const canvasId = await seedCanvas(db);
    const m = await connectWhileRevoked(canvasId, "banned", { userId: "banned" });
    expect(shutOut(m)).toBe(true);
  });

  it("a canvas-wide revoke (delete) mid-connect is shut out", async () => {
    const canvasId = await seedCanvas(db);
    const m = await connectWhileRevoked(canvasId, "anyone", { canvasId });
    expect(shutOut(m)).toBe(true);
  });

  it("a revoke for another canvas, or another user, mid-connect leaves the connect alone", async () => {
    const canvasId = await seedCanvas(db);
    const otherCanvas = await seedCanvas(db);
    const a = await connectWhileRevoked(canvasId, "bystander", {
      canvasId: otherCanvas,
      userId: "bystander",
    });
    expect(shutOut(a)).toBe(false);
    expect(a.provider.isSynced).toBe(true);
    const b = await connectWhileRevoked(canvasId, "bystander2", { canvasId, userId: "someone" });
    expect(shutOut(b)).toBe(false);
    expect(b.provider.isSynced).toBe(true);
  });

  it("an update queued during authentication is never applied, relayed or stored once revoked", async () => {
    const canvasId = await seedCanvas(db);
    const name = documentName("canvas", canvasId);
    const peer = connect(server.port, canvasId, "alice");
    clients.push(peer);
    expect(await synced(peer)).toBe(true);

    const raw = rawSocket(server.port);
    await until(() => raw.state.open);
    const token = await signCanvasToken({ c: name, u: "mallory", a: "write" }, SECRET);
    ledgerDelayMs = 400;
    onLedger = (who) => {
      if (who !== "mallory") return;
      onLedger = null;
      setTimeout(() => server.handleRevoke({ canvasId, userId: "mallory" }), 100);
    };
    raw.socket.send(authFrame(name, token));
    // Queued by Hocuspocus until the connection is set up.
    raw.socket.send(updateFrame(name, cardUpdate("evil")));
    await sleep(1500);
    ledgerDelayMs = 0;

    expect(peer.nodes.has("evil")).toBe(false);
    expect(server.hocuspocus.documents.get(name)?.getMap("nodes").has("evil") ?? false).toBe(false);
    addCard(peer, "fine");
    expect(
      await until(async () => (await storedNodeIds(db, canvasId)).includes("fine"), 3000),
    ).toBe(true);
    expect(await storedNodeIds(db, canvasId)).toEqual(["fine"]);
    raw.socket.close();
  });

  it(`a member re-added after a revoke gets back in with a token minted more than ${REVOKE_CLOCK_SKEW_MS}ms later, not sooner`, async () => {
    const canvasId = await seedCanvas(db);
    const name = documentName("canvas", canvasId);
    server.handleRevoke({ canvasId, userId: "returning" });
    const soon = await signCanvasToken(
      { c: name, u: "returning", a: "write" },
      SECRET,
      Date.now() + REVOKE_CLOCK_SKEW_MS - 500,
    );
    const early = connect(server.port, canvasId, "returning", { token: async () => soon });
    clients.push(early);
    expect(await until(() => early.authFailures.length > 0, 3000)).toBe(true);
    expect(early.authFailures[0]).toStartWith(`${SYNC_CLOSE.revoked}`);
    early.destroy();

    const later = await signCanvasToken(
      { c: name, u: "returning", a: "write" },
      SECRET,
      Date.now() + REVOKE_CLOCK_SKEW_MS + 500,
    );
    const back = connect(server.port, canvasId, "returning", { token: async () => later });
    clients.push(back);
    expect(await synced(back)).toBe(true);
    addCard(back, "again");
    expect(
      await until(async () => (await storedNodeIds(db, canvasId)).includes("again"), 3000),
    ).toBe(true);
    // Its later messages aren't refused by the old revoke either.
    await sleep(300);
    expect(back.closes).toEqual([]);
  });
});

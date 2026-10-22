import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { eq } from "drizzle-orm";
import IORedis from "ioredis";
import * as Y from "yjs";

import { canvasDocs } from "../../../src/db/schema.ts";
import { SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { type CanvasEvent, revokesFor } from "../../../src/lib/canvas/revokes.ts";
import {
  applyChannel,
  documentName,
  REVOKE_CLOCK_SKEW_MS,
  revokeChannel,
  sendRevoke,
  SYNC_CLOSE,
  syncEnvPrefix,
} from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { createRedisExtension, redisChannels, redisLedger, redisTombstones } from "../src/redis.ts";
import {
  addCard,
  connect,
  SECRET,
  seedCanvas,
  sleep,
  storedNodeIds,
  storedState,
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
    "access changes over Redis",
    "CANVAS_SYNC_TEST_DATABASE_URL and CANVAS_SYNC_TEST_REDIS_URL",
  );
}

/**
 * Each access change the web app emits, published over Redis exactly as
 * `publishCanvasRevoke` / `publishCanvasApply` do, reaching sockets spread
 * over two instances (and a third that boots after the change).
 */
describe.skipIf(!enabled)("access changes over Redis, across instances", () => {
  const prefix = syncEnvPrefix(`test-${crypto.randomUUID().slice(0, 8)}`);
  let db: ServiceDb;
  let end: () => Promise<void>;
  let one: SyncServer;
  let two: SyncServer;
  let publisher: IORedis;
  const servers: SyncServer[] = [];
  const clients: TestClient[] = [];
  const open = (...args: Parameters<typeof connect>) => {
    const client = connect(...args);
    clients.push(client);
    return client;
  };

  const instance = async (id: string) => {
    const server = await startServer({
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
      tombstones: redisTombstones(TEST_REDIS_URL!, prefix),
    });
    servers.push(server);
    return server;
  };

  beforeAll(async () => {
    ({ db, end } = testDb());
    one = await instance("access-one");
    two = await instance("access-two");
    publisher = new IORedis(TEST_REDIS_URL!);
    await sleep(500);
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await Promise.all(servers.map((s) => s.stop(5000)));
    publisher.disconnect();
    await end();
  });

  /** What `emitCanvasEvent` sends for an event, through the web app's own sender. */
  async function emit(event: CanvasEvent) {
    for (const message of revokesFor(event)) {
      await sendRevoke(publisher, prefix, message, SYNC_LIMITS.tokenTtlMs + REVOKE_CLOCK_SKEW_MS);
    }
  }

  const scope = { kind: "team", teamId: "t1" } as const;

  /** Owner on instance one; an editor and a reader on instance two. */
  async function liveCanvas() {
    const canvasId = await seedCanvas(db);
    const alice = open(one.port, canvasId, "alice");
    const bob = open(two.port, canvasId, "bob");
    const rita = open(two.port, canvasId, "rita", { access: "read" });
    for (const c of [alice, bob, rita]) expect(await synced(c)).toBe(true);
    return { canvasId, alice, bob, rita };
  }

  const revoked = (client: TestClient) =>
    until(() => client.closes.includes(SYNC_CLOSE.revoked), 3000);

  async function stillOpen(...open: TestClient[]) {
    await sleep(400);
    for (const client of open) {
      expect(client.closes).toEqual([]);
      expect(client.provider.isSynced).toBe(true);
    }
  }

  it("hide closes everyone on both instances", async () => {
    const { canvasId, alice, bob, rita } = await liveCanvas();
    await emit({ type: "hidden", canvasId, scope });
    for (const c of [alice, bob, rita]) expect(await revoked(c)).toBe(true);
  });

  it("unhide, widening and an upgrade close nobody", async () => {
    const { canvasId, alice, bob, rita } = await liveCanvas();
    await emit({ type: "unhidden", canvasId, scope });
    await emit({ type: "visibility_changed", canvasId, scope, from: "team", to: "unlisted" });
    await emit({ type: "visibility_changed", canvasId, scope, from: "unlisted", to: "public" });
    await emit({ type: "member_role_changed", canvasId, scope, userId: "bob", role: "editor" });
    await stillOpen(alice, bob, rita);
  });

  it.each([
    ["public", "unlisted"],
    ["public", "team"],
    ["unlisted", "team"],
    ["public", "private"],
  ])("narrowing %s → %s closes everyone", async (from, to) => {
    const { canvasId, alice, bob, rita } = await liveCanvas();
    await emit({ type: "visibility_changed", canvasId, scope, from, to });
    for (const c of [alice, bob, rita]) expect(await revoked(c)).toBe(true);
  });

  it("removing a member closes only them; the rest keep editing across instances", async () => {
    const { canvasId, alice, bob, rita } = await liveCanvas();
    await emit({ type: "member_removed", canvasId, scope, userId: "bob" });
    expect(await revoked(bob)).toBe(true);
    await stillOpen(alice, rita);
    addCard(alice, "after-removal");
    expect(await until(() => rita.nodes.has("after-removal"), 3000)).toBe(true);
  });

  it("a removed member's pre-removal token is refused, even on an instance booted afterwards", async () => {
    const { canvasId, bob } = await liveCanvas();
    const minted = Date.now();
    const staleToken = await signCanvasToken(
      { c: documentName("canvas", canvasId), u: "bob", a: "write" },
      SECRET,
      minted,
    );
    await sleep(5);
    await emit({ type: "member_removed", canvasId, scope, userId: "bob" });
    expect(await revoked(bob)).toBe(true);
    bob.destroy();

    const late = await instance("access-late");
    for (const port of [two.port, late.port]) {
      const retry = open(port, canvasId, "bob", { token: async () => staleToken });
      expect(await until(() => retry.authFailures.length > 0, 3000)).toBe(true);
      expect(retry.authFailures[0]).toStartWith(`${SYNC_CLOSE.revoked}`);
      retry.destroy();
    }
  });

  it("a downgrade closes that member, who returns read-only and can't write", async () => {
    const { canvasId, alice, bob, rita } = await liveCanvas();
    await emit({ type: "member_role_changed", canvasId, scope, userId: "bob", role: "viewer" });
    expect(await revoked(bob)).toBe(true);
    await stillOpen(alice, rita);
    bob.destroy();
    const token = await signCanvasToken(
      { c: documentName("canvas", canvasId), u: "bob", a: "read" },
      SECRET,
      Date.now() + REVOKE_CLOCK_SKEW_MS + 500,
    );
    const reader = open(one.port, canvasId, "bob", { access: "read", token: async () => token });
    expect(await synced(reader)).toBe(true);
    addCard(reader, "bob-write");
    addCard(alice, "alice-write");
    expect(await until(() => reader.nodes.has("alice-write"), 3000)).toBe(true);
    await sleep(800);
    expect(rita.nodes.has("bob-write")).toBe(false);
    expect(await storedNodeIds(db, canvasId)).toEqual(["alice-write"]);
  });

  it("a move: the apply loads image copies live on every instance, then everyone is closed", async () => {
    const { canvasId, alice, bob, rita } = await liveCanvas();
    addCard(alice, "img");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).includes("img"), 5000)).toBe(
      true,
    );
    expect(await until(() => rita.nodes.has("img"), 3000)).toBe(true);
    await sleep(300);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await storedState(db, canvasId))!);
    (doc.getMap("nodes").get("img") as Y.Map<unknown>).set("attachmentId", "team-copy");
    await db
      .update(canvasDocs)
      .set({ state: Buffer.from(Y.encodeStateAsUpdate(doc)) })
      .where(eq(canvasDocs.canvasId, canvasId));

    await publisher.publish(applyChannel(prefix), JSON.stringify({ canvasId }));
    const att = (c: TestClient) =>
      (c.nodes.get("img") as Y.Map<unknown> | undefined)?.get("attachmentId");
    expect(await until(() => att(alice) === "team-copy" && att(rita) === "team-copy", 3000)).toBe(
      true,
    );

    await emit({ type: "moved_to_team", canvasId, scope, fromOwnerId: "alice" });
    await emit({ type: "member_removed", canvasId, scope, userId: "bob" });
    for (const c of [alice, bob, rita]) expect(await revoked(c)).toBe(true);
  });

  it("ignores malformed messages on the revoke channel and keeps serving", async () => {
    const { canvasId, alice, bob } = await liveCanvas();
    for (const raw of ["", "{", "null", "[]", '{"canvasId":42}', '{"userId":null}', "{}"]) {
      await publisher.publish(revokeChannel(prefix), raw);
    }
    await stillOpen(alice, bob);
    await emit({ type: "hidden", canvasId, scope });
    expect(await revoked(alice)).toBe(true);
  });
});

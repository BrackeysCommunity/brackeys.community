import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import IORedis from "ioredis";

import {
  documentName,
  REVOKE_CLOCK_SKEW_MS,
  revokeTombstoneKey,
  SYNC_CLOSE,
} from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { redisTombstones } from "../src/redis.ts";
import { FakeRedis } from "./fake-redis.ts";
import {
  connect,
  SECRET,
  seedCanvas,
  synced,
  TEST_DATABASE_URL,
  testDb,
  type TestClient,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(30_000);

const PREFIX = "tombstone-test:canvas-sync";

/** What the web app's revoke publish leaves behind. */
async function writeTombstone(
  url: string,
  at: number,
  canvasId: string | undefined,
  userId: string | undefined,
): Promise<void> {
  const client = new IORedis(url, { maxRetriesPerRequest: 1 });
  await client.set(revokeTombstoneKey(PREFIX, canvasId, userId), String(at), "PX", 62_000);
  client.disconnect();
}

describe("redisTombstones", () => {
  const redis = new FakeRedis();
  beforeAll(() => redis.start());
  afterAll(() => redis.stop());

  it("reads the latest revoke covering a user on a canvas", async () => {
    const tombstones = redisTombstones(redis.url, PREFIX);
    expect(await tombstones.latest("c1", "u1")).toBeNull();
    await writeTombstone(redis.url, 1000, "c1", "u1");
    await writeTombstone(redis.url, 3000, undefined, "u1");
    await writeTombstone(redis.url, 2000, "c1", undefined);
    await writeTombstone(redis.url, 9000, "c2", undefined);
    expect(await tombstones.latest("c1", "u1")).toBe(3000);
    expect(await tombstones.latest("c1", "u2")).toBe(2000);
    expect(await tombstones.latest("c3", "u3")).toBeNull();
    await tombstones.close();
  });

  it("reads as none while Redis is down", async () => {
    const down = new FakeRedis();
    await down.start();
    const tombstones = redisTombstones(down.url, PREFIX);
    await down.stop();
    expect(await tombstones.latest("c1", "u1")).toBeNull();
    await tombstones.close();
  });
});

if (!TEST_DATABASE_URL) warnSkipped("revoke tombstones", "CANVAS_SYNC_TEST_DATABASE_URL");

describe.skipIf(!TEST_DATABASE_URL)("an instance that starts after a revoke", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  const redis = new FakeRedis();
  const clients: TestClient[] = [];

  beforeAll(async () => {
    ({ db, end } = testDb());
    await redis.start();
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "tombstones",
      telemetry: { captureException() {}, capture() {}, async shutdown() {} },
      debounceMs: 200,
      maxDebounceMs: 1000,
      tombstones: redisTombstones(redis.url, PREFIX),
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(5000);
    await redis.stop();
    await end();
  });

  const tokenFor = (canvasId: string, userId: string, mintedAt: number) =>
    signCanvasToken(
      { c: documentName("canvas", canvasId), u: userId, a: "write" },
      SECRET,
      mintedAt,
    );

  const refused = async (client: TestClient) => {
    expect(await until(() => client.authFailures.length > 0, 3000)).toBe(true);
    expect(client.authFailures[0]).toStartWith(`${SYNC_CLOSE.revoked}`);
  };

  it("refuses a token minted before a member's removal it never heard about", async () => {
    const canvasId = await seedCanvas(db);
    const minted = Date.now() - 10_000;
    const token = await tokenFor(canvasId, "removed", minted);
    await writeTombstone(redis.url, minted + 5_000, canvasId, "removed");
    const client = connect(server.port, canvasId, "removed", { token: async () => token });
    clients.push(client);
    await refused(client);
    expect(server.metrics.refusals.auth).toBeGreaterThan(0);
  });

  it("refuses a pre-ban token on any canvas, and a pre-delete token for anyone", async () => {
    const canvasId = await seedCanvas(db);
    const minted = Date.now() - 10_000;
    await writeTombstone(redis.url, minted + 1, undefined, "banned");
    const banned = await tokenFor(canvasId, "banned", minted);
    const a = connect(server.port, canvasId, "banned", { token: async () => banned });
    clients.push(a);
    await refused(a);

    const deleted = await seedCanvas(db);
    await writeTombstone(redis.url, minted + 1, deleted, undefined);
    const bystander = await tokenFor(deleted, "bystander", minted);
    const b = connect(server.port, deleted, "bystander", { token: async () => bystander });
    clients.push(b);
    await refused(b);
  });

  it(`admits a token minted more than ${REVOKE_CLOCK_SKEW_MS}ms after the revoke`, async () => {
    const canvasId = await seedCanvas(db);
    const revokedAt = Date.now() - 10_000;
    await writeTombstone(redis.url, revokedAt, canvasId, "readded");
    const token = await tokenFor(canvasId, "readded", revokedAt + REVOKE_CLOCK_SKEW_MS + 500);
    const client = connect(server.port, canvasId, "readded", { token: async () => token });
    clients.push(client);
    expect(await synced(client)).toBe(true);
    expect(client.authFailures).toEqual([]);
  });

  it("admits everyone while Redis is down", async () => {
    const canvasId = await seedCanvas(db);
    const minted = Date.now() - 10_000;
    await writeTombstone(redis.url, minted + 1, canvasId, "lucky");
    await redis.stop();
    try {
      const token = await tokenFor(canvasId, "lucky", minted);
      const client = connect(server.port, canvasId, "lucky", { token: async () => token });
      clients.push(client);
      expect(await synced(client)).toBe(true);
    } finally {
      await redis.start();
    }
  });
});

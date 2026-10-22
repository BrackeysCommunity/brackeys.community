import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import net from "node:net";

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

/**
 * Forwards to `target`; frozen, it holds every byte back and sends it on
 * when thawed, the way a stalled but live TCP connection delivers late.
 */
async function freezableProxy(targetPort: number) {
  let frozen = false;
  const held: (() => void)[] = [];
  const pass = (to: net.Socket) => (chunk: Buffer) => {
    if (frozen) held.push(() => to.write(chunk));
    else to.write(chunk);
  };
  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    client.on("data", pass(upstream));
    upstream.on("data", pass(client));
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `redis://127.0.0.1:${port}`,
    freeze: (value: boolean) => {
      frozen = value;
      if (!value) for (const flush of held.splice(0)) flush();
    },
    close: () => server.close(),
  };
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

  describe("on a Redis that stops answering", () => {
    const redis = new FakeRedis();
    let proxy: Awaited<ReturnType<typeof freezableProxy>>;
    beforeAll(async () => {
      await redis.start();
      proxy = await freezableProxy(redis.port);
    });
    afterAll(async () => {
      proxy.close();
      await redis.stop();
    });

    it("gives up within the command timeout and reads as none", async () => {
      const tombstones = redisTombstones(proxy.url, PREFIX);
      const writer = new IORedis(redis.url);
      await writer.set(revokeTombstoneKey(PREFIX, "c1", "u1"), "5000", "PX", 62_000);
      // Reads before the client is ready fail open too.
      expect(await until(async () => (await tombstones.latest("c1", "u1")) === 5000, 3000)).toBe(
        true,
      );

      proxy.freeze(true);
      const started = Date.now();
      expect(await tombstones.latest("c1", "u1")).toBeNull();
      const took = Date.now() - started;
      console.log(`  hung read failed open after ${took}ms`);
      expect(took).toBeLessThan(2500);
      proxy.freeze(false);
      writer.disconnect();
      await tombstones.close();
    });

    // ioredis keeps a timed-out command queued, so its late reply is consumed
    // by that command and the replies after it stay aligned.
    it("after a stall, each read gets its own user's tombstone", async () => {
      const tombstones = redisTombstones(proxy.url, PREFIX);
      const writer = new IORedis(redis.url);
      await writer.set(revokeTombstoneKey(PREFIX, "s1", "u1"), "5000", "PX", 62_000);
      await writer.set(revokeTombstoneKey(PREFIX, "s2", "u2"), "7777", "PX", 62_000);
      await until(async () => (await tombstones.latest("s1", "u1")) === 5000, 3000);

      proxy.freeze(true);
      await tombstones.latest("s1", "u1");
      proxy.freeze(false);

      const [a, b] = await Promise.all([
        tombstones.latest("s1", "u1"),
        tombstones.latest("s2", "u2"),
      ]);
      writer.disconnect();
      await tombstones.close();
      expect([a, b]).toEqual([5000, 7777]);
    });

    it("ignores a tombstone value that isn't a time", async () => {
      const tombstones = redisTombstones(redis.url, PREFIX);
      const writer = new IORedis(redis.url);
      await writer.set(revokeTombstoneKey(PREFIX, "c9", "u9"), "garbage", "PX", 62_000);
      await writer.set(revokeTombstoneKey(PREFIX, "c9", undefined), "-5", "PX", 62_000);
      expect(await tombstones.latest("c9", "u9")).toBeNull();
      writer.disconnect();
      await tombstones.close();
    });
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

describe.skipIf(!TEST_DATABASE_URL)("connecting while the tombstone Redis hangs", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  const redis = new FakeRedis();
  let proxy: Awaited<ReturnType<typeof freezableProxy>>;

  beforeAll(async () => {
    ({ db, end } = testDb());
    await redis.start();
    proxy = await freezableProxy(redis.port);
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "tombstone-hung",
      telemetry: { captureException() {}, capture() {}, async shutdown() {} },
      debounceMs: 200,
      maxDebounceMs: 1000,
      tombstones: redisTombstones(proxy.url, PREFIX),
    });
  });

  afterAll(async () => {
    await server.stop(5000);
    proxy.close();
    await redis.stop();
    await end();
  });

  it("admits after the timeout and holds no seat while waiting", async () => {
    const canvasId = await seedCanvas(db);
    const warm = connect(server.port, canvasId, "warm");
    expect(await synced(warm)).toBe(true);
    warm.destroy();

    proxy.freeze(true);
    const name = documentName("canvas", canvasId);
    const started = Date.now();
    const client = connect(server.port, canvasId, "waiting", {
      token: () => signCanvasToken({ c: name, u: "waiting", a: "write" }, SECRET),
    });
    await Bun.sleep(300);
    expect(server.caps.localUserCount("waiting")).toBe(0);
    expect(await synced(client, 5000)).toBe(true);
    console.log(`  synced ${Date.now() - started}ms after connecting with Redis hung`);
    client.destroy();
    proxy.freeze(false);
  });
});

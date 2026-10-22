import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import net from "node:net";

import IORedis from "ioredis";

import { documentName, revokeTombstoneKey } from "../../../src/lib/canvas/sync-channels.ts";
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
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(30_000);

if (!TEST_DATABASE_URL) warnSkipped("tombstones on a hung Redis", "CANVAS_SYNC_TEST_DATABASE_URL");

const PREFIX = "tombstone-hung:canvas-sync";

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

describe("redisTombstones on a Redis that stops answering", () => {
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

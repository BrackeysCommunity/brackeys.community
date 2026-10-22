import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import net from "node:net";

import { SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { documentName } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { SyncContext } from "../src/auth.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import type { UserConnectionLedger } from "../src/limits.ts";
import { redisLedger } from "../src/redis.ts";
import { FakeRedis } from "./fake-redis.ts";
import {
  authFrame,
  connect,
  rawSocket,
  SECRET,
  seedCanvas,
  sleep,
  synced,
  TEST_DATABASE_URL,
  testDb,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(60_000);

if (!TEST_DATABASE_URL)
  warnSkipped("connection caps across ledgers", "CANVAS_SYNC_TEST_DATABASE_URL");

const PER_CANVAS = SYNC_LIMITS.connectionsPerCanvas;
const PER_USER = SYNC_LIMITS.connectionsPerUser;
const quiet = { captureException() {}, capture() {}, async shutdown() {} };

/** A ledger whose reads take `ms`, the way a slow Redis round trip would. */
function slowLedger(ms: number): UserConnectionLedger {
  return {
    othersCount: () => new Promise((resolve) => setTimeout(() => resolve(0), ms)),
    async record() {},
    async close() {},
  };
}

/** Accepts TCP connections and never answers: a hung Redis. */
async function hungServer(): Promise<{ url: string; close: () => void }> {
  const sockets: net.Socket[] = [];
  const server = net.createServer((s) => sockets.push(s));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `redis://127.0.0.1:${port}`,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

type Variant = {
  label: string;
  setup: () => Promise<{ ledger?: UserConnectionLedger; teardown: () => Promise<void> }>;
  /** Reads are slow enough that a burst all waits on them together. */
  slow: boolean;
};

const variants: Variant[] = [
  { label: "local", slow: false, setup: async () => ({ teardown: async () => {} }) },
  {
    label: "300ms ledger",
    slow: true,
    setup: async () => ({ ledger: slowLedger(300), teardown: async () => {} }),
  },
  {
    label: "1500ms ledger",
    slow: true,
    setup: async () => ({ ledger: slowLedger(1500), teardown: async () => {} }),
  },
  {
    label: "redisLedger over FakeRedis",
    slow: false,
    setup: async () => {
      const redis = await new FakeRedis().start();
      return {
        ledger: redisLedger(redis.url, "caps-variants:canvas-sync", "v-redis"),
        teardown: () => redis.stop(),
      };
    },
  },
  {
    label: "redisLedger, Redis down",
    slow: false,
    setup: async () => ({
      ledger: redisLedger("redis://127.0.0.1:1", "caps-variants:canvas-sync", "v-down"),
      teardown: async () => {},
    }),
  },
  {
    label: "redisLedger, Redis hung",
    slow: false,
    setup: async () => {
      const hung = await hungServer();
      return {
        ledger: redisLedger(hung.url, "caps-variants:canvas-sync", "v-hung"),
        teardown: async () => hung.close(),
      };
    },
  },
];

for (const variant of variants) {
  describe.skipIf(!TEST_DATABASE_URL)(`caps, ${variant.label}`, () => {
    let db: ServiceDb;
    let end: () => Promise<void>;
    let server: SyncServer;
    let teardown: () => Promise<void>;

    beforeAll(async () => {
      ({ db, end } = testDb());
      const setup = await variant.setup();
      teardown = setup.teardown;
      server = await startServer({
        port: 0,
        secret: SECRET,
        db,
        instanceId: `caps-${variant.label}`,
        telemetry: quiet,
        debounceMs: 200,
        maxDebounceMs: 1000,
        ...(setup.ledger ? { ledger: setup.ledger } : {}),
      });
    });

    afterAll(async () => {
      await server.stop(5000);
      await teardown();
      await end();
    });

    const liveFor = (name: string, userId?: string) =>
      (server.hocuspocus.documents.get(name)?.getConnections() ?? []).filter(
        (c) => !userId || (c.context as SyncContext).userId === userId,
      ).length;
    // Long enough for every auth frame to reach admission, then until no seat is pending.
    const settle = async () => {
      await sleep(variant.slow ? 400 : 300);
      await until(() => server.caps.pendingCount() === 0, 10_000);
      await sleep(200);
    };

    it(`exactly ${PER_CANVAS} of 60 simultaneous sockets get in; the rest are refused by the caps`, async () => {
      const canvasId = await seedCanvas(db);
      const name = documentName("canvas", canvasId);
      const sockets = Array.from({ length: 60 }, () => rawSocket(server.port));
      await until(() => sockets.every((s) => s.state.open));
      const tokens = await Promise.all(
        sockets.map((_, i) => signCanvasToken({ c: name, u: `burst${i}`, a: "write" }, SECRET)),
      );
      const capped = server.metrics.refusals.caps;
      sockets.forEach((s, i) => s.socket.send(authFrame(name, tokens[i]!)));
      await settle();
      expect(liveFor(name)).toBe(PER_CANVAS);
      expect(server.metrics.refusals.caps - capped).toBe(60 - PER_CANVAS);

      // Full: one more on its own is refused; once someone leaves, the next gets in.
      const late = rawSocket(server.port);
      await until(() => late.state.open);
      late.socket.send(
        authFrame(name, await signCanvasToken({ c: name, u: "late", a: "write" }, SECRET)),
      );
      await settle();
      expect(liveFor(name, "late")).toBe(0);
      expect(server.metrics.refusals.caps - capped).toBe(61 - PER_CANVAS);

      const admitted = sockets.find((_, i) => liveFor(name, `burst${i}`) === 1)!;
      admitted.socket.close();
      expect(await until(() => liveFor(name) === PER_CANVAS - 1)).toBe(true);
      late.socket.send(
        authFrame(name, await signCanvasToken({ c: name, u: "late", a: "write" }, SECRET)),
      );
      expect(await until(() => liveFor(name, "late") === 1, 5000)).toBe(true);
      for (const s of [...sockets, late]) s.socket.close();
      await until(() => liveFor(name) === 0);
    });

    it(`exactly ${PER_USER} of one user's 15 simultaneous sockets get in`, async () => {
      const canvasId = await seedCanvas(db);
      const name = documentName("canvas", canvasId);
      const sockets = Array.from({ length: 15 }, () => rawSocket(server.port));
      await until(() => sockets.every((s) => s.state.open));
      const token = await signCanvasToken({ c: name, u: "greedy", a: "write" }, SECRET);
      const capped = server.metrics.refusals.caps;
      for (const s of sockets) s.socket.send(authFrame(name, token));
      await settle();
      expect(liveFor(name, "greedy")).toBe(PER_USER);
      expect(server.metrics.refusals.caps - capped).toBe(15 - PER_USER);
      for (const s of sockets) s.socket.close();
      await until(() => liveFor(name) === 0);
    });

    it(`the per-user cap spans canvases: ${PER_USER} canvases at once, the next refused`, async () => {
      const ids = await Promise.all(Array.from({ length: 12 }, () => seedCanvas(db)));
      const names = ids.map((id) => documentName("canvas", id));
      const sockets = names.map(() => rawSocket(server.port));
      await until(() => sockets.every((s) => s.state.open));
      const capped = server.metrics.refusals.caps;
      await Promise.all(
        sockets.map(async (s, i) =>
          s.socket.send(
            authFrame(
              names[i]!,
              await signCanvasToken({ c: names[i]!, u: "roamer", a: "write" }, SECRET),
            ),
          ),
        ),
      );
      await settle();
      expect(server.caps.localUserCount("roamer")).toBe(PER_USER);
      expect(server.metrics.refusals.caps - capped).toBe(12 - PER_USER);
      for (const s of sockets) s.socket.close();
      expect(await until(() => server.caps.localUserCount("roamer") === 0)).toBe(true);
    });

    it("multiplexed sessions for one user end with nothing live and no seats held", async () => {
      const canvasId = await seedCanvas(db);
      const name = documentName("canvas", canvasId);
      const raw = rawSocket(server.port);
      await until(() => raw.state.open);
      const token = await signCanvasToken({ c: name, u: "mux", a: "write" }, SECRET);
      const capped = server.metrics.refusals.caps;
      for (let i = 0; i < 15; i++) raw.socket.send(authFrame(`${name}\u0000m${i}`, token));
      await settle();
      expect(liveFor(name, "mux")).toBe(0);
      expect(server.caps.localUserCount("mux")).toBe(0);
      // A burst on one socket reserves one seat per session, so 5 are capped.
      if (variant.slow) expect(server.metrics.refusals.caps - capped).toBe(15 - PER_USER);
      raw.socket.close();
    });

    it("multiplexed sessions for 60 users never put more than the canvas cap live", async () => {
      const canvasId = await seedCanvas(db);
      const name = documentName("canvas", canvasId);
      const raw = rawSocket(server.port);
      await until(() => raw.state.open);
      let peak = 0;
      const watch = setInterval(() => (peak = Math.max(peak, liveFor(name))), 1);
      for (let i = 0; i < 60; i++) {
        const token = await signCanvasToken({ c: name, u: `mx${i}`, a: "write" }, SECRET);
        raw.socket.send(authFrame(`${name}\u0000s${i}`, token));
      }
      await settle();
      clearInterval(watch);
      expect(peak).toBeLessThanOrEqual(PER_CANVAS);
      expect(liveFor(name)).toBe(0);
      raw.socket.close();
    });

    it("an ordinary provider still connects and syncs", async () => {
      const canvasId = await seedCanvas(db);
      const a = connect(server.port, canvasId, "plain-a");
      const b = connect(server.port, canvasId, "plain-b");
      expect(await synced(a)).toBe(true);
      expect(await synced(b)).toBe(true);
      a.nodes.set("x", new (await import("yjs")).Map());
      expect(await until(() => b.nodes.has("x"))).toBe(true);
      a.destroy();
      b.destroy();
    });
  });
}

describe.skipIf(!TEST_DATABASE_URL)("caps across two instances sharing the Redis ledger", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let a: SyncServer;
  let b: SyncServer;
  const redis = new FakeRedis();

  beforeAll(async () => {
    ({ db, end } = testDb());
    await redis.start();
    const start = (id: string) =>
      startServer({
        port: 0,
        secret: SECRET,
        db,
        instanceId: id,
        telemetry: quiet,
        debounceMs: 200,
        maxDebounceMs: 1000,
        ledger: redisLedger(redis.url, "caps-two:canvas-sync", id),
      });
    [a, b] = await Promise.all([start("two-a"), start("two-b")]);
  });

  afterAll(async () => {
    await Promise.all([a.stop(5000), b.stop(5000)]);
    await redis.stop();
    await end();
  });

  it(`${PER_USER} connections on one instance: the next on the other is refused`, async () => {
    const canvasId = await seedCanvas(db);
    const clients = Array.from({ length: PER_USER }, () => connect(a.port, canvasId, "spread"));
    for (const c of clients) expect(await synced(c)).toBe(true);
    await sleep(300);
    const capped = b.metrics.refusals.caps;
    const extra = connect(b.port, canvasId, "spread");
    await until(() => b.metrics.refusals.caps > capped, 3000);
    expect(extra.provider.isSynced).toBe(false);
    expect(b.metrics.refusals.caps - capped).toBe(1);
    extra.destroy();
    for (const c of clients) c.destroy();
  });

  it("a simultaneous burst split over two instances never passes the cap", async () => {
    const canvasId = await seedCanvas(db);
    const name = documentName("canvas", canvasId);
    const token = await signCanvasToken({ c: name, u: "split", a: "write" }, SECRET);
    const sockets = Array.from({ length: 16 }, (_, i) => rawSocket(i % 2 ? b.port : a.port));
    await until(() => sockets.every((s) => s.state.open));
    for (const s of sockets) s.socket.send(authFrame(name, token));
    await sleep(2000);
    const held = a.caps.localUserCount("split") + b.caps.localUserCount("split");
    // Each instance writes its count before reading the other's, so a split
    // burst may refuse a few that would have fit (they retry) but never
    // admits more than the cap.
    console.log(`  16 sockets for one user split over two instances: ${held} held`);
    expect(held).toBeLessThanOrEqual(PER_USER);

    const topUp = [];
    for (let i = held; i < PER_USER; i++) {
      const c = connect(i % 2 ? b.port : a.port, canvasId, "split");
      expect(await synced(c)).toBe(true);
      topUp.push(c);
    }
    await sleep(300);
    const capped = a.metrics.refusals.caps;
    const extra = connect(a.port, canvasId, "split");
    await until(() => a.metrics.refusals.caps > capped, 3000);
    expect(extra.provider.isSynced).toBe(false);
    extra.destroy();
    for (const c of topUp) c.destroy();
    for (const s of sockets) s.socket.close();
  });
});

describe.skipIf(!TEST_DATABASE_URL)("seats of sockets that hang up mid-connect", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;

  beforeAll(async () => {
    ({ db, end } = testDb());
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "caps-hangup",
      telemetry: quiet,
    });
  });

  afterAll(async () => {
    await server.stop(5000);
    await end();
  });

  it(`${PER_USER} hang-ups don't lock the user out`, async () => {
    const canvasId = await seedCanvas(db);
    const name = documentName("canvas", canvasId);
    const token = await signCanvasToken({ c: name, u: "flaky", a: "write" }, SECRET);
    const sockets = Array.from({ length: PER_USER }, () => rawSocket(server.port));
    await until(() => sockets.every((s) => s.state.open));
    for (const s of sockets) s.socket.send(authFrame(name, token));
    for (const s of sockets) s.socket.close();
    await until(() => sockets.every((s) => s.state.closed !== null));
    await sleep(300);
    const client = connect(server.port, canvasId, "flaky");
    const ok = await synced(client, 3000);
    const pending = server.caps.pendingCount();
    client.destroy();
    expect({ ok, pending }).toEqual({ ok: true, pending: 0 });
  });
});

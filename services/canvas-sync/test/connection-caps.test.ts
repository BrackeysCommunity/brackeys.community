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

if (!TEST_DATABASE_URL) warnSkipped("connection caps", "CANVAS_SYNC_TEST_DATABASE_URL");

const PER_CANVAS = SYNC_LIMITS.connectionsPerCanvas;
const PER_USER = SYNC_LIMITS.connectionsPerUser;
const quiet = { captureException() {}, capture() {}, async shutdown() {} };

/** `until` with room for a loaded machine, failing as a timeout rather than as a later count mismatch. */
async function waitFor(check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  if (!(await until(check, ms))) throw new Error(`condition not met within ${ms}ms`);
}

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
  /** Also runs the one-socket, repeated-frame, bad-token and hang-up cases. */
  edges: boolean;
};

const variants: Variant[] = [
  { label: "local", slow: false, edges: true, setup: async () => ({ teardown: async () => {} }) },
  {
    label: "300ms ledger",
    slow: true,
    edges: true,
    setup: async () => ({ ledger: slowLedger(300), teardown: async () => {} }),
  },
  {
    label: "1500ms ledger",
    slow: true,
    edges: false,
    setup: async () => ({ ledger: slowLedger(1500), teardown: async () => {} }),
  },
  {
    label: "redisLedger over FakeRedis",
    slow: false,
    edges: true,
    setup: async () => {
      const redis = await new FakeRedis().start();
      return {
        ledger: redisLedger(redis.url, "connection-caps:canvas-sync", "v-redis"),
        teardown: () => redis.stop(),
      };
    },
  },
  {
    label: "redisLedger, Redis down",
    slow: false,
    edges: false,
    setup: async () => ({
      ledger: redisLedger("redis://127.0.0.1:1", "connection-caps:canvas-sync", "v-down"),
      teardown: async () => {},
    }),
  },
  {
    label: "redisLedger, Redis hung",
    slow: false,
    edges: false,
    setup: async () => {
      const hung = await hungServer();
      return {
        ledger: redisLedger(hung.url, "connection-caps:canvas-sync", "v-hung"),
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
    const liveForUser = (userId: string) => {
      let n = 0;
      for (const doc of server.hocuspocus.documents.values())
        for (const c of doc.getConnections()) if ((c.context as SyncContext).userId === userId) n++;
      return n;
    };
    // Long enough for every auth frame to reach admission, then until no seat is pending.
    const settle = async () => {
      await sleep(variant.slow ? 600 : 400);
      await waitFor(() => server.caps.pendingCount() === 0);
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

    if (variant.edges) {
      it(`one socket, ${PER_USER + 3} different canvases for one user: exactly ${PER_USER} live`, async () => {
        const ids = await Promise.all(Array.from({ length: PER_USER + 3 }, () => seedCanvas(db)));
        const names = ids.map((id) => documentName("canvas", id));
        const user = `mux-${variant.label}`;
        const tokens = await Promise.all(
          names.map((c) => signCanvasToken({ c, u: user, a: "write" }, SECRET)),
        );
        const { socket, state } = rawSocket(server.port);
        await waitFor(() => state.open);
        const capped = server.metrics.refusals.caps;
        names.forEach((name, i) => socket.send(authFrame(name, tokens[i]!)));
        await settle();
        const live = liveForUser(user);
        const refused = server.metrics.refusals.caps - capped;
        socket.close();
        await waitFor(() => state.closed !== null);
        await waitFor(() => liveForUser(user) === 0);
        expect({ live, refused, pending: server.caps.pendingCount() }).toEqual({
          live: PER_USER,
          refused: 3,
          pending: 0,
        });
        expect(server.caps.localUserCount(user)).toBe(0);
      });

      it("the same auth frame repeated on one socket holds one connection and leaks no seat", async () => {
        const canvasId = await seedCanvas(db);
        const name = documentName("canvas", canvasId);
        const user = `dupe-${variant.label}`;
        const token = await signCanvasToken({ c: name, u: user, a: "write" }, SECRET);
        const { socket, state } = rawSocket(server.port);
        await waitFor(() => state.open);
        for (let i = 0; i < 20; i++) socket.send(authFrame(name, token));
        await settle();
        const live = liveForUser(user);
        const count = server.caps.localUserCount(user);
        socket.close();
        await waitFor(() => liveForUser(user) === 0);
        expect({ live, count }).toEqual({ live: 1, count: 1 });
      });

      it("bad tokens reserve nothing", async () => {
        const canvasId = await seedCanvas(db);
        const name = documentName("canvas", canvasId);
        const other = documentName("canvas", crypto.randomUUID());
        const wrongDoc = await signCanvasToken({ c: other, u: "bad", a: "write" }, SECRET);
        const forged = await signCanvasToken({ c: name, u: "bad", a: "write" }, "not-the-secret");
        const sockets = Array.from({ length: 30 }, () => rawSocket(server.port));
        await waitFor(() => sockets.every((s) => s.state.open));
        sockets.forEach((s, i) => {
          const token = i % 3 === 0 ? wrongDoc : i % 3 === 1 ? forged : "garbage";
          s.socket.send(authFrame(name, token));
        });
        await settle();
        expect(server.caps.pendingCount()).toBe(0);
        expect(server.caps.localUserCount("bad")).toBe(0);
        for (const s of sockets) s.socket.close();
      });

      it(`after a burst half hangs up, the canvas still fills to exactly ${PER_CANVAS}`, async () => {
        const canvasId = await seedCanvas(db);
        const name = documentName("canvas", canvasId);
        const first = Array.from({ length: 60 }, () => rawSocket(server.port));
        await waitFor(() => first.every((s) => s.state.open));
        const tokens = await Promise.all(
          first.map((_, i) =>
            signCanvasToken({ c: name, u: `half-${variant.label}-${i}`, a: "write" }, SECRET),
          ),
        );
        first.forEach((s, i) => s.socket.send(authFrame(name, tokens[i]!)));
        first.forEach((s, i) => i % 2 && s.socket.close());
        await settle();
        const doc = () => server.hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0;
        await waitFor(() => doc() <= 30);
        const afterHangUp = doc();
        const second = Array.from({ length: 40 }, () => rawSocket(server.port));
        await waitFor(() => second.every((s) => s.state.open));
        const more = await Promise.all(
          second.map((_, i) =>
            signCanvasToken({ c: name, u: `half2-${variant.label}-${i}`, a: "write" }, SECRET),
          ),
        );
        second.forEach((s, i) => s.socket.send(authFrame(name, more[i]!)));
        await settle();
        const held = doc();
        console.log(`  ${variant.label}: ${afterHangUp} after hang-ups, ${held} after the refill`);
        for (const s of [...first, ...second]) s.socket.close();
        expect(afterHangUp).toBeLessThanOrEqual(30);
        expect(held).toBe(PER_CANVAS);
      });
    }
  });
}

/**
 * Hocuspocus routes `<documentName>\0<sessionId>` keys to separate
 * connections on one websocket (the provider's `sessionAwareness`). A raw
 * client can open many connections to one canvas over a single socket, all
 * authenticating at once.
 */
for (const ledgerMs of [0, 300]) {
  describe.skipIf(!TEST_DATABASE_URL)(
    `session keys on one socket, every ledger read in flight together (ledger ${ledgerMs}ms)`,
    () => {
      let db: ServiceDb;
      let end: () => Promise<void>;
      let server: SyncServer;
      // The Redis ledger is a network round trip. A burst of connects all
      // waits on it together: each read returns once `burst` reads are in
      // flight, or after `ledgerMs`, whichever comes first.
      let burst = Infinity;
      let waiting: (() => void)[] = [];
      const release = () => {
        const ready = waiting;
        waiting = [];
        for (const resolve of ready) resolve();
      };
      const ledger: UserConnectionLedger = {
        othersCount: () =>
          new Promise<number>((resolve) => {
            waiting.push(() => resolve(0));
            if (waiting.length >= burst) release();
            else setTimeout(release, ledgerMs);
          }),
        async record() {},
        async close() {},
      };

      beforeAll(async () => {
        ({ db, end } = testDb());
        server = await startServer({
          port: 0,
          secret: SECRET,
          db,
          instanceId: "multiplex",
          telemetry: quiet,
          debounceMs: 200,
          maxDebounceMs: 1000,
          ...(ledgerMs ? { ledger } : {}),
        });
      });

      afterAll(async () => {
        await server.stop(5000);
        await end();
      });

      const liveFor = (name: string, userId?: string) =>
        (server.hocuspocus.documents.get(name)?.getConnections() ?? []).filter(
          (c) => !userId || (c.context as SyncContext).userId === userId,
        ).length;

      it(`one user can't hold more than ${PER_USER} connections through session keys on one socket`, async () => {
        const canvasId = await seedCanvas(db);
        const name = documentName("canvas", canvasId);
        const raw = rawSocket(server.port);
        await until(() => raw.state.open);
        const token = await signCanvasToken({ c: name, u: "mallory", a: "write" }, SECRET);
        const capped = server.metrics.refusals.caps;
        burst = 15;
        for (let i = 0; i < 15; i++) raw.socket.send(authFrame(`${name}\u0000s${i}`, token));
        await sleep(1500);
        burst = Infinity;
        const held = liveFor(name, "mallory");
        console.log(`  one socket, 15 sessions for one user: ${held} connections established`);
        expect(held).toBeLessThanOrEqual(PER_USER);
        // Each session held its own seat while they all waited on the ledger.
        if (ledgerMs) {
          expect(server.metrics.refusals.caps - capped).toBe(15 - PER_USER);
        }
        raw.socket.close();
      });

      it(`a canvas can't take more than ${PER_CANVAS} connections through session keys on one socket`, async () => {
        const canvasId = await seedCanvas(db);
        const name = documentName("canvas", canvasId);
        const raw = rawSocket(server.port);
        await until(() => raw.state.open);
        const capped = server.metrics.refusals.caps;
        burst = 60;
        for (let i = 0; i < 60; i++) {
          const token = await signCanvasToken({ c: name, u: `crowd${i}`, a: "write" }, SECRET);
          raw.socket.send(authFrame(`${name}\u0000s${i}`, token));
        }
        await sleep(2000);
        burst = Infinity;
        const held = liveFor(name);
        console.log(`  one socket, 60 sessions for 60 users: ${held} connections established`);
        expect(held).toBeLessThanOrEqual(PER_CANVAS);
        if (ledgerMs) {
          expect(server.metrics.refusals.caps - capped).toBe(60 - PER_CANVAS);
        }
        raw.socket.close();
      });

      it("session-keyed connections are closed once established, and free their seats", async () => {
        const canvasId = await seedCanvas(db);
        const name = documentName("canvas", canvasId);
        const raw = rawSocket(server.port);
        await until(() => raw.state.open);
        const token = await signCanvasToken({ c: name, u: "patient", a: "write" }, SECRET);
        for (let i = 0; i < 12; i++) {
          raw.socket.send(authFrame(`${name}\u0000p${i}`, token));
          await sleep(80);
        }
        await sleep(500);
        expect(liveFor(name, "patient")).toBe(0);
        expect(server.caps.localUserCount("patient")).toBe(0);
        // The plain document name on the same socket still connects.
        raw.socket.send(authFrame(name, token));
        expect(await until(() => liveFor(name, "patient") === 1, 3000)).toBe(true);
        raw.socket.close();
      });
    },
  );
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

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

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
  rawSocket,
  SECRET,
  seedCanvas,
  sleep,
  TEST_DATABASE_URL,
  testDb,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(30_000);

if (!TEST_DATABASE_URL)
  warnSkipped("connection caps over one socket", "CANVAS_SYNC_TEST_DATABASE_URL");

/**
 * Hocuspocus routes `<documentName>\0<sessionId>` keys to separate
 * connections on one websocket (the provider's `sessionAwareness`). A raw
 * client can open many connections to one canvas over a single socket, all
 * authenticating at once.
 */
for (const ledgerMs of [0, 300]) {
  describe.skipIf(!TEST_DATABASE_URL)(
    `connection caps over a multiplexed socket (ledger ${ledgerMs}ms)`,
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
          telemetry: { captureException() {}, capture() {}, async shutdown() {} },
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

      it(`one user can't hold more than ${SYNC_LIMITS.connectionsPerUser} connections through session keys on one socket`, async () => {
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
        expect(held).toBeLessThanOrEqual(SYNC_LIMITS.connectionsPerUser);
        // Each session held its own seat while they all waited on the ledger.
        if (ledgerMs) {
          expect(server.metrics.refusals.caps - capped).toBe(15 - SYNC_LIMITS.connectionsPerUser);
        }
        raw.socket.close();
      });

      it(`a canvas can't take more than ${SYNC_LIMITS.connectionsPerCanvas} connections through session keys on one socket`, async () => {
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
        expect(held).toBeLessThanOrEqual(SYNC_LIMITS.connectionsPerCanvas);
        if (ledgerMs) {
          expect(server.metrics.refusals.caps - capped).toBe(60 - SYNC_LIMITS.connectionsPerCanvas);
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

      it(`separate sockets: the ${SYNC_LIMITS.connectionsPerCanvas + 1}st simultaneous connection to a canvas is refused`, async () => {
        const canvasId = await seedCanvas(db);
        const name = documentName("canvas", canvasId);
        const sockets = Array.from({ length: 60 }, () => rawSocket(server.port));
        await until(() => sockets.every((s) => s.state.open));
        const tokens = await Promise.all(
          sockets.map((_, i) => signCanvasToken({ c: name, u: `sep${i}`, a: "write" }, SECRET)),
        );
        sockets.forEach((s, i) => s.socket.send(authFrame(name, tokens[i]!)));
        await sleep(2000);
        const held = liveFor(name);
        console.log(`  60 sockets, 60 users at once: ${held} connections established`);
        expect(held).toBeLessThanOrEqual(SYNC_LIMITS.connectionsPerCanvas);
        for (const s of sockets) s.socket.close();
      });

      it(`separate sockets: one user's ${SYNC_LIMITS.connectionsPerUser + 1}th simultaneous connection is refused`, async () => {
        const canvasId = await seedCanvas(db);
        const name = documentName("canvas", canvasId);
        const sockets = Array.from({ length: 15 }, () => rawSocket(server.port));
        await until(() => sockets.every((s) => s.state.open));
        const token = await signCanvasToken({ c: name, u: "eager", a: "write" }, SECRET);
        for (const s of sockets) s.socket.send(authFrame(name, token));
        await sleep(1500);
        const held = liveFor(name, "eager");
        console.log(`  15 sockets, one user at once: ${held} connections established`);
        expect(held).toBeLessThanOrEqual(SYNC_LIMITS.connectionsPerUser);
        for (const s of sockets) s.socket.close();
      });
    },
  );
}

describe.skipIf(!TEST_DATABASE_URL)(
  "connection caps with the real Redis ledger (fake RESP server)",
  () => {
    let db: ServiceDb;
    let end: () => Promise<void>;
    let server: SyncServer;
    const redis = new FakeRedis();

    beforeAll(async () => {
      ({ db, end } = testDb());
      await redis.start();
      server = await startServer({
        port: 0,
        secret: SECRET,
        db,
        instanceId: "caps-ledger",
        telemetry: { captureException() {}, capture() {}, async shutdown() {} },
        debounceMs: 200,
        maxDebounceMs: 1000,
        ledger: redisLedger(redis.url, "caps-test:canvas-sync", "caps-ledger"),
      });
    });

    afterAll(async () => {
      await server.stop(5000);
      await redis.stop();
      await end();
    });

    it(`the ${SYNC_LIMITS.connectionsPerCanvas + 1}st simultaneous connection to a canvas is refused`, async () => {
      const canvasId = await seedCanvas(db);
      const name = documentName("canvas", canvasId);
      const sockets = Array.from({ length: 60 }, () => rawSocket(server.port));
      await until(() => sockets.every((s) => s.state.open));
      const tokens = await Promise.all(
        sockets.map((_, i) => signCanvasToken({ c: name, u: `led${i}`, a: "write" }, SECRET)),
      );
      sockets.forEach((s, i) => s.socket.send(authFrame(name, tokens[i]!)));
      await sleep(2000);
      const held = server.hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0;
      console.log(`  real ledger, 60 sockets at once: ${held} connections established`);
      expect(held).toBeLessThanOrEqual(SYNC_LIMITS.connectionsPerCanvas);
      for (const s of sockets) s.socket.close();
    });
  },
);

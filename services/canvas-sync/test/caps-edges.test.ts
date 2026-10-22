import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { eq } from "drizzle-orm";

import { canvasDocs } from "../../../src/db/schema.ts";
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

if (!TEST_DATABASE_URL) warnSkipped("connection cap edges", "CANVAS_SYNC_TEST_DATABASE_URL");

const PER_CANVAS = SYNC_LIMITS.connectionsPerCanvas;
const PER_USER = SYNC_LIMITS.connectionsPerUser;
const quiet = { captureException() {}, capture() {}, async shutdown() {} };

/** `until` with room for a loaded machine, failing as a timeout rather than as a later count mismatch. */
async function waitFor(check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  if (!(await until(check, ms))) throw new Error(`condition not met within ${ms}ms`);
}

function slowLedger(ms: number): UserConnectionLedger {
  return {
    othersCount: () => new Promise((resolve) => setTimeout(() => resolve(0), ms)),
    async record() {},
    async close() {},
  };
}

type Variant = {
  label: string;
  slow: boolean;
  setup: () => Promise<{ ledger?: UserConnectionLedger; teardown: () => Promise<void> }>;
};

const variants: Variant[] = [
  { label: "local", slow: false, setup: async () => ({ teardown: async () => {} }) },
  {
    label: "300ms ledger",
    slow: true,
    setup: async () => ({ ledger: slowLedger(300), teardown: async () => {} }),
  },
  {
    label: "redisLedger over FakeRedis",
    slow: false,
    setup: async () => {
      const redis = await new FakeRedis().start();
      return {
        ledger: redisLedger(redis.url, "caps-edges:canvas-sync", "edges-redis"),
        teardown: () => redis.stop(),
      };
    },
  },
];

for (const variant of variants) {
  describe.skipIf(!TEST_DATABASE_URL)(`cap edges, ${variant.label}`, () => {
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
        instanceId: `edges-${variant.label}`,
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

    const liveForUser = (userId: string) => {
      let n = 0;
      for (const doc of server.hocuspocus.documents.values())
        for (const c of doc.getConnections()) if ((c.context as SyncContext).userId === userId) n++;
      return n;
    };
    const settle = async () => {
      await sleep(variant.slow ? 600 : 400);
      await waitFor(() => server.caps.pendingCount() === 0);
      await sleep(200);
    };

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
  });
}

describe.skipIf(!TEST_DATABASE_URL)("cap edges, a doc that fails to load", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;

  beforeAll(async () => {
    ({ db, end } = testDb());
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "edges-load-fail",
      telemetry: quiet,
    });
  });

  afterAll(async () => {
    await server.stop(5000);
    await end();
  });

  it("frees the seats of connections whose doc can't be loaded", async () => {
    const broken = await seedCanvas(db);
    await db
      .update(canvasDocs)
      .set({ state: Buffer.from([0xff, 0xff, 0xff, 0xff, 0x01, 0x02]) })
      .where(eq(canvasDocs.canvasId, broken));
    const name = documentName("canvas", broken);
    const token = await signCanvasToken({ c: name, u: "loadfail", a: "write" }, SECRET);
    const sockets = Array.from({ length: PER_USER }, () => rawSocket(server.port));
    await waitFor(() => sockets.every((s) => s.state.open));
    for (const s of sockets) s.socket.send(authFrame(name, token));
    await sleep(1500);
    const live = server.hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0;
    const pending = server.caps.pendingCount();
    const good = await seedCanvas(db);
    const client = connect(server.port, good, "loadfail");
    const ok = await synced(client, 3000);
    client.destroy();
    for (const s of sockets) s.socket.close();
    console.log(`  broken doc: ${live} live, ${pending} seats pending; good canvas synced: ${ok}`);
    expect({ pending, ok }).toEqual({ pending: 0, ok: true });
  });
});

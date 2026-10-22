import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { eq } from "drizzle-orm";
import * as decoding from "lib0/decoding";
import * as Y from "yjs";

import { canvasDocs, canvases } from "../../../src/db/schema.ts";
import { SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { documentName } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
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

setDefaultTimeout(90_000);

if (!TEST_DATABASE_URL)
  warnSkipped("caps when a doc fails to load", "CANVAS_SYNC_TEST_DATABASE_URL");

const PER_CANVAS = SYNC_LIMITS.connectionsPerCanvas;
const PER_USER = SYNC_LIMITS.connectionsPerUser;
const quiet = { captureException() {}, capture() {}, async shutdown() {} };
const CORRUPT = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x01, 0x02]);
const EMPTY = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));

async function waitFor(check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  if (!(await until(check, ms))) throw new Error(`condition not met within ${ms}ms`);
}

/** Names the server answered permission-denied for on this socket. */
function deniedOn(socket: WebSocket): Set<string> {
  const denied = new Set<string>();
  socket.addEventListener("message", (event) => {
    const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
    const name = decoding.readVarString(decoder);
    // MessageType.Auth, then AuthMessageType.PermissionDenied.
    if (decoding.readVarUint(decoder) === 2 && decoding.readVarUint(decoder) === 1)
      denied.add(name);
  });
  return denied;
}

/** Wraps a ledger and keeps the last count written for each user. */
function recording(inner: UserConnectionLedger) {
  const last = new Map<string, number>();
  const ledger: UserConnectionLedger = {
    othersCount: (userId) => inner.othersCount(userId),
    record: (userId, count) => {
      last.set(userId, count);
      return inner.record(userId, count);
    },
    close: () => inner.close(),
  };
  return { ledger, last };
}

function slowLedger(ms: number): UserConnectionLedger {
  return {
    othersCount: () => new Promise((resolve) => setTimeout(() => resolve(0), ms)),
    async record() {},
    async close() {},
  };
}

const nullLedger: UserConnectionLedger = {
  othersCount: async () => 0,
  async record() {},
  async close() {},
};

type Variant = {
  label: string;
  slow: boolean;
  setup: () => Promise<{ ledger: UserConnectionLedger; teardown: () => Promise<void> }>;
};

const variants: Variant[] = [
  {
    label: "local",
    slow: false,
    setup: async () => ({ ledger: nullLedger, teardown: async () => {} }),
  },
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
        ledger: redisLedger(redis.url, "caps-load-fail:canvas-sync", "lf-redis"),
        teardown: () => redis.stop(),
      };
    },
  },
];

for (const variant of variants) {
  describe.skipIf(!TEST_DATABASE_URL)(`load failures, ${variant.label}`, () => {
    let db: ServiceDb;
    let end: () => Promise<void>;
    let server: SyncServer;
    let teardown: () => Promise<void>;
    let last: Map<string, number>;

    beforeAll(async () => {
      ({ db, end } = testDb());
      const setup = await variant.setup();
      teardown = setup.teardown;
      const rec = recording(setup.ledger);
      last = rec.last;
      server = await startServer({
        port: 0,
        secret: SECRET,
        db,
        instanceId: `lf-${variant.label}`,
        telemetry: quiet,
        debounceMs: 200,
        maxDebounceMs: 1000,
        ledger: rec.ledger,
      });
    });

    afterAll(async () => {
      await server.stop(5000);
      await teardown();
      await end();
    });

    const settle = async () => {
      await sleep(variant.slow ? 700 : 400);
      await waitFor(() => server.caps.pendingCount() === 0);
      await sleep(200);
    };

    it(`60 users bursting a corrupt canvas hold nothing; once repaired exactly ${PER_CANVAS} get in`, async () => {
      const canvasId = await seedCanvas(db);
      await db.update(canvasDocs).set({ state: CORRUPT }).where(eq(canvasDocs.canvasId, canvasId));
      const name = documentName("canvas", canvasId);
      const users = Array.from({ length: 60 }, (_, i) => `lfburst-${variant.label}-${i}`);
      const tokens = await Promise.all(
        users.map((u) => signCanvasToken({ c: name, u, a: "write" }, SECRET)),
      );
      const first = users.map(() => rawSocket(server.port));
      const firstDenied = first.map((s) => deniedOn(s.socket));
      await waitFor(() => first.every((s) => s.state.open));
      first.forEach((s, i) => s.socket.send(authFrame(name, tokens[i]!)));
      await waitFor(() => firstDenied.every((d) => d.size === 1), 30_000);
      await settle();
      const brokenLive = server.hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0;
      const pendingAfterFail = server.caps.pendingCount();
      const lastCounts = users.map((u) => last.get(u) ?? 0);
      const localCounts = users.map((u) => server.caps.localUserCount(u));

      await db.update(canvasDocs).set({ state: EMPTY }).where(eq(canvasDocs.canvasId, canvasId));
      const capped = server.metrics.refusals.caps;
      const second = users.map(() => rawSocket(server.port));
      const secondDenied = second.map((s) => deniedOn(s.socket));
      await waitFor(() => second.every((s) => s.state.open));
      second.forEach((s, i) => s.socket.send(authFrame(name, tokens[i]!)));
      const docLive = () => server.hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0;
      await waitFor(() => docLive() + secondDenied.filter((d) => d.size > 0).length >= 60, 30_000);
      await settle();
      const held = server.hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0;
      const refused = server.metrics.refusals.caps - capped;
      for (const s of [...first, ...second]) s.socket.close();
      console.log(`  ${variant.label}: corrupt burst live ${brokenLive}, then ${held} held`);
      expect({ brokenLive, pendingAfterFail }).toEqual({ brokenLive: 0, pendingAfterFail: 0 });
      expect(localCounts.every((n) => n === 0)).toBe(true);
      expect(lastCounts.every((n) => n === 0)).toBe(true);
      expect({ held, refused }).toEqual({ held: PER_CANVAS, refused: 60 - PER_CANVAS });
    });

    it(`one socket mixing broken and good canvases: the user still reaches exactly ${PER_USER}`, async () => {
      const user = `lfmix-${variant.label}`;
      const broken = await Promise.all(Array.from({ length: 5 }, () => seedCanvas(db)));
      for (const id of broken)
        await db.update(canvasDocs).set({ state: CORRUPT }).where(eq(canvasDocs.canvasId, id));
      const good = await Promise.all(Array.from({ length: PER_USER + 2 }, () => seedCanvas(db)));
      const names = [...broken, ...good].map((id) => documentName("canvas", id));
      const tokens = await Promise.all(
        names.map((c) => signCanvasToken({ c, u: user, a: "write" }, SECRET)),
      );
      const { socket, state } = rawSocket(server.port);
      const denied = deniedOn(socket);
      await waitFor(() => state.open);
      names.forEach((n, i) => socket.send(authFrame(n, tokens[i]!)));
      await waitFor(
        () =>
          denied.size + server.caps.localUserCount(user) - server.caps.pendingCount() >=
          names.length,
        30_000,
      );
      await settle();
      const burstLive = server.caps.localUserCount(user);
      const pending = server.caps.pendingCount();

      // Broken loads hold seats while loading, so a burst may come in under
      // the cap; plain connects then top it up and the next is refused.
      const topUp = [];
      for (let i = burstLive; i < PER_USER; i++) {
        const unused = good[good.length - 1 - (i - burstLive)]!;
        const c = connect(server.port, unused, user);
        topUp.push(c);
      }
      for (const c of topUp) expect(await synced(c, 8000)).toBe(true);
      await sleep(200);
      const atCap = server.caps.localUserCount(user);
      const capped = server.metrics.refusals.caps;
      const extra = connect(server.port, await seedCanvas(db), user);
      await waitFor(() => server.metrics.refusals.caps > capped, 5000);
      const extraSynced = extra.provider.isSynced;
      extra.destroy();
      for (const c of topUp) c.destroy();
      socket.close();
      await waitFor(() => server.caps.localUserCount(user) === 0);
      console.log(
        `  ${variant.label}: mixed socket burst ${burstLive} live, topped up to ${atCap}`,
      );
      expect(burstLive).toBeLessThanOrEqual(PER_USER);
      expect({ pending, atCap, extraSynced }).toEqual({
        pending: 0,
        atCap: PER_USER,
        extraSynced: false,
      });
      expect(last.get(user)).toBe(0);
    });
  });
}

describe.skipIf(!TEST_DATABASE_URL)("a canvas deleted between auth and load", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  let last: Map<string, number>;

  beforeAll(async () => {
    ({ db, end } = testDb());
    const rec = recording(slowLedger(800));
    last = rec.last;
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "lf-deleted",
      telemetry: quiet,
      ledger: rec.ledger,
    });
  });

  afterAll(async () => {
    await server.stop(5000);
    await end();
  });

  it("frees the seats, and the user's other canvases still fill to the cap", async () => {
    const doomed = await seedCanvas(db);
    const user = "lfdeleted";
    const clients = Array.from({ length: PER_USER }, () => connect(server.port, doomed, user));
    await waitFor(() => server.caps.pendingCount() === PER_USER, 5000);
    await db.update(canvases).set({ deletedAt: new Date() }).where(eq(canvases.id, doomed));
    await waitFor(() => clients.every((c) => c.authFailures.length > 0));
    const reasons = new Set(clients.flatMap((c) => c.authFailures));
    const pending = server.caps.pendingCount();
    const local = server.caps.localUserCount(user);
    for (const c of clients) c.destroy();

    const good = await Promise.all(Array.from({ length: PER_USER }, () => seedCanvas(db)));
    const fresh = good.map((id) => connect(server.port, id, user));
    const allSynced = (await Promise.all(fresh.map((c) => synced(c, 8000)))).every(Boolean);
    for (const c of fresh) c.destroy();
    await waitFor(() => server.caps.localUserCount(user) === 0);
    expect([...reasons].some((r) => r.includes("deleted"))).toBe(true);
    expect({ pending, local, allSynced }).toEqual({ pending: 0, local: 0, allSynced: true });
    expect(last.get(user)).toBe(0);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("an instance restarting under the shared Redis ledger", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  const redis = new FakeRedis();

  beforeAll(async () => {
    ({ db, end } = testDb());
    await redis.start();
  });

  afterAll(async () => {
    await redis.stop();
    await end();
  });

  const start = (id: string) =>
    startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: id,
      telemetry: quiet,
      debounceMs: 200,
      maxDebounceMs: 1000,
      ledger: redisLedger(redis.url, "caps-restart:canvas-sync", id),
    });

  it(`a user's ${PER_USER} seats on a stopped instance free up for the one that stays`, async () => {
    const a = await start("restart-a");
    const b = await start("restart-b");
    const user = "restarter";
    const ids = await Promise.all(Array.from({ length: PER_USER }, () => seedCanvas(db)));
    const onA = ids.map((id) => connect(a.port, id, user));
    for (const c of onA) expect(await synced(c)).toBe(true);
    await sleep(300);

    const capped = b.metrics.refusals.caps;
    const blocked = connect(b.port, await seedCanvas(db), user);
    await waitFor(() => b.metrics.refusals.caps > capped, 5000);
    blocked.destroy();

    for (const c of onA) c.destroy();
    await a.stop(5000);
    const onB = ids.map((id) => connect(b.port, id, user));
    const allSynced = (await Promise.all(onB.map((c) => synced(c, 8000)))).every(Boolean);
    await sleep(300);
    const capped2 = b.metrics.refusals.caps;
    const extra = connect(b.port, await seedCanvas(db), user);
    await waitFor(() => b.metrics.refusals.caps > capped2, 5000);
    const extraSynced = extra.provider.isSynced;
    extra.destroy();
    for (const c of onB) c.destroy();
    await b.stop(5000);
    expect({ allSynced, extraSynced }).toEqual({ allSynced: true, extraSynced: false });
  });
});

describe.skipIf(!TEST_DATABASE_URL)("malformed auth frames", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;

  beforeAll(async () => {
    ({ db, end } = testDb());
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "lf-malformed",
      telemetry: quiet,
    });
  });

  afterAll(async () => {
    await server.stop(5000);
    await end();
  });

  it("reserve no seat and leave the server serving", async () => {
    const canvasId = await seedCanvas(db);
    const name = documentName("canvas", canvasId);
    const valid = await signCanvasToken({ c: name, u: "malformed", a: "write" }, SECRET);
    const notCanvas = await signCanvasToken({ c: "team:abc", u: "malformed", a: "write" }, SECRET);
    const frames: Uint8Array<ArrayBuffer>[] = [
      new Uint8Array([]),
      new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      authFrame("", valid),
      authFrame("team:abc", notCanvas),
      authFrame(name, "x".repeat(200_000)),
      authFrame(`${name}\0`, valid),
      authFrame(name, valid).slice(0, 10),
    ];
    const sockets = frames.map(() => rawSocket(server.port));
    await waitFor(() => sockets.every((s) => s.state.open));
    frames.forEach((f, i) => sockets[i]!.socket.send(f));
    await sleep(1500);
    const pending = server.caps.pendingCount();
    for (const s of sockets) s.socket.close();
    await waitFor(() => server.caps.localUserCount("malformed") === 0);
    const client = connect(server.port, canvasId, "malformed");
    const ok = await synced(client, 5000);
    client.destroy();
    expect({ pending, ok }).toEqual({ pending: 0, ok: true });
  });
});

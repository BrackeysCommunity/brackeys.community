import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import pg from "pg";

import { SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import { documentName } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { RESERVATION_TTL_MS } from "../src/limits.ts";
import {
  authFrame,
  rawSocket,
  SECRET,
  seedCanvas,
  sleep,
  TEST_DATABASE_URL,
  testDb,
  until,
} from "./harness.ts";

setDefaultTimeout(30_000);

const PER_CANVAS = SYNC_LIMITS.connectionsPerCanvas;
const WAVE = PER_CANVAS + 10;
const quiet = { captureException() {}, capture() {}, async shutdown() {} };

async function waitFor(check: () => boolean, ms = 10_000): Promise<void> {
  if (!(await until(check, ms))) throw new Error(`condition not met within ${ms}ms`);
}

describe.skipIf(!TEST_DATABASE_URL)("a document load stalled past the reservation TTL", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  // The server's clock; skipping it ahead stands in for a real stall past the TTL.
  let skew = 0;

  beforeAll(async () => {
    ({ db, end } = testDb());
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "slow-load",
      telemetry: quiet,
      now: () => Date.now() + skew,
    });
  });

  afterAll(async () => {
    await server.stop(5000);
    await end();
  });

  it(`keeps its seats, so the canvas still holds exactly ${PER_CANVAS}`, async () => {
    const name = documentName("canvas", await seedCanvas(db));
    const wave = async (tag: string) => {
      const tokens = await Promise.all(
        Array.from({ length: WAVE }, (_, i) =>
          signCanvasToken({ c: name, u: `${tag}-${i}`, a: "write" }, SECRET),
        ),
      );
      const sockets = tokens.map(() => rawSocket(server.port));
      await waitFor(() => sockets.every((s) => s.state.open));
      sockets.forEach((s, i) => s.socket.send(authFrame(name, tokens[i]!)));
      return sockets;
    };

    const locker = new pg.Client(TEST_DATABASE_URL);
    await locker.connect();
    const sockets = [];
    let released = false;
    try {
      await locker.query("BEGIN");
      await locker.query("LOCK TABLE canvas.canvas_docs IN ACCESS EXCLUSIVE MODE");
      const refusedBefore = server.metrics.refusals.caps;
      sockets.push(...(await wave("stall-a")));
      await waitFor(() => server.metrics.refusals.caps - refusedBefore === WAVE - PER_CANVAS);
      await sleep(100);
      expect(server.caps.pendingCount()).toBe(PER_CANVAS);

      skew += RESERVATION_TTL_MS + 1000;
      expect(server.caps.pendingCount()).toBe(PER_CANVAS);
      sockets.push(...(await wave("stall-b")));
      await waitFor(() => server.metrics.refusals.caps - refusedBefore === 2 * WAVE - PER_CANVAS);

      await locker.query("COMMIT");
      released = true;
      const live = () => server.hocuspocus.documents.get(name)?.getConnectionsCount() ?? 0;
      await waitFor(() => live() === PER_CANVAS && server.caps.pendingCount() === 0);
      await sleep(200);
      expect({ live: live(), pending: server.caps.pendingCount() }).toEqual({
        live: PER_CANVAS,
        pending: 0,
      });
    } finally {
      if (!released) await locker.query("ROLLBACK").catch(() => {});
      await locker.end();
      for (const s of sockets) s.socket.close();
    }
  });
});

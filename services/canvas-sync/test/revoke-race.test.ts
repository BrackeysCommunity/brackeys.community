import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { documentName, SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import type { UserConnectionLedger } from "../src/limits.ts";
import {
  connect,
  SECRET,
  seedCanvas,
  sleep,
  synced,
  TEST_DATABASE_URL,
  testDb,
  type TestClient,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(30_000);

if (!TEST_DATABASE_URL) warnSkipped("revokes racing a connect", "CANVAS_SYNC_TEST_DATABASE_URL");

/**
 * onAuthenticate checks the revocation list first, then awaits the canvas
 * row and the per-user ledger (a Redis round trip, up to its 1s command
 * timeout), then Hocuspocus loads the document. A revoke landing in any of
 * those awaits finds no connection to close yet.
 */
describe.skipIf(!TEST_DATABASE_URL)("a revoke racing a connect", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  let ledgerDelayMs = 0;
  let onLedger: (() => void) | null = null;
  const clients: TestClient[] = [];

  const slowLedger: UserConnectionLedger = {
    async othersCount() {
      onLedger?.();
      await sleep(ledgerDelayMs);
      return 0;
    },
    async record() {},
    async close() {},
  };

  beforeAll(async () => {
    ({ db, end } = testDb());
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "revoke-race",
      telemetry: { captureException() {}, capture() {}, async shutdown() {} },
      debounceMs: 200,
      maxDebounceMs: 1000,
      ledger: slowLedger,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(5000);
    await end();
  });

  it("doesn't leave a revoked member connected when the revoke lands mid-authentication", async () => {
    const canvasId = await seedCanvas(db);
    const name = documentName("canvas", canvasId);
    const token = await signCanvasToken({ c: name, u: "mallory", a: "write" }, SECRET);
    ledgerDelayMs = 400;
    let revoked = 0;
    onLedger = () => {
      onLedger = null;
      // The web app removes mallory while her connect is in flight.
      setTimeout(() => {
        revoked = server.handleRevoke({ canvasId, userId: "mallory" });
      }, 100);
    };
    const m = connect(server.port, canvasId, "mallory", { token: async () => token });
    clients.push(m);
    await sleep(1500);
    console.log(
      `  revoke closed ${revoked} connection(s); mallory synced=${m.provider.isSynced}, closes=${JSON.stringify(m.closes)}, authFailures=${JSON.stringify(m.authFailures)}`,
    );
    // Either refused or closed with 4403; never left syncing with write access.
    const shutOut =
      m.authFailures.some((r) => r.startsWith(`${SYNC_CLOSE.revoked}`)) ||
      m.closes.includes(SYNC_CLOSE.revoked);
    expect(shutOut).toBe(true);
    expect(await until(() => !m.provider.isSynced, 1000)).toBe(true);
    ledgerDelayMs = 0;
  });

  it("control: a connect after the revoke with the same token is refused", async () => {
    const canvasId = await seedCanvas(db);
    const name = documentName("canvas", canvasId);
    const token = await signCanvasToken({ c: name, u: "mallory", a: "write" }, SECRET);
    server.handleRevoke({ canvasId, userId: "mallory" });
    const m = connect(server.port, canvasId, "mallory", { token: async () => token });
    clients.push(m);
    expect(await until(() => m.authFailures.length > 0, 3000)).toBe(true);
    expect(m.authFailures[0]).toStartWith(`${SYNC_CLOSE.revoked}`);
    const other = connect(server.port, canvasId, "alice");
    clients.push(other);
    expect(await synced(other)).toBe(true);
  });
});

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { join } from "node:path";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { eq } from "drizzle-orm";
import * as Y from "yjs";

import { canvasDocs } from "../../../src/db/schema.ts";
import { documentName, SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken } from "../../../src/lib/canvas/token.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { storeCanvasState } from "../src/persistence.ts";
import {
  addCard,
  connect,
  SECRET,
  seedCanvas,
  sleep,
  storedNodeIds,
  synced,
  TEST_DATABASE_URL,
  testDb,
  type TestClient,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(60_000);

const noTelemetry = { captureException() {}, capture() {}, async shutdown() {} };
const SERVICE_DIR = join(import.meta.dir, "..");

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port!;
  await probe.stop(true);
  return port;
}

/** The service as Railway runs it: `bun run src/index.ts` with env only. */
function spawnService(port: number, env: Record<string, string> = {}) {
  const output: string[] = [];
  // Unset rather than empty: config refuses an empty REDIS_URL.
  const base = { ...process.env };
  for (const key of ["REDIS_URL", "POSTHOG_KEY", "VITE_POSTHOG_KEY"]) delete base[key];
  const child = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: SERVICE_DIR,
    env: {
      ...base,
      DATABASE_URL: TEST_DATABASE_URL!,
      CANVAS_SYNC_SECRET: SECRET,
      PORT: String(port),
      INSTANCE_ID: `sub-${port}`,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) output.push(decoder.decode(chunk));
  };
  void drain(child.stdout);
  void drain(child.stderr);
  return { child, output };
}

async function waitHealthy(port: number, ms = 15_000): Promise<boolean> {
  return until(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
    } catch {
      return false;
    }
  }, ms);
}

/** A second provider on the same doc, the way a reconnect to another instance looks. */
function reattach(client: TestClient, port: number, canvasId: string, userId: string): TestClient {
  client.provider.destroy();
  const name = documentName("canvas", canvasId);
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name,
    document: client.doc,
    token: () => signCanvasToken({ c: name, u: userId, a: "write" }, SECRET),
  });
  return { ...client, provider, destroy: () => provider.destroy() };
}

if (!TEST_DATABASE_URL) warnSkipped("canvas-sync recovery tests", "CANVAS_SYNC_TEST_DATABASE_URL");

describe.skipIf(!TEST_DATABASE_URL)("canvas-sync restarts and overlap", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  const cleanup: (() => unknown)[] = [];

  beforeAll(() => {
    ({ db, end } = testDb());
  });

  afterAll(async () => {
    for (const step of cleanup.reverse()) await step();
    await end();
  });

  it("SIGTERM with a 30s store pending flushes every edit and exits 0", async () => {
    const port = await freePort();
    const service = spawnService(port, { STORE_DEBOUNCE_MS: "30000" });
    cleanup.push(() => service.child.kill("SIGKILL"));
    expect(await waitHealthy(port)).toBe(true);

    const canvasId = await seedCanvas(db);
    const a = connect(port, canvasId, "alice");
    const b = connect(port, canvasId, "bob");
    cleanup.push(
      () => a.destroy(),
      () => b.destroy(),
    );
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    for (let i = 0; i < 10; i++) addCard(i % 2 ? a : b, `t${i}`);
    expect(await until(() => a.nodes.size === 10 && b.nodes.size === 10, 3000)).toBe(true);
    expect(
      await until(() => !a.provider.hasUnsyncedChanges && !b.provider.hasUnsyncedChanges),
    ).toBe(true);
    await sleep(300);
    expect(await storedNodeIds(db, canvasId)).toEqual([]);

    const started = performance.now();
    service.child.kill("SIGTERM");
    const code = await service.child.exited;
    const took = performance.now() - started;
    console.log(`  SIGTERM exit ${code} after ${took.toFixed(0)}ms`);
    expect(code).toBe(0);
    expect(took).toBeLessThan(25_000);
    expect((await storedNodeIds(db, canvasId)).length).toBe(10);
    expect(service.output.join("")).toContain("[shutdown] done");
  });

  it("redeploy: after SIGTERM, clients reconnect to the new instance on their own and keep editing", async () => {
    const port = await freePort();
    let service = spawnService(port);
    expect(await waitHealthy(port)).toBe(true);
    const canvasId = await seedCanvas(db);
    const a = connect(port, canvasId, "alice");
    const b = connect(port, canvasId, "bob");
    cleanup.push(
      () => a.destroy(),
      () => b.destroy(),
    );
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    addCard(a, "before");
    // Received (not yet stored): an edit still in flight is the client's to resend.
    expect(await until(() => !a.provider.hasUnsyncedChanges, 3000)).toBe(true);
    service.child.kill("SIGTERM");
    expect(await service.child.exited).toBe(0);
    expect(await storedNodeIds(db, canvasId)).toEqual(["before"]);

    // Edits during the gap, then the new instance comes up.
    addCard(a, "gap-a");
    addCard(b, "gap-b");
    service = spawnService(port);
    cleanup.push(() => service.child.kill("SIGKILL"));
    expect(await waitHealthy(port)).toBe(true);
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 3, 15_000)).toBe(
      true,
    );
    expect(await until(() => a.nodes.size === 3 && b.nodes.size === 3, 5000)).toBe(true);
    addCard(b, "after");
    expect(await until(() => a.nodes.has("after"), 2000)).toBe(true);
    service.child.kill("SIGTERM");
    expect(await service.child.exited).toBe(0);
  });

  it("SIGKILL before the debounce, offline edits on both sides, restart: everything lands", async () => {
    const port = await freePort();
    let service = spawnService(port);
    expect(await waitHealthy(port)).toBe(true);

    const canvasId = await seedCanvas(db);
    const a = connect(port, canvasId, "alice");
    const b = connect(port, canvasId, "bob");
    cleanup.push(
      () => a.destroy(),
      () => b.destroy(),
    );
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    addCard(a, "a-live");
    addCard(b, "b-live");
    expect(await until(() => a.nodes.size === 2 && b.nodes.size === 2, 2000)).toBe(true);
    service.child.kill("SIGKILL");
    await service.child.exited;
    expect(await storedNodeIds(db, canvasId)).toEqual([]);

    // Offline: both keep editing.
    for (let i = 0; i < 5; i++) {
      addCard(a, `a-off${i}`);
      addCard(b, `b-off${i}`);
    }
    await sleep(500);
    service = spawnService(port);
    cleanup.push(() => service.child.kill("SIGKILL"));
    expect(await waitHealthy(port)).toBe(true);
    const expected = [
      "a-live",
      "b-live",
      ...[0, 1, 2, 3, 4].flatMap((i) => [`a-off${i}`, `b-off${i}`]),
    ].sort();
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 12, 30_000)).toBe(
      true,
    );
    expect(await storedNodeIds(db, canvasId)).toEqual(expected);
    expect(await until(() => a.nodes.size === 12 && b.nodes.size === 12, 5000)).toBe(true);
    service.child.kill("SIGTERM");
    expect(await service.child.exited).toBe(0);
  });

  it("two instances on one DB without Redis: the union lands, and survives one stopping", async () => {
    const { db: db2, end: end2 } = testDb();
    cleanup.push(end2);
    const one = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "one",
      telemetry: noTelemetry,
      debounceMs: 200,
      maxDebounceMs: 1000,
    });
    const two = await startServer({
      port: 0,
      secret: SECRET,
      db: db2,
      instanceId: "two",
      telemetry: noTelemetry,
      debounceMs: 200,
      maxDebounceMs: 1000,
    });
    cleanup.push(
      () => two.stop(3000),
      () => one.stop(3000),
    );

    const canvasId = await seedCanvas(db);
    let a = connect(one.port, canvasId, "alice");
    const b = connect(two.port, canvasId, "bob");
    cleanup.push(
      () => a.destroy(),
      () => b.destroy(),
    );
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    for (let i = 0; i < 10; i++) {
      addCard(a, `one-${i}`);
      addCard(b, `two-${i}`);
      await sleep(20);
    }
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 20, 10_000)).toBe(
      true,
    );
    console.log(`  overlap union: ${(await storedNodeIds(db, canvasId)).length}/20`);

    // Deploy ends: instance one stops, its client reconnects to two.
    await one.stop(5000);
    a = reattach(a, two.port, canvasId, "alice");
    expect(await synced(a)).toBe(true);
    addCard(a, "after-move");
    expect(await until(() => a.nodes.size === 21 && b.nodes.size === 21, 5000)).toBe(true);
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 21, 5000)).toBe(
      true,
    );
  });

  it("a deletion on one instance isn't undone by a stale store on another", async () => {
    const { db: db2, end: end2 } = testDb();
    cleanup.push(end2);
    const one = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "del-one",
      telemetry: noTelemetry,
      debounceMs: 200,
      maxDebounceMs: 1000,
    });
    const two = await startServer({
      port: 0,
      secret: SECRET,
      db: db2,
      instanceId: "del-two",
      telemetry: noTelemetry,
      debounceMs: 200,
      maxDebounceMs: 1000,
    });
    cleanup.push(
      () => two.stop(3000),
      () => one.stop(3000),
    );

    const canvasId = await seedCanvas(db);
    const a = connect(one.port, canvasId, "alice");
    cleanup.push(() => a.destroy());
    expect(await synced(a)).toBe(true);
    addCard(a, "doomed");
    addCard(a, "kept");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 2, 3000)).toBe(
      true,
    );

    // Instance two loads the canvas while "doomed" still exists.
    const b = connect(two.port, canvasId, "bob");
    cleanup.push(() => b.destroy());
    expect(await synced(b)).toBe(true);
    expect(b.nodes.has("doomed")).toBe(true);

    a.nodes.delete("doomed");
    expect(
      await until(async () => !(await storedNodeIds(db, canvasId)).includes("doomed"), 3000),
    ).toBe(true);
    addCard(b, "from-two");
    expect(
      await until(async () => (await storedNodeIds(db, canvasId)).includes("from-two"), 3000),
    ).toBe(true);
    expect(await storedNodeIds(db, canvasId)).toEqual(["from-two", "kept"]);
    // Two's store folded the deletion into its live doc too.
    expect(await until(() => !b.nodes.has("doomed"), 2000)).toBe(true);
  });

  it("first stores racing on a canvas with no doc row both land (x20)", async () => {
    const { db: db2, end: end2 } = testDb();
    cleanup.push(end2);
    for (let round = 0; round < 20; round++) {
      const canvasId = await seedCanvas(db);
      await db.delete(canvasDocs).where(eq(canvasDocs.canvasId, canvasId));
      const docs = [new Y.Doc(), new Y.Doc()];
      docs[0]!.getMap("nodes").set(`x-${round}`, new Y.Map());
      docs[1]!.getMap("nodes").set(`y-${round}`, new Y.Map());
      const outcomes = await Promise.all([
        storeCanvasState(db, {
          canvasId,
          document: docs[0]!,
          editorId: null,
          withSnapshot: false,
          now: new Date(),
        }),
        storeCanvasState(db2, {
          canvasId,
          document: docs[1]!,
          editorId: null,
          withSnapshot: false,
          now: new Date(),
        }),
      ]);
      expect(outcomes.map((o) => o.kind)).toEqual(["stored", "stored"]);
      expect(await storedNodeIds(db, canvasId)).toEqual([`x-${round}`, `y-${round}`]);
    }
  });

  it("first live stores from two instances on a canvas with no doc row: union", async () => {
    const { db: db2, end: end2 } = testDb();
    cleanup.push(end2);
    const one = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "race-one",
      telemetry: noTelemetry,
      debounceMs: 100,
      maxDebounceMs: 500,
    });
    const two = await startServer({
      port: 0,
      secret: SECRET,
      db: db2,
      instanceId: "race-two",
      telemetry: noTelemetry,
      debounceMs: 100,
      maxDebounceMs: 500,
    });
    cleanup.push(
      () => two.stop(3000),
      () => one.stop(3000),
    );
    const canvasId = await seedCanvas(db);
    await db.delete(canvasDocs).where(eq(canvasDocs.canvasId, canvasId));
    const a = connect(one.port, canvasId, "alice");
    const b = connect(two.port, canvasId, "bob");
    cleanup.push(
      () => a.destroy(),
      () => b.destroy(),
    );
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    addCard(a, "first-a");
    addCard(b, "first-b");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 2, 5000)).toBe(
      true,
    );
  });

  it("an offline backlog over 1 MB (but under the 5 MB canvas cap) still syncs on reconnect", async () => {
    const port = await freePort();
    let service = spawnService(port);
    expect(await waitHealthy(port)).toBe(true);
    const canvasId = await seedCanvas(db);
    const a = connect(port, canvasId, "alice");
    cleanup.push(() => a.destroy());
    expect(await synced(a)).toBe(true);
    addCard(a, "online");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).length === 1, 5000)).toBe(
      true,
    );
    // The connection drops (here: the instance dies).
    service.child.kill("SIGKILL");
    await service.child.exited;

    // Fifteen 100 KB cards while it's down: each edit small, 1.5 MB in all.
    for (let i = 0; i < 15; i++) addCard(a, `off${i}`, "q".repeat(100 * 1024));
    service = spawnService(port);
    cleanup.push(() => service.child.kill("SIGKILL"));
    expect(await waitHealthy(port)).toBe(true);
    const landed = await until(
      async () => (await storedNodeIds(db, canvasId)).length === 16,
      15_000,
    );
    console.log(
      `  backlog reconnect: closes ${JSON.stringify(a.closes)}, synced ${a.provider.isSynced}, stored ${(await storedNodeIds(db, canvasId)).length}`,
    );
    expect(landed).toBe(true);
    // Nothing was too large: the editor must not be told to stop for good.
    expect(a.closes).not.toContain(SYNC_CLOSE.tooLarge);
  });
});

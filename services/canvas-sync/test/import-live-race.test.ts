import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { eq } from "drizzle-orm";
import * as Y from "yjs";

import * as RootY from "../../../node_modules/yjs";
import { canvasDocs } from "../../../src/db/schema.ts";
import { docFromState, mergeStates, missingFrom } from "../../../src/lib/canvas/doc-state.ts";
import { applyJsonCanvas } from "../../../src/lib/canvas/json-canvas.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import {
  addCard,
  connect,
  SECRET,
  seedCanvas,
  sleep,
  storedNodeIds,
  storedState,
  synced,
  TEST_DATABASE_URL,
  testDb,
  type TestClient,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(60_000);

if (!TEST_DATABASE_URL)
  warnSkipped("concurrent imports into a live canvas", "CANVAS_SYNC_TEST_DATABASE_URL");

/** Stores an import the way `saveCanvasImport` does; returns the import's own Yjs client. */
async function importInDb(db: ServiceDb, canvasId: string, tab: TestClient, prefix: string) {
  const base = Y.encodeStateAsUpdate(tab.doc);
  const copy = docFromState(base);
  const client = copy.clientID;
  applyJsonCanvas(
    copy,
    {
      nodes: Array.from({ length: 3 }, (_, i) => ({
        id: `${prefix}${i}`,
        type: "text",
        text: `${prefix} ${i}`,
        x: i * 10,
        y: 0,
        width: 10,
        height: 10,
      })),
      edges: [],
    },
    { mode: "fragment" },
  );
  const update = missingFrom(
    RootY.encodeStateAsUpdate(copy),
    RootY.encodeStateVectorFromUpdate(base),
  );
  copy.destroy();
  const next = mergeStates(mergeStates((await storedState(db, canvasId))!, base), update);
  await db
    .update(canvasDocs)
    .set({ state: Buffer.from(next) })
    .where(eq(canvasDocs.canvasId, canvasId));
  return client;
}

describe.skipIf(!TEST_DATABASE_URL)("two imports stored before canvas-sync applies either", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;
  let server: SyncServer;
  const clients: TestClient[] = [];

  beforeAll(async () => {
    ({ db, end } = testDb());
    server = await startServer({
      port: 0,
      secret: SECRET,
      db,
      instanceId: "import-race",
      telemetry: { captureException() {}, capture() {}, async shutdown() {} },
      debounceMs: 200,
      maxDebounceMs: 1000,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(5000);
    await end();
  });

  // The apply reads the whole row, so the importer's tab can get both
  // imports in one transaction. The editor's undo step keeps only its own
  // import's structs (src/components/canvas/io/__tests__/import-capture-race.test.ts).
  it("the importer's tab gets both imports, possibly in one transaction", async () => {
    const canvasId = await seedCanvas(db);
    const a = connect(server.port, canvasId, "alice");
    const b = connect(server.port, canvasId, "bob");
    clients.push(a, b);
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    addCard(a, "c1");
    expect(await until(async () => (await storedNodeIds(db, canvasId)).includes("c1"))).toBe(true);
    await sleep(300);

    const seen: number[][] = [];
    a.doc.on("afterTransaction", (tr: Y.Transaction) => {
      const advanced = [...tr.afterState.keys()].filter(
        (c) => (tr.afterState.get(c) ?? 0) > (tr.beforeState.get(c) ?? 0),
      );
      if (advanced.length) seen.push(advanced);
    });

    const fromA = await importInDb(db, canvasId, a, "ia");
    const fromB = await importInDb(db, canvasId, b, "ib");
    // Each import publishes an apply; the first one read finds both stored.
    expect(await server.handleApply({ canvasId })).toBe(true);
    await server.handleApply({ canvasId });
    expect(await until(() => a.nodes.size === 7, 5000)).toBe(true);

    expect(seen.some((clients) => clients.includes(fromA))).toBe(true);
    expect(seen.some((clients) => clients.includes(fromB))).toBe(true);
  });
});

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { eq } from "drizzle-orm";
import * as Y from "yjs";

// The shared helpers build on the root's Yjs; this test's own Yjs is canvas-sync's.
import * as RootY from "../../../node_modules/yjs";
import { canvasDocs } from "../../../src/db/schema.ts";
import {
  docFromState,
  mergeStates,
  missingFrom,
  stateVectorOf,
} from "../../../src/lib/canvas/doc-state.ts";
import { applyJsonCanvas } from "../../../src/lib/canvas/json-canvas.ts";
import { CANVAS_LIMITS } from "../../../src/lib/canvas/limits.ts";
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

setDefaultTimeout(90_000);

if (!TEST_DATABASE_URL) warnSkipped("import into a live canvas", "CANVAS_SYNC_TEST_DATABASE_URL");

/**
 * An import built the way the editor builds one (on a copy of the tab's doc,
 * root Yjs, bytes out) and stored the way `saveCanvasImport` stores it:
 * stored ⊕ base, then ⊕ the import. Returns the import update and the reply.
 */
async function importInDb(
  db: ServiceDb,
  canvasId: string,
  tab: TestClient,
  canvas: unknown,
  docFields: Record<string, { text: string }> = {},
) {
  const base = Y.encodeStateAsUpdate(tab.doc);
  const stateVector = stateVectorOf(base);
  const copy = docFromState(base);
  applyJsonCanvas(copy, canvas, { mode: "fragment", docFields });
  const update = missingFrom(RootY.encodeStateAsUpdate(copy), stateVector);
  copy.destroy();
  const stored = (await storedState(db, canvasId))!;
  const next = mergeStates(mergeStates(stored, base), update);
  expect(next.byteLength).toBeLessThanOrEqual(CANVAS_LIMITS.maxStateBytes);
  await db
    .update(canvasDocs)
    .set({ state: Buffer.from(next) })
    .where(eq(canvasDocs.canvasId, canvasId));
  return { update, reply: missingFrom(next, stateVector), vector: stateVectorOf(next) };
}

/** Three cards stored as `saveCanvasImport` stores them; returns the import's own Yjs client. */
async function importCardsInDb(db: ServiceDb, canvasId: string, tab: TestClient, prefix: string) {
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

for (const withApply of [true, false]) {
  describe.skipIf(!TEST_DATABASE_URL)(
    `an import into a live canvas (${withApply ? "apply publish arrives" : "apply publish missed"})`,
    () => {
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
          instanceId: `import-${withApply}`,
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

      async function pair() {
        const canvasId = await seedCanvas(db);
        const a = connect(server.port, canvasId, "alice");
        const b = connect(server.port, canvasId, "bob");
        clients.push(a, b);
        expect(await synced(a)).toBe(true);
        expect(await synced(b)).toBe(true);
        addCard(a, "c1");
        expect(await until(async () => (await storedNodeIds(db, canvasId)).includes("c1"))).toBe(
          true,
        );
        await sleep(300);
        return { canvasId, a, b };
      }

      async function land(
        canvasId: string,
        a: TestClient,
        b: TestClient,
        built: Awaited<ReturnType<typeof importInDb>>,
      ) {
        const before = server.metrics.messages;
        // `applyRestored` while live: the provider's own origin, so never sent.
        Y.applyUpdate(a.doc, built.update, a.provider);
        Y.applyUpdate(a.doc, built.reply, a.provider);
        expect(a.provider.hasUnsyncedChanges).toBe(false);
        await sleep(300);
        expect(server.metrics.messages - before).toBe(0);
        if (withApply) expect(await server.handleApply({ canvasId })).toBe(true);
        else addCard(a, "nudge");
      }

      it("a single note body over 1 MB reaches the other editor and Postgres", async () => {
        const { canvasId, a, b } = await pair();
        const body = "n".repeat(CANVAS_LIMITS.maxMessageBytes + 50_000);
        const built = await importInDb(
          db,
          canvasId,
          a,
          { nodes: [{ id: "f", type: "file", file: "big.md", x: 0, y: 0, width: 1, height: 1 }] },
          { f: { text: body } },
        );
        expect(built.update.byteLength).toBeGreaterThan(CANVAS_LIMITS.maxMessageBytes);
        await land(canvasId, a, b, built);

        const bodyOn = (client: TestClient) =>
          [...client.nodes.values()].find((n) => n.get("type") === "file")?.get("text") as
            | Y.Text
            | undefined;
        expect(await until(() => bodyOn(b)?.length === body.length, 10_000)).toBe(true);
        // Editing on top of it reaches everyone.
        const imported = [...b.nodes.entries()].find(([, n]) => n.get("type") === "file")![0];
        b.nodes.get(imported)!.set("x", 500);
        expect(await until(() => a.nodes.get(imported)?.get("x") === 500, 5000)).toBe(true);
        expect(
          await until(async () => (await storedNodeIds(db, canvasId)).includes(imported), 5000),
        ).toBe(true);
        expect(a.closes).toEqual([]);
        expect(b.closes).toEqual([]);
        a.destroy();
        b.destroy();
      });

      it("several MB of cards in one import reach the other editor, a concurrent edit kept", async () => {
        const { canvasId, a, b } = await pair();
        const nodes = Array.from({ length: 4 }, (_, i) => ({
          id: `t${i}`,
          type: "text",
          text: `${i}`.repeat(700_000),
          x: i * 10,
          y: 0,
          width: 1,
          height: 1,
        }));
        const built = await importInDb(db, canvasId, a, { nodes });
        expect(built.update.byteLength).toBeGreaterThan(2_500_000);
        // Made after the import was built and stored; the importer sees it before the import lands.
        addCard(b, "while-importing");
        expect(await until(() => a.nodes.has("while-importing"), 5000)).toBe(true);
        await sleep(300);
        await land(canvasId, a, b, built);
        expect(await until(() => b.nodes.size === (withApply ? 6 : 7), 15_000)).toBe(true);
        expect(await until(() => a.nodes.has("while-importing"), 5000)).toBe(true);
        expect(
          await until(
            async () => (await storedNodeIds(db, canvasId)).length === (withApply ? 6 : 7),
            8000,
          ),
        ).toBe(true);
        expect(a.closes).toEqual([]);
        expect(b.closes).toEqual([]);
        a.destroy();
        b.destroy();
      });

      it("the importer reconnecting afterwards syncs without a 4413", async () => {
        const { canvasId, a, b } = await pair();
        const built = await importInDb(db, canvasId, a, {
          nodes: [
            { id: "t", type: "text", text: "r".repeat(1_500_000), x: 0, y: 0, width: 1, height: 1 },
          ],
        });
        await land(canvasId, a, b, built);
        a.provider.disconnect();
        await sleep(200);
        await a.provider.connect();
        expect(await synced(a, 10_000)).toBe(true);
        expect(await until(() => b.nodes.size === (withApply ? 2 : 3), 10_000)).toBe(true);
        await sleep(500);
        expect(a.closes.filter((c) => c != null)).toEqual([]);
        a.destroy();
        b.destroy();
      });
    },
  );
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
  // imports in one transaction; the editor's undo step keeps only its own
  // import's structs.
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

    const fromA = await importCardsInDb(db, canvasId, a, "ia");
    const fromB = await importCardsInDb(db, canvasId, b, "ib");
    // Each import publishes an apply; the first one read finds both stored.
    expect(await server.handleApply({ canvasId })).toBe(true);
    await server.handleApply({ canvasId });
    expect(await until(() => a.nodes.size === 7, 5000)).toBe(true);

    expect(seen.some((clients) => clients.includes(fromA))).toBe(true);
    expect(seen.some((clients) => clients.includes(fromB))).toBe(true);
  });
});

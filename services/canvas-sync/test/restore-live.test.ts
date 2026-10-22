import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { eq } from "drizzle-orm";
import * as Y from "yjs";

import { canvasDocs } from "../../../src/db/schema.ts";
import {
  docFromState,
  mergeStates,
  missingFrom,
  restoreCanvasInto,
} from "../../../src/lib/canvas/doc-state.ts";
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

if (!TEST_DATABASE_URL) warnSkipped("version restore while live", "CANVAS_SYNC_TEST_DATABASE_URL");

/**
 * What `restoreCanvasVersion` does to Postgres (restore `version` as an edit
 * on top of what's stored, write the merge), returning what the restoring
 * client gets back for `stateVector`. Bytes only: the shared helpers hold
 * the root's Yjs.
 */
async function restoreInDb(
  db: ServiceDb,
  canvasId: string,
  version: Uint8Array,
  stateVector: Uint8Array,
): Promise<Uint8Array> {
  const stored = (await storedState(db, canvasId))!;
  const live = docFromState(stored);
  const old = docFromState(version);
  const restore: Uint8Array[] = [];
  live.on("update", (update: Uint8Array) => restore.push(update));
  restoreCanvasInto(live, old, "restore");
  live.destroy();
  old.destroy();
  const state = mergeStates(stored, ...restore);
  await db
    .update(canvasDocs)
    .set({ state: Buffer.from(state) })
    .where(eq(canvasDocs.canvasId, canvasId));
  return missingFrom(state, stateVector);
}

function bigText(bytes: number): string {
  return Array.from({ length: bytes }, (_, i) => String.fromCharCode(97 + ((i * 11) % 26))).join(
    "",
  );
}

for (const withApply of [true, false]) {
  describe.skipIf(!TEST_DATABASE_URL)(
    `a version restored while the canvas is live (${withApply ? "apply publish arrives" : "apply publish missed"})`,
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
          instanceId: `restore-${withApply}`,
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

      it("reaches the other editor and Postgres, and the restorer's own copy is never sent back", async () => {
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
        const version = (await storedState(db, canvasId))!;
        addCard(a, "c2");
        addCard(b, "c3");
        expect(
          await until(async () => (await storedNodeIds(db, canvasId)).length === 3, 5000),
        ).toBe(true);
        await sleep(300);

        const sent: number[] = [];
        const before = server.metrics.messages;
        const update = await restoreInDb(db, canvasId, version, Y.encodeStateVector(a.doc));
        // The editor's live `applyRestored`: applied as the provider's own.
        Y.applyUpdate(a.doc, update, a.provider);
        expect([...a.nodes.keys()].sort()).toEqual(["c1"]);
        expect(a.provider.hasUnsyncedChanges).toBe(false);
        await sleep(200);
        sent.push(server.metrics.messages - before);
        expect(sent[0]).toBe(0);

        if (withApply) {
          expect(await server.handleApply({ canvasId })).toBe(true);
        } else {
          // Nothing tells the service; the next store's merge brings it in.
          addCard(a, "c4");
        }
        const want = withApply ? ["c1"] : ["c1", "c4"];
        expect(await until(() => [...b.nodes.keys()].sort().join() === want.join(), 5000)).toBe(
          true,
        );
        // Edits made on top of the restore by the restorer reach everyone too.
        addCard(a, "c5");
        expect(await until(() => b.nodes.has("c5"), 5000)).toBe(true);
        expect(
          await until(
            async () => (await storedNodeIds(db, canvasId)).join() === [...want, "c5"].join(),
            5000,
          ),
        ).toBe(true);
        expect([...a.nodes.keys()].sort()).toEqual([...want, "c5"]);
        expect(a.closes).toEqual([]);
        expect(b.closes).toEqual([]);
        a.destroy();
        b.destroy();
      });

      it("a restore that brings back over 1 MB reaches the other editor with no 4413", async () => {
        const canvasId = await seedCanvas(db);
        const a = connect(server.port, canvasId, "alice");
        const b = connect(server.port, canvasId, "bob");
        clients.push(a, b);
        expect(await synced(a)).toBe(true);
        expect(await synced(b)).toBe(true);
        // 1.5 MB as a single card, in three sub-cap appends so each update stays under 1 MB.
        addCard(a, "big", "");
        const text = a.nodes.get("big")!.get("text") as Y.Text;
        const content = bigText(1_500_000);
        for (let i = 0; i < 3; i++) {
          text.insert(text.length, content.slice(i * 500_000, (i + 1) * 500_000));
          await sleep(150);
        }
        expect(
          await until(
            async () => ((await storedState(db, canvasId))?.byteLength ?? 0) > 1_400_000,
            5000,
          ),
        ).toBe(true);
        const version = (await storedState(db, canvasId))!;
        a.nodes.delete("big");
        expect(await until(() => !b.nodes.has("big"), 5000)).toBe(true);
        expect(
          await until(async () => (await storedNodeIds(db, canvasId)).length === 0, 5000),
        ).toBe(true);
        await sleep(300);

        const update = await restoreInDb(db, canvasId, version, Y.encodeStateVector(a.doc));
        expect(update.byteLength).toBeGreaterThan(1_000_000);
        Y.applyUpdate(a.doc, update, a.provider);
        expect(a.provider.hasUnsyncedChanges).toBe(false);
        if (withApply) expect(await server.handleApply({ canvasId })).toBe(true);
        else addCard(a, "nudge");
        expect(
          await until(
            () => (b.nodes.get("big")?.get("text") as Y.Text | undefined)?.length === 1_500_000,
            8000,
          ),
        ).toBe(true);
        await sleep(300);
        expect(a.closes).toEqual([]);
        expect(b.closes).toEqual([]);
        a.destroy();
        b.destroy();
      });
    },
  );
}

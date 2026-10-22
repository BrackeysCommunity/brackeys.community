import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { eq } from "drizzle-orm";
import pg from "pg";
import * as Y from "yjs";

import { canvasDocVersions } from "../../../src/db/schema.ts";
import type { ServiceDb } from "../src/db.ts";
import { storeCanvasState } from "../src/persistence.ts";
import {
  seedCanvas,
  sleep,
  storedNodeIds,
  TEST_DATABASE_URL,
  testDb,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(30_000);

if (!TEST_DATABASE_URL) warnSkipped("live stores under row locks", "CANVAS_SYNC_TEST_DATABASE_URL");

/** A second session holding locks in an open transaction. */
async function holdTransaction() {
  const client = new pg.Client(TEST_DATABASE_URL);
  await client.connect();
  await client.query("BEGIN");
  return {
    query: (text: string, values: unknown[]) => client.query(text, values),
    async commit() {
      await client.query("COMMIT");
      await client.end();
    },
    async abandon() {
      await client.end();
    },
  };
}

function docWith(...ids: string[]): Y.Doc {
  const doc = new Y.Doc();
  for (const id of ids) doc.getMap("nodes").set(id, new Y.Map());
  return doc;
}

const versionCount = async (db: ServiceDb, canvasId: string) =>
  (
    await db
      .select({ id: canvasDocVersions.id })
      .from(canvasDocVersions)
      .where(eq(canvasDocVersions.docId, canvasId))
  ).length;

describe.skipIf(!TEST_DATABASE_URL)("a live store waiting on the row locks", () => {
  let db: ServiceDb;
  let end: () => Promise<void>;

  beforeAll(() => {
    ({ db, end } = testDb());
  });
  afterAll(async () => {
    await end();
  });

  it("writes nothing to a canvas trashed while it waited", async () => {
    const canvasId = await seedCanvas(db);
    await storeCanvasState(db, {
      canvasId,
      document: docWith("before"),
      editorId: null,
      withSnapshot: false,
      now: new Date(0),
    });
    const versions = await versionCount(db, canvasId);

    const holder = await holdTransaction();
    await holder.query("SELECT 1 FROM canvas.canvases WHERE id = $1 FOR UPDATE", [canvasId]);
    const pending = storeCanvasState(db, {
      canvasId,
      document: docWith("before", "after"),
      editorId: null,
      withSnapshot: true,
      now: new Date(),
    });
    await sleep(300);
    await holder.query("UPDATE canvas.canvases SET deleted_at = now() WHERE id = $1", [canvasId]);
    await holder.commit();

    expect((await pending).kind).toBe("gone");
    expect(await storedNodeIds(db, canvasId)).toEqual(["before"]);
    expect(await versionCount(db, canvasId)).toBe(versions);
  });

  it("takes the canvas row before its doc, so it queues behind a move instead of deadlocking", async () => {
    const canvasId = await seedCanvas(db);
    // Holds the doc so the store and the move both have to wait on it.
    const docHolder = await holdTransaction();
    await docHolder.query("SELECT 1 FROM canvas.canvas_docs WHERE canvas_id = $1 FOR UPDATE", [
      canvasId,
    ]);
    const store = storeCanvasState(db, {
      canvasId,
      document: docWith("live"),
      editorId: null,
      withSnapshot: false,
      now: new Date(),
    }).then(
      (outcome) => outcome.kind,
      (error: { code?: string }) => error.code ?? "error",
    );
    await sleep(300);
    // The move into a team: the canvas row, then the doc (to rehome images).
    const move = await holdTransaction();
    const moved = (async () => {
      await move.query("SELECT 1 FROM canvas.canvases WHERE id = $1 FOR UPDATE", [canvasId]);
      await move.query("SELECT 1 FROM canvas.canvas_docs WHERE canvas_id = $1 FOR UPDATE", [
        canvasId,
      ]);
      await move.query("UPDATE canvas.canvases SET updated_at = now() WHERE id = $1", [canvasId]);
      await move.commit();
      return "moved";
    })().catch(async (error: { code?: string }) => {
      await move.abandon();
      return error.code ?? "error";
    });
    await sleep(300);
    await docHolder.commit();

    expect(await Promise.all([store, moved])).toEqual(["stored", "moved"]);
    expect(await storedNodeIds(db, canvasId)).toEqual(["live"]);
  });
});

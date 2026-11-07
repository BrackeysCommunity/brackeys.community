import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { eq } from "drizzle-orm";
import * as Y from "yjs";

import { sceneDocs, user } from "../../../src/db/schema.ts";
import type { ServiceDb } from "../src/db.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import { postgresSceneStore } from "../src/scene/pg-store.ts";
import { workerSnapshots } from "../src/scene/snapshot.ts";
import { MemorySceneStore, type SceneStore } from "../src/scene/store.ts";
import {
  addSolid,
  connectScene,
  newSceneId,
  sceneOf,
  sceneSynced,
  SECRET,
  seedSceneRow,
  seedUser,
  type SceneClient,
  TEST_DATABASE_URL,
  testDb,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(30_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };

const SEED = JSON.stringify({
  v: 1,
  game: "test",
  name: "stored",
  bounds: [0, 0, 640, 360],
  solid: [
    ["box", 0, 300, 320, 20],
    ["box", 400, 200, 40, 10],
  ],
  entities: [{ id: "spawn", type: "marker", at: [10, 280] }],
});

function keysOf(state: Uint8Array | null): string[] {
  if (!state) return [];
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return [...doc.getMap("entities").keys()].sort();
}

/**
 * The same claims against either store: a restart flushes what's pending,
 * and two instances storing one scene at once lose nothing.
 */
function storeSuite(
  label: string,
  make: () => Promise<{
    store: SceneStore;
    create(sceneId: string, seed: string | null): Promise<void>;
    state(sceneId: string): Promise<Uint8Array | null>;
    row(sceneId: string): Promise<{
      snapshot: string | null;
      sceneHash: string | null;
      lastEditedById: string | null;
    }>;
    close(): Promise<void>;
  }>,
) {
  describe(label, () => {
    let fixture: Awaited<ReturnType<typeof make>>;
    const servers: SyncServer[] = [];
    const clients: SceneClient[] = [];
    const instance = async (id: string, debounceMs = 100) => {
      const server = await startServer({
        port: 0,
        secret: SECRET,
        sceneStore: fixture.store,
        sceneSnapshots: workerSnapshots(),
        instanceId: id,
        telemetry: quiet,
        debounceMs,
        maxDebounceMs: Math.max(500, debounceMs),
      });
      servers.push(server);
      return server;
    };
    const open = (...args: Parameters<typeof connectScene>) => {
      const client = connectScene(...args);
      clients.push(client);
      return client;
    };

    beforeAll(async () => {
      fixture = await make();
    });

    afterAll(async () => {
      for (const client of clients) client.destroy();
      await Promise.all(servers.map((server) => server.stop(3000)));
      await fixture.close();
    });

    it("a restart flushes pending stores", async () => {
      const sceneId = newSceneId();
      await fixture.create(sceneId, SEED);
      // Nothing stores on its own within the test: only the shutdown can.
      const old = await instance("store-old", 60_000);
      const a = open(old.port, sceneId, "alice");
      expect(await sceneSynced(a)).toBe(true);
      addSolid(a.doc, "pending", 7);
      expect(
        await until(
          () =>
            old.hocuspocus.documents.get(`scene:${sceneId}`)?.getMap("entities").has("pending") ??
            false,
        ),
      ).toBe(true);
      expect(keysOf(await fixture.state(sceneId))).not.toContain("pending");

      await old.stop(5000);
      expect(keysOf(await fixture.state(sceneId))).toContain("pending");

      const next = await instance("store-new");
      const b = open(next.port, sceneId, "bob");
      expect(await sceneSynced(b)).toBe(true);
      expect(b.entities.has("pending")).toBe(true);
      expect(b.entities.size).toBe(4);
    });

    it("merge-on-store never loses an edit: two instances storing at once, then a reload holds both", async () => {
      const sceneId = newSceneId();
      await fixture.create(sceneId, SEED);
      // No relay between them: each holds only its own client's edits.
      const one = await instance("merge-one");
      const two = await instance("merge-two");
      const a = open(one.port, sceneId, "alice");
      const b = open(two.port, sceneId, "bob");
      expect(await sceneSynced(a)).toBe(true);
      expect(await sceneSynced(b)).toBe(true);
      const seeded = [...a.entities.keys()].sort();
      expect([...b.entities.keys()].sort()).toEqual(seeded);

      const removed = seeded[0]!;
      const reshaped = seeded[1]!;
      a.doc.transact(() => {
        addSolid(a.doc, "from-one", 1);
        a.entities.delete(removed);
      });
      b.doc.transact(() => {
        addSolid(b.doc, "from-two", 2);
        b.entities.get(reshaped)!.set("shape", ["box", 99, 99, 5, 5]);
      });
      a.destroy();
      b.destroy();

      const expected = [...seeded.filter((k) => k !== removed), "from-one", "from-two"].sort();
      expect(
        await until(
          async () => keysOf(await fixture.state(sceneId)).join() === expected.join(),
          8000,
        ),
      ).toBe(true);

      const fresh = await instance("merge-reload");
      const c = open(fresh.port, sceneId, "carol");
      expect(await sceneSynced(c)).toBe(true);
      expect([...c.entities.keys()].sort()).toEqual(expected);
      expect(c.entities.get(reshaped)!.get("shape")).toEqual(["box", 99, 99, 5, 5]);
      c.destroy();

      expect(
        await until(
          async () => (await fixture.row(sceneId)).sceneHash === sceneOf(c.doc)!.hash,
          5000,
        ),
      ).toBe(true);
      expect((await fixture.row(sceneId)).snapshot).toBe(sceneOf(c.doc)!.text);
    });
  });
}

storeSuite("the in-memory scene store", async () => {
  const store = new MemorySceneStore();
  return {
    store,
    create: async (sceneId, seed) => store.create(sceneId, seed),
    state: async (sceneId) => store.rows.get(sceneId)?.state ?? null,
    row: async (sceneId) => store.rows.get(sceneId)!,
    close: async () => {},
  };
});

if (!TEST_DATABASE_URL) warnSkipped("the Postgres scene store", "CANVAS_SYNC_TEST_DATABASE_URL");

if (TEST_DATABASE_URL) {
  storeSuite("the Postgres scene store", async () => {
    const { db, end } = testDb();
    return {
      store: postgresSceneStore(db),
      create: (sceneId, seed) => seedSceneRow(db, sceneId, seed),
      state: async (sceneId) => {
        const [row] = await db
          .select({ state: sceneDocs.state })
          .from(sceneDocs)
          .where(eq(sceneDocs.sceneId, sceneId));
        return row?.state ? new Uint8Array(row.state) : null;
      },
      row: async (sceneId) => {
        const [row] = await db.select().from(sceneDocs).where(eq(sceneDocs.sceneId, sceneId));
        return row!;
      },
      close: end,
    };
  });

  describe("the Postgres scene store's row", () => {
    let db: ServiceDb;
    let end: () => Promise<void>;
    let server: SyncServer;

    beforeAll(async () => {
      ({ db, end } = testDb());
      server = await startServer({
        port: 0,
        secret: SECRET,
        sceneStore: postgresSceneStore(db),
        instanceId: "pg-row",
        telemetry: quiet,
        debounceMs: 100,
        maxDebounceMs: 500,
      });
    });

    afterAll(async () => {
      await server.stop(3000);
      await end();
    });

    it("records the last editor, the size and the version, and ignores an unknown editor", async () => {
      const sceneId = newSceneId();
      await seedUser(db, "scene-editor");
      await seedSceneRow(db, sceneId, SEED);
      const a = connectScene(server.port, sceneId, "scene-editor");
      expect(await sceneSynced(a)).toBe(true);
      addSolid(a.doc, "edited", 3);
      a.destroy();
      const row = async () =>
        (await db.select().from(sceneDocs).where(eq(sceneDocs.sceneId, sceneId)))[0]!;
      expect(await until(async () => (await row()).lastEditedById === "scene-editor", 5000)).toBe(
        true,
      );
      const stored = await row();
      expect(stored.byteSize).toBe(stored.state!.byteLength);
      expect(stored.schemaVersion).toBe(1);
      expect(stored.lastEditedAt).toBeInstanceOf(Date);

      const ghost = connectScene(server.port, sceneId, "no-such-user");
      expect(await sceneSynced(ghost)).toBe(true);
      addSolid(ghost.doc, "ghost", 4);
      ghost.destroy();
      expect(await until(async () => keysOf((await row()).state).includes("ghost"), 5000)).toBe(
        true,
      );
      expect((await row()).lastEditedById).toBe("scene-editor");
      const [deleted] = await db.select().from(user).where(eq(user.id, "no-such-user"));
      expect(deleted).toBeUndefined();
    });
  });
}

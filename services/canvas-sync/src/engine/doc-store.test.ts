import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

import { and, eq } from "drizzle-orm";
import pg from "pg";

import { engineAssetDocs, engineProjects, sceneDocs } from "../../../../src/db/schema.ts";
import { TEST_DATABASE_URL, seedUser, testDb, warnSkipped } from "../../test/harness.ts";
import { postgresSceneStore } from "../scene/pg-store.ts";
import {
  MemoryAssetDocStore,
  postgresAssetDocStore,
  splitDocId,
  type EngineDocStore,
} from "./doc-store.ts";

setDefaultTimeout(60_000);

const edit = { editorId: null, now: new Date(0) };
const bytes = (...values: number[]) => new Uint8Array(values);
const newProjectId = () => `p-${crypto.randomUUID().slice(0, 8)}`;

describe("splitDocId", () => {
  it("splits at the first dot and refuses an empty part", () => {
    expect(splitDocId("game.level-1")).toEqual({ projectId: "game", key: "level-1" });
    expect(splitDocId("a.b.c")).toEqual({ projectId: "a", key: "b.c" });
    expect(splitDocId("nodot")).toBeNull();
    expect(splitDocId(".key")).toBeNull();
    expect(splitDocId("project.")).toBeNull();
  });
});

interface Fixture {
  store: EngineDocStore;
  /** A new project holding one doc of `kind`; returns the doc id. */
  create(kind: string, seed?: string | null): Promise<string>;
  deleteProject(docId: string): Promise<void>;
  row(docId: string): Promise<{
    state: Uint8Array | null;
    byteSize: number;
    snapshot: string | null;
    contentSha256: string | null;
    lastEditedById: string | null;
    lastEditedAt: Date | null;
  }>;
  close(): Promise<void>;
}

/** The same claims against either asset doc store. */
function assetStoreSuite(label: string, make: () => Promise<Fixture>) {
  describe(label, () => {
    let fixture: Fixture;
    beforeAll(async () => {
      fixture = await make();
    });
    afterAll(async () => {
      await fixture.close();
    });

    it("loads the seed, and heads the kind and the stored version", async () => {
      const docId = await fixture.create("tileset", '{"tiles":[]}');
      expect(await fixture.store.load(docId)).toEqual({
        state: null,
        seed: '{"tiles":[]}',
        schemaVersion: null,
      });
      expect(await fixture.store.head(docId)).toEqual({ schemaVersion: null, kind: "tileset" });
      await fixture.store.write(
        docId,
        async () => ({ state: bytes(1, 2), schemaVersion: 3 }),
        edit,
      );
      expect(await fixture.store.load(docId)).toEqual({
        state: bytes(1, 2),
        seed: '{"tiles":[]}',
        schemaVersion: 3,
      });
      expect(await fixture.store.head(docId)).toEqual({ schemaVersion: 3, kind: "tileset" });
      expect((await fixture.row(docId)).byteSize).toBe(2);
    });

    it("runs one doc's writes in turn, each merging into the last", async () => {
      const docId = await fixture.create("prefab");
      const seen: (number[] | null)[] = [];
      const write = (value: number, delayMs: number) =>
        fixture.store.write(
          docId,
          async (stored) => {
            seen.push(stored ? [...stored] : null);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return { state: bytes(...(stored ?? []), value), schemaVersion: 1 };
          },
          edit,
        );
      const outcomes = await Promise.all([write(1, 80), write(2, 0), write(3, 20)]);
      expect(outcomes.map((o) => o.kind)).toEqual(["stored", "stored", "stored"]);
      expect(seen[0]).toBeNull();
      expect(seen.slice(1).map((s) => s!.length)).toEqual([1, 2]);
      expect((await fixture.row(docId)).state?.length).toBe(3);
    });

    it("reports a write that changes nothing, a refusal and a missing doc", async () => {
      const docId = await fixture.create("prefab");
      await fixture.store.write(docId, async () => ({ state: bytes(1), schemaVersion: 1 }), edit);
      expect(
        await fixture.store.write(docId, async (s) => ({ state: s!, schemaVersion: 1 }), edit),
      ).toEqual({ kind: "unchanged" });
      expect(
        await fixture.store.write(docId, async () => ({ refused: "too-large", bytes: 9 }), edit),
      ).toEqual({ kind: "refused", refused: "too-large", bytes: 9 });
      expect((await fixture.row(docId)).state).toEqual(bytes(1));
      const missing = `${splitDocId(docId)!.projectId}.no-such-doc`;
      expect(await fixture.store.load(missing)).toBeNull();
      expect(await fixture.store.head(missing)).toBeNull();
      expect(
        await fixture.store.write(
          missing,
          async () => ({ state: bytes(1), schemaVersion: 1 }),
          edit,
        ),
      ).toEqual({ kind: "gone" });
      expect(await fixture.store.head("not-a-doc-id")).toBeNull();
    });

    it("keeps the snapshot as canonical text and its SHA-256, and the editor", async () => {
      const docId = await fixture.create("tileset");
      const outcome = await fixture.store.write(
        docId,
        async () => ({
          state: bytes(4, 5),
          schemaVersion: 1,
          snapshot: { text: '{"tiles":[]}\n', hash: "a".repeat(64) },
        }),
        { editorId: "doc-store-editor", now: new Date(1000) },
      );
      expect(outcome).toEqual({ kind: "stored", bytes: 2 });
      const row = await fixture.row(docId);
      expect(row).toMatchObject({
        snapshot: '{"tiles":[]}\n',
        contentSha256: "a".repeat(64),
        lastEditedById: "doc-store-editor",
      });
      expect(row.lastEditedAt?.getTime()).toBe(1000);

      // An unchanged state still writes when it brings a snapshot.
      expect(
        await fixture.store.write(
          docId,
          async (s) => ({
            state: s!,
            schemaVersion: 1,
            snapshot: { text: "{}\n", hash: "b".repeat(64) },
          }),
          edit,
        ),
      ).toEqual({ kind: "stored", bytes: 2 });
      expect((await fixture.row(docId)).contentSha256).toBe("b".repeat(64));
      expect((await fixture.row(docId)).lastEditedById).toBe("doc-store-editor");
    });

    it("keeps going after a merge throws", async () => {
      const docId = await fixture.create("prefab");
      const failed = fixture.store.write(
        docId,
        async () => Promise.reject(new Error("boom")),
        edit,
      );
      const next = fixture.store.write(
        docId,
        async () => ({ state: bytes(5), schemaVersion: 1 }),
        edit,
      );
      await expect(failed).rejects.toThrow("boom");
      expect(await next).toEqual({ kind: "stored", bytes: 1 });
    });

    it("reads a soft-deleted project's docs as gone and writes nothing to them", async () => {
      const docId = await fixture.create("prefab");
      await fixture.store.write(docId, async () => ({ state: bytes(1), schemaVersion: 1 }), edit);
      await fixture.deleteProject(docId);
      expect(await fixture.store.load(docId)).toBeNull();
      expect(await fixture.store.head(docId)).toBeNull();
      expect(
        await fixture.store.write(docId, async () => ({ state: bytes(2), schemaVersion: 1 }), edit),
      ).toEqual({ kind: "gone" });
      expect((await fixture.row(docId)).state).toEqual(bytes(1));
    });
  });
}

assetStoreSuite("the in-memory asset doc store", async () => {
  const store = new MemoryAssetDocStore();
  return {
    store,
    async create(kind, seed = null) {
      const docId = `${newProjectId()}.doc`;
      store.create(docId, kind, seed);
      return docId;
    },
    deleteProject: async (docId) => store.deleteProject(splitDocId(docId)!.projectId),
    row: async (docId) => store.rows.get(docId)!,
    close: async () => {},
  };
});

if (!TEST_DATABASE_URL) {
  warnSkipped("the Postgres doc stores", "CANVAS_SYNC_TEST_DATABASE_URL");
  warnSkipped("the engine_projects migration", "CANVAS_SYNC_TEST_DATABASE_URL");
}

if (TEST_DATABASE_URL) {
  assetStoreSuite("the Postgres asset doc store", async () => {
    const { db, end } = testDb();
    await seedUser(db, "doc-store-editor");
    return {
      store: postgresAssetDocStore(db),
      async create(kind, seed = null) {
        const projectId = newProjectId();
        await db.insert(engineProjects).values({ projectId, name: projectId });
        await db.insert(engineAssetDocs).values({ projectId, assetKey: "doc", kind, seed });
        return `${projectId}.doc`;
      },
      async deleteProject(docId) {
        await db
          .update(engineProjects)
          .set({ deletedAt: new Date() })
          .where(eq(engineProjects.projectId, splitDocId(docId)!.projectId));
      },
      async row(docId) {
        const id = splitDocId(docId)!;
        const [row] = await db
          .select()
          .from(engineAssetDocs)
          .where(
            and(eq(engineAssetDocs.projectId, id.projectId), eq(engineAssetDocs.assetKey, id.key)),
          );
        return { ...row!, state: row!.state ? new Uint8Array(row!.state) : null };
      },
      close: end,
    };
  });

  describe("the Postgres scene store as a doc store", () => {
    const { db, end } = testDb();
    const store = postgresSceneStore(db);
    afterAll(end);

    it("heads a scene as the scene kind, and a deleted project's scene as gone", async () => {
      const projectId = newProjectId();
      const sceneId = `${projectId}.level`;
      await db.insert(engineProjects).values({ projectId, name: projectId });
      await db.insert(sceneDocs).values({ sceneId, projectId, seed: null });
      expect(await store.head(sceneId)).toEqual({ schemaVersion: null, kind: "scene" });
      await db
        .update(engineProjects)
        .set({ deletedAt: new Date() })
        .where(eq(engineProjects.projectId, projectId));
      expect(await store.head(sceneId)).toBeNull();
      expect(
        await store.write(sceneId, async () => ({ state: bytes(1), schemaVersion: 1 }), edit),
      ).toEqual({ kind: "gone" });
    });
  });

  describe("the engine_projects migration", () => {
    const MIGRATIONS = new URL("../../../../drizzle/", import.meta.url);
    const BEFORE = "20261107054121_scene_docs";
    const MIGRATION = "20261107185741_engine_projects";
    const database = `doc_store_migrate_${crypto.randomUUID().slice(0, 8)}`;
    const admin = new pg.Client(TEST_DATABASE_URL);
    let client: pg.Client;

    const apply = async (name: string) => {
      const text = await readFile(new URL(`${name}/migration.sql`, MIGRATIONS), "utf8");
      await client.query("BEGIN");
      for (const statement of text.split("--> statement-breakpoint")) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query("COMMIT");
    };

    beforeAll(async () => {
      await admin.connect();
      await admin.query(`CREATE DATABASE "${database}"`);
      const url = new URL(TEST_DATABASE_URL!);
      url.pathname = `/${database}`;
      client = new pg.Client(url.toString());
      await client.connect();
    });

    afterAll(async () => {
      await client?.end();
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end();
    });

    it("applies on a fresh database and gives every scene its id's project", async () => {
      const names = (await readdir(MIGRATIONS, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      expect(names).toContain(BEFORE);
      expect(names).toContain(MIGRATION);
      for (const name of names.filter((n) => n <= BEFORE)) await apply(name);

      await client.query(
        `INSERT INTO canvas.scene_docs (scene_id, seed) VALUES
          ('engine.kitchen-sink', null), ('engine.empty', null), ('platformer.level-1', '{}')`,
      );
      await apply(MIGRATION);

      const projects = await client.query(
        "SELECT project_id, name, game, layout FROM canvas.engine_projects ORDER BY project_id",
      );
      expect(projects.rows).toEqual([
        { project_id: "engine", name: "engine", game: null, layout: 1 },
        { project_id: "platformer", name: "platformer", game: "platformer", layout: 1 },
      ]);
      const scenes = await client.query(
        "SELECT scene_id, project_id FROM canvas.scene_docs ORDER BY scene_id",
      );
      expect(scenes.rows).toEqual([
        { scene_id: "engine.empty", project_id: "engine" },
        { scene_id: "engine.kitchen-sink", project_id: "engine" },
        { scene_id: "platformer.level-1", project_id: "platformer" },
      ]);

      // The project's row now owns its scenes.
      await client.query("DELETE FROM canvas.engine_projects WHERE project_id = 'platformer'");
      const left = await client.query("SELECT scene_id FROM canvas.scene_docs ORDER BY scene_id");
      expect(left.rows.map((r: { scene_id: string }) => r.scene_id)).toEqual([
        "engine.empty",
        "engine.kitchen-sink",
      ]);
    });
  });
}

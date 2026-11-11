import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { and, eq } from "drizzle-orm";
import * as Y from "yjs";

import { engineAssetDocs, engineBlobs, engineProjects, sceneDocs } from "../../../src/db/schema.ts";
import { SEED_STALE_REASON } from "../../../src/engine/collab/seed-identity.ts";
import { DATA_TABLE_VERSION } from "../../../src/engine/project/kinds/data-table.ts";
import type { AssetEntry, ProjectState } from "../../../src/engine/project/types.ts";
import { documentName, syncEnvPrefix } from "../../../src/lib/canvas/sync-channels.ts";
import {
  emptyProjectState,
  readProjectState,
  seedProjectState,
} from "../../../src/lib/scene/project-bytes.ts";
import { MemoryAssetDocStore, postgresAssetDocStore } from "../src/engine/doc-store.ts";
import { MemoryProjectStore, postgresProjectStore } from "../src/engine/project-kind.ts";
import { startServer, type ServerOptions, type SyncServer } from "../src/index.ts";
import { createRedisExtension, redisChannels } from "../src/redis.ts";
import { postgresSceneStore } from "../src/scene/pg-store.ts";
import { MemorySceneStore } from "../src/scene/store.ts";
import { FakeRedis } from "./fake-redis.ts";
import {
  assetSnapshotOf,
  COLLAB_LAYOUT_VERSION,
  connectAsset,
  connectDoc,
  connectProject,
  type EngineClient,
  newEntry,
  newProjectId,
  projectStateOf,
  projectToken,
  putEntry,
  SECRET,
  seedAssetRow,
  seedProjectRow,
  sceneSynced as synced,
  TEST_DATABASE_URL,
  TEST_REDIS_URL,
  testDb,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(30_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };
const HASH = "c".repeat(64);

const TABLE = JSON.stringify({
  kind: "data-table",
  v: DATA_TABLE_VERSION,
  table: "card",
  rows: [
    { id: "fireball", cost: 3, damage: 5 },
    { id: "heal", cost: 2, damage: 0 },
  ],
});

const entry = (
  key: string,
  fields: Pick<AssetEntry, "kind" | "path"> & Partial<AssetEntry>,
): AssetEntry => ({ key, id: key, created: { at: 1, by: "alice" }, ...fields });

/** What the web app writes when it creates a project from files: the registry, and rows with seeds. */
function bundleState(projectId: string): ProjectState {
  return {
    ...emptyProjectState(projectId, "Demo"),
    assets: {
      deck: entry("deck", { kind: "data-table", path: "data/deck.json" }),
      level: entry("level", { kind: "scene", path: "level.json" }),
      crate: entry("crate", { kind: "texture", path: "art/crate.png", sha256: HASH, bytes: 3 }),
      // The web app made no row for this one: the project kind does.
      rubber: entry("rubber", { kind: "material", path: "materials/rubber.json" }),
    },
  };
}

const sameRegistry = (clients: EngineClient[]) => {
  const texts = clients.map((c) => JSON.stringify(projectStateOf(c.doc)));
  return texts.every((t) => t === texts[0]);
};

interface Fixture {
  options: Pick<ServerOptions, "projectStore" | "assetStore" | "sceneStore">;
  relay(): Promise<{ url: string; close(): Promise<void> }>;
  /** A project row with its first registry state, and the rows the web app makes with it. */
  create(projectId: string, state: Uint8Array | null): Promise<void>;
  /** What the web app does when it restores a project: the registry row's state replaced. */
  replaceRegistry(projectId: string, state: Uint8Array): Promise<void>;
  storedRegistry(projectId: string): Promise<ProjectState | null>;
  assetRow(docId: string): Promise<{
    kind: string;
    seed: string | null;
    snapshot: string | null;
    sha: string | null;
  } | null>;
  hasScene(sceneId: string): Promise<boolean>;
  close(): Promise<void>;
}

function seedSuite(label: string, make: () => Promise<Fixture>) {
  describe(label, () => {
    let fixture: Fixture;
    const servers: SyncServer[] = [];
    const clients: EngineClient[] = [];
    const relays: { close(): Promise<void> }[] = [];

    const instance = async (id: string, relay?: { url: string; prefix: string }) => {
      const server = await startServer({
        port: 0,
        secret: SECRET,
        ...fixture.options,
        instanceId: id,
        telemetry: quiet,
        debounceMs: 100,
        maxDebounceMs: 500,
        ...(relay
          ? {
              redis: createRedisExtension(relay.url, relay.prefix, id),
              channels: redisChannels(relay.url, relay.prefix),
            }
          : {}),
      });
      servers.push(server);
      return server;
    };
    const track = (client: EngineClient) => {
      clients.push(client);
      return client;
    };

    beforeAll(async () => {
      fixture = await make();
    });

    afterAll(async () => {
      for (const client of clients) client.destroy();
      await Promise.all(servers.map((server) => server.stop(3000)));
      for (const relay of relays) await relay.close();
      await fixture?.close();
    });

    it("two clients opening a project with no registry yet see one meta seed", async () => {
      const server = await instance(`${label}-meta`);
      const projectId = newProjectId();
      await fixture.create(projectId, null);
      const a = track(connectProject(server.port, projectId, "alice"));
      const b = track(connectProject(server.port, projectId, "bob"));
      expect(await synced(a)).toBe(true);
      expect(await synced(b)).toBe(true);
      const expected = { projectId, layout: 1, name: "Demo" };
      expect(projectStateOf(a.doc).meta).toEqual(expected);
      expect(projectStateOf(b.doc)).toEqual(projectStateOf(a.doc));
      expect(Y.encodeStateVector(a.doc)).toEqual(Y.encodeStateVector(b.doc));
      // Stored at load.
      expect((await fixture.storedRegistry(projectId))?.meta).toEqual(expected);
    });

    it("two instances loading a created project at once, relayed, hold one copy", async () => {
      const relay = await fixture.relay();
      relays.push(relay);
      const prefix = syncEnvPrefix(`project-seed-${crypto.randomUUID().slice(0, 8)}`);
      const one = await instance(`${label}-relay-one`, { url: relay.url, prefix });
      const two = await instance(`${label}-relay-two`, { url: relay.url, prefix });
      const projectId = newProjectId();
      const registry = bundleState(projectId);
      await fixture.create(projectId, seedProjectState(registry));

      const a = track(connectProject(one.port, projectId, "alice"));
      const b = track(connectProject(two.port, projectId, "bob"));
      expect(await synced(a)).toBe(true);
      expect(await synced(b)).toBe(true);
      expect(Object.keys(projectStateOf(a.doc).assets).sort()).toEqual(
        Object.keys(registry.assets).sort(),
      );
      expect(sameRegistry([a, b])).toBe(true);
      expect(a.doc.getMap("assets").size).toBe(4);

      // Each instance loaded it on its own and both still edit one registry.
      putEntry(a.doc, newEntry("gem", { id: "gem", kind: "material", path: "materials/gem.json" }));
      expect(await until(() => projectStateOf(b.doc).assets.gem !== undefined, 5000)).toBe(true);

      // The project kind made the rows the web app didn't, for the doc entries only.
      expect(await until(async () => (await fixture.assetRow(`${projectId}.gem`)) !== null)).toBe(
        true,
      );
      expect((await fixture.assetRow(`${projectId}.rubber`))?.kind).toBe("material");
      expect(await fixture.assetRow(`${projectId}.crate`)).toBeNull();
      expect(await fixture.hasScene(`${projectId}.level`)).toBe(true);

      // The deck's doc, seeded by both instances from its row's seed: one copy of each row.
      const da = track(connectAsset(one.port, `${projectId}.deck`, "alice"));
      const db = track(connectAsset(two.port, `${projectId}.deck`, "bob"));
      expect(await synced(da)).toBe(true);
      expect(await synced(db)).toBe(true);
      const rows = () => (da.doc.getMap("content").get("rows") as Y.Map<unknown> | undefined)?.size;
      expect(rows()).toBe(2);
      da.doc.getMap("content").set("table", "spell");
      expect(await until(() => db.doc.getMap("content").get("table") === "spell", 5000)).toBe(true);
      expect(rows()).toBe(2);
      expect(await assetSnapshotOf(da.doc)).toEqual(await assetSnapshotOf(db.doc));
      const seeded = await fixture.assetRow(`${projectId}.deck`);
      expect(seeded?.seed).toBe(TABLE);
      expect(JSON.parse(seeded!.snapshot!)).toEqual(JSON.parse(TABLE));
      expect(seeded?.sha).toMatch(/^[0-9a-f]{64}$/);
    });

    it("refuses a client still holding the registry from before a reseed, and serves the new one alone", async () => {
      const one = await instance(`${label}-stale-one`);
      const projectId = newProjectId();
      await fixture.create(projectId, seedProjectState(bundleState(projectId)));
      const a = track(connectProject(one.port, projectId, "alice"));
      expect(await synced(a)).toBe(true);
      expect(Object.keys(projectStateOf(a.doc).assets)).toHaveLength(4);
      a.destroy();
      await one.stop(3000);

      const restored: ProjectState = {
        ...emptyProjectState(projectId, "Restored"),
        assets: { level: entry("level", { kind: "scene", path: "level.json" }) },
      };
      await fixture.replaceRegistry(projectId, seedProjectState(restored));
      const two = await instance(`${label}-stale-two`);
      const stale = track(
        connectDoc(
          two.port,
          documentName("project", projectId),
          () => projectToken(projectId, "alice"),
          a.doc,
        ),
      );
      const reasons: string[] = [];
      stale.provider.on("close", ({ event }: { event: { reason: string } }) => {
        reasons.push(event.reason);
      });
      expect(await until(() => reasons.includes(SEED_STALE_REASON), 5000)).toBe(true);

      const fresh = track(connectProject(two.port, projectId, "bob"));
      expect(await synced(fresh)).toBe(true);
      expect(Object.keys(projectStateOf(fresh.doc).assets)).toEqual(["level"]);
      expect(projectStateOf(fresh.doc).meta.name).toBe("Restored");
    });

    it("refuses a project the web app never created, and an asset doc with no row", async () => {
      const server = await instance(`${label}-missing`);
      const projectId = newProjectId();
      const p = track(connectProject(server.port, projectId, "alice"));
      expect(await until(() => p.authFailures.length > 0, 3000)).toBe(true);
      expect(p.authFailures[0]).toContain("project not found");
      await fixture.create(projectId, null);
      const a = track(connectAsset(server.port, `${projectId}.nothing`, "alice"));
      expect(await until(() => a.authFailures.length > 0, 3000)).toBe(true);
      expect(a.authFailures[0]).toContain("asset not found");
    });

    it("connects a client on an older collab layout read-only, with a notice", async () => {
      const server = await instance(`${label}-layout`);
      const projectId = newProjectId();
      await fixture.create(projectId, null);
      const old = track(
        connectProject(server.port, projectId, "alice", { layout: COLLAB_LAYOUT_VERSION - 1 }),
      );
      const current = track(connectProject(server.port, projectId, "bob"));
      expect(await synced(old)).toBe(true);
      expect(await synced(current)).toBe(true);
      expect(await until(() => old.notices.length > 0, 3000)).toBe(true);
      expect(JSON.parse(old.notices[0]!)).toEqual({
        type: "layout-read-only",
        reason: "engine-outdated",
        layout: COLLAB_LAYOUT_VERSION,
      });
      expect(old.scope()).toBe("readonly");
      putEntry(old.doc, newEntry("x", { id: "x", kind: "material", path: "x.json" }));
      putEntry(current.doc, newEntry("y", { id: "y", kind: "material", path: "y.json" }));
      expect(await until(() => projectStateOf(old.doc).assets.y !== undefined, 3000)).toBe(true);
      expect(projectStateOf(current.doc).assets.x).toBeUndefined();
    });
  });
}

const SEED_ROWS = [{ key: "deck", kind: "data-table", seed: TABLE }];

const fakeRelay = async () => {
  const redis = new FakeRedis();
  await redis.start();
  return { url: redis.url, close: () => redis.stop() };
};

seedSuite("memory", async () => {
  const assets = new MemoryAssetDocStore();
  const scenes = new MemorySceneStore();
  const projects = new MemoryProjectStore({ assets, scenes });
  return {
    options: { projectStore: projects, assetStore: assets, sceneStore: scenes },
    relay: fakeRelay,
    async create(projectId, state) {
      projects.create(projectId, "Demo", state);
      if (!state) return;
      projects.addBlob(projectId, HASH);
      for (const row of SEED_ROWS) assets.create(`${projectId}.${row.key}`, row.kind, row.seed);
      scenes.create(`${projectId}.level`);
    },
    async replaceRegistry(projectId, state) {
      projects.create(projectId, "Demo", state);
    },
    async storedRegistry(projectId) {
      const row = projects.rowsById.get(projectId);
      return row?.state ? readProjectState(row.state) : null;
    },
    async assetRow(docId) {
      const row = assets.rows.get(docId);
      return row
        ? { kind: row.kind, seed: row.seed, snapshot: row.snapshot, sha: row.contentSha256 }
        : null;
    },
    hasScene: async (sceneId) => scenes.rows.has(sceneId),
    close: async () => {},
  };
});

if (TEST_DATABASE_URL) {
  seedSuite("postgres", async () => {
    const { db, end } = testDb();
    return {
      options: {
        projectStore: postgresProjectStore(db),
        assetStore: postgresAssetDocStore(db),
        sceneStore: postgresSceneStore(db),
      },
      relay: async () =>
        TEST_REDIS_URL ? { url: TEST_REDIS_URL, close: async () => {} } : fakeRelay(),
      async create(projectId, state) {
        await seedProjectRow(db, projectId, state, "Demo");
        if (!state) return;
        await db.insert(engineBlobs).values({
          projectId,
          sha256: HASH,
          byteSize: 3,
          contentType: "image/png",
          storageKey: `engine-assets/${projectId}/${HASH}`,
        });
        for (const row of SEED_ROWS) await seedAssetRow(db, projectId, row.key, row.kind, row.seed);
        await db.insert(sceneDocs).values({ sceneId: `${projectId}.level`, projectId });
      },
      async replaceRegistry(projectId, state) {
        await db
          .update(engineProjects)
          .set({ state: Buffer.from(state) })
          .where(eq(engineProjects.projectId, projectId));
      },
      async storedRegistry(projectId) {
        const [row] = await db
          .select({ state: engineProjects.state })
          .from(engineProjects)
          .where(eq(engineProjects.projectId, projectId));
        return row?.state ? readProjectState(new Uint8Array(row.state)) : null;
      },
      async assetRow(docId) {
        const [projectId, key] = docId.split(".") as [string, string];
        const [row] = await db
          .select({
            kind: engineAssetDocs.kind,
            seed: engineAssetDocs.seed,
            snapshot: engineAssetDocs.snapshot,
            sha: engineAssetDocs.contentSha256,
          })
          .from(engineAssetDocs)
          .where(and(eq(engineAssetDocs.projectId, projectId), eq(engineAssetDocs.assetKey, key)));
        return row ?? null;
      },
      async hasScene(sceneId) {
        const [row] = await db
          .select({ id: sceneDocs.sceneId })
          .from(sceneDocs)
          .where(eq(sceneDocs.sceneId, sceneId));
        return row !== undefined;
      },
      close: end,
    };
  });
} else {
  warnSkipped("project seeding on Postgres", "CANVAS_SYNC_TEST_DATABASE_URL");
}

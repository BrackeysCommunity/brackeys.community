import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { openProjectClient, type ProjectClient } from "../../../scripts/scene/project-client.ts";
import { docToScene, layoutFromDoc } from "../../../src/engine/collab/index.ts";
import type { QuotaPolicy } from "../../../src/engine/project/index.ts";
import { createRegistry } from "../../../src/engine/scene/index.ts";
import {
  emptyProjectState,
  ENGINE_KINDS,
  seedProjectState,
} from "../../../src/lib/scene/project-bytes.ts";
import { postgresAssetDocStore } from "../src/engine/doc-store.ts";
import { postgresProjectStore, type ProjectStore } from "../src/engine/project-kind.ts";
import { startServer, type ServerOptions, type SyncServer } from "../src/index.ts";
import { postgresSceneStore } from "../src/scene/pg-store.ts";
import {
  createMemoryProject,
  memoryEngineStores,
  newProjectId,
  projectStateOf,
  projectToken,
  SECRET,
  seedProjectRow,
  TEST_DATABASE_URL,
  testDb,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(60_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };
const ATOMIC = { as: "map", rest: { as: "atomic" } } as const;

type Stores = Pick<ServerOptions, "projectStore" | "assetStore" | "sceneStore">;

interface Fixture {
  stores: Stores;
  create(projectId: string): Promise<void>;
  rows(projectId: string): Promise<string[]>;
  close(): Promise<void>;
}

const ops = [
  { op: "createAsset", kind: "material", path: "materials/ice.json", id: "ice" },
  { op: "createAsset", kind: "scene", path: "levels/two.json" },
] as const;

function createAssetSuite(label: string, make: () => Promise<Fixture>) {
  describe(`createAsset through a live project session (${label})`, () => {
    let fixture: Fixture;
    const servers: SyncServer[] = [];
    const clients: ProjectClient[] = [];

    const serve = async (extra: Partial<ServerOptions> = {}) => {
      const server = await startServer({
        port: 0,
        secret: SECRET,
        ...fixture.stores,
        instanceId: `project-create-asset-${label}-${servers.length}`,
        telemetry: quiet,
        debounceMs: 2_000,
        maxDebounceMs: 10_000,
        ...extra,
      });
      servers.push(server);
      return server;
    };

    const open = async (server: SyncServer, projectId: string, userId = "ada") => {
      const client = await openProjectClient({
        project: projectId,
        url: `ws://127.0.0.1:${server.port}`,
        registry: createRegistry(null),
        kinds: ENGINE_KINDS,
        origin: { kind: "user", userId },
        token: () => projectToken(projectId, userId, { scoped: true }),
      });
      clients.push(client);
      return client;
    };

    beforeAll(async () => {
      fixture = await make();
    });

    afterAll(async () => {
      for (const client of clients) await client.close().catch(() => undefined);
      for (const server of servers) await server.stop();
      await fixture.close();
    });

    it("opens a material's and a scene's new docs before the registry is stored, and both land", async () => {
      const server = await serve();
      const projectId = newProjectId();
      await fixture.create(projectId);
      const ada = await open(server, projectId);

      const r = await ada.apply({ v: 1, label: "Add ice and a level", ops: [...ops] });
      if (!r.ok) throw new Error(`${r.issue.code}: ${r.issue.message}`);
      expect(r.created).toEqual(["ice", "two"]);
      const state = ada.session.state();
      const key = (id: string) => Object.values(state.assets).find((e) => e.id === id)!.key;
      const material = `asset:${projectId}.${key("ice")}`;
      const scene = `scene:${projectId}.${key("two")}`;
      expect(r.docs).toEqual([`project:${projectId}`, material, scene]);
      expect(r.entry?.docs.map((d) => d.doc)).toEqual(r.docs);
      expect(ada.session.undoLabel()).toBe("Add ice and a level");
      expect(new Set(await fixture.rows(projectId))).toEqual(new Set([key("ice"), key("two")]));

      const bo = await open(server, projectId, "bo");
      const ice = await bo.session.open(material);
      expect(layoutFromDoc(ice.doc, ATOMIC)).toEqual({
        kind: "material",
        v: expect.any(Number),
        description: "A new material.",
      });
      const two = await bo.session.open(scene);
      expect(docToScene(two.doc).name).toBe("two");
      expect(projectStateOf(bo.session.projectDoc).assets[key("two")]?.deleted).toBeUndefined();
    });

    it("leaves a new doc the quota has no room for unopened, as one undo step", async () => {
      const full: QuotaPolicy = {
        check: (usage, add) =>
          add.docs
            ? { ok: false, limit: "docs", used: usage.docs, max: usage.docs, message: "No room." }
            : { ok: true },
      };
      const server = await serve({ quota: full });
      const projectId = newProjectId();
      await fixture.create(projectId);
      const ada = await open(server, projectId);

      await expect(
        ada.apply({
          v: 1,
          label: "Add ice",
          ops: [{ op: "createAsset", kind: "material", path: "materials/ice.json", id: "ice" }],
        }),
      ).rejects.toThrow(/refused/);
      expect(await fixture.rows(projectId)).toEqual([]);
      expect(ada.session.undoLabel(), "what was written undoes as one step").toBe("Add ice");
      ada.session.undo();
      expect(
        Object.values(ada.session.state().assets).some((e) => e.id === "ice" && !e.deleted),
      ).toBe(false);
      await ada.pushed();
      expect(
        await until(() =>
          Object.values(projectStateOf(ada.session.projectDoc).assets).every((e) => e.id !== "ice"),
        ),
      ).toBe(true);
    });
  });
}

createAssetSuite("memory", async () => {
  const stores = memoryEngineStores();
  return {
    stores: stores.options,
    async create(projectId) {
      createMemoryProject(stores, emptyProjectState(projectId, projectId));
    },
    async rows(projectId) {
      return (await stores.projects.rows(projectId)).map((row) => row.key);
    },
    async close() {},
  };
});

if (TEST_DATABASE_URL) {
  createAssetSuite("postgres", async () => {
    const { db, end } = testDb();
    const projects = postgresProjectStore(db);
    return {
      stores: {
        projectStore: projects as ProjectStore,
        assetStore: postgresAssetDocStore(db),
        sceneStore: postgresSceneStore(db),
      },
      async create(projectId) {
        await seedProjectRow(
          db,
          projectId,
          seedProjectState(emptyProjectState(projectId, projectId)),
        );
      },
      async rows(projectId) {
        return (await projects.rows(projectId)).map((row) => row.key);
      },
      close: end,
    };
  });
} else {
  warnSkipped(
    "createAsset through a live project session (postgres)",
    "CANVAS_SYNC_TEST_DATABASE_URL",
  );
}

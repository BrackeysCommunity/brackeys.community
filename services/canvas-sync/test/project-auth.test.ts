import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import type { AssetEntry } from "../../../src/engine/project/types.ts";
import { documentName, SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import { emptyProjectState } from "../../../src/lib/scene/project-bytes.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import {
  addSolid,
  assetToken,
  connectDoc,
  createMemoryProject,
  type EngineClient,
  memoryEngineStores,
  newProjectId,
  projectToken,
  sceneSynced as synced,
  SECRET,
  sleep,
  until,
} from "./harness.ts";

setDefaultTimeout(30_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };

const TABLE = JSON.stringify({ kind: "data-table", v: 1, table: "card", rows: [{ id: "a" }] });

const entry = (key: string, kind: string, path: string): AssetEntry => ({
  key,
  id: key,
  kind,
  path,
  created: { at: 1, by: "alice" },
});

describe("project-scoped access", () => {
  const stores = memoryEngineStores();
  let server: SyncServer;
  const clients: EngineClient[] = [];

  const open = (name: string, token: () => Promise<string>) => {
    const client = connectDoc(server.port, name, token);
    clients.push(client);
    return client;
  };
  /** A project with a scene `level` and a data table `deck`, each with its row. */
  const project = () => {
    const projectId = newProjectId();
    createMemoryProject(
      stores,
      {
        ...emptyProjectState(projectId, projectId),
        assets: {
          level: entry("level", "scene", "level.json"),
          deck: entry("deck", "data-table", "data/deck.json"),
        },
      },
      { deck: TABLE },
    );
    return projectId;
  };
  const docsOf = (projectId: string) => [
    documentName("project", projectId),
    documentName("scene", `${projectId}.level`),
    documentName("asset", `${projectId}.deck`),
  ];
  const refused = async (client: EngineClient) => {
    expect(await until(() => client.authFailures.length > 0, 3000)).toBe(true);
    return client.authFailures[0]!;
  };

  beforeAll(async () => {
    server = await startServer({
      port: 0,
      secret: SECRET,
      ...stores.options,
      instanceId: "project-auth",
      telemetry: quiet,
      debounceMs: 50,
      maxDebounceMs: 200,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server.stop(3000);
  });

  it("a project-scoped token opens the project's registry, scenes and assets, and nothing else", async () => {
    const mine = project();
    const theirs = project();
    const token = () => projectToken(mine, "alice", { scoped: true });

    const opened = docsOf(mine).map((name) => open(name, token));
    for (const client of opened) {
      expect(await synced(client)).toBe(true);
      expect(client.scope()).toBe("read-write");
    }
    addSolid(opened[1]!.doc, "from-scoped", 4);
    expect(
      await until(() => (stores.scenes.rows.get(`${mine}.level`)?.byteSize ?? 0) > 0, 5000),
    ).toBe(true);

    for (const name of [...docsOf(theirs), documentName("canvas", "c1")]) {
      expect(await refused(open(name, token))).toContain("another document");
    }
    // An id that only starts like the project's is another project.
    const lookalike = open(documentName("scene", `${mine}x.level`), token);
    expect(await refused(lookalike)).toContain("another document");
  });

  it("an unscoped project token opens only the registry", async () => {
    const mine = project();
    const token = () => projectToken(mine, "alice");
    const [registry, scene, asset] = docsOf(mine).map((name) => open(name, token));
    expect(await synced(registry!)).toBe(true);
    expect(await refused(scene!)).toContain("another document");
    expect(await refused(asset!)).toContain("another document");
  });

  it("an asset token opens its own doc and no other, in its project or another", async () => {
    const mine = project();
    const theirs = project();
    const token = () => assetToken(`${mine}.deck`, "alice");
    expect(await synced(open(documentName("asset", `${mine}.deck`), token))).toBe(true);
    for (const name of [
      documentName("asset", `${theirs}.deck`),
      documentName("scene", `${mine}.level`),
      documentName("project", mine),
    ]) {
      expect(await refused(open(name, token))).toContain("another document");
    }
  });

  it("revoking a project closes every doc of it, for one person or everyone, and refuses the tokens held", async () => {
    const mine = project();
    const theirs = project();
    const frankToken = await projectToken(mine, "frank", { scoped: true });
    const frank = docsOf(mine).map((name) => open(name, async () => frankToken));
    const alice = docsOf(mine).map((name) =>
      open(name, () => projectToken(mine, "alice", { scoped: true })),
    );
    const elsewhere = docsOf(theirs).map((name) =>
      open(name, () => projectToken(theirs, "frank", { scoped: true })),
    );
    for (const client of [...frank, ...alice, ...elsewhere])
      expect(await synced(client)).toBe(true);

    expect(server.handleRevoke({ projectId: mine, userId: "frank" })).toBe(3);
    for (const client of frank) {
      expect(await until(() => client.stopped() === SYNC_CLOSE.revoked, 3000)).toBe(true);
    }
    await sleep(200);
    for (const client of [...alice, ...elsewhere]) expect(client.closes).toEqual([]);

    for (const name of docsOf(mine)) {
      expect(await refused(open(name, async () => frankToken))).toContain("access revoked");
    }

    expect(server.handleRevoke({ projectId: mine })).toBe(3);
    for (const client of alice) {
      expect(await until(() => client.stopped() === SYNC_CLOSE.revoked, 3000)).toBe(true);
    }
    for (const client of elsewhere) expect(client.closes).toEqual([]);
  });

  it("refuses a project whose row is gone, and every doc of a deleted project", async () => {
    const token = (projectId: string) => () => projectToken(projectId, "alice", { scoped: true });
    const missing = newProjectId();
    expect(await refused(open(documentName("project", missing), token(missing)))).toContain(
      "project not found",
    );

    const deleted = project();
    stores.projects.deleteProject(deleted);
    const [registry, scene, asset] = docsOf(deleted).map((name) => open(name, token(deleted)));
    expect(await refused(registry!)).toContain("project not found");
    expect(await refused(scene!)).toContain("scene not found");
    expect(await refused(asset!)).toContain("asset not found");
  });
});

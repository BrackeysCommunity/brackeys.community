import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import { eq } from "drizzle-orm";
import * as Y from "yjs";

import {
  assignZ,
  compareZ,
  CONTENT_MAP,
  KEYED_ITEM,
  KEYED_Z,
} from "../../../packages/engine/collab/index.ts";
import {
  ANIMATION_KIND,
  animationKind,
  EMITTER_KIND,
  emitterKind,
  formatAssetDoc,
  INPUT_MAP_KIND,
  inputMapKind,
  projectView,
  SCENE_LIST_KIND,
  sceneListKind,
  type AnimationFile,
  type EmitterFile,
  type InputMapFile,
  type SceneListFile,
} from "../../../packages/engine/project/index.ts";
import type { AssetEntry, ProjectState } from "../../../packages/engine/project/types.ts";
import { SCENE_FORMAT_VERSION } from "../../../packages/engine/scene/types.ts";
import { engineAssetDocs, engineBlobs, engineProjects } from "../../../src/db/schema.ts";
import {
  assetDocValue,
  emptyProjectState,
  readProjectState,
  seedProjectState,
} from "../../../src/lib/scene/project-bytes.ts";
import { MemoryAssetDocStore, postgresAssetDocStore } from "../src/engine/doc-store.ts";
import {
  MemoryProjectStore,
  postgresProjectStore,
  type ProjectStore,
} from "../src/engine/project-kind.ts";
import { startServer, type ServerOptions, type SyncServer } from "../src/index.ts";
import { MemorySceneStore } from "../src/scene/store.ts";
import {
  assetSnapshotOf,
  connectAsset,
  connectProject,
  connectScene,
  createMemoryProject,
  editEntry,
  type EngineClient,
  memoryEngineStores,
  newEntry,
  newProjectId,
  projectLogOf,
  projectStateOf,
  putEntry,
  sceneSynced as synced,
  SECRET,
  seedProjectRow,
  sleep,
  TEST_DATABASE_URL,
  testDb,
  until,
  warnSkipped,
} from "./harness.ts";

setDefaultTimeout(90_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };
const KNOWN = ["1", "2", "3"].map((d) => d.repeat(64));

function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const IDS = ["crate", "door", "gem", "key", "coin"];
const FOLDERS = ["", "art/", "Art/", "levels/", "levels/deep/"];

/** One random batch of registry edits in one transaction: creates, moves, renames, deletes and restores. */
function randomBatch(
  client: EngineClient,
  random: () => number,
  tag: string,
  created: Set<string>,
): void {
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const assets = client.doc.getMap<Y.Map<unknown>>("assets");
  client.doc.transact(() => {
    const ops = 1 + Math.floor(random() * 3);
    for (let i = 0; i < ops; i++) {
      const keys = [...assets.keys()];
      const live = keys.filter((k) => !assets.get(k)?.has("deleted"));
      const trashed = keys.filter((k) => assets.get(k)?.has("deleted"));
      const roll = random();
      if (roll < 0.4 || live.length === 0) {
        const key = `${tag}-${Math.floor(random() * 1e9).toString(36)}`;
        const id = pick(IDS);
        const blob = random() < 0.4;
        putEntry(
          client.doc,
          newEntry(key, {
            id,
            kind: blob ? "texture" : "material",
            path: `${pick(FOLDERS)}${id}.${blob ? "png" : "json"}`,
            ...(blob ? { sha256: pick(KNOWN), bytes: 10 } : {}),
          }),
        );
        created.add(key);
      } else if (roll < 0.6) {
        const key = pick(live);
        const path = String(assets.get(key)!.get("path"));
        editEntry(client.doc, key, { path: `${pick(FOLDERS)}${path.split("/").pop()}` });
      } else if (roll < 0.75) {
        const key = pick(live);
        const path = String(assets.get(key)!.get("path"));
        const ext = path.slice(path.lastIndexOf("."));
        const id = pick(IDS);
        editEntry(client.doc, key, {
          path: `${path.slice(0, path.lastIndexOf("/") + 1)}${id}${ext}`,
          name: id,
        });
      } else if (roll < 0.9 || trashed.length === 0) {
        editEntry(client.doc, pick(live), { deleted: { at: Date.now(), by: tag } });
      } else {
        editEntry(client.doc, pick(trashed), { deleted: undefined });
      }
    }
  });
}

/** Problems a converged registry must not have. */
function problems(state: ProjectState): string[] {
  const view = projectView(state);
  const out = view.issues.map((i) => `${i.code}: ${i.message}`);
  const live = Object.values(state.assets).filter((e) => !e.deleted);
  const paths = new Set(live.map((e) => e.path.toLowerCase()));
  if (paths.size !== live.length) out.push("duplicate live paths");
  if (new Set(live.map((e) => e.id)).size !== live.length) out.push("duplicate live ids");
  return out;
}

interface Fixture {
  options: Pick<ServerOptions, "projectStore" | "assetStore" | "sceneStore">;
  create(projectId: string, state: Uint8Array): Promise<void>;
  assetRows(projectId: string): Promise<Set<string>>;
  storedRegistry(projectId: string): Promise<ProjectState | null>;
  close(): Promise<void>;
}

function convergeSuite(label: string, seeds: number[], make: () => Promise<Fixture>) {
  describe(`three clients editing one registry through the real server (${label})`, () => {
    let fixture: Fixture;
    let server: SyncServer;
    const clients: EngineClient[] = [];

    beforeAll(async () => {
      fixture = await make();
      server = await startServer({
        port: 0,
        secret: SECRET,
        ...fixture.options,
        instanceId: `project-converge-${label}`,
        telemetry: quiet,
        debounceMs: 100,
        maxDebounceMs: 400,
      });
    });

    afterAll(async () => {
      for (const client of clients) client.destroy();
      await server?.stop(3000);
      await fixture?.close();
    });

    for (const seed of seeds) {
      it(`converge with no duplicate paths or ids and no lost entries (seed ${seed})`, async () => {
        const projectId = newProjectId();
        await fixture.create(projectId, seedProjectState(emptyProjectState(projectId, "Fuzz")));
        const trio = ["alice", "bob", "carol"].map((user) =>
          connectProject(server.port, projectId, user),
        );
        clients.push(...trio);
        for (const client of trio) expect(await synced(client)).toBe(true);

        const created = new Set<string>();
        await Promise.all(
          trio.map(async (client, n) => {
            const random = rng(seed * 31 + n);
            for (let batch = 0; batch < 25; batch++) {
              randomBatch(client, random, `${"abc"[n]}${batch}`, created);
              if (random() < 0.4) await sleep(Math.floor(random() * 15));
            }
          }),
        );

        const live = () => server.hocuspocus.documents.get(`project:${projectId}`)!;
        const settled = () => {
          const states = [...trio.map((c) => projectStateOf(c.doc)), projectStateOf(live())];
          const texts = states.map((s) => JSON.stringify(s));
          return texts.every((t) => t === texts[0]) && problems(states[0]!).length === 0;
        };
        expect(await until(settled, 20_000)).toBe(true);

        const state = projectStateOf(trio[0]!.doc);
        expect(problems(state)).toEqual([]);
        for (const key of created) expect(state.assets[key], key).toBeDefined();
        expect(Object.keys(state.assets).length).toBe(created.size);

        // Every live doc entry has its row; blob entries have none.
        const rows = await fixture.assetRows(projectId);
        for (const entry of Object.values(state.assets)) {
          if (entry.kind === "texture") expect(rows.has(entry.key)).toBe(false);
          else if (!entry.deleted) expect(rows.has(entry.key), entry.key).toBe(true);
        }

        for (const client of trio) client.destroy();
        expect(
          await until(
            async () =>
              JSON.stringify(await fixture.storedRegistry(projectId)) === JSON.stringify(state),
            5000,
          ),
        ).toBe(true);
      });
    }
  });
}

convergeSuite("memory", [1, 7, 42], async () => {
  const assets = new MemoryAssetDocStore();
  const projects = new MemoryProjectStore({ assets });
  return {
    options: { projectStore: projects, assetStore: assets },
    async create(projectId, state) {
      projects.create(projectId, "Fuzz", state);
      for (const hash of KNOWN) projects.addBlob(projectId, hash);
    },
    async assetRows(projectId) {
      return new Set(
        [...assets.rows.keys()]
          .filter((id) => id.startsWith(`${projectId}.`))
          .map((id) => id.split(".")[1]!),
      );
    },
    async storedRegistry(projectId) {
      const row = projects.rowsById.get(projectId);
      return row?.state ? readProjectState(row.state) : null;
    },
    close: async () => {},
  };
});

if (TEST_DATABASE_URL) {
  convergeSuite("postgres", [3], async () => {
    const { db, end } = testDb();
    return {
      options: { projectStore: postgresProjectStore(db), assetStore: postgresAssetDocStore(db) },
      async create(projectId, state) {
        await seedProjectRow(db, projectId, state, "Fuzz");
        await db.insert(engineBlobs).values(
          KNOWN.map((sha256) => ({
            projectId,
            sha256,
            byteSize: 10,
            contentType: "image/png",
            storageKey: `engine-assets/${projectId}/${sha256}`,
          })),
        );
      },
      async assetRows(projectId) {
        const rows = await db
          .select({ key: engineAssetDocs.assetKey })
          .from(engineAssetDocs)
          .where(eq(engineAssetDocs.projectId, projectId));
        return new Set(rows.map((r) => r.key));
      },
      async storedRegistry(projectId) {
        const [row] = await db
          .select({ state: engineProjects.state })
          .from(engineProjects)
          .where(eq(engineProjects.projectId, projectId));
        return row?.state ? readProjectState(new Uint8Array(row.state)) : null;
      },
      close: end,
    };
  });
} else {
  warnSkipped("project convergence on Postgres", "CANVAS_SYNC_TEST_DATABASE_URL");
}

const entry = (
  key: string,
  fields: Pick<AssetEntry, "kind" | "path"> & Partial<AssetEntry>,
): AssetEntry => ({ key, id: key, created: { at: 1, by: "alice" }, ...fields });

describe("the registry's one writer", () => {
  const assets = new MemoryAssetDocStore();
  const scenes = new MemorySceneStore();
  const projects = new MemoryProjectStore({ assets, scenes });
  const servers: SyncServer[] = [];
  const clients: EngineClient[] = [];
  const instance = async (id: string, extra: Partial<ServerOptions> = {}) => {
    const server = await startServer({
      port: 0,
      secret: SECRET,
      projectStore: projects as ProjectStore,
      assetStore: assets,
      sceneStore: scenes,
      instanceId: id,
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 400,
      ...extra,
    });
    servers.push(server);
    return server;
  };
  const project = (assetsOf: Record<string, AssetEntry>, history: ProjectState["history"] = {}) => {
    const projectId = newProjectId();
    projects.create(
      projectId,
      projectId,
      seedProjectState({ ...emptyProjectState(projectId, projectId), assets: assetsOf, history }),
    );
    return projectId;
  };
  const open = async (port: number, projectId: string) => {
    const client = connectProject(port, projectId, "alice");
    clients.push(client);
    expect(await synced(client)).toBe(true);
    return client;
  };
  const reasons = (client: EngineClient) =>
    projectLogOf(client.doc).map((e) =>
      e.actor.kind === "repair" ? e.actor.reason : e.actor.kind,
    );

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await Promise.all(servers.map((server) => server.stop(3000)));
  });

  it("puts a hash the blob store lacks back to the stored one, and trashes one with nothing to go back to", async () => {
    const server = await instance("duty-hash");
    const meta = { format: "png", width: 8, height: 8 };
    const projectId = project({
      crate: entry("crate", {
        kind: "texture",
        path: "crate.png",
        sha256: KNOWN[0],
        bytes: 4,
        meta,
      }),
    });
    projects.addBlob(projectId, KNOWN[0]!);
    const a = await open(server.port, projectId);

    const unknown = "f".repeat(64);
    editEntry(a.doc, "crate", {
      sha256: unknown,
      bytes: 99,
      meta: { format: "png", width: 1, height: 1 },
    });
    putEntry(
      a.doc,
      newEntry("ghost", {
        id: "ghost",
        kind: "texture",
        path: "ghost.png",
        sha256: unknown,
        bytes: 1,
      }),
    );
    expect(
      await until(() => {
        const state = projectStateOf(a.doc);
        return state.assets.crate?.sha256 === KNOWN[0] && state.assets.ghost?.deleted !== undefined;
      }),
    ).toBe(true);
    const state = projectStateOf(a.doc);
    expect(state.assets.crate).toMatchObject({ sha256: KNOWN[0], bytes: 4, meta });
    expect(state.assets.crate!.deleted).toBeUndefined();
    expect(state.assets.ghost!.deleted?.by).toBe("repair");
    expect(reasons(a)).toContain("hash-mismatch");
  });

  it("gives new doc entries rows until the quota refuses one, which goes to the trash", async () => {
    const quota = {
      check: (usage: { docs: number }, add: { docs?: number }) =>
        usage.docs + (add.docs ?? 0) > 2
          ? {
              ok: false as const,
              limit: "docs",
              used: usage.docs,
              max: 2,
              message: "2 docs at most",
            }
          : { ok: true as const },
    };
    const server = await instance("duty-quota", { quota });
    const projectId = project({ base: entry("base", { kind: "material", path: "base.json" }) });
    assets.create(`${projectId}.base`, "material");
    const a = await open(server.port, projectId);

    a.doc.transact(() => {
      putEntry(a.doc, newEntry("one", { id: "one", kind: "material", path: "one.json" }));
      putEntry(a.doc, newEntry("two", { id: "two", kind: "material", path: "two.json" }));
    });
    expect(await until(() => projectStateOf(a.doc).assets.two?.deleted !== undefined)).toBe(true);
    expect(projectStateOf(a.doc).assets.one!.deleted).toBeUndefined();
    expect(assets.rows.has(`${projectId}.one`)).toBe(true);
    expect(assets.rows.has(`${projectId}.two`)).toBe(false);
    const log = projectLogOf(a.doc);
    expect(reasons(a)).toContain("quota-exceeded");
    expect(log.find((e) => e.label.startsWith("quota-exceeded"))!.label).toContain(
      "2 docs at most",
    );
  });

  it("restores a trashed prefab that an open scene names, with asset-in-use in the log", async () => {
    const server = await instance("duty-restore");
    const projectId = project({
      level: entry("level", { kind: "scene", path: "level.json" }),
      crate: entry("crate", {
        kind: "prefab",
        path: "prefabs/crate.json",
        deleted: { at: 2, by: "bob" },
      }),
    });
    scenes.create(
      `${projectId}.level`,
      JSON.stringify({
        v: SCENE_FORMAT_VERSION,
        name: "level",
        bounds: [0, 0, 64, 64],
        instances: [{ id: "c1", prefab: "crate", at: [0, 0] }],
      }),
    );
    const a = await open(server.port, projectId);
    expect(projectStateOf(a.doc).assets.crate!.deleted).toBeDefined();

    const scene = connectScene(server.port, `${projectId}.level`, "alice");
    clients.push(scene);
    expect(await synced(scene)).toBe(true);
    expect(await until(() => projectStateOf(a.doc).assets.crate!.deleted === undefined)).toBe(true);
    expect(reasons(a)).toContain("asset-in-use");

    // Trashed again while the scene still names it: the next store brings it back.
    editEntry(a.doc, "crate", { deleted: { at: Date.now(), by: "alice" } });
    await sleep(50);
    expect(await until(() => projectStateOf(a.doc).assets.crate!.deleted === undefined)).toBe(true);
    expect(reasons(a).filter((r) => r === "asset-in-use").length).toBe(2);
  });

  it("repairs a shared path deterministically, on the later entry", async () => {
    const server = await instance("duty-paths");
    const projectId = project({});
    const a = await open(server.port, projectId);
    putEntry(a.doc, {
      ...newEntry("first", { id: "gem", kind: "material", path: "gem.json" }),
      created: { at: 1, by: "a" },
    });
    putEntry(a.doc, {
      ...newEntry("second", { id: "gem", kind: "material", path: "Gem.json" }),
      created: { at: 2, by: "b" },
    });
    expect(await until(() => problems(projectStateOf(a.doc)).length === 0)).toBe(true);
    const state = projectStateOf(a.doc);
    expect(state.assets.first).toMatchObject({ id: "gem", path: "gem.json" });
    expect(state.assets.second).toMatchObject({ id: "gem-2", path: "Gem-2.json" });
    expect(reasons(a)).toContain("registry");
  });
});

describe("an input-map asset doc through the real server", () => {
  const stores = memoryEngineStores();
  let server: SyncServer;
  const clients: EngineClient[] = [];

  const SEED: InputMapFile = {
    kind: INPUT_MAP_KIND,
    v: 1,
    players: { max: 2, join: "press" },
    actions: [{ action: "jump", bindings: [{ device: "key", code: "Space" }] }],
  };

  beforeAll(async () => {
    server = await startServer({
      port: 0,
      secret: SECRET,
      ...stores.options,
      instanceId: "project-converge-input-map",
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 400,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server?.stop(3000);
  });

  // Client docs come from the service's yjs, not the engine's: read them through
  // their bytes, and write them as a provider's client does, by their Y types.
  const valueOf = (doc: Y.Doc) =>
    assetDocValue(Y.encodeStateAsUpdate(doc)) as unknown as InputMapFile;
  const content = (doc: Y.Doc) => doc.getMap<unknown>(CONTENT_MAP);
  const keyedItem = (doc: Y.Doc, field: string, match: (item: Y.Map<unknown>) => boolean) => {
    const keyed = content(doc).get(field) as Y.Map<Y.Map<unknown>>;
    for (const entry of keyed.values()) {
      const item = entry.get(KEYED_ITEM) as Y.Map<unknown>;
      if (match(item)) return item;
    }
    throw new Error(`no ${field} item matches`);
  };
  const addBinding = (doc: Y.Doc, action: string, binding: Record<string, unknown>) => {
    const item = keyedItem(doc, "actions", (i) => i.get("action") === action);
    (item.get("bindings") as Y.Array<unknown>).push([binding]);
  };
  const addTouch = (doc: Y.Doc, key: string, control: Record<string, unknown>) =>
    doc.transact(() => {
      const touch = new Y.Map<Y.Map<unknown>>();
      const entry = new Y.Map<unknown>();
      const item = new Y.Map<unknown>();
      for (const [field, value] of Object.entries(control)) item.set(field, value);
      entry.set(KEYED_Z, "a0");
      entry.set(KEYED_ITEM, item);
      touch.set(key, entry);
      content(doc).set("touch", touch);
    });

  it("seeds once, merges two clients' edits and snapshots the canonical text", async () => {
    const projectId = newProjectId();
    createMemoryProject(
      stores,
      {
        ...emptyProjectState(projectId, "Versus"),
        assets: { input: entry("input", { kind: INPUT_MAP_KIND, path: "input.json" }) },
      },
      { input: JSON.stringify(SEED) },
    );
    const docId = `${projectId}.input`;
    const [a, b] = ["alice", "bob"].map((user) => connectAsset(server.port, docId, user));
    clients.push(a!, b!);
    expect(await synced(a!)).toBe(true);
    expect(await synced(b!)).toBe(true);

    // One seed: both clients hold the server's single copy of each item.
    expect(valueOf(a!.doc)).toEqual(SEED);
    expect(Y.encodeStateVector(a!.doc)).toEqual(Y.encodeStateVector(b!.doc));
    expect(a!.doc.getMap("meta").get("kind")).toBe(INPUT_MAP_KIND);

    // Concurrent, before either sees the other: two bindings on one action,
    // a seat count against a new touch control.
    a!.doc.transact(() => {
      addBinding(a!.doc, "jump", { device: "key", code: "KeyW" });
      addTouch(a!.doc, "a-touch", {
        id: "jump-btn",
        kind: "button",
        action: "jump",
        at: [0.85, 0.8],
        radius: 0.1,
      });
    });
    b!.doc.transact(() => {
      addBinding(b!.doc, "jump", { device: "pad", button: "south" });
      (content(b!.doc).get("players") as Y.Map<unknown>).set("max", 4);
    });

    const live = () => server.hocuspocus.documents.get(`asset:${docId}`)!;
    const texts = () => [a!.doc, b!.doc, live()].map((doc) => JSON.stringify(valueOf(doc)));
    expect(
      await until(() => {
        const [first, ...rest] = texts();
        return rest.every((t) => t === first) && valueOf(a!.doc).touch !== undefined;
      }, 10_000),
    ).toBe(true);

    const merged = valueOf(a!.doc);
    expect(merged.players).toEqual({ max: 4, join: "press" });
    expect(merged.touch?.map((t) => t.id)).toEqual(["jump-btn"]);
    const bindings = merged.actions![0]!.bindings;
    expect(bindings[0]).toEqual({ device: "key", code: "Space" });
    expect(bindings).toHaveLength(3);
    expect(bindings).toContainEqual({ device: "key", code: "KeyW" });
    expect(bindings).toContainEqual({ device: "pad", button: "south" });

    // An engine kind: the service formats the snapshot itself, as the engine does.
    const expected = await assetSnapshotOf(a!.doc);
    expect(expected?.text).toBe(formatAssetDoc(inputMapKind, merged));
    expect(await assetSnapshotOf(b!.doc)).toEqual(expected);

    a!.destroy();
    b!.destroy();
    const row = () => stores.assets.rows.get(docId);
    expect(await until(() => row()?.snapshot === expected!.text, 10_000)).toBe(true);
    expect(row()?.contentSha256).toBe(expected!.sha256);
    expect(row()?.kind).toBe(INPUT_MAP_KIND);
    expect(JSON.parse(row()!.snapshot!)).toEqual(merged);
  });
});

describe("a scene-list asset doc through the real server", () => {
  const stores = memoryEngineStores();
  let server: SyncServer;
  const clients: EngineClient[] = [];

  const SEED: SceneListFile = {
    kind: SCENE_LIST_KIND,
    v: 1,
    start: "yard",
    scenes: [
      { scene: "yard", title: "Yard" },
      { scene: "result" },
      { scene: "cellar", sublevel: true },
    ],
  };

  beforeAll(async () => {
    server = await startServer({
      port: 0,
      secret: SECRET,
      ...stores.options,
      instanceId: "project-converge-scene-list",
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 400,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server?.stop(3000);
  });

  // Client docs come from the service's yjs: read them through their bytes,
  // and write them by their Y types, as a provider's client does.
  const valueOf = (doc: Y.Doc) =>
    assetDocValue(Y.encodeStateAsUpdate(doc)) as unknown as SceneListFile;
  const content = (doc: Y.Doc) => doc.getMap<unknown>(CONTENT_MAP);
  const scenesOf = (doc: Y.Doc) => content(doc).get("scenes") as Y.Map<Y.Map<unknown>>;
  /** The list's entries in order, `(z, key)`, as the layout reads them. */
  const ordered = (doc: Y.Doc) =>
    [...scenesOf(doc).entries()]
      .map(([key, entry]) => ({ key, entry, z: String(entry.get(KEYED_Z)) }))
      .sort(compareZ);
  const itemOf = (doc: Y.Doc, scene: string) =>
    ordered(doc)
      .map((e) => e.entry)
      .find((entry) => (entry.get(KEYED_ITEM) as Y.Map<unknown>).get("scene") === scene)!;

  it("seeds once, merges two clients' edits and snapshots the canonical text", async () => {
    const projectId = newProjectId();
    createMemoryProject(
      stores,
      {
        ...emptyProjectState(projectId, "Ford"),
        assets: { list: entry("list", { kind: SCENE_LIST_KIND, path: "scene-list.json" }) },
      },
      { list: JSON.stringify(SEED) },
    );
    const docId = `${projectId}.list`;
    const [a, b] = ["alice", "bob"].map((user) => connectAsset(server.port, docId, user));
    clients.push(a!, b!);
    expect(await synced(a!)).toBe(true);
    expect(await synced(b!)).toBe(true);

    expect(valueOf(a!.doc)).toEqual(SEED);
    expect(Y.encodeStateVector(a!.doc)).toEqual(Y.encodeStateVector(b!.doc));
    expect(a!.doc.getMap("meta").get("kind")).toBe(SCENE_LIST_KIND);

    // Concurrent: one client lists a new scene at the end and retitles one;
    // the other moves the result scene first and starts there.
    a!.doc.transact(() => {
      const zs = ordered(a!.doc).map((e) => e.z);
      const entry = new Y.Map<unknown>();
      const item = new Y.Map<unknown>();
      item.set("scene", "ford");
      item.set("title", "Ford");
      entry.set(KEYED_Z, assignZ([...zs, undefined]).at(-1)!);
      entry.set(KEYED_ITEM, item);
      scenesOf(a!.doc).set("a-ford", entry);
      (itemOf(a!.doc, "yard").get(KEYED_ITEM) as Y.Map<unknown>).set("title", "Court");
    });
    b!.doc.transact(() => {
      const zs = ordered(b!.doc).map((e) => e.z);
      itemOf(b!.doc, "result").set(KEYED_Z, assignZ([undefined, ...zs])[0]!);
      content(b!.doc).set("start", "result");
    });

    const live = () => server.hocuspocus.documents.get(`asset:${docId}`)!;
    const texts = () => [a!.doc, b!.doc, live()].map((doc) => JSON.stringify(valueOf(doc)));
    expect(
      await until(() => {
        const [first, ...rest] = texts();
        return (
          rest.every((t) => t === first) &&
          valueOf(a!.doc).start === "result" &&
          valueOf(b!.doc).scenes.length === 4
        );
      }, 10_000),
    ).toBe(true);

    const merged = valueOf(a!.doc);
    expect(merged).toEqual({
      ...SEED,
      start: "result",
      scenes: [
        { scene: "result" },
        { scene: "yard", title: "Court" },
        { scene: "cellar", sublevel: true },
        { scene: "ford", title: "Ford" },
      ],
    });

    // An engine kind: the service formats the snapshot itself, as the engine does.
    const expected = await assetSnapshotOf(a!.doc);
    expect(expected?.text).toBe(formatAssetDoc(sceneListKind, merged));
    expect(await assetSnapshotOf(b!.doc)).toEqual(expected);

    a!.destroy();
    b!.destroy();
    const row = () => stores.assets.rows.get(docId);
    expect(await until(() => row()?.snapshot === expected!.text, 10_000)).toBe(true);
    expect(row()?.contentSha256).toBe(expected!.sha256);
    expect(row()?.kind).toBe(SCENE_LIST_KIND);
    expect(JSON.parse(row()!.snapshot!)).toEqual(merged);
  });
});

describe("animation and emitter asset docs through the real server", () => {
  const stores = memoryEngineStores();
  let server: SyncServer;
  const clients: EngineClient[] = [];

  beforeAll(async () => {
    server = await startServer({
      port: 0,
      secret: SECRET,
      ...stores.options,
      instanceId: "project-converge-effects",
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 400,
    });
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await server?.stop(3000);
  });

  // Client docs come from the service's yjs: read them through their bytes,
  // and write them by their Y types, as a provider's client does.
  const valueOf = <T>(doc: Y.Doc) => assetDocValue(Y.encodeStateAsUpdate(doc)) as unknown as T;
  const content = (doc: Y.Doc) => doc.getMap<unknown>(CONTENT_MAP);

  /** Seeds one doc asset, connects two clients to it and waits until both hold the server's one seed. */
  async function seeded<T>(kind: string, path: string, seed: T) {
    const projectId = newProjectId();
    createMemoryProject(
      stores,
      { ...emptyProjectState(projectId, "Effects"), assets: { fx: entry("fx", { kind, path }) } },
      { fx: JSON.stringify(seed) },
    );
    const docId = `${projectId}.fx`;
    const [a, b] = ["alice", "bob"].map((user) => connectAsset(server.port, docId, user));
    clients.push(a!, b!);
    expect(await synced(a!)).toBe(true);
    expect(await synced(b!)).toBe(true);
    expect(valueOf<T>(a!.doc)).toEqual(seed);
    expect(Y.encodeStateVector(a!.doc)).toEqual(Y.encodeStateVector(b!.doc));
    expect(a!.doc.getMap("meta").get("kind")).toBe(kind);
    const live = () => server.hocuspocus.documents.get(`asset:${docId}`)!;
    return { docId, a: a!, b: b!, live };
  }

  /** Waits for both clients and the server to hold one value that `done` accepts. */
  async function converged(docs: Y.Doc[], done: (doc: Y.Doc) => boolean) {
    const texts = () =>
      docs.map((doc) => JSON.stringify(assetDocValue(Y.encodeStateAsUpdate(doc))));
    expect(
      await until(() => {
        const [first, ...rest] = texts();
        return rest.every((t) => t === first) && docs.every(done);
      }, 10_000),
    ).toBe(true);
  }

  /** The stored row once both clients leave: the snapshot both computed, the hash and the kind. */
  async function snapshotted(docId: string, a: EngineClient, b: EngineClient, kind: string) {
    const expected = await assetSnapshotOf(a.doc);
    expect(await assetSnapshotOf(b.doc)).toEqual(expected);
    a.destroy();
    b.destroy();
    const row = () => stores.assets.rows.get(docId);
    expect(await until(() => row()?.snapshot === expected!.text, 10_000)).toBe(true);
    expect(row()?.contentSha256).toBe(expected!.sha256);
    expect(row()?.kind).toBe(kind);
    return { expected: expected!, row: row()! };
  }

  it("an animation seeds once, merges two clients' clip edits and snapshots the canonical text", async () => {
    const SEED: AnimationFile = {
      kind: ANIMATION_KIND,
      v: 1,
      atlas: "hero",
      clips: [
        { name: "idle", tag: "idle" },
        {
          name: "strike",
          frames: [
            { frame: "hero-0", ms: 50 },
            { frame: "hero-1", ms: 80, events: ["swing"] },
          ],
          loop: "once",
          next: "idle",
        },
      ],
    };
    const { docId, a, b, live } = await seeded(ANIMATION_KIND, "art/knight.animation.json", SEED);
    const clipsOf = (doc: Y.Doc) => content(doc).get("clips") as Y.Map<Y.Map<unknown>>;
    const ordered = (doc: Y.Doc) =>
      [...clipsOf(doc).entries()]
        .map(([key, entry]) => ({ key, entry, z: String(entry.get(KEYED_Z)) }))
        .sort(compareZ);
    const clip = (doc: Y.Doc, name: string) =>
      ordered(doc)
        .map((e) => e.entry.get(KEYED_ITEM) as Y.Map<unknown>)
        .find((item) => item.get("name") === name)!;

    // Concurrent, on different clips: one client slows strike's second frame
    // and speeds the clip up; the other adds a clip at the end.
    a.doc.transact(() => {
      const strike = clip(a.doc, "strike");
      const frames = strike.get("frames") as Y.Array<unknown>;
      frames.delete(1, 1);
      frames.insert(1, [{ frame: "hero-1", ms: 120, events: ["swing"] }]);
      strike.set("speed", 1.5);
    });
    b.doc.transact(() => {
      const zs = ordered(b.doc).map((e) => e.z);
      const entry = new Y.Map<unknown>();
      const item = new Y.Map<unknown>();
      item.set("name", "sway");
      item.set("tag", "idle");
      item.set("loop", "pingpong");
      entry.set(KEYED_Z, assignZ([...zs, undefined]).at(-1)!);
      entry.set(KEYED_ITEM, item);
      clipsOf(b.doc).set("b-sway", entry);
    });

    await converged(
      [a.doc, b.doc, live()],
      (doc) =>
        valueOf<AnimationFile>(doc).clips.length === 3 &&
        valueOf<AnimationFile>(doc).clips[1]?.speed === 1.5,
    );
    const merged = valueOf<AnimationFile>(a.doc);
    expect(merged).toEqual({
      ...SEED,
      clips: [
        { name: "idle", tag: "idle" },
        {
          name: "strike",
          frames: [
            { frame: "hero-0", ms: 50 },
            { frame: "hero-1", ms: 120, events: ["swing"] },
          ],
          loop: "once",
          next: "idle",
          speed: 1.5,
        },
        { name: "sway", tag: "idle", loop: "pingpong" },
      ],
    });

    const { expected, row } = await snapshotted(docId, a, b, ANIMATION_KIND);
    expect(expected.text).toBe(formatAssetDoc(animationKind, merged));
    expect(JSON.parse(row.snapshot!)).toEqual(merged);
  });

  it("an emitter seeds once, merges two clients' field and burst edits and snapshots the canonical text", async () => {
    const SEED: EmitterFile = {
      kind: EMITTER_KIND,
      v: 1,
      texture: "sparks",
      rate: 40,
      bursts: [{ atMs: 0, count: 12 }],
      lifeMs: [300, 600],
      speed: [0.8, 2.2],
      angle: [-120, -60],
      tint: [
        [0, 16777215],
        [1, 16744448],
      ],
    };
    const { docId, a, b, live } = await seeded(EMITTER_KIND, "fx/sparks.emitter.json", SEED);
    const bursts = (doc: Y.Doc) => content(doc).get("bursts") as Y.Array<unknown>;

    // Concurrent: each client sets its own field and adds a burst.
    a.doc.transact(() => {
      content(a.doc).set("rate", 55);
      bursts(a.doc).push([{ atMs: 250, count: 6 }]);
    });
    b.doc.transact(() => {
      content(b.doc).set("tint", [
        [0, 16777215],
        [1, 255],
      ]);
      bursts(b.doc).push([{ atMs: 500, count: 3 }]);
    });

    await converged(
      [a.doc, b.doc, live()],
      (doc) =>
        valueOf<EmitterFile>(doc).bursts?.length === 3 && valueOf<EmitterFile>(doc).rate === 55,
    );
    const merged = valueOf<EmitterFile>(a.doc);
    expect(merged.rate).toBe(55);
    expect(merged.tint).toEqual([
      [0, 16777215],
      [1, 255],
    ]);
    expect(merged.bursts?.[0]).toEqual({ atMs: 0, count: 12 });
    expect(merged.bursts).toContainEqual({ atMs: 250, count: 6 });
    expect(merged.bursts).toContainEqual({ atMs: 500, count: 3 });
    const { rate: _rate, tint: _tint, bursts: _bursts, ...rest } = merged;
    const { rate: _r, tint: _t, bursts: _b, ...seedRest } = SEED;
    expect(rest).toEqual(seedRest);

    const { expected, row } = await snapshotted(docId, a, b, EMITTER_KIND);
    expect(expected.text).toBe(formatAssetDoc(emitterKind, merged));
    expect(JSON.parse(row.snapshot!)).toEqual(merged);
  });
});

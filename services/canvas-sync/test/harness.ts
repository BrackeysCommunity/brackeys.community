import { it } from "bun:test";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { eq, sql } from "drizzle-orm";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";

import {
  BULK_FIELD,
  DOC_MAPS,
  LEGACY_BULK_FIELD,
  LEGACY_Z_FIELD,
  Z_FIELD,
  type ProjectLogEntry,
} from "../../../packages/engine/collab/types.ts";
import type { AssetEntry, ProjectState } from "../../../packages/engine/project/types.ts";
import {
  SCENE_FORMAT_VERSION,
  type Prefab,
  type SceneDefinition,
} from "../../../packages/engine/scene/types.ts";
import {
  canvasDocs,
  canvases,
  engineAssetDocs,
  engineProjects,
  sceneDocs,
  user,
} from "../../../src/db/schema.ts";
import { documentName, SYNC_CLOSE, syncCloseCode } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken, type SyncAccess } from "../../../src/lib/canvas/token.ts";
import { sceneSnapshot, seedState } from "../../../src/lib/scene/doc-bytes.ts";
import {
  assetSnapshot,
  COLLAB_LAYOUT_VERSION,
  prefabDocValue,
  readProjectState,
  seedProjectState,
} from "../../../src/lib/scene/project-bytes.ts";
import { createDb, type ServiceDb } from "../src/db.ts";
import { MemoryAssetDocStore } from "../src/engine/doc-store.ts";
import { MemoryProjectStore } from "../src/engine/project-kind.ts";
import { MemorySceneStore } from "../src/scene/store.ts";

export const TEST_DATABASE_URL = process.env.CANVAS_SYNC_TEST_DATABASE_URL;
export const TEST_REDIS_URL = process.env.CANVAS_SYNC_TEST_REDIS_URL;
export const SECRET = "test-secret-for-canvas-sync";

/** Set in CI: a suite that would skip for want of a database or a Redis fails instead. */
export const REQUIRE_INTEGRATION = process.env.CANVAS_SYNC_REQUIRE_INTEGRATION === "1";

export function warnSkipped(what: string, variable: string): void {
  const message = `${what} needs ${variable} (see services/canvas-sync/README.md, "Tests")`;
  if (REQUIRE_INTEGRATION) {
    it(`${what} runs (CANVAS_SYNC_REQUIRE_INTEGRATION=1)`, () => {
      throw new Error(`not skipped under CANVAS_SYNC_REQUIRE_INTEGRATION=1: ${message}`);
    });
    return;
  }
  console.warn(`\n  !! SKIPPED: ${message}.\n`);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(check: () => boolean | Promise<boolean>, ms = 5000): Promise<boolean> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > ms) return false;
    await sleep(10);
  }
  return true;
}

export function testDb(): { db: ServiceDb; end: () => Promise<void> } {
  const { pool, db } = createDb(TEST_DATABASE_URL!);
  return { db, end: () => pool.end() };
}

const EMPTY = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()));

export async function seedUser(db: ServiceDb, id: string): Promise<void> {
  const now = new Date();
  await db
    .insert(user)
    .values({
      id,
      name: id,
      email: `${id}@test.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
}

/** A personal canvas owned by `ownerId`, with its empty doc row. */
export async function seedCanvas(db: ServiceDb, ownerId = "alice"): Promise<string> {
  await seedUser(db, ownerId);
  const id = crypto.randomUUID();
  await db.insert(canvases).values({ id, ownerId, path: `Test ${id.slice(0, 8)}.canvas` });
  await db.insert(canvasDocs).values({ canvasId: id, state: EMPTY });
  return id;
}

export interface TestClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  nodes: Y.Map<Y.Map<unknown>>;
  /** Sync close codes (or null for an ordinary close) in arrival order. */
  closes: (number | null)[];
  authFailures: string[];
  destroy(): void;
}

export function connect(
  port: number,
  canvasId: string,
  userId: string,
  options: { access?: SyncAccess; token?: () => Promise<string>; name?: string } = {},
): TestClient {
  const doc = new Y.Doc();
  const name = options.name ?? documentName("canvas", canvasId);
  const closes: (number | null)[] = [];
  const authFailures: string[] = [];
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name,
    document: doc,
    token:
      options.token ??
      (() => signCanvasToken({ c: name, u: userId, a: options.access ?? "write" }, SECRET)),
    onClose: ({ event }) => closes.push(syncCloseCode(event)),
    onAuthenticationFailed: ({ reason }) => authFailures.push(reason),
  });
  return {
    doc,
    provider,
    nodes: doc.getMap("nodes"),
    closes,
    authFailures,
    destroy: () => provider.destroy(),
  };
}

export const synced = (client: TestClient, ms = 5000) => until(() => client.provider.isSynced, ms);

/** A text card, laid out the way the editor writes one. */
export function addCard(client: TestClient, id: string, text = id, x = 0): void {
  client.doc.transact(() => {
    const node = new Y.Map<unknown>();
    node.set("type", "text");
    node.set("x", x);
    node.set("y", 0);
    node.set("w", 200);
    node.set("h", 100);
    node.set("z", "a0");
    node.set("text", new Y.Text(text));
    client.nodes.set(id, node);
  });
}

export async function storedState(db: ServiceDb, canvasId: string): Promise<Uint8Array | null> {
  const [row] = await db
    .select({ state: canvasDocs.state })
    .from(canvasDocs)
    .where(eq(canvasDocs.canvasId, canvasId));
  return row ? new Uint8Array(row.state) : null;
}

export async function storedNodeIds(db: ServiceDb, canvasId: string): Promise<string[]> {
  const state = await storedState(db, canvasId);
  if (!state) return [];
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return [...doc.getMap("nodes").keys()].sort();
}

export async function canvasRow(db: ServiceDb, canvasId: string) {
  const [row] = await db.select().from(canvases).where(eq(canvases.id, canvasId));
  return row!;
}

export async function versionCount(db: ServiceDb, canvasId: string): Promise<number> {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from canvas.doc_versions where doc_kind = 'canvas' and doc_id = ${canvasId}`,
  );
  return result.rows[0]!.n;
}

/** The provider's auth message: documentName, Auth, Token, token. */
export function authFrame(name: string, token: string): Uint8Array<ArrayBuffer> {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, name);
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarString(encoder, token);
  return encoding.toUint8Array(encoder);
}

export function rawSocket(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.binaryType = "arraybuffer";
  const state = { open: false, closed: null as null | { code: number; reason: string } };
  socket.addEventListener("open", () => (state.open = true));
  socket.addEventListener("close", (event) => {
    state.closed = { code: event.code, reason: event.reason };
  });
  return { socket, state };
}

// ─── Scenes ──────────────────────────────────────────────

export { SCENE_FORMAT_VERSION };

/** A scene token; `layout: null` leaves out `l`, as a token from before collab layouts did. */
export function sceneToken(
  sceneId: string,
  userId: string,
  options: { access?: SyncAccess; format?: number; layout?: number | null } = {},
): Promise<string> {
  const layout = options.layout === undefined ? COLLAB_LAYOUT_VERSION : options.layout;
  return signCanvasToken(
    {
      c: documentName("scene", sceneId),
      u: userId,
      a: options.access ?? "write",
      k: "scene",
      f: options.format ?? SCENE_FORMAT_VERSION,
      ...(layout !== null ? { l: layout } : {}),
    },
    SECRET,
  );
}

/** A client of an engine doc (scene, project or asset), behaving as the editor does. */
export interface EngineClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  closes: (number | null)[];
  authFailures: string[];
  /** Stateless messages from the server, in arrival order. */
  notices: string[];
  /** The scope the server granted, once authenticated. */
  scope: () => string | null;
  /** How many times the server accepted this client's token. */
  authentications: () => number;
  /** Set once a 4413 or 4403 made the client give up, as the editor does. */
  stopped: () => number | null;
  destroy(): void;
}

export interface SceneClient extends EngineClient {
  entities: Y.Map<Y.Map<unknown>>;
}

export function connectScene(
  port: number,
  sceneId: string,
  userId: string,
  options: {
    access?: SyncAccess;
    format?: number;
    layout?: number | null;
    token?: () => Promise<string>;
    /** Reconnect an existing client's doc, as a provider does after a deploy. */
    doc?: Y.Doc;
  } = {},
): SceneClient {
  const client = connectDoc(
    port,
    documentName("scene", sceneId),
    options.token ?? (() => sceneToken(sceneId, userId, options)),
    options.doc,
  );
  return { ...client, entities: client.doc.getMap("entities") };
}

/** Opens `name` with `token`, giving up on 4413 and 4403 as the editor does. */
export function connectDoc(
  port: number,
  name: string,
  token: () => Promise<string>,
  existing?: Y.Doc,
): EngineClient {
  const doc = existing ?? new Y.Doc();
  const closes: (number | null)[] = [];
  const authFailures: string[] = [];
  const notices: string[] = [];
  let scope: string | null = null;
  let authentications = 0;
  let stopped: number | null = null;
  const provider: HocuspocusProvider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name,
    document: doc,
    token,
    onClose: ({ event }) => {
      const code = syncCloseCode(event);
      closes.push(code);
      if (stopped === null && (code === SYNC_CLOSE.tooLarge || code === SYNC_CLOSE.revoked)) {
        stopped = code;
        provider.disconnect();
      }
    },
    onAuthenticationFailed: ({ reason }) => authFailures.push(reason),
    onAuthenticated: ({ scope: granted }) => {
      scope = granted;
      authentications++;
    },
    onStateless: ({ payload }) => notices.push(payload),
  });
  return {
    doc,
    provider,
    closes,
    authFailures,
    notices,
    scope: () => scope,
    authentications: () => authentications,
    stopped: () => stopped,
    destroy: () => provider.destroy(),
  };
}

export const sceneSynced = (client: EngineClient, ms = 5000) =>
  until(() => client.provider.isSynced, ms);

/** A bulk `solid` box, laid out as the engine writes one. */
export function addSolid(doc: Y.Doc, key: string, x = 0, z = "a0"): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set(Z_FIELD, z);
    map.set(BULK_FIELD, "solid");
    map.set("type", "solid");
    map.set("shape", ["box", x, 0, 16, 16]);
    doc.getMap<Y.Map<unknown>>("entities").set(key, map);
  });
}

/** A named entity, laid out as the engine writes one. */
export function addNamed(doc: Y.Doc, key: string, id: string, x = 0, z = "a0"): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set(Z_FIELD, z);
    map.set("id", id);
    map.set("type", "marker");
    map.set("at", [x, 0]);
    doc.getMap<Y.Map<unknown>>("entities").set(key, map);
  });
}

/** The canonical text and hash a doc reads as, through the engine. */
export function sceneOf(doc: Y.Doc): { text: string; hash: string; schemaVersion: number } | null {
  const snapshot = sceneSnapshot(Y.encodeStateAsUpdate(doc));
  if (!snapshot?.text || !snapshot.hash) return null;
  return { text: snapshot.text, hash: snapshot.hash, schemaVersion: snapshot.schemaVersion };
}

/** A hosted scene row, as the web app creates one. */
export async function seedSceneRow(
  db: ServiceDb,
  sceneId: string,
  seed: string | null = null,
): Promise<void> {
  await db.insert(sceneDocs).values({ sceneId, seed }).onConflictDoNothing();
}

/** A fresh scene id, so suites sharing a database never meet. */
export const newSceneId = (game = "test") => `${game}.s-${crypto.randomUUID().slice(0, 8)}`;

// ─── Projects and assets ─────────────────────────────────

export { COLLAB_LAYOUT_VERSION };

/** A fresh project id, so suites sharing a database never meet. */
export const newProjectId = () => `p-${crypto.randomUUID().slice(0, 8)}`;

/** A project token, as the web app mints one: with the engine's format and layout. */
export function projectToken(
  projectId: string,
  userId: string,
  options: { access?: SyncAccess; layout?: number; scoped?: boolean; format?: number } = {},
): Promise<string> {
  return signCanvasToken(
    {
      c: documentName("project", projectId),
      u: userId,
      a: options.access ?? "write",
      k: "project",
      f: options.format ?? SCENE_FORMAT_VERSION,
      l: options.layout ?? COLLAB_LAYOUT_VERSION,
      ...(options.scoped ? { s: "project" as const } : {}),
    },
    SECRET,
  );
}

/** A project-scoped token the web app mints for an agent token: `g` the agent, `o` the user it acts for. */
export function agentSyncToken(
  projectId: string,
  agentId: string,
  onBehalfOf: string,
  options: { access?: SyncAccess; name?: string; now?: number; ttlMs?: number } = {},
): Promise<string> {
  return signCanvasToken(
    {
      c: documentName("project", projectId),
      u: onBehalfOf,
      a: options.access ?? "write",
      k: "project",
      s: "project",
      f: SCENE_FORMAT_VERSION,
      l: COLLAB_LAYOUT_VERSION,
      g: agentId,
      o: onBehalfOf,
      ...(options.name !== undefined ? { n: options.name } : {}),
    },
    SECRET,
    options.now,
    options.ttlMs,
  );
}

export function assetToken(
  assetId: string,
  userId: string,
  options: { access?: SyncAccess; layout?: number } = {},
): Promise<string> {
  return signCanvasToken(
    {
      c: documentName("asset", assetId),
      u: userId,
      a: options.access ?? "write",
      k: "asset",
      l: options.layout ?? COLLAB_LAYOUT_VERSION,
    },
    SECRET,
  );
}

export function connectProject(
  port: number,
  projectId: string,
  userId: string,
  options: { access?: SyncAccess; layout?: number; token?: () => Promise<string> } = {},
): EngineClient {
  return connectDoc(
    port,
    documentName("project", projectId),
    options.token ?? (() => projectToken(projectId, userId, options)),
  );
}

export function connectAsset(
  port: number,
  assetId: string,
  userId: string,
  options: { access?: SyncAccess; layout?: number; token?: () => Promise<string> } = {},
): EngineClient {
  return connectDoc(
    port,
    documentName("asset", assetId),
    options.token ?? (() => assetToken(assetId, userId, options)),
  );
}

/** The memory stores of one project-hosting deployment, shareable between instances. */
export function memoryEngineStores() {
  const scenes = new MemorySceneStore();
  const assets = new MemoryAssetDocStore();
  const projects = new MemoryProjectStore({ assets, scenes });
  return {
    scenes,
    assets,
    projects,
    options: { sceneStore: scenes, assetStore: assets, projectStore: projects },
  };
}

/** A project row holding `state`, with a row for each of its doc entries, as the web app creates one. */
export function createMemoryProject(
  stores: ReturnType<typeof memoryEngineStores>,
  state: ProjectState,
  seeds: Record<string, string> = {},
): void {
  const projectId = state.meta.projectId;
  stores.projects.create(projectId, state.meta.name, seedProjectState(state));
  for (const entry of Object.values(state.assets)) {
    const id = `${projectId}.${entry.key}`;
    if (entry.kind === "scene") stores.scenes.create(id, seeds[entry.key] ?? null);
    else if (entry.sha256 === undefined)
      stores.assets.create(id, entry.kind, seeds[entry.key] ?? null);
  }
}

/** A scene doc as a layout-1 server stored it: its prefabs in its own `prefabs` map, no `meta.layout`. */
export function layoutOneState(
  sceneId: string,
  def: SceneDefinition,
  prefabs: readonly Prefab[],
): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, seedState(sceneId, def));
  doc.transact(() => {
    doc.getMap("meta").delete("layout");
    const map = doc.getMap<unknown>("prefabs");
    for (const prefab of prefabs) map.set(prefab.id, structuredClone(prefab));
  });
  return Y.encodeStateAsUpdate(doc);
}

/**
 * A scene state as a layout-2 instance stored it: every entity and instance
 * record's order and bulk keys under their layout-2 names, `meta.layout` 2,
 * and `meta.schemaVersion` set to `schemaVersion` when given.
 */
export function layoutTwoState(state: Uint8Array, schemaVersion?: number): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  doc.transact(() => {
    for (const name of [DOC_MAPS.entities, DOC_MAPS.instances])
      for (const rec of doc.getMap(name).values()) {
        if (!(rec instanceof Y.Map)) continue;
        for (const [from, to] of [
          [Z_FIELD, LEGACY_Z_FIELD],
          [BULK_FIELD, LEGACY_BULK_FIELD],
        ] as const)
          if (rec.has(from)) {
            rec.set(to, rec.get(from));
            rec.delete(from);
          }
      }
    const meta = doc.getMap(DOC_MAPS.meta);
    meta.set("layout", 2);
    if (schemaVersion !== undefined) meta.set("schemaVersion", schemaVersion);
  });
  return Y.encodeStateAsUpdate(doc);
}

/** The prefab an asset doc's state holds, through the engine. */
export const prefabOfState = (state: Uint8Array | null) => prefabDocValue(state);

/** A registry entry as a client writes one: atomic fields, `import` and `licence` as nested maps. */
export function putEntry(doc: Y.Doc, entry: AssetEntry): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    for (const [field, value] of Object.entries(entry)) {
      if (field === "key" || value === undefined) continue;
      if (field === "import" || field === "licence") {
        const nested = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) nested.set(k, v);
        map.set(field, nested);
      } else map.set(field, value);
    }
    if (!entry.import) map.set("import", new Y.Map());
    if (!entry.licence) map.set("licence", new Y.Map());
    doc.getMap<Y.Map<unknown>>("assets").set(entry.key, map);
  });
}

/** Sets (or, for undefined, removes) atomic fields of an existing entry, in one transaction. */
export function editEntry(doc: Y.Doc, key: string, fields: Partial<AssetEntry>): void {
  const map = doc.getMap<Y.Map<unknown>>("assets").get(key);
  if (!map) return;
  doc.transact(() => {
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) map.delete(field);
      else map.set(field, value);
    }
  });
}

/** An entry a user created just now. */
export function newEntry(
  key: string,
  fields: Pick<AssetEntry, "id" | "kind" | "path"> & Partial<AssetEntry>,
  by = "alice",
): AssetEntry {
  return { key, created: { at: Date.now(), by }, ...fields };
}

/** The registry a client's project doc holds, through the engine. */
export const projectStateOf = (doc: Y.Doc): ProjectState =>
  readProjectState(Y.encodeStateAsUpdate(doc));

/** The project log a client's project doc holds. */
export const projectLogOf = (doc: Y.Doc): ProjectLogEntry[] =>
  doc.getArray<ProjectLogEntry>("log").toArray();

/** The canonical text and SHA-256 an asset doc reads as, through the engine. */
export const assetSnapshotOf = (doc: Y.Doc) => assetSnapshot(Y.encodeStateAsUpdate(doc));

/** A hosted project row, as the web app creates one, with the registry's first state. */
export async function seedProjectRow(
  db: ServiceDb,
  projectId: string,
  state: Uint8Array | null = null,
  name = projectId,
): Promise<void> {
  await db
    .insert(engineProjects)
    .values({ projectId, name, ...(state ? { state: Buffer.from(state) } : {}) })
    .onConflictDoNothing();
}

/** An asset doc row, as the web app or the project kind creates one. */
export async function seedAssetRow(
  db: ServiceDb,
  projectId: string,
  key: string,
  kind: string,
  seed: string | null = null,
): Promise<void> {
  await db
    .insert(engineAssetDocs)
    .values({ projectId, assetKey: key, kind, seed })
    .onConflictDoNothing();
}

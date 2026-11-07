import { it } from "bun:test";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { eq, sql } from "drizzle-orm";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";

import { canvasDocs, canvases, sceneDocs, user } from "../../../src/db/schema.ts";
import { SCENE_FORMAT_VERSION } from "../../../src/engine/scene/types.ts";
import { documentName, SYNC_CLOSE, syncCloseCode } from "../../../src/lib/canvas/sync-channels.ts";
import { signCanvasToken, type SyncAccess } from "../../../src/lib/canvas/token.ts";
import { sceneSnapshot } from "../../../src/lib/scene/doc-bytes.ts";
import { createDb, type ServiceDb } from "../src/db.ts";

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

export function sceneToken(
  sceneId: string,
  userId: string,
  options: { access?: SyncAccess; format?: number } = {},
): Promise<string> {
  return signCanvasToken(
    {
      c: documentName("scene", sceneId),
      u: userId,
      a: options.access ?? "write",
      k: "scene",
      f: options.format ?? SCENE_FORMAT_VERSION,
    },
    SECRET,
  );
}

export interface SceneClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  entities: Y.Map<Y.Map<unknown>>;
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

export function connectScene(
  port: number,
  sceneId: string,
  userId: string,
  options: {
    access?: SyncAccess;
    format?: number;
    token?: () => Promise<string>;
    /** Reconnect an existing client's doc, as a provider does after a deploy. */
    doc?: Y.Doc;
  } = {},
): SceneClient {
  const doc = options.doc ?? new Y.Doc();
  const closes: (number | null)[] = [];
  const authFailures: string[] = [];
  const notices: string[] = [];
  let scope: string | null = null;
  let authentications = 0;
  let stopped: number | null = null;
  const provider: HocuspocusProvider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name: documentName("scene", sceneId),
    document: doc,
    token: options.token ?? (() => sceneToken(sceneId, userId, options)),
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
    entities: doc.getMap("entities"),
    closes,
    authFailures,
    notices,
    scope: () => scope,
    authentications: () => authentications,
    stopped: () => stopped,
    destroy: () => provider.destroy(),
  };
}

export const sceneSynced = (client: SceneClient, ms = 5000) =>
  until(() => client.provider.isSynced, ms);

/** A bulk `solid` box, laid out as the engine writes one. */
export function addSolid(doc: Y.Doc, key: string, x = 0, z = "a0"): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set("z", z);
    map.set("bulk", "solid");
    map.set("type", "solid");
    map.set("shape", ["box", x, 0, 16, 16]);
    doc.getMap<Y.Map<unknown>>("entities").set(key, map);
  });
}

/** A named entity, laid out as the engine writes one. */
export function addNamed(doc: Y.Doc, key: string, id: string, x = 0, z = "a0"): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set("z", z);
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

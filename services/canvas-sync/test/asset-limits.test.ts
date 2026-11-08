import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";

import * as Y from "yjs";

import {
  createKindRegistry,
  dataTableKind,
  defineAssetKind,
  ENGINE_ASSET_KINDS,
  formatAssetDoc,
  materialKind,
} from "../../../src/engine/project/index.ts";
import { SYNC_CLOSE } from "../../../src/lib/canvas/sync-channels.ts";
import { ASSET_DOC_LIMITS } from "../../../src/lib/scene/limits.ts";
import { MemoryAssetDocStore } from "../src/engine/doc-store.ts";
import { startServer, type ServerOptions, type SyncServer } from "../src/index.ts";
import {
  assetSnapshotOf,
  connectAsset,
  type EngineClient,
  newProjectId,
  sceneSynced as synced,
  SECRET,
  sleep,
  until,
} from "./harness.ts";

setDefaultTimeout(30_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };

const TINY = { maxStateBytes: 16_000, maxItems: 5 };
/** The data table's layout and schema under small caps; its seeds are laid out as written. */
const tinyKind = defineAssetKind({
  ...dataTableKind,
  kind: "tiny-table",
  title: "Tiny table",
  description: "A table with small caps, for tests.",
  match: { jsonKind: "tiny-table" },
  schemaId: "urn:jams-engine:tiny-table:v1",
  limits: TINY,
});
const KINDS = createKindRegistry(null, [...ENGINE_ASSET_KINDS, tinyKind]);
const TINY_SEED = JSON.stringify({ kind: "tiny-table", v: 1, rows: [] });
const MATERIAL = formatAssetDoc(materialKind, { kind: "material", v: 1, description: "Rubber." });

/** A row as the keyed layout holds one: `z` and the item's own map. */
function addRow(doc: Y.Doc, key: string, note: string): void {
  doc.transact(() => {
    const rows = doc.getMap("content").get("rows") as Y.Map<Y.Map<unknown>>;
    const entry = new Y.Map<unknown>();
    const item = new Y.Map<unknown>();
    item.set("id", key);
    item.set("note", note);
    entry.set("z", `a${key}`);
    entry.set("item", item);
    rows.set(key, entry);
  });
}

describe("asset doc limits", () => {
  const store = new MemoryAssetDocStore();
  const servers: SyncServer[] = [];
  const clients: EngineClient[] = [];
  const instance = async (id: string, extra: Partial<ServerOptions> = {}) => {
    const server = await startServer({
      port: 0,
      secret: SECRET,
      assetStore: store,
      engineKinds: KINDS,
      instanceId: id,
      telemetry: quiet,
      debounceMs: 100,
      maxDebounceMs: 500,
      ...extra,
    });
    servers.push(server);
    return server;
  };
  const open = (port: number, docId: string, user = "alice") => {
    const client = connectAsset(port, docId, user);
    clients.push(client);
    return client;
  };
  const newDoc = (kind: string, seed: string | null = null) => {
    const docId = `${newProjectId()}.doc`;
    store.create(docId, kind, seed);
    return docId;
  };
  const storedBytes = (docId: string) => store.rows.get(docId)?.state?.byteLength ?? 0;
  /** Gave up on 4413 and never came back. */
  const stayedAway = async (client: EngineClient) => {
    const authenticated = client.authentications();
    await sleep(1000);
    return client.stopped() === SYNC_CLOSE.tooLarge && client.authentications() === authenticated;
  };

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await Promise.all(servers.map((server) => server.stop(3000)));
  });

  it("refuses a store over the kind's item cap and closes everyone with 4413", async () => {
    const server = await instance("asset-items");
    const docId = newDoc("tiny-table", TINY_SEED);
    const a = open(server.port, docId);
    const b = open(server.port, docId, "bob");
    expect(await synced(a)).toBe(true);
    expect(await synced(b)).toBe(true);
    for (let i = 0; i < TINY.maxItems; i++) addRow(a.doc, `r${i}`, "ok");
    expect(await until(() => b.doc.getMap("content").size > 0 && rowsIn(b.doc) === 5)).toBe(true);
    await sleep(300);
    const stored = storedBytes(docId);
    addRow(a.doc, "r9", "over");
    expect(await stayedAway(a)).toBe(true);
    expect(await stayedAway(b)).toBe(true);
    expect(storedBytes(docId)).toBe(stored);
  });

  it("refuses a store over the kind's state cap", async () => {
    const server = await instance("asset-bytes");
    const docId = newDoc("tiny-table", TINY_SEED);
    const a = open(server.port, docId);
    expect(await synced(a)).toBe(true);
    // Each message stays under the cap; together they pass it.
    for (let i = 0; i < 4; i++) {
      addRow(a.doc, `r${i}`, "x".repeat(5_000));
      await sleep(20);
    }
    expect(await stayedAway(a)).toBe(true);
    expect(storedBytes(docId)).toBeLessThanOrEqual(TINY.maxStateBytes);
  });

  it("caps a message at the kind's state cap when that is below the default message cap", async () => {
    const server = await instance("asset-message-small");
    const docId = newDoc("tiny-table", TINY_SEED);
    const a = open(server.port, docId);
    expect(await synced(a)).toBe(true);
    await sleep(200);
    addRow(a.doc, "big", "x".repeat(TINY.maxStateBytes + 1_000));
    expect(await stayedAway(a)).toBe(true);
  });

  it("gives a kind without limits the default caps", async () => {
    const server = await instance("asset-defaults");
    const docId = newDoc("material", MATERIAL);
    const a = open(server.port, docId);
    expect(await synced(a)).toBe(true);
    await sleep(200);
    a.doc
      .getMap("content")
      .set("description", "x".repeat(ASSET_DOC_LIMITS.maxMessageBytes - 10_000));
    await sleep(500);
    expect(a.stopped()).toBeNull();
    a.doc
      .getMap("content")
      .set("description", "y".repeat(ASSET_DOC_LIMITS.maxMessageBytes + 1_000));
    expect(await stayedAway(a)).toBe(true);
  });

  it("snapshots the engine's kinds, and leaves a game's to its clients", async () => {
    const server = await instance("asset-snapshots", { snapshotIntervalMs: 0 });
    const material = newDoc("material", MATERIAL);
    const game = newDoc("platformer/deck");
    const m = open(server.port, material);
    const g = open(server.port, game);
    expect(await synced(m)).toBe(true);
    expect(await synced(g)).toBe(true);
    expect(store.rows.get(material)!.snapshot).toBe(MATERIAL);

    m.doc.getMap("content").set("description", "Bouncier rubber.");
    g.doc.getMap("content").set("title", "Red deck");
    const expected = await assetSnapshotOf(m.doc);
    expect(expected!.text).toContain("Bouncier rubber.");
    expect(
      await until(() => store.rows.get(material)!.contentSha256 === expected!.sha256, 5000),
    ).toBe(true);
    expect(store.rows.get(material)!.snapshot).toBe(expected!.text);
    expect(await until(() => (store.rows.get(game)!.state?.byteLength ?? 0) > 0)).toBe(true);
    await sleep(300);
    expect(store.rows.get(game)!.snapshot).toBeNull();
    expect(store.rows.get(game)!.contentSha256).toBeNull();
  });
});

function rowsIn(doc: Y.Doc): number {
  return (doc.getMap("content").get("rows") as Y.Map<unknown> | undefined)?.size ?? 0;
}

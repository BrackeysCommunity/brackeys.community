import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import { createRegistry } from "../../game/define";
import { stableJson } from "../../project/canonical";
import { memoryContentStore, type ContentStore } from "../../project/content-store";
import { sha256 } from "../../project/hash";
import { inspectEntry } from "../../project/inspect/entry";
import {
  createKindRegistry,
  defineAssetKind,
  type BlobKindDef,
  type KindRegistry,
} from "../../project/kinds";
import { ENGINE_ASSET_KINDS } from "../../project/kinds/index";
import type { ProjectApplyResult } from "../../project/ops";
import type { AssetEntry, AssetKey, ProjectState } from "../../project/types";
import { applyProjectBatch, reinspectBlobs } from "../project-apply";
import { readProject, seedProjectDoc } from "../project-doc";
import { readProjectLog } from "../project-log";
import { createProjectSession, memoryDocHost, type ProjectSession } from "../project-session";
import type { DocOrigin } from "../types";

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../project/__tests__/fixtures/${name}`, import.meta.url)),
  );

/** A kind whose meta depends on two settings at once, so two concurrent edits each leave stale meta. */
const strip = defineAssetKind({
  storage: "blob",
  kind: "strip",
  title: "Strip",
  description: "Bytes measured in frames.",
  match: { suffixes: [".strip"] },
  contentTypes: ["application/octet-stream"],
  maxBytes: 1 << 16,
  settings: z.strictObject({
    scale: z.number().int().positive().optional(),
    offset: z.number().int().optional(),
    explode: z.boolean().optional(),
  }),
  meta: z.strictObject({ frames: z.number() }),
  inspect: (bytes: Uint8Array, s: { scale?: number; offset?: number; explode?: boolean }) => {
    if (s.explode) throw new Error("boom");
    return { ok: true as const, meta: { frames: bytes.length * (s.scale ?? 1) + (s.offset ?? 0) } };
  },
});

const kinds = createKindRegistry(null, [...ENGINE_ASSET_KINDS, strip]);
const registry = createRegistry();
const users: DocOrigin[] = [
  { kind: "user", userId: "ada" },
  { kind: "user", userId: "bo" },
];

const HERO = fixture("hero.png");
const SHEET = fixture("hero.json");
const STRIP = new Uint8Array([1, 2, 3, 4]);

async function entryOf(
  store: ContentStore,
  key: string,
  kind: string,
  path: string,
  bytes: Uint8Array,
  idAt: (path: string) => string | undefined = () => undefined,
): Promise<AssetEntry> {
  const e: AssetEntry = {
    key,
    id: key,
    kind,
    path,
    sha256: await store.put(bytes),
    bytes: bytes.byteLength,
    created: { at: 0, by: "seed" },
  };
  const result = inspectEntry(kinds.get(kind) as BlobKindDef, e, bytes, idAt);
  if (!result.ok) throw new Error(result.issue.message);
  e.meta = result.meta as Record<string, unknown>;
  if (result.import) e.import = result.import;
  return e;
}

async function world(store: ContentStore) {
  const host = memoryDocHost();
  const state: ProjectState = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: {
      hero: await entryOf(store, "hero", "texture", "art/hero.png", HERO),
      "hero-atlas": await entryOf(store, "hero-atlas", "atlas", "art/hero.atlas.json", SHEET, (p) =>
        p === "art/hero.png" ? "hero" : undefined,
      ),
      reel: await entryOf(store, "reel", "strip", "art/reel.strip", STRIP),
    },
    history: {},
    code: {},
    build: {},
  };
  seedProjectDoc(host.doc("project:p"), state, { kind: "migration" });
  return host;
}

type Client = { session: ProjectSession; setOnline(online: boolean): void };

async function join(
  host: ReturnType<typeof memoryDocHost>,
  origin: DocOrigin,
  store: ContentStore,
  kindsOf: KindRegistry = kinds,
): Promise<Client> {
  const client = host.client();
  const session = await createProjectSession({
    project: "p",
    origin,
    registry,
    kinds: kindsOf,
    store,
    openDoc: client.openDoc,
  });
  return { session, setOnline: (online) => client.setOnline(online) };
}

const setImport = (c: Client, id: string, set: Record<string, unknown>) =>
  applyProjectBatch(c.session, { v: 1, ops: [{ op: "setImport", id, set }] }, c.session.origin);

function ok(r: ProjectApplyResult): Extract<ProjectApplyResult, { ok: true }> {
  if (!r.ok) throw new Error(`${r.issue.code} at ${r.opIndex}: ${r.issue.message}`);
  return r;
}

/** Edits made by two clients while apart, then a reconnect. */
async function apart(
  host: ReturnType<typeof memoryDocHost>,
  store: ContentStore,
  edits: [(c: Client) => Promise<unknown>, (c: Client) => Promise<unknown>],
) {
  const clients = await Promise.all(users.map((u) => join(host, u, store)));
  for (const c of clients) c.setOnline(false);
  for (const [i, edit] of edits.entries()) await edit(clients[i]!);
  for (const c of clients) c.setOnline(true);
  const state = readProject(host.doc("project:p"));
  for (const c of clients)
    expect(stableJson(readProject(c.session.projectDoc))).toBe(stableJson(state));
  return { clients, state };
}

const metaDigest = async (e: AssetEntry | undefined) => sha256(stableJson(e?.meta ?? null));

describe("import settings: concurrent edits", () => {
  it("merge per field: two clients setting different fields both keep their value", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const { clients, state } = await apart(host, store, [
      async (c) => ok(await setImport(c, "hero", { filter: "linear" })),
      async (c) => ok(await setImport(c, "hero", { pivot: [0.5, 1], nineSlice: [1, 1, 1, 1] })),
    ]);
    expect(state.assets.hero!.import).toEqual({
      filter: "linear",
      pivot: [0.5, 1],
      nineSlice: [1, 1, 1, 1],
    });
    expect(state.assets.hero!.meta).toEqual({ format: "png", width: 32, height: 8 });
    for (const c of clients) c.session.destroy();
  });

  it("a reset (null) on one field merges with a set on another", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const seeded = await join(host, users[0]!, store);
    ok(await setImport(seeded, "hero", { filter: "linear", pivot: [0, 0] }));
    seeded.session.destroy();
    const { clients, state } = await apart(host, store, [
      async (c) => ok(await setImport(c, "hero", { filter: null })),
      async (c) => ok(await setImport(c, "hero", { pivot: [1, 1] })),
    ]);
    expect(state.assets.hero!.import).toEqual({ pivot: [1, 1] });
    for (const c of clients) c.session.destroy();
  });

  it("one field set by both ends on one writer's value on every replica", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const { clients, state } = await apart(host, store, [
      async (c) => ok(await setImport(c, "reel", { scale: 2 })),
      async (c) => ok(await setImport(c, "reel", { scale: 3 })),
    ]);
    const scale = state.assets.reel!.import!.scale as number;
    expect([2, 3]).toContain(scale);
    expect(state.assets.reel!.meta).toEqual({ frames: STRIP.length * scale });
    for (const c of clients) c.session.destroy();
  });

  it("an atlas's settings merge per field, and its meta follows its pivot", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const before = readProject(host.doc("project:p")).assets["hero-atlas"]!;
    expect(before.import).toEqual({ texture: "hero" });
    const { clients, state } = await apart(host, store, [
      async (c) => ok(await setImport(c, "hero-atlas", { pivotDefault: [0, 1] })),
      async (c) => ok(await setImport(c, "hero", { filter: "linear" })),
    ]);
    const atlas = state.assets["hero-atlas"]!;
    expect(atlas.import).toEqual({ texture: "hero", pivotDefault: [0, 1] });
    const frames = Object.values((atlas.meta as { frames: Record<string, unknown> }).frames);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(frame).toHaveProperty("pivot");
    for (const c of clients) c.session.destroy();
  });
});

describe("import settings: re-inspection", () => {
  it("is deterministic: the same bytes and settings give the same meta on every client", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const digests: string[] = [];
    for (const origin of users) {
      const fresh = memoryDocHost();
      seedProjectDoc(fresh.doc("project:p"), readProject(host.doc("project:p")), {
        kind: "migration",
      });
      const c = await join(fresh, origin, store);
      ok(await setImport(c, "hero-atlas", { pivotDefault: [0.25, 0.75] }));
      ok(await setImport(c, "reel", { scale: 4, offset: -1 }));
      const s = readProject(fresh.doc("project:p"));
      digests.push(
        `${await metaDigest(s.assets["hero-atlas"])}|${await metaDigest(s.assets.reel)}`,
      );
      c.session.destroy();
    }
    expect(digests[1]).toBe(digests[0]);
  });

  it("the one writer re-derives meta two concurrent edits each left stale, and concurrent writers agree", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const { clients, state } = await apart(host, store, [
      async (c) => ok(await setImport(c, "reel", { scale: 2 })),
      async (c) => ok(await setImport(c, "reel", { offset: 5 })),
    ]);
    expect(state.assets.reel!.import).toEqual({ scale: 2, offset: 5 });
    const want = { frames: STRIP.length * 2 + 5 };
    expect(state.assets.reel!.meta).not.toEqual(want);

    // Two writers re-inspect at once (a restarted dev server racing the hosted one): same values.
    const [a, b] = clients.map((c) => c.session.projectDoc);
    clients[0]!.setOnline(false);
    clients[1]!.setOnline(false);
    const ra = await reinspectBlobs(a!, { kinds, store, now: 7 });
    const rb = await reinspectBlobs(b!, { kinds, store, now: 7 });
    expect([ra.reinspected, rb.reinspected]).toEqual([["reel"], ["reel"]]);
    expect(readProjectLog(a!).at(-1)).toMatchObject({
      actor: { kind: "repair", reason: "reinspect" },
      label: "Re-inspect reel",
    });
    for (const c of clients) c.setOnline(true);
    const end = readProject(host.doc("project:p"));
    expect(end.assets.reel!.meta).toEqual(want);
    for (const c of clients)
      expect(stableJson(readProject(c.session.projectDoc))).toBe(stableJson(end));

    expect((await reinspectBlobs(host.doc("project:p"), { kinds, store })).wrote).toBe(false);
    for (const c of clients) c.session.destroy();
  });

  it("skips entries unchanged since the last call, bytes the store lacks and the trash", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const doc = host.doc("project:p");
    const reads: string[] = [];
    const counting: ContentStore = {
      ...store,
      get: async (hash) => {
        reads.push(hash);
        return store.get(hash);
      },
    };
    const checked = new Map<AssetKey, string>();
    expect((await reinspectBlobs(doc, { kinds, store: counting, checked })).wrote).toBe(false);
    expect(reads).toHaveLength(3);
    expect((await reinspectBlobs(doc, { kinds, store: counting, checked })).wrote).toBe(false);
    expect(reads).toHaveLength(3);

    const c = await join(host, users[0]!, store);
    ok(await setImport(c, "reel", { scale: 3 }));
    ok(
      await applyProjectBatch(
        c.session,
        { v: 1, ops: [{ op: "deleteAsset", id: "hero", force: true }] },
        c.session.origin,
      ),
    );
    await reinspectBlobs(doc, { kinds, store: counting, checked });
    expect(reads).toHaveLength(4);

    const empty = memoryContentStore();
    const bare = memoryDocHost();
    seedProjectDoc(bare.doc("project:p"), readProject(doc), { kind: "migration" });
    expect(await reinspectBlobs(bare.doc("project:p"), { kinds, store: empty })).toEqual({
      wrote: false,
      reinspected: [],
    });
    c.session.destroy();
  });

  it("writes nothing for an entry that changed while its bytes were read", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const doc = host.doc("project:p");
    const reel = doc.getMap("assets").get("reel") as Y.Map<unknown>;
    reel.set("meta", { frames: 0 });
    const racing: ContentStore = {
      ...store,
      get: async (hash) => {
        const bytes = await store.get(hash);
        (reel.get("import") as Y.Map<unknown>).set("scale", 9);
        return bytes;
      },
    };
    const r = await reinspectBlobs(doc, { kinds, store: racing });
    expect(r.reinspected).not.toContain("reel");
    expect(readProject(doc).assets.reel!.meta).toEqual({ frames: 0 });
    expect((await reinspectBlobs(doc, { kinds, store })).reinspected).toEqual(["reel"]);
    expect(readProject(doc).assets.reel!.meta).toEqual({ frames: STRIP.length * 9 });
  });

  it("re-derives meta that names paths after a move, even for an entry it checked", async () => {
    const store = memoryContentStore();
    const host = memoryDocHost();
    const page = await entryOf(
      store,
      "font-0",
      "texture",
      "fonts/font_0.png",
      fixture("font_0.png"),
    );
    const font = await entryOf(store, "font", "font", "fonts/font.fnt", fixture("font.fnt"), (p) =>
      p === page.path ? page.id : undefined,
    );
    expect([font.meta, font.import]).toMatchObject([
      { pages: ["fonts/font_0.png"] },
      { pages: ["font-0"] },
    ]);
    seedProjectDoc(
      host.doc("project:p"),
      {
        meta: { projectId: "p", layout: 1, name: "P" },
        assets: { font, "font-0": page },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    const doc = host.doc("project:p");
    const checked = new Map<AssetKey, string>();
    expect((await reinspectBlobs(doc, { kinds, store, checked })).wrote).toBe(false);

    const c = await join(host, users[0]!, store);
    ok(
      await applyProjectBatch(
        c.session,
        { v: 1, ops: [{ op: "moveAsset", ids: ["font", "font-0"], to: "type/" }] },
        c.session.origin,
      ),
    );
    expect((await reinspectBlobs(doc, { kinds, store, checked })).reinspected).toEqual(["font"]);
    expect(readProject(doc).assets.font!.meta).toMatchObject({ pages: ["type/font_0.png"] });
    expect((await reinspectBlobs(doc, { kinds, store, checked })).wrote).toBe(false);
    c.session.destroy();
  });
});

describe("import settings: refusals", () => {
  it("settings the kind refuses are op-invalid; an inspector that throws is import-failed", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const c = await join(host, users[0]!, store);
    const before = stableJson(readProject(host.doc("project:p")));
    const bad = await setImport(c, "hero", { filter: "blurry" });
    expect(bad.ok || bad.issue.code).toBe("op-invalid");
    const thrown = await setImport(c, "reel", { explode: true });
    expect(thrown.ok || [thrown.issue.code, thrown.issue.entityIds]).toEqual([
      "import-failed",
      ["reel"],
    ]);
    expect(stableJson(readProject(host.doc("project:p")))).toBe(before);
    c.session.destroy();
  });

  it("a setImport whose bytes the store doesn't hold is hash-mismatch", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const c = await join(host, users[0]!, memoryContentStore());
    const r = await setImport(c, "hero", { filter: "linear" });
    expect(r.ok || r.issue.code).toBe("hash-mismatch");
    c.session.destroy();
  });
});

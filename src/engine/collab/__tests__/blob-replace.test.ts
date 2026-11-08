import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../../game/define";
import { stableJson } from "../../project/canonical";
import { memoryContentStore, type ContentStore } from "../../project/content-store";
import { sha256 } from "../../project/hash";
import { inspectEntry } from "../../project/inspect/entry";
import { createKindRegistry, type BlobKindDef } from "../../project/kinds";
import type { ProjectApplyResult, ProjectOpBatch } from "../../project/ops";
import type { AssetEntry, ProjectState } from "../../project/types";
import { rng } from "../../scene/__tests__/fixtures/random-ops";
import { applyProjectBatch } from "../project-apply";
import { readProject, seedProjectDoc } from "../project-doc";
import { createProjectSession, memoryDocHost, type ProjectSession } from "../project-session";
import type { DocOrigin } from "../types";

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../project/__tests__/fixtures/${name}`, import.meta.url)),
  );

const kinds = createKindRegistry(null);
const registry = createRegistry();
const texture = kinds.get("texture") as BlobKindDef;

const PNG = fixture("texture.png");
/** The same 12×10 header with different bytes: a re-export whose meta doesn't change. */
const PNG_RESAVED = new Uint8Array([...PNG, 0]);
const HERO = fixture("hero.png");
const JPEG = fixture("texture.jpg");
const GIF = fixture("texture.gif");
const RUN = fixture("run.recording.json");

const users: DocOrigin[] = ["ada", "bo", "cy"].map((userId) => ({ kind: "user", userId }));

async function world(store: ContentStore) {
  const host = memoryDocHost();
  const at = { at: 0, by: "seed" };
  const entry = async (key: string, kind: string, path: string, bytes: Uint8Array) => {
    const e: AssetEntry = {
      key,
      id: key,
      kind,
      path,
      sha256: await store.put(bytes),
      bytes: bytes.byteLength,
      created: at,
    };
    const result = inspectEntry(kinds.get(kind) as BlobKindDef, e, bytes, () => undefined);
    if (result.ok) e.meta = result.meta as Record<string, unknown>;
    return e;
  };
  const state: ProjectState = {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: {
      crate: await entry("crate", "texture", "art/crate.png", PNG),
      run: await entry("run", "recording", "runs/run.recording.json", RUN),
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
  clientID?: number,
): Promise<Client> {
  const client = host.client();
  const session = await createProjectSession({
    project: "p",
    origin,
    registry,
    kinds,
    store,
    openDoc: async (name) => {
      const opened = await client.openDoc(name);
      if (clientID !== undefined) opened.doc.clientID = clientID;
      return opened;
    },
  });
  return { session, setOnline: (online) => client.setOnline(online) };
}

const replace = async (s: ProjectSession, id: string, bytes: Uint8Array) =>
  applyProjectBatch(
    s,
    { v: 1, ops: [{ op: "replaceContent", id, sha256: await sha256(bytes), bytes: bytes.length }] },
    s.origin,
  );

function ok(r: ProjectApplyResult): Extract<ProjectApplyResult, { ok: true }> {
  if (!r.ok) throw new Error(`${r.issue.code} at ${r.opIndex}: ${r.issue.message}`);
  return r;
}

/** The entry's hash, size and meta all describe the bytes the store holds for that hash. */
async function consistent(store: ContentStore, entry: AssetEntry): Promise<void> {
  const bytes = await store.get(entry.sha256!);
  expect(bytes, "the store keeps the bytes the entry names").not.toBeNull();
  expect(entry.bytes).toBe(bytes!.byteLength);
  const result = inspectEntry(texture, entry, bytes!, () => undefined);
  expect(result.ok && result.meta).toEqual(entry.meta);
}

describe("binary replace races", () => {
  for (const [winner, ids] of [
    ["the client with the higher id", [1, 2]],
    ["the client with the lower id", [2, 1]],
  ] as const)
    it(`two concurrent replaces end on one hash, whose size and meta come with it (${winner} first)`, async () => {
      const store = memoryContentStore();
      const host = await world(store);
      const a = await join(host, users[0]!, store, ids[0]);
      const b = await join(host, users[1]!, store, ids[1]);
      await store.put(PNG_RESAVED);
      await store.put(HERO);

      a.setOnline(false);
      b.setOnline(false);
      ok(await replace(a.session, "crate", PNG_RESAVED));
      ok(await replace(b.session, "crate", HERO));
      a.setOnline(true);
      b.setOnline(true);

      const end = readProject(host.doc("project:p"));
      expect(stableJson(readProject(a.session.projectDoc))).toBe(stableJson(end));
      expect(stableJson(readProject(b.session.projectDoc))).toBe(stableJson(end));
      const crate = end.assets.crate!;
      expect([await sha256(PNG_RESAVED), await sha256(HERO)]).toContain(crate.sha256);
      await consistent(store, crate);
      expect(new Set(end.history.crate!.map((h) => h.sha256))).toEqual(
        new Set([await sha256(PNG), await sha256(PNG_RESAVED), await sha256(HERO)]),
      );
      for (const h of end.history.crate!) expect(await store.has(h.sha256)).toBe(true);
      a.session.destroy();
      b.session.destroy();
    });

  it("random replaces across partitions converge on one consistent hash, keeping every blob", async () => {
    const pool = [PNG, PNG_RESAVED, HERO, JPEG, GIF];
    for (let seed = 1; seed <= 6; seed++) {
      const rand = rng(seed);
      const store = memoryContentStore();
      for (const bytes of pool) await store.put(bytes);
      const host = await world(store);
      const clients = await Promise.all(users.map((u, i) => join(host, u, store, 10 + i)));
      const offered = new Set([await sha256(PNG)]);
      for (let round = 0; round < 12; round++) {
        const c = clients[Math.floor(rand() * clients.length)]!;
        if (rand() < 0.3) c.setOnline(rand() < 0.5);
        const bytes = pool[Math.floor(rand() * pool.length)]!;
        const r = await replace(c.session, "crate", bytes);
        expect(r.ok, `seed ${seed} round ${round}`).toBe(true);
        offered.add(await sha256(bytes));
      }
      for (const c of clients) c.setOnline(true);

      const end = readProject(host.doc("project:p"));
      for (const c of clients)
        expect(stableJson(readProject(c.session.projectDoc)), `seed ${seed}`).toBe(stableJson(end));
      const crate = end.assets.crate!;
      expect(offered.has(crate.sha256!)).toBe(true);
      await consistent(store, crate);
      const held = new Set(end.history.crate!.map((h) => h.sha256));
      for (const hash of held) expect(await store.has(hash)).toBe(true);
      if (held.size === 0) expect(crate.sha256).toBe(await sha256(PNG));
      else
        expect(held.has(crate.sha256!), `seed ${seed}: the current hash is in the history`).toBe(
          true,
        );
      for (const c of clients) c.session.destroy();
    }
  });
});

describe("blob ops need their bytes in the store", () => {
  it("a replace or an import naming bytes the store lacks is hash-mismatch and writes nothing", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const { session } = await join(host, users[0]!, store);
    const before = stableJson(readProject(host.doc("project:p")));
    const absent = await replace(session, "crate", HERO);
    expect(absent.ok || absent.issue.code).toBe("hash-mismatch");
    const imported = await applyProjectBatch(
      session,
      {
        v: 1,
        ops: [
          {
            op: "importAsset",
            path: "art/hero.png",
            sha256: await sha256(HERO),
            bytes: HERO.length,
          },
        ],
      },
      session.origin,
    );
    expect(imported.ok || [imported.issue.code, imported.opIndex]).toEqual(["hash-mismatch", 0]);
    expect(stableJson(readProject(host.doc("project:p")))).toBe(before);

    await store.put(HERO);
    ok(await replace(session, "crate", HERO));
    expect(readProject(host.doc("project:p")).assets.crate).toMatchObject({
      sha256: await sha256(HERO),
      bytes: HERO.length,
      meta: { format: "png", width: 32, height: 8 },
    });
    session.destroy();
  });

  it("bytes the kind can't read are import-failed and write nothing", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const { session } = await join(host, users[0]!, store);
    const junk = new TextEncoder().encode("not a png at all");
    await store.put(junk);
    const before = stableJson(readProject(host.doc("project:p")));
    const r = await replace(session, "crate", junk);
    expect(r.ok || r.issue.code).toBe("import-failed");
    const batch: ProjectOpBatch = {
      v: 1,
      ops: [{ op: "importAsset", path: "art/junk.png", sha256: await sha256(junk), bytes: 16 }],
    };
    const imported = await applyProjectBatch(session, batch, session.origin);
    expect(imported.ok || imported.issue.code).toBe("import-failed");
    expect(stableJson(readProject(host.doc("project:p")))).toBe(before);
    session.destroy();
  });

  it("a recording's content is never replaced (asset-kind), even with its bytes in the store", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const { session } = await join(host, users[0]!, store);
    const value = JSON.parse(new TextDecoder().decode(RUN)) as { ticks: number };
    const again = new TextEncoder().encode(`${JSON.stringify({ ...value, ticks: value.ticks })}\n`);
    await store.put(again);
    const before = stableJson(readProject(host.doc("project:p")));
    const r = await replace(session, "run", again);
    expect(r.ok || [r.issue.code, r.issue.entityIds]).toEqual(["asset-kind", ["run"]]);
    expect(stableJson(readProject(host.doc("project:p")))).toBe(before);
    session.destroy();
  });

  it("a replace is one undo step that puts back the old hash, size and meta", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const { session } = await join(host, users[0]!, store);
    await store.put(HERO);
    const before = readProject(host.doc("project:p")).assets.crate!;
    ok(await replace(session, "crate", HERO));
    expect(session.undo()?.label).toBe("replaceContent");
    const after = readProject(host.doc("project:p"));
    expect(after.assets.crate).toEqual(before);
    session.destroy();
  });
});

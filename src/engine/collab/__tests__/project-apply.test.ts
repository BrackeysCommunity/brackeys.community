import { describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import { createRegistry } from "../../game/define";
import { memoryContentStore } from "../../project/content-store";
import { sha256 } from "../../project/hash";
import { createKindRegistry, defineAssetKind, type DocLayout } from "../../project/kinds";
import { prefabKind } from "../../project/kinds/prefab";
import { sceneKind } from "../../project/kinds/scene";
import type { EditSceneOp, ProjectApplyResult, ProjectOp, ProjectOpBatch } from "../../project/ops";
import type { AssetEntry, ProjectState } from "../../project/types";
import { engine, engineYard } from "../../scene/__tests__/fixtures/random-ops";
import { makeIssue } from "../../scene/issues";
import type { Prefab, SceneDefinition } from "../../scene/types";
import * as apply from "../apply";
import { docToScene, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { layoutFromDoc, layoutToDoc } from "../layout";
import { readLog } from "../log";
import { prefabToDoc } from "../prefab-doc";
import { sessionPrefabSource } from "../prefab-source";
import { applyProjectBatch } from "../project-apply";
import { readProject, seedProjectDoc } from "../project-doc";
import { readProjectLog } from "../project-log";
import {
  createProjectSession,
  memoryDocHost,
  type PrefabWriter,
  type ProjectSession,
} from "../project-session";
import { ada, bo } from "./helpers";

/** Set to make the doc refuse every scene batch, as if the doc and its plain JSON disagreed. */
const sceneRefusal = vi.hoisted(() => ({ on: false }));
vi.mock("../apply", async (original) => {
  const real = await original<typeof import("../apply")>();
  return {
    ...real,
    applyOpsToDoc: (...args: Parameters<typeof real.applyOpsToDoc>) =>
      sceneRefusal.on
        ? {
            ok: false,
            hash: "",
            failedAt: 0,
            issue: makeIssue("op-invalid", { message: "the doc refuses", path: "/ops/0" }),
          }
        : real.applyOpsToDoc(...args),
  };
});

const cardLayout: DocLayout = {
  as: "map",
  fields: { rows: { as: "keyed", item: { as: "map", rest: { as: "atomic" } } } },
  rest: { as: "atomic" },
};
const card = defineAssetKind({
  storage: "doc",
  kind: "card",
  title: "Card",
  description: "A card.",
  match: { suffixes: [".card.json"] },
  version: 1,
  schemaId: "urn:jams-engine:card:v1",
  schema: () =>
    z.strictObject({
      v: z.literal(1),
      title: z.string().optional(),
      cost: z.number().int().min(0).optional(),
      shape: z.looseObject({}).optional(),
      rows: z.array(z.strictObject({ id: z.string(), n: z.number() })).optional(),
    }),
  layout: cardLayout,
  empty: () => ({ v: 1 }),
});
const sprite = defineAssetKind({
  storage: "blob",
  kind: "sprite",
  title: "Sprite",
  description: "Bytes.",
  match: { suffixes: [".spr"] },
  contentTypes: ["application/octet-stream"],
  maxBytes: 1000,
  settings: z.strictObject({ scale: z.number().optional() }),
  meta: z.looseObject({}),
  inspect: (bytes: Uint8Array, settings: { scale?: number }) => ({
    ok: true as const,
    meta: { length: bytes.length * (settings.scale ?? 1) },
  }),
});
const kinds = createKindRegistry(null, [sceneKind, card, sprite]);

const at = { at: 0, by: "seed" };
const cardEntry = (key: string): AssetEntry => ({
  key,
  id: key,
  kind: "card",
  path: `cards/${key}.card.json`,
  created: at,
});
const STATE: ProjectState = {
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: {
    a: cardEntry("a"),
    b: cardEntry("b"),
    c: cardEntry("c"),
    yard: { key: "yard", id: "yard", kind: "scene", path: "yard.json", created: at },
  },
  history: {},
  code: {},
  build: {},
};

function world() {
  const host = memoryDocHost();
  seedProjectDoc(host.doc("project:p"), STATE, { kind: "migration" });
  for (const key of ["a", "b", "c"])
    layoutToDoc(host.doc(`asset:p.${key}`), cardLayout, {
      v: 1,
      title: key,
      cost: 1,
      shape: { w: 1 },
    });
  sceneToDoc(engineYard(), { doc: host.doc("scene:p.yard"), key: sequentialKeys("srv") });
  return host;
}

const join = (host: ReturnType<typeof world>, origin = ada, extra = {}) =>
  createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin,
    registry: engine,
    kinds,
    ...extra,
  });

const content = (doc: Y.Doc) => layoutFromDoc(doc, cardLayout);

function ok(r: ProjectApplyResult): Extract<ProjectApplyResult, { ok: true }> {
  if (!r.ok) throw new Error(`${r.issue.code} at ${r.opIndex}: ${r.issue.message}`);
  return r;
}

const titles = (...ids: string[]): ProjectOpBatch => ({
  v: 1,
  label: "Retitle",
  ops: ids.map((id) => ({ op: "editAsset", id, edits: [{ set: "/title", value: `${id}!` }] })),
});

describe("applyProjectBatch", () => {
  it("writes nothing anywhere when an op in the third doc fails", async () => {
    const host = world();
    const s = await join(host);
    for (const name of ["asset:p.a", "asset:p.b", "asset:p.c", "scene:p.yard"]) await s.open(name);
    const before = ["a", "b", "c", "yard"].map((k) =>
      Y.encodeStateVector(host.doc(k === "yard" ? "scene:p.yard" : `asset:p.${k}`)),
    );
    const projectBefore = Y.encodeStateVector(host.doc("project:p"));

    for (const bad of [
      { set: "/cost", value: -2 },
      { set: "/shape/w", value: 3 },
      { remove: "/rows/@nope" },
    ]) {
      const r = await applyProjectBatch(
        s,
        {
          v: 1,
          ops: [
            { op: "editAsset", id: "a", edits: [{ set: "/title", value: "A" }] },
            { op: "editScene", id: "yard", ops: [{ op: "move", refs: ["crate"], by: [5, 0] }] },
            { op: "editAsset", id: "c", edits: [bad] },
          ],
        },
        ada,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.opIndex).toBe(2);
    }
    const r = await applyProjectBatch(
      s,
      { v: 1, ops: [{ op: "editAsset", id: "c", edits: [{ set: "/shape/w", value: 3 }] }] },
      ada,
    );
    expect(r.ok || [r.issue.code, r.issue.path]).toEqual(["op-invalid", "/ops/0/edits/0/set"]);
    const schema = await applyProjectBatch(
      s,
      { v: 1, ops: [{ op: "editAsset", id: "c", edits: [{ set: "/cost", value: -2 }] }] },
      ada,
    );
    expect(schema.ok || schema.issue.code).toBe("schema");

    ["a", "b", "c", "yard"].forEach((k, i) =>
      expect(Y.encodeStateVector(host.doc(k === "yard" ? "scene:p.yard" : `asset:p.${k}`))).toEqual(
        before[i],
      ),
    );
    expect(Y.encodeStateVector(host.doc("project:p"))).toEqual(projectBefore);
    expect(s.canUndo()).toBe(false);
    s.destroy();
  });

  it("writes nothing anywhere when a scene doc refuses ops its plain JSON accepted", async () => {
    const host = world();
    const s = await join(host);
    for (const name of ["asset:p.a", "scene:p.yard"]) await s.open(name);
    const names = ["asset:p.a", "scene:p.yard", "project:p"];
    const before = names.map((n) => Y.encodeStateVector(host.doc(n)));
    const move: ProjectOp = {
      op: "editScene",
      id: "yard",
      ops: [{ op: "move", refs: ["crate"], by: [5, 0] }],
    };
    sceneRefusal.on = true;
    try {
      const both = await applyProjectBatch(
        s,
        {
          v: 1,
          ops: [{ op: "editAsset", id: "a", edits: [{ set: "/title", value: "A" }] }, move],
        },
        ada,
      );
      expect(both.ok || [both.opIndex, both.issue.message]).toEqual([1, "the doc refuses"]);
      const alone = await applyProjectBatch(s, { v: 1, ops: [move] }, ada);
      expect(alone.ok || alone.opIndex).toBe(0);
    } finally {
      sceneRefusal.on = false;
    }
    names.forEach((n, i) => expect(Y.encodeStateVector(host.doc(n)), n).toEqual(before[i]));
    expect(s.canUndo()).toBe(false);

    const spy = vi.spyOn(apply, "applyOpsToDoc");
    const r = ok(
      await applyProjectBatch(
        s,
        {
          v: 1,
          ops: [{ op: "editAsset", id: "a", edits: [{ set: "/title", value: "A" }] }, move],
        },
        ada,
      ),
    );
    expect(r.docs).toEqual(["asset:p.a", "scene:p.yard"]);
    expect(
      spy.mock.calls.map(([doc]) => doc === s.get("scene:p.yard")!.doc),
      "tried on a copy, then written",
    ).toEqual([false, true]);
    spy.mockRestore();
    s.destroy();
  });

  it("gives each doc one transaction with the batch's origin and its own log entry", async () => {
    const host = world();
    const s = await join(host);
    const docs = await Promise.all(["asset:p.a", "asset:p.b", "asset:p.c"].map((n) => s.open(n)));
    const seen = new Map<string, number>();
    for (const d of [...docs, { name: s.name, doc: s.projectDoc }])
      d.doc.on("afterTransaction", (tr: Y.Transaction) => {
        if (tr.origin === ada) seen.set(d.name, (seen.get(d.name) ?? 0) + 1);
      });

    const r = ok(await applyProjectBatch(s, titles("a", "b", "c"), ada));

    expect(r.docs).toEqual(["asset:p.a", "asset:p.b", "asset:p.c"]);
    expect(Object.fromEntries(seen)).toEqual({
      "asset:p.a": 1,
      "asset:p.b": 1,
      "asset:p.c": 1,
      "project:p": 1,
    });
    expect(r.entry).toMatchObject({ label: "Retitle", actor: ada });
    expect(r.entry!.docs).toEqual(
      docs.map((d) => ({ doc: d.name, entry: readLog(d.doc).at(-1)!.id })),
    );
    for (const d of docs) {
      const [entry] = readLog(d.doc);
      expect(entry).toMatchObject({ label: "Retitle", keys: ["@content:title"] });
    }
    expect(readProjectLog(host.doc("project:p")).at(-1)).toEqual(r.entry);
    expect(content(host.doc("asset:p.b"))).toMatchObject({ title: "b!", cost: 1 });
    s.destroy();
  });

  it("logs no project entry for a batch that writes one doc", async () => {
    const host = world();
    const s = await join(host);
    const r = ok(await applyProjectBatch(s, titles("a"), ada));
    expect(r.docs).toEqual(["asset:p.a"]);
    expect(r.entry).toBeUndefined();
    expect(readProjectLog(host.doc("project:p"))).toEqual([]);
    expect(readLog(host.doc("asset:p.a"))).toHaveLength(1);

    const same = ok(
      await applyProjectBatch(
        s,
        { v: 1, ops: [{ op: "editAsset", id: "b", edits: [{ set: "/title", value: "b" }] }] },
        ada,
      ),
    );
    expect(same.docs).toEqual([]);
    expect(readLog(host.doc("asset:p.b"))).toEqual([]);
    s.destroy();
  });

  it("runs editScene through the scene's ops, and refuses prefab writes until the project has a writer", async () => {
    const host = world();
    const s = await join(host);
    const r = ok(
      await applyProjectBatch(
        s,
        {
          v: 1,
          ops: [
            { op: "editScene", id: "yard", ops: [{ op: "move", refs: ["crate"], by: [10, 0] }] },
            { op: "editAsset", id: "a", edits: [{ insert: "/rows", value: { id: "r1", n: 2 } }] },
            { op: "editScene", id: "yard", ops: [{ op: "remove", refs: ["zone"] }] },
          ],
        },
        bo,
      ),
    );
    expect(r.docs).toEqual(["scene:p.yard", "asset:p.a"]);
    const yard = docToScene(host.doc("scene:p.yard"));
    expect(yard.entities!.find((e) => e.id === "crate")!.shape).toEqual(["circle", 1210, 940, 20]);
    expect(yard.entities!.some((e) => e.id === "zone")).toBe(false);
    expect(readLog(host.doc("scene:p.yard"))).toHaveLength(1);
    expect(content(host.doc("asset:p.a")).rows).toEqual([{ id: "r1", n: 2 }]);
    expect(s.canUndo(), "bo's batch isn't the session's own").toBe(false);

    const vector = Y.encodeStateVector(host.doc("scene:p.yard"));
    const refused = await applyProjectBatch(
      s,
      {
        v: 1,
        ops: [
          { op: "editAsset", id: "a", edits: [{ set: "/title", value: "x" }] },
          { op: "editScene", id: "yard", ops: [{ op: "definePrefab", id: "gate", prefab: null }] },
        ],
      },
      ada,
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect([refused.opIndex, refused.issue.code]).toEqual([1, "op-invalid"]);
      expect(refused.issue.message).toContain("needs the project");
    }
    expect(Y.encodeStateVector(host.doc("scene:p.yard"))).toEqual(vector);
    expect(content(host.doc("asset:p.a")).title).toBe("a");

    const wrong = await applyProjectBatch(
      s,
      { v: 1, ops: [{ op: "editScene", id: "a", ops: [{ op: "remove", refs: ["x"] }] }] },
      ada,
    );
    expect(wrong.ok || wrong.issue.code).toBe("asset-kind");
    const missing = await applyProjectBatch(
      s,
      { v: 1, ops: [{ op: "editScene", id: "yard", ops: [{ op: "remove", refs: ["nope"] }] }] },
      ada,
    );
    expect(
      missing.ok || [missing.issue.code, missing.issue.path?.startsWith("/ops/0/ops/0")],
    ).toEqual(["ref-not-found", true]);
    s.destroy();
  });

  it("hands prefab writes to the session's prefab writer", async () => {
    const host = world();
    const s = await join(host);
    const writes: string[] = [];
    const writer: PrefabWriter = {
      async plan({ entry }) {
        return {
          ok: true,
          docs: ["asset:p.b"],
          write(origin) {
            writes.push(`${entry.id}:${origin === ada}`);
            return [{ doc: "asset:p.b", entry: "planned" }];
          },
        };
      },
    };
    s.prefabWriter = writer;
    const r = ok(
      await applyProjectBatch(
        s,
        {
          v: 1,
          ops: [
            { op: "editAsset", id: "a", edits: [{ set: "/title", value: "A" }] },
            { op: "editScene", id: "yard", ops: [{ op: "unpack", ref: "gate-1" }] },
          ],
        },
        ada,
      ),
    );
    expect(writes).toEqual(["yard:true"]);
    expect(r.entry!.docs).toEqual([
      { doc: "asset:p.a", entry: readLog(host.doc("asset:p.a")).at(-1)!.id },
      { doc: "asset:p.b", entry: "planned" },
    ]);
    s.destroy();
  });

  it("creates an asset's doc with its content as the doc's first edit", async () => {
    const host = world();
    const s = await join(host, ada, { key: sequentialKeys("new") });
    const r = ok(
      await applyProjectBatch(
        s,
        {
          v: 1,
          label: "Add d",
          ops: [
            {
              op: "createAsset",
              kind: "card",
              path: "cards/d.card.json",
              id: "d",
              content: { v: 1, title: "dee", rows: [{ id: "x", n: 1 }] },
            },
            { op: "editAsset", id: "d", edits: [{ set: "/cost", value: 4 }] },
            { op: "editAsset", id: "a", edits: [{ set: "/cost", value: 2 }] },
            { op: "createAsset", kind: "scene", path: "levels/two.json" },
          ],
        },
        ada,
      ),
    );
    const project = readProject(host.doc("project:p"));
    const d = Object.values(project.assets).find((e) => e.id === "d")!;
    const two = Object.values(project.assets).find((e) => e.id === "two")!;
    expect(r.created).toEqual(["d", "two"]);
    expect(r.docs).toEqual(["asset:p.a", "project:p", `asset:p.${d.key}`, `scene:p.${two.key}`]);
    expect(content(host.doc(`asset:p.${d.key}`))).toEqual({
      rows: [{ id: "x", n: 1 }],
      cost: 4,
      title: "dee",
      v: 1,
    });
    expect(docToScene(host.doc(`scene:p.${two.key}`)).name).toBe("two");
    expect(r.entry!.docs.map((x) => x.doc)).toEqual(r.docs);
    for (const { doc, entry } of r.entry!.docs.filter((x) => x.doc !== "project:p"))
      expect(readLog(host.doc(doc)).map((e) => e.id)).toContain(entry);

    const prefab = await applyProjectBatch(
      s,
      { v: 1, ops: [{ op: "createAsset", kind: "prefab", path: "prefabs/p.json" }] },
      ada,
    );
    expect(prefab.ok).toBe(false);
    s.destroy();
  });

  it("inspects blob ops from the store's bytes and refuses a hash the store lacks", async () => {
    const host = world();
    const store = memoryContentStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = await store.put(bytes);
    const s = await join(host, ada, { store });
    const r = ok(
      await applyProjectBatch(
        s,
        {
          v: 1,
          ops: [
            {
              op: "importAsset",
              path: "art/x.spr",
              sha256: hash,
              bytes: 3,
              settings: { scale: 2 },
            },
          ],
        },
        ada,
      ),
    );
    expect(r.docs).toEqual(["project:p"]);
    const x = Object.values(readProject(host.doc("project:p")).assets).find((e) => e.id === "x");
    expect(x?.meta).toEqual({ length: 6 });

    const absent = await applyProjectBatch(
      s,
      {
        v: 1,
        ops: [{ op: "replaceContent", id: "x", sha256: await sha256("nope"), bytes: 4 }],
      },
      ada,
    );
    expect(absent.ok || absent.issue.code).toBe("hash-mismatch");
    s.destroy();
  });
});

describe("removing a prefab through editScene", () => {
  const registry = createRegistry();
  const POST: Prefab = {
    kind: "prefab",
    v: 2,
    id: "post",
    entities: [{ id: "pole", type: "solid", shape: ["box", 0, -60, 10, 60] }],
  };
  const scene = (name: string, ids: string[]): SceneDefinition => ({
    v: 2,
    name,
    bounds: [0, 0, 2000, 1200],
    instances: ids.map((id, i) => ({ id, prefab: "post", at: [100 + 200 * i, 900] })),
  });

  /** Two scenes, `yard` and `lot`, that both place the `post` prefab. */
  async function shared() {
    const host = memoryDocHost();
    seedProjectDoc(
      host.doc("project:p"),
      {
        meta: { projectId: "p", layout: 1, name: "P" },
        assets: {
          yard: { key: "yard", id: "yard", kind: "scene", path: "yard.json", created: at },
          lot: { key: "lot", id: "lot", kind: "scene", path: "lot.json", created: at },
          post: { key: "post", id: "post", kind: "prefab", path: "prefabs/post.json", created: at },
        },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    sceneToDoc(scene("yard", ["post-1", "post-2"]), {
      doc: host.doc("scene:p.yard"),
      key: sequentialKeys("y"),
    });
    sceneToDoc(scene("lot", ["post-9"]), {
      doc: host.doc("scene:p.lot"),
      key: sequentialKeys("l"),
    });
    prefabToDoc(POST, { doc: host.doc("asset:p.post"), key: sequentialKeys("p") });
    const session = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry,
      kinds: createKindRegistry(null, [sceneKind, prefabKind]),
    });
    const source = sessionPrefabSource(session);
    await source.ready();
    return { host, session, source };
  }

  const drop = (id: string, remove: string[]): ProjectOp => ({
    op: "editScene",
    id,
    ops: [
      { op: "remove", refs: remove },
      { op: "definePrefab", id: "post", prefab: null },
    ],
  });
  const live = (s: ProjectSession) => !s.state().assets.post!.deleted;

  it("is refused while another scene places it, and writes nothing", async () => {
    const { host, session, source } = await shared();
    const yard = Y.encodeStateVector(host.doc("scene:p.yard"));
    const r = await applyProjectBatch(
      session,
      { v: 1, ops: [drop("yard", ["post-1", "post-2"])] },
      ada,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.opIndex).toBe(0);
      expect(r.issue).toMatchObject({
        code: "asset-in-use",
        entityIds: ["post"],
        detail: { referrers: [{ id: "lot", pointer: "/instances/@post-9/prefab" }] },
      });
    }
    expect(live(session)).toBe(true);
    expect(Y.encodeStateVector(host.doc("scene:p.yard"))).toEqual(yard);
    source.destroy();
    session.destroy();
  });

  it("judges the edited scene by what the batch leaves it", async () => {
    const { session, source } = await shared();
    const r = await applyProjectBatch(session, { v: 1, ops: [drop("yard", ["post-1"])] }, ada);
    expect(r.ok || r.issue.detail).toEqual({
      referrers: [
        { id: "lot", pointer: "/instances/@post-9/prefab" },
        { id: "yard", pointer: "/instances/@post-2/prefab" },
      ],
    });
    expect(live(session)).toBe(true);

    ok(
      await applyProjectBatch(
        session,
        { v: 1, ops: [{ op: "editScene", id: "lot", ops: [{ op: "remove", refs: ["post-9"] }] }] },
        ada,
      ),
    );
    ok(await applyProjectBatch(session, { v: 1, ops: [drop("yard", ["post-1", "post-2"])] }, ada));
    expect(live(session)).toBe(false);
    source.destroy();
    session.destroy();
  });

  it("is refused through the scene's own prefab writer while an open scene places it", async () => {
    const { session } = await shared();
    const source = sessionPrefabSource(session, { scene: "yard" });
    await source.ready();
    await session.open("scene:p.lot");
    const doc = (await session.open("scene:p.yard")).doc;
    const vector = Y.encodeStateVector(doc);
    const r = apply.applyOpsToDoc(
      doc,
      { ops: (drop("yard", ["post-1", "post-2"]) as EditSceneOp).ops },
      ada,
      registry,
      { prefabs: source.library(), prefabWriter: source.writer },
    );
    expect(r.ok || r.issue.code).toBe("asset-in-use");
    expect(Y.encodeStateVector(doc)).toEqual(vector);
    expect(live(session)).toBe(true);
    source.destroy();
    session.destroy();
  });
});

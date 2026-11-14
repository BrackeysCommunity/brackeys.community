import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { createRegistry } from "../../game/define";
import { createKindRegistry } from "../../project/kinds";
import { prefabKind } from "../../project/kinds/prefab";
import { sceneKind } from "../../project/kinds/scene";
import type { ProjectOpBatch } from "../../project/ops";
import type { AssetEntry } from "../../project/types";
import { expandScene } from "../../scene/expand";
import { formatPrefab } from "../../scene/format";
import { resolveScene } from "../../scene/resolve";
import {
  SCENE_FORMAT_VERSION,
  type Prefab,
  type PrefabLibrary,
  type RuntimeEntity,
  type SceneDefinition,
} from "../../scene/types";
import { sceneNameOf } from "../../vite/scene-paths";
import { applyOpsToDoc } from "../apply";
import { bindSceneDoc, type BindableRuntime } from "../bind";
import { readDoc, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { readLog } from "../log";
import { docToPrefab, prefabPatch, prefabToDoc } from "../prefab-doc";
import { localPrefabSource, sessionPrefabSource } from "../prefab-source";
import { applyProjectBatch } from "../project-apply";
import { seedProjectDoc } from "../project-doc";
import { createProjectSession, memoryDocHost } from "../project-session";
import { revertEntry } from "../revert";
import { actorLabel, COLLAB_LAYOUT_VERSION } from "../types";
import { ada, bo, sync } from "./helpers";

const registry = createRegistry();
const dir = (rel: string) => new URL(rel, import.meta.url);
const jsonIn = (rel: string) =>
  readdirSync(dir(rel))
    .filter((f) => sceneNameOf(f) !== null)
    .map((f) => [`${rel}${f}`, readFileSync(dir(`${rel}${f}`), "utf8")] as const);

/** Every prefab file the engine owns, each written by formatPrefab. */
const FILES = [
  ...jsonIn("../../scenes/prefabs/"),
  ...jsonIn("../../scene/__tests__/fixtures/prefabs/"),
];

const POST: Prefab = {
  kind: "prefab",
  v: 2,
  id: "post",
  entities: [
    { id: "pole", type: "solid", shape: ["box", 0, -60, 10, 60] },
    { id: "cap", type: "marker", at: [0, -130], tags: ["top"] },
  ],
  bulk: { solid: [["box", 0, 0, 40, 6]] },
};

/** Two clients' copies of one seeded prefab doc. */
function pair(prefab: Prefab = POST): [Y.Doc, Y.Doc] {
  const server = prefabToDoc(prefab, { key: sequentialKeys("srv") });
  const a = new Y.Doc();
  const b = new Y.Doc();
  Y.applyUpdate(a, Y.encodeStateAsUpdate(server));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(server));
  return [a, b];
}

const child = (doc: Y.Doc, id: string) => docToPrefab(doc).entities.find((e) => e.id === id)!;

describe("prefab docs", () => {
  it("covers every prefab file the engine owns", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(3);
  });

  for (const [name, text] of FILES) {
    it(`is byte-identical file → doc → file for ${name}, also after the doc crosses the wire`, () => {
      const prefab = JSON.parse(text) as Prefab;
      const expected = formatPrefab(prefab);
      expect(expected).toBe(text);
      const doc = prefabToDoc(prefab);
      expect(formatPrefab(docToPrefab(doc))).toBe(expected);
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      expect(formatPrefab(docToPrefab(remote))).toBe(expected);
    });
  }

  it("holds the children exactly as a scene doc holds entities, plus a header", () => {
    const doc = prefabToDoc({ ...POST, contract: { slots: 1 } }, { key: sequentialKeys("k") });
    expect(doc.getMap("meta").toJSON()).toMatchObject({
      kind: "prefab",
      schemaVersion: 2,
      layout: COLLAB_LAYOUT_VERSION,
    });
    expect(doc.getMap("prefab").toJSON()).toEqual({ id: "post", contract: { slots: 1 } });
    const scene = sceneToDoc(
      { v: 2, name: "s", bounds: [0, 0, 10, 10], entities: POST.entities, solid: POST.bulk!.solid },
      { key: sequentialKeys("k") },
    );
    const strip = (d: Y.Doc) => d.getMap("entities").toJSON();
    expect(strip(doc)).toEqual(strip(scene));
    const view = readDoc(doc, { registry });
    expect(view.kind).toBe("prefab");
    expect(view.def.name).toBe("post");
    expect(view.def.bounds[0]).toBeLessThan(0);
    expect(doc.getMap("scene").size).toBe(0);
  });

  it("keeps two clients' edits to different children", () => {
    const [a, b] = pair();
    applyOpsToDoc(a, { ops: [{ op: "move", refs: ["cap"], by: [5, 0] }] }, ada, registry);
    applyOpsToDoc(b, { ops: [{ op: "move", refs: ["pole"], by: [0, 7] }] }, bo, registry);
    sync(a, b);
    expect(formatPrefab(docToPrefab(a))).toBe(formatPrefab(docToPrefab(b)));
    expect(child(a, "cap").at).toEqual([5, -130]);
    expect(child(a, "pole").shape).toEqual(["box", 0, -53, 10, 60]);
  });

  it("keeps two clients' edits to different fields of one child", () => {
    const [a, b] = pair();
    applyOpsToDoc(
      a,
      { ops: [{ op: "update", ref: "cap", set: { at: [3, -120] } }] },
      ada,
      registry,
    );
    applyOpsToDoc(b, { ops: [{ op: "update", ref: "cap", set: { tags: ["lid"] } }] }, bo, registry);
    sync(a, b);
    expect(child(a, "cap")).toEqual({ id: "cap", type: "marker", at: [3, -120], tags: ["lid"] });
    expect(child(b, "cap")).toEqual(child(a, "cap"));
  });

  it("patches only what changed, keeping keys, so a concurrent edit survives", () => {
    const [a, b] = pair();
    const keys = [...a.getMap("entities").keys()].sort();
    const entry = prefabPatch(
      a,
      { ...POST, entities: [POST.entities[0]!, { ...POST.entities[1]!, at: [0, -140] }] },
      ada,
    );
    expect(entry?.keys).toHaveLength(1);
    expect([...a.getMap("entities").keys()].sort()).toEqual(keys);
    applyOpsToDoc(b, { ops: [{ op: "move", refs: ["pole"], by: [1, 0] }] }, bo, registry);
    sync(a, b);
    expect(child(a, "cap").at).toEqual([0, -140]);
    expect(child(a, "pole").shape).toEqual(["box", 1, -60, 10, 60]);
    expect(prefabPatch(a, docToPrefab(a), ada)).toBeNull();
    expect(
      readLog(a)
        .map((e) => actorLabel(e.actor))
        .sort(),
    ).toEqual(["Ada", "Bo"]);
  });

  it("refuses scene-only ops and grouped children with op-invalid, writing nothing", () => {
    const [a] = pair();
    const vector = Y.encodeStateVector(a);
    for (const ops of [
      [{ op: "setScene", set: { name: "x" } }],
      [{ op: "setSettings", set: { gravity: 1 } }],
      [{ op: "definePrefab", id: "post", prefab: null }],
      [{ op: "createPrefab", refs: ["cap"], id: "lid" }],
    ] as const) {
      const r = applyOpsToDoc(a, { ops: [...ops] as never }, ada, registry);
      expect(r.ok || r.issue.code, JSON.stringify(ops)).toBe("op-invalid");
    }
    const self = applyOpsToDoc(
      a,
      { ops: [{ op: "instantiate", instance: { prefab: "post", at: [0, 0] } }] },
      ada,
      registry,
      { prefabs: new Map([["post", POST]]) },
    );
    expect(self.ok || self.issue.code).toBe("prefab-cycle");
    expect(Y.encodeStateVector(a)).toEqual(vector);
  });

  it("takes parent links between its children, written and reparented", () => {
    const [a, b] = pair({ ...POST, v: 4 });
    const added = applyOpsToDoc(
      a,
      {
        ops: [
          { op: "add", entity: { id: "hinge", type: "node", at: [0, -60], rot: 90 } },
          { op: "add", entity: { id: "flag", type: "marker", at: [4, 0], parent: "hinge" } },
          { op: "reparent", refs: ["cap"], parent: "hinge" },
        ],
      },
      ada,
      registry,
      { validate: "none" },
    );
    expect(added.ok || added.issue.message).toBe(true);
    sync(a, b);
    expect(child(b, "flag")).toMatchObject({ parent: "hinge", at: [4, 0] });
    expect(child(b, "cap").parent).toBe("hinge");
    expect(formatPrefab(docToPrefab(b))).toBe(formatPrefab(docToPrefab(a)));

    expect(revertEntry(a, readLog(a).at(-1)!, ada).ok).toBe(true);
    expect(docToPrefab(a).entities.map((e) => e.id)).toEqual(["pole", "cap"]);
    expect(child(a, "cap")).toEqual(POST.entities[1]);
  });

  it("an instance follows a prefab edit, re-expanding once per prefab transaction", async () => {
    const host = memoryDocHost();
    const entry = (key: string, kind: string, path: string): AssetEntry => ({
      key,
      id: key,
      kind,
      path,
      created: { at: 0, by: "seed" },
    });
    seedProjectDoc(
      host.doc("project:p"),
      {
        meta: { projectId: "p", layout: 1, name: "P" },
        assets: {
          yard: entry("yard", "scene", "yard.json"),
          post: entry("post", "prefab", "prefabs/post.json"),
        },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    const scene: SceneDefinition = {
      v: 2,
      name: "yard",
      bounds: [0, 0, 2000, 1200],
      instances: [
        { id: "post-1", prefab: "post", at: [100, 900] },
        { id: "post-2", prefab: "post", at: [300, 900] },
      ],
    };
    sceneToDoc(scene, { doc: host.doc("scene:p.yard"), key: sequentialKeys("s") });
    prefabToDoc(POST, { doc: host.doc("asset:p.post"), key: sequentialKeys("p") });
    const kinds = createKindRegistry(null, [sceneKind, prefabKind]);
    const join = (origin: typeof ada) =>
      createProjectSession({
        project: "p",
        openDoc: host.client().openDoc,
        origin,
        registry,
        kinds,
      });
    const mine = await join(ada);
    const theirs = await join(bo);
    const source = sessionPrefabSource(mine, { scene: "yard" });
    await source.ready();
    const doc = (await mine.open("scene:p.yard")).doc;

    const loads: number[] = [];
    const updates: RuntimeEntity[][] = [];
    const runtime: BindableRuntime = {
      load: (s) => (loads.push(s.entities.length), { ok: true }),
      add: () => ({ ok: true }),
      update: (es) => (updates.push(es), { ok: true }),
      remove: () => {},
    };
    const binding = bindSceneDoc(doc, runtime, registry, { prefabs: source });
    const cap = () => binding.scene().entities.find((e) => e.id === "post-2/cap")!;
    expect(cap().at).toEqual([300, 770]);

    const remote = sessionPrefabSource(theirs);
    const prefabDoc = (await remote.open("post"))!;
    applyOpsToDoc(prefabDoc, { ops: [{ op: "move", refs: ["cap"], by: [0, -10] }] }, bo, registry);
    await new Promise((r) => setTimeout(r, 0));
    expect(cap().at).toEqual([300, 760]);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.map((e) => e.id).sort()).toEqual(["post-1/cap", "post-2/cap"]);
    expect(source.library().get("post")!.entities[1]!.at).toEqual([0, -140]);
    binding.destroy();
    mine.destroy();
    theirs.destroy();
  });

  it("gives prefabs created in one batch distinct keys when a suffixed key is free only in the registry", async () => {
    const host = memoryDocHost();
    const created = { at: 0, by: "seed" };
    seedProjectDoc(
      host.doc("project:p"),
      {
        meta: { projectId: "p", layout: 1, name: "P" },
        assets: {
          yard: { key: "yard", id: "yard", kind: "scene", path: "yard.json", created },
          peg: { key: "peg", id: "old-peg", kind: "prefab", path: "prefabs/old-peg.json", created },
        },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    sceneToDoc(
      { v: 2, name: "yard", bounds: [0, 0, 500, 500] },
      { doc: host.doc("scene:p.yard"), key: sequentialKeys("s") },
    );
    prefabToDoc(
      { ...POST, id: "old-peg" },
      { doc: host.doc("asset:p.peg"), key: sequentialKeys("o") },
    );
    const session = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry,
      kinds: createKindRegistry(null, [sceneKind, prefabKind]),
    });
    const source = sessionPrefabSource(session, { scene: "yard" });
    await source.ready();
    const doc = (await session.open("scene:p.yard")).doc;
    const body = { entities: POST.entities };
    const r = applyOpsToDoc(
      doc,
      {
        ops: [
          { op: "definePrefab", id: "peg", prefab: body },
          { op: "definePrefab", id: "peg-2", prefab: body },
        ],
      },
      ada,
      registry,
      { prefabs: source.library(), prefabWriter: source.writer },
    );
    expect(r.ok || r.issue).toBe(true);
    const prefabs = Object.values(session.state().assets)
      .filter((e) => e.kind === "prefab")
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((e) => [e.key, e.id, e.path]);
    expect(prefabs).toEqual([
      ["peg", "old-peg", "prefabs/old-peg.json"],
      ["peg-2", "peg", "prefabs/peg.json"],
      ["peg-2-2", "peg-2", "prefabs/peg-2.json"],
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect([...source.library().keys()].sort()).toEqual(["old-peg", "peg", "peg-2"]);
    session.destroy();
  });

  it("a local source writes prefab ops to its own docs, one transaction each", () => {
    const source = localPrefabSource(new Map([["post", POST]]), { key: sequentialKeys("l") });
    const doc = sceneToDoc(
      {
        v: 2,
        name: "s",
        bounds: [0, 0, 500, 500],
        instances: [
          { id: "post-1", prefab: "post", at: [10, 10], overrides: { "cap.at": [0, -150] } },
        ],
      },
      { key: sequentialKeys("s") },
    );
    const bare = applyOpsToDoc(
      doc,
      { ops: [{ op: "applyToPrefab", ref: "post-1" }] },
      ada,
      registry,
      {
        prefabs: source.library(),
      },
    );
    expect(bare.ok || [bare.issue.code, bare.issue.message]).toEqual([
      "op-invalid",
      expect.stringContaining("needs the project"),
    ]);
    let prefabTransactions = 0;
    source
      .docs()
      .get("post")!
      .on("afterTransaction", () => prefabTransactions++);
    const r = applyOpsToDoc(doc, { ops: [{ op: "applyToPrefab", ref: "post-1" }] }, ada, registry, {
      prefabs: source.library(),
      prefabWriter: source.writer!,
    });
    expect(r.ok && r.docs).toEqual([{ doc: "prefab:post", entry: expect.any(String) }]);
    expect(prefabTransactions).toBe(1);
    expect(source.library().get("post")!.entities[1]!.at).toEqual([0, -150]);
    expect(readDoc(doc).def.instances![0]!.overrides).toBeUndefined();
  });
});

/** A variant of `post` with every prefab-only map filled. */
const RICH: Prefab = {
  kind: "prefab",
  v: 2,
  id: "tall-post",
  base: "post",
  contract: { slots: 2 },
  assets: ["snd-b", "snd-a"],
  params: {
    height: { description: "Pole height", targets: ["pole.shape"], default: 60 },
    label: { description: "Cap tag", targets: ["cap.tags"] },
  },
  overrides: { "cap.at": [0, -140], "pole.off": true },
  entities: [{ id: "lamp", type: "marker", at: [0, -150] }],
  instances: [
    {
      id: "inner-1",
      prefab: "post",
      at: [50, 0],
      params: { height: 80 },
      overrides: { "cap.tags": ["x"] },
    },
    { id: "inner-2", prefab: "post", at: [100, 0], rot: 90, z: 2 },
  ],
};

const instanceKeys = (doc: Y.Doc) => [...doc.getMap("instances").keys()].sort();
const keyOf = (doc: Y.Doc, id: string) =>
  [...(doc.getMap("instances") as Y.Map<Y.Map<unknown>>).entries()].find(
    ([, m]) => m.get("id") === id,
  )![0];

describe("prefab doc maps", () => {
  it("writes each prefab-only map per key and reads it back, also across the wire", () => {
    const doc = prefabToDoc(RICH, { key: sequentialKeys("r") });
    expect(doc.getMap("prefab").toJSON()).toEqual({
      id: "tall-post",
      base: "post",
      contract: { slots: 2 },
    });
    expect(doc.getMap("params").toJSON()).toEqual(RICH.params);
    expect(doc.getMap("overrides").toJSON()).toEqual(RICH.overrides);
    expect(doc.getMap("assets").toJSON()).toEqual({ "snd-a": true, "snd-b": true });
    const instances = doc.getMap("instances") as Y.Map<Y.Map<unknown>>;
    expect(instances.size).toBe(2);
    const inner = instances.get(keyOf(doc, "inner-1"))!;
    expect(inner).toBeInstanceOf(Y.Map);
    expect(inner.get("overrides")).toBeInstanceOf(Y.Map);
    expect(inner.get("params")).toBeInstanceOf(Y.Map);
    expect(instances.get(keyOf(doc, "inner-2"))!.get("z")).toBe(2);
    expect(inner.get("prefab")).toBe("post");

    const expected = { ...RICH, assets: ["snd-a", "snd-b"] };
    expect(docToPrefab(doc)).toEqual(expected);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    expect(docToPrefab(remote)).toEqual(expected);
    expect(JSON.stringify(docToPrefab(remote))).toBe(JSON.stringify(docToPrefab(doc)));
  });

  it("leaves the maps empty and the fields out for a prefab without them", () => {
    const doc = prefabToDoc({ ...POST, assets: [], params: {}, overrides: {}, instances: [] });
    for (const name of ["params", "overrides", "assets", "instances"])
      expect(doc.getMap(name).size).toBe(0);
    expect(doc.getMap("prefab").has("base")).toBe(false);
    expect(docToPrefab(doc)).toEqual(POST);
  });

  it("logs each changed parameter under its own key, writing only that key", () => {
    const doc = prefabToDoc(RICH, { key: sequentialKeys("r") });
    const height = { ...RICH.params!.height!, default: 90 };
    const entry = prefabPatch(doc, { ...RICH, params: { ...RICH.params, height } }, ada);
    expect(entry?.keys).toEqual(["@param:height"]);
    expect(entry?.before?.["@param:height"]).toEqual(RICH.params!.height);
    expect(entry?.after?.["@param:height"]).toEqual(expect.any(String));
    expect(docToPrefab(doc).params!.height).toEqual(height);

    const gone = prefabPatch(doc, { ...RICH, params: { height } }, ada);
    expect(gone?.keys).toEqual(["@param:label"]);
    expect(gone?.after?.["@param:label"]).toBeNull();
    expect([...doc.getMap("params").keys()]).toEqual(["height"]);
  });

  it("logs base and overrides under the variant key, patching overrides per path", () => {
    const doc = prefabToDoc(RICH, { key: sequentialKeys("r") });
    const overrides = doc.getMap("overrides");
    let deleted: string[] = [];
    let set: string[] = [];
    overrides.observe((e) => {
      deleted = [...e.keysChanged].filter((k) => !overrides.has(k));
      set = [...e.keysChanged].filter((k) => overrides.has(k));
    });
    const entry = prefabPatch(
      doc,
      { ...RICH, overrides: { "cap.at": [0, -145], "lamp.tags": ["on"] } },
      ada,
    );
    expect(entry?.keys).toEqual(["@variant"]);
    expect(entry?.before?.["@variant"]).toEqual({ base: "post", overrides: RICH.overrides });
    expect(set.sort()).toEqual(["cap.at", "lamp.tags"]);
    expect(deleted).toEqual(["pole.off"]);

    const { base: _base, overrides: _o, ...plain } = RICH;
    const unvaried = prefabPatch(doc, plain, ada);
    expect(unvaried?.keys).toEqual(["@variant"]);
    expect(doc.getMap("prefab").has("base")).toBe(false);
    expect(overrides.size).toBe(0);
    expect(docToPrefab(doc).base).toBeUndefined();
    expect(docToPrefab(doc).overrides).toBeUndefined();
  });

  it("logs the assets map under one key, adding and removing ids one by one", () => {
    const doc = prefabToDoc(RICH, { key: sequentialKeys("r") });
    const entry = prefabPatch(doc, { ...RICH, assets: ["snd-c", "snd-a"] }, ada);
    expect(entry?.keys).toEqual(["@assets"]);
    expect(entry?.before?.["@assets"]).toEqual(["snd-a", "snd-b"]);
    expect(doc.getMap("assets").toJSON()).toEqual({ "snd-a": true, "snd-c": true });
    const none = prefabPatch(doc, { ...RICH, assets: [] }, ada);
    expect(none?.after?.["@assets"]).toBeNull();
    expect(doc.getMap("assets").size).toBe(0);
    expect(docToPrefab(doc).assets).toBeUndefined();
  });

  it("keeps nested instances' keys by id and patches each one field by field", () => {
    const doc = prefabToDoc(RICH, { key: sequentialKeys("r") });
    const keys = instanceKeys(doc);
    const k1 = keyOf(doc, "inner-1");
    const k2 = keyOf(doc, "inner-2");
    const inner = (doc.getMap("instances") as Y.Map<Y.Map<unknown>>).get(k1)!;
    const nested = inner.get("overrides") as Y.Map<unknown>;
    const [first, second] = RICH.instances!;
    const entry = prefabPatch(
      doc,
      { ...RICH, instances: [{ ...first!, at: [60, 0] }, second!] },
      ada,
    );
    expect(entry?.keys).toEqual([`@instance:${k1}`]);
    expect(instanceKeys(doc)).toEqual(keys);
    expect(inner.get("overrides")).toBe(nested);
    expect(docToPrefab(doc).instances![0]!.at).toEqual([60, 0]);

    const reordered = prefabPatch(
      doc,
      { ...RICH, instances: [second!, { id: "inner-3", prefab: "post", at: [0, 9] }] },
      ada,
    );
    const k3 = keyOf(doc, "inner-3");
    expect(reordered?.keys.sort()).toEqual([`@instance:${k1}`, `@instance:${k3}`].sort());
    expect(reordered?.after?.[`@instance:${k1}`]).toBeNull();
    expect(instanceKeys(doc)).toEqual([k2, k3].sort());
    expect(docToPrefab(doc).instances!.map((i) => i.id)).toEqual(["inner-2", "inner-3"]);
    expect(prefabPatch(doc, docToPrefab(doc), ada)).toBeNull();
  });

  it("merges two clients' patches to different keys of every map", () => {
    const [a, b] = pair(RICH);
    const [first, second] = RICH.instances!;
    prefabPatch(
      a,
      {
        ...RICH,
        params: { ...RICH.params, height: { ...RICH.params!.height!, default: 70 } },
        overrides: { ...RICH.overrides, "cap.at": [1, -140] },
        assets: [...RICH.assets!, "snd-c"],
        instances: [{ ...first!, at: [51, 0] }, second!],
      },
      ada,
    );
    prefabPatch(
      b,
      {
        ...RICH,
        params: { ...RICH.params, label: { description: "Cap", targets: ["cap.tags"] } },
        overrides: { ...RICH.overrides, "pole.off": false },
        assets: [...RICH.assets!, "snd-d"],
        instances: [{ ...first!, overrides: { "cap.tags": ["y"] } }, second!],
      },
      bo,
    );
    sync(a, b);
    const merged = docToPrefab(a);
    expect(docToPrefab(b)).toEqual(merged);
    expect(merged.params).toEqual({
      height: { ...RICH.params!.height!, default: 70 },
      label: { description: "Cap", targets: ["cap.tags"] },
    });
    expect(merged.overrides).toEqual({ "cap.at": [1, -140], "pole.off": false });
    expect(merged.assets).toEqual(["snd-a", "snd-b", "snd-c", "snd-d"]);
    expect(merged.instances![0]).toEqual({
      ...first!,
      at: [51, 0],
      overrides: { "cap.tags": ["y"] },
    });
    expect(instanceKeys(a)).toHaveLength(2);
  });

  it("logs each map so that its entry reverts to the state before", () => {
    const doc = prefabToDoc(RICH, { key: sequentialKeys("r") });
    const before = docToPrefab(doc);
    const [first, second] = RICH.instances!;
    const entry = prefabPatch(
      doc,
      {
        ...RICH,
        base: "gate",
        params: { height: RICH.params!.height! },
        overrides: { "cap.at": [0, -150] },
        assets: ["snd-c"],
        instances: [second!, { ...first!, params: { height: 81 } }],
      },
      ada,
    )!;
    expect(entry.keys).toEqual(
      expect.arrayContaining([
        "@variant",
        "@param:label",
        "@assets",
        `@instance:${keyOf(doc, "inner-1")}`,
      ]),
    );
    const r = revertEntry(doc, entry, bo);
    expect(r.ok || r.issue).toBe(true);
    expect(docToPrefab(doc)).toEqual(before);
  });
});

/** Three levels: a room holds two doors, each door holds a panel. */
const PANEL: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "panel",
  entities: [
    { id: "slab", type: "solid", shape: ["box", 0, 0, 20, 4] },
    { id: "knob", type: "marker", at: [8, 0] },
  ],
};
const DOOR: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "door",
  entities: [{ id: "frame", type: "marker", at: [0, -40] }],
  instances: [{ id: "panel-1", prefab: "panel", at: [0, -20] }],
};
const ROOM: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "room",
  entities: [{ id: "floor", type: "solid", shape: ["box", 0, 0, 200, 10] }],
  instances: [
    { id: "door-1", prefab: "door", at: [-60, 0], overrides: { "panel-1/knob.tags": ["brass"] } },
    { id: "door-2", prefab: "door", at: [60, 0], rot: 180 },
  ],
};
const NESTED: PrefabLibrary = new Map([
  ["panel", PANEL],
  ["door", DOOR],
  ["room", ROOM],
]);

/** A project holding the three nested prefabs, joined by one client per origin. */
async function nestedProject(...origins: (typeof ada)[]) {
  const host = memoryDocHost();
  const created = { at: 0, by: "seed" };
  const assets: Record<string, AssetEntry> = {};
  for (const id of NESTED.keys())
    assets[id] = { key: id, id, kind: "prefab", path: `prefabs/${id}.json`, created };
  seedProjectDoc(
    host.doc("project:p"),
    { meta: { projectId: "p", layout: 1, name: "P" }, assets, history: {}, code: {}, build: {} },
    { kind: "migration" },
  );
  for (const [id, prefab] of NESTED)
    prefabToDoc(prefab, { doc: host.doc(`asset:p.${id}`), key: sequentialKeys(id) });
  const kinds = createKindRegistry(null, [sceneKind, prefabKind]);
  const sessions = await Promise.all(
    origins.map((origin) =>
      createProjectSession({
        project: "p",
        openDoc: host.client().openDoc,
        origin,
        registry,
        kinds,
      }),
    ),
  );
  const sources = sessions.map((s) => sessionPrefabSource(s));
  await Promise.all(sources.map((s) => s.ready()));
  return { sessions, sources };
}

const idsOf = (def: SceneDefinition) => (def.entities ?? []).map((e) => e.id).sort();

describe("nested prefabs in prefab docs", () => {
  it("round-trips nested instances file → doc → file, readDoc returning them, also across the wire", () => {
    for (const prefab of NESTED.values()) {
      const doc = prefabToDoc(prefab, { key: sequentialKeys("n") });
      expect(readDoc(doc, { registry }).def.instances).toEqual(prefab.instances);
      expect(formatPrefab(docToPrefab(doc))).toBe(formatPrefab(prefab));
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      expect(docToPrefab(remote)).toEqual(docToPrefab(doc));
      expect(prefabPatch(remote, prefab, ada)).toBeNull();
    }
  });

  it("holds its nested instances' origins in the bounds it is edited in", () => {
    const far: Prefab = { ...ROOM, instances: [{ id: "door-9", prefab: "door", at: [5000, 0] }] };
    const bounds = readDoc(prefabToDoc(far), { registry }).def.bounds;
    expect(bounds[2]).toBeGreaterThan(5000);
  });

  it("resolves its view against the session's prefabs to the ids expandScene gives, following a deeper prefab's edits", async () => {
    const {
      sessions: [mine, theirs],
      sources: [source, remote],
    } = await nestedProject(ada, bo);
    const doc = (await source!.open("room"))!;
    const resolved = () =>
      resolveScene(readDoc(doc, { registry }).def, registry, source!.library());
    const scene: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      name: "yard",
      bounds: [-1000, -1000, 1000, 1000],
      instances: [{ id: "room-1", prefab: "room", at: [0, 0] }],
    };
    const expanded = expandScene(scene, registry, { prefabs: source!.library() })
      .entities.filter((e) => e.type !== "node")
      .map((e) => e.id.replace(/^room-1\//, ""));
    expect(idsOf(resolved())).toEqual(expanded.sort());
    expect(idsOf(resolved())).toEqual(
      expect.arrayContaining([
        "floor",
        "door-1/frame",
        "door-1/panel-1/slab",
        "door-2/panel-1/knob",
      ]),
    );
    const knob = () => resolved().entities!.find((e) => e.id === "door-1/panel-1/knob")!;
    expect(knob().tags).toEqual(["brass"]);
    expect(knob().at).toEqual([-52, -20]);

    let fired: readonly string[] = [];
    source!.subscribe((changed) => (fired = changed));
    const panel = (await remote!.open("panel"))!;
    applyOpsToDoc(panel, { ops: [{ op: "move", refs: ["knob"], by: [2, 0] }] }, bo, registry);
    await new Promise((r) => setTimeout(r, 0));
    expect(fired).toEqual(["panel"]);
    expect(knob().at).toEqual([-50, -20]);
    mine!.destroy();
    theirs!.destroy();
  });

  it("keeps two clients' edits to different fields of one nested child", () => {
    const server = prefabToDoc(ROOM, { key: sequentialKeys("srv") });
    const [a, b] = [new Y.Doc(), new Y.Doc()];
    Y.applyUpdate(a, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(server));
    const opts = { prefabs: NESTED };
    const ra = applyOpsToDoc(
      a,
      { ops: [{ op: "override", ref: "door-1", set: { "panel-1/knob.at": [9, 1] } }] },
      ada,
      registry,
      opts,
    );
    const rb = applyOpsToDoc(
      b,
      { ops: [{ op: "override", ref: "door-1", set: { "panel-1/knob.tags": ["iron"] } }] },
      bo,
      registry,
      opts,
    );
    expect([ra.ok || ra.issue, rb.ok || rb.issue]).toEqual([true, true]);
    sync(a, b);
    const merged = docToPrefab(a);
    expect(docToPrefab(b)).toEqual(merged);
    expect(merged.instances![0]!.overrides).toEqual({
      "panel-1/knob.at": [9, 1],
      "panel-1/knob.tags": ["iron"],
    });
    const knob = resolveScene(readDoc(a, { registry }).def, registry, NESTED).entities!.find(
      (e) => e.id === "door-1/panel-1/knob",
    )!;
    expect(knob).toMatchObject({ at: [-51, -19], tags: ["iron"] });
  });

  it("takes the instance ops inside a prefab and refuses a cycle through a nested instance", () => {
    const doc = prefabToDoc(PANEL, { key: sequentialKeys("p") });
    const vector = Y.encodeStateVector(doc);
    const cycle = applyOpsToDoc(
      doc,
      { ops: [{ op: "instantiate", instance: { id: "room-1", prefab: "room", at: [0, 0] } }] },
      ada,
      registry,
      { prefabs: NESTED },
    );
    expect(cycle.ok || [cycle.issue.code, cycle.failedAt]).toEqual(["prefab-cycle", 0]);
    expect(Y.encodeStateVector(doc)).toEqual(vector);

    const room = prefabToDoc(ROOM, { key: sequentialKeys("r") });
    const placed = applyOpsToDoc(
      room,
      { ops: [{ op: "instantiate", instance: { id: "panel-9", prefab: "panel", at: [0, 50] } }] },
      ada,
      registry,
      { prefabs: NESTED },
    );
    expect(placed.ok || placed.issue).toBe(true);
    expect(docToPrefab(room).instances!.map((i) => i.id)).toEqual(["door-1", "door-2", "panel-9"]);
    const reverted = applyOpsToDoc(
      room,
      { ops: [{ op: "revertOverride", ref: "door-1" }] },
      ada,
      registry,
      { prefabs: NESTED },
    );
    expect(reverted.ok || reverted.issue).toBe(true);
    expect(docToPrefab(room).instances![0]!.overrides).toBeUndefined();
  });
});

describe("prefab header ops through the project", () => {
  const TALL: Prefab = {
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    id: "tall-post",
    base: "post",
    overrides: { "cap.at": [0, -150] },
    entities: [],
  };
  const height = { description: "Cap height.", targets: ["cap.at"] };

  async function project() {
    const host = memoryDocHost();
    const created = { at: 0, by: "seed" };
    seedProjectDoc(
      host.doc("project:p"),
      {
        meta: { projectId: "p", layout: 1, name: "P" },
        assets: {
          yard: { key: "yard", id: "yard", kind: "scene", path: "yard.json", created },
          post: { key: "post", id: "post", kind: "prefab", path: "prefabs/post.json", created },
          short: { key: "short", id: "short", kind: "prefab", path: "prefabs/short.json", created },
          tall: {
            key: "tall",
            id: "tall-post",
            kind: "prefab",
            path: "prefabs/tall.json",
            created,
          },
        },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    sceneToDoc(
      {
        v: SCENE_FORMAT_VERSION,
        name: "yard",
        bounds: [0, 0, 500, 500],
        instances: [{ id: "t-1", prefab: "tall-post", at: [100, 100] }],
      },
      { doc: host.doc("scene:p.yard"), key: sequentialKeys("s") },
    );
    prefabToDoc(POST, { doc: host.doc("asset:p.post"), key: sequentialKeys("o") });
    prefabToDoc(
      { ...POST, id: "short" },
      { doc: host.doc("asset:p.short"), key: sequentialKeys("h") },
    );
    prefabToDoc(TALL, { doc: host.doc("asset:p.tall"), key: sequentialKeys("t") });
    const session = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry,
      kinds: createKindRegistry(null, [sceneKind, prefabKind]),
    });
    const source = sessionPrefabSource(session, { scene: "yard" });
    await source.ready();
    const tall = (await session.open("asset:p.tall")).doc;
    return { session, source, tall };
  }
  const editScene = (id: string, ops: unknown[]) =>
    ({ v: 1, ops: [{ op: "editScene", id, ops }] }) as ProjectOpBatch;

  it("setPrefabBase and exposeParam sent with the prefab's id reach its doc", async () => {
    const { session, source, tall } = await project();
    const r = await applyProjectBatch(
      session,
      editScene("tall-post", [
        { op: "setPrefabBase", base: "short" },
        { op: "exposeParam", name: "height", param: height },
      ]),
      ada,
    );
    expect(r.ok || r.issue).toBe(true);
    expect(docToPrefab(tall)).toEqual({ ...TALL, base: "short", params: { height } });
    const entry = readLog(tall).at(-1)!;
    expect(entry.keys.sort()).toEqual(["@param:height", "@variant"]);
    expect(actorLabel(entry.actor)).toBe(actorLabel(ada));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(source.library().get("tall-post")).toMatchObject({ base: "short", params: { height } });
    session.destroy();
  });

  it("refuses an unknown base and header ops sent to a scene, writing nothing", async () => {
    const { session, tall } = await project();
    const vector = Y.encodeStateVector(tall);
    const unknown = await applyProjectBatch(
      session,
      editScene("tall-post", [
        { op: "exposeParam", name: "height", param: height },
        { op: "setPrefabBase", base: "shrt" },
      ]),
      ada,
    );
    expect(unknown.ok || [unknown.issue.code, unknown.issue.path]).toEqual([
      "variant-base-unknown",
      "/ops/1/base",
    ]);
    const cycle = await applyProjectBatch(
      session,
      editScene("post", [{ op: "setPrefabBase", base: "tall-post" }]),
      ada,
    );
    expect(cycle.ok || cycle.issue.code).toBe("prefab-cycle");
    const onScene = await applyProjectBatch(
      session,
      editScene("yard", [{ op: "exposeParam", name: "height", param: height }]),
      ada,
    );
    expect(onScene.ok || [onScene.issue.code, onScene.issue.path]).toEqual([
      "op-invalid",
      "/ops/0/ops/0",
    ]);
    expect(onScene.ok || onScene.issue.message).toContain("only works on a prefab doc");
    expect(Y.encodeStateVector(tall)).toEqual(vector);
    session.destroy();
  });

  it("a variant's base follows its base prefab's new id", async () => {
    const { session, tall } = await project();
    const r = await applyProjectBatch(
      session,
      { v: 1, ops: [{ op: "changeAssetId", id: "post", to: "pole" }] } as ProjectOpBatch,
      ada,
    );
    expect(r.ok || r.issue).toBe(true);
    expect(docToPrefab(tall).base).toBe("pole");
    expect(docToPrefab(tall).overrides).toEqual(TALL.overrides);
    session.destroy();
  });
});

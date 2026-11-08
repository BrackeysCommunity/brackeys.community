import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { createRegistry } from "../../game/define";
import { createKindRegistry } from "../../project/kinds";
import { prefabKind } from "../../project/kinds/prefab";
import { sceneKind } from "../../project/kinds/scene";
import type { AssetEntry } from "../../project/types";
import { formatPrefab } from "../../scene/format";
import type { Prefab, RuntimeEntity, SceneDefinition } from "../../scene/types";
import { sceneNameOf } from "../../vite/scene-paths";
import { applyOpsToDoc } from "../apply";
import { bindSceneDoc, type BindableRuntime } from "../bind";
import { readDoc, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { readLog } from "../log";
import { docToPrefab, prefabPatch, prefabToDoc } from "../prefab-doc";
import { localPrefabSource, sessionPrefabSource } from "../prefab-source";
import { seedProjectDoc } from "../project-doc";
import { createProjectSession, memoryDocHost } from "../project-session";
import { actorLabel } from "../types";
import { ada, bo, sync } from "./helpers";

const registry = createRegistry();
const dir = (rel: string) => new URL(rel, import.meta.url);
const jsonIn = (rel: string) =>
  readdirSync(dir(rel))
    .filter((f) => sceneNameOf(f) !== null)
    .map((f) => [`${rel}${f}`, readFileSync(dir(`${rel}${f}`), "utf8")] as const);

/** Every prefab file the engine owns; the scene files' prefabs are canonical text, the fixtures hand-formatted. */
const FILES = [
  ...jsonIn("../../scenes/prefabs/").map(([n, t]) => [n, t, true] as const),
  ...jsonIn("../../scene/__tests__/fixtures/prefabs/").map(([n, t]) => [n, t, false] as const),
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

  for (const [name, text, canonical] of FILES) {
    it(`is byte-identical file → doc → file for ${name}, also after the doc crosses the wire`, () => {
      const prefab = JSON.parse(text) as Prefab;
      const expected = formatPrefab(prefab);
      if (canonical) expect(expected).toBe(text);
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
      layout: 2,
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
      [{ op: "instantiate", instance: { prefab: "post", at: [0, 0] } }],
      [{ op: "definePrefab", id: "post", prefab: null }],
    ] as const) {
      const r = applyOpsToDoc(a, { ops: [...ops] as never }, ada, registry);
      expect(r.ok || r.issue.code).toBe("op-invalid");
    }
    expect(Y.encodeStateVector(a)).toEqual(vector);
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

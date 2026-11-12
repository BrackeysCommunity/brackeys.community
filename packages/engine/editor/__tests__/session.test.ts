import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import { readDoc, sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import { layoutFromDoc, layoutToDoc } from "../../collab/layout";
import { readLog } from "../../collab/log";
import { docToPrefab, prefabToDoc } from "../../collab/prefab-doc";
import { sessionPrefabSource, type PrefabSource } from "../../collab/prefab-source";
import { applyProjectBatch } from "../../collab/project-apply";
import { seedProjectDoc } from "../../collab/project-doc";
import { readProject } from "../../collab/project-doc";
import { historyRows, readProjectLog, type HistoryRow } from "../../collab/project-log";
import { createProjectSession, memoryDocHost } from "../../collab/project-session";
import { Z_FIELD, type AwarenessLike, type SceneOrigin } from "../../collab/types";
import { createRegistry } from "../../game/define";
import { createKindRegistry, defineAssetKind, type DocLayout } from "../../project/kinds";
import { prefabKind } from "../../project/kinds/prefab";
import { sceneKind } from "../../project/kinds/scene";
import type { ProjectOpBatch } from "../../project/ops";
import type { AssetEntry } from "../../project/types";
import door from "../../scene/__tests__/fixtures/prefabs/door.json";
import gate from "../../scene/__tests__/fixtures/prefabs/gate.json";
import room from "../../scene/__tests__/fixtures/prefabs/room.json";
import { engine } from "../../scene/__tests__/fixtures/random-ops";
import { formatScene } from "../../scene/format";
import { sceneHash } from "../../scene/hash";
import { prefabLibrary } from "../../scene/prefab";
import { resolveScene } from "../../scene/resolve";
import type { Prefab, PrefabLibrary, SceneDefinition, ShapeTuple } from "../../scene/types";
import {
  applyToPrefabBatch,
  asProjectBatch,
  createPrefabBatch,
  unpackBatch,
} from "../prefab-commands";
import { createEditorSession, labelFor, projectHistory, type EditorSessionEvent } from "../session";

const registry = createRegistry();
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const bo: SceneOrigin = { kind: "user", userId: "bo", name: "Bo" };
const solidOf = (def: SceneDefinition) => def.solid as ShapeTuple[];
const text = (def: SceneDefinition) => formatScene(def).text;

function scene(): SceneDefinition {
  return {
    v: 1,
    name: "s",
    bounds: [0, 0, 100, 100],
    solid: [
      ["box", 10, 10, 2, 2],
      ["box", 20, 20, 2, 2],
    ],
    entities: [
      { id: "a", type: "marker", at: [1, 1] },
      { id: "b", type: "marker", at: [2, 2] },
    ],
  };
}

/** A minimal in-memory awareness that two sessions share, as a provider would relay it. */
function sharedAwareness() {
  const states = new Map<number, Record<string, unknown>>();
  const handlers = new Set<() => void>();
  const make = (clientID: number): AwarenessLike => ({
    clientID,
    getLocalState: () => states.get(clientID) ?? null,
    setLocalStateField(field, value) {
      states.set(clientID, { ...states.get(clientID), [field]: value });
      for (const h of handlers) h();
    },
    getStates: () => states,
    on: (_e, cb) => handlers.add(cb as () => void),
    off: (_e, cb) => handlers.delete(cb as () => void),
  });
  return make;
}

/** Two sessions on two docs, linked so every update reaches the other at once. */
function setup() {
  const server = sceneToDoc(scene(), { key: sequentialKeys("srv") });
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  for (const d of [docA, docB]) Y.applyUpdate(d, Y.encodeStateAsUpdate(server));
  for (const [from, to] of [
    [docA, docB],
    [docB, docA],
  ] as const) {
    from.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "net") Y.applyUpdate(to, u, "net");
    });
  }
  const awareness = sharedAwareness();
  const mk = (doc: Y.Doc, origin: SceneOrigin, id: number) =>
    createEditorSession({
      doc,
      origin,
      name: "s",
      registry,
      awareness: awareness(id),
      user: { id: (origin as { userId: string }).userId, name: String(id), color: "#f00" },
      issuesDebounceMs: 0,
    });
  const a = mk(docA, ada, 1);
  const b = mk(docB, bo, 2);
  const events: EditorSessionEvent[] = [];
  a.subscribe((e) => events.push(e));
  return { a, b, events };
}

describe("EditorSession on a shared doc", () => {
  it("starts with the document's hash, no undo, and edit mode", () => {
    const { a, b } = setup();
    expect(a.getHash()).toBe(b.getHash());
    expect(a.store.state).toMatchObject({
      sceneName: "s",
      hash: a.getHash(),
      canUndo: false,
      mode: "edit",
    });
  });

  it("dispatches into the doc; the other client sees it, with its actor in history", () => {
    const { a, b, events } = setup();
    const r = a.dispatch({ ops: [{ op: "move", refs: ["~solid:0"], by: [5, 0] }] });
    expect(r.ok).toBe(true);
    expect(solidOf(b.getDoc())[0]).toEqual(["box", 15, 10, 2, 2]);
    expect(text(a.getDoc())).toBe(text(b.getDoc()));
    expect(events.map((e) => e.source)).toEqual(["dispatch"]);
    expect(events[0]!.touched).toEqual(["~solid:0"]);
    const row = b.store.state.history.at(-1)!;
    expect(row).toMatchObject({ actor: ada, label: "Move ~solid:0" });
    expect(b.store.state.lastActor).toEqual(ada);
  });

  it("reports a remote change as one remote event with what it logged", () => {
    const { a, b, events } = setup();
    b.dispatch({ label: "Bo's edit", ops: [{ op: "remove", refs: ["b"] }] });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: "remote" });
    expect(events[0]!.logged.map((e) => e.label)).toEqual(["Bo's edit"]);
    expect(a.getDoc().entities!.map((e) => e.id)).toEqual(["a"]);
  });

  it("leaves everything alone when a batch fails", () => {
    const { a, events } = setup();
    const hash = a.getHash();
    const r = a.dispatch({ ops: [{ op: "remove", refs: ["missing"] }] });
    expect(r.ok).toBe(false);
    expect(a.getHash()).toBe(hash);
    expect(events).toEqual([]);
    expect(a.store.state.canUndo).toBe(false);
  });

  it("undoes only its own batches, restoring the selection, and redoes them", () => {
    const { a, b } = setup();
    a.select(["a"]);
    a.dispatch({ ops: [{ op: "remove", refs: ["a"] }] });
    expect(a.store.state.selection).toEqual([]);
    b.dispatch({ ops: [{ op: "move", refs: ["b"], by: [1, 1] }] });
    expect(a.store.state).toMatchObject({ canUndo: true, undoLabel: "Delete a" });

    expect(a.undo()).toBe(true);
    expect(
      a
        .getDoc()
        .entities!.map((e) => e.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(a.store.state.selection).toEqual(["a"]);
    expect(b.getDoc().entities!.find((e) => e.id === "b")!.at).toEqual([3, 3]);
    expect(a.undo()).toBe(false);

    expect(a.redo()).toBe(true);
    expect(a.getDoc().entities!.map((e) => e.id)).toEqual(["b"]);
    expect(b.store.state.canUndo).toBe(true);
  });

  it("keeps a bulk selection on the same entry when someone else's edit shifts it", () => {
    const { a, b } = setup();
    a.select(["~solid:1"]);
    b.dispatch({ ops: [{ op: "remove", refs: ["~solid:0"] }] });
    expect(a.store.state.selection).toEqual(["~solid:0"]);
    expect(a.keyOf("~solid:0")).toBe(b.keyOf("~solid:0"));
    b.dispatch({ ops: [{ op: "addBulk", key: "solid", shapes: [["box", 1, 1, 1, 1]], index: 0 }] });
    expect(a.store.state.selection).toEqual(["~solid:1"]);
  });

  it("follows renames in the selection, and takes an explicit selectionAfter", () => {
    const { a, b } = setup();
    a.select(["a"]);
    b.dispatch({ ops: [{ op: "rename", from: "a", to: "z" }] });
    expect(a.store.state.selection).toEqual(["z"]);
    a.dispatch(
      { ops: [{ op: "add", entity: { id: "c", type: "marker", at: [3, 3] } }] },
      { selectionAfter: ["c"] },
    );
    expect(a.store.state.selection).toEqual(["c"]);
  });

  it("reverts someone else's entry as its own batch, or reports an issue when it changed since", () => {
    const { a, b } = setup();
    b.dispatch({ label: "Bo moves b", ops: [{ op: "move", refs: ["b"], by: [10, 0] }] });
    const entry = a.store.state.history.at(-1)!;
    const ok = a.revert(entry.id);
    expect(ok.ok).toBe(true);
    expect(b.getDoc().entities!.find((e) => e.id === "b")!.at).toEqual([2, 2]);
    expect(a.store.state.history.at(-1)).toMatchObject({ actor: ada, kind: "revert" });
    expect(b.store.state.canUndo).toBe(true);
    expect(a.store.state.canUndo).toBe(true);

    b.dispatch({ label: "Bo moves b again", ops: [{ op: "move", refs: ["b"], by: [1, 0] }] });
    const second = a.store.state.history.at(-1)!;
    b.dispatch({ ops: [{ op: "move", refs: ["b"], by: [1, 0] }] });
    const refused = a.revert(second.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.issue.message).toMatch(/changed since/);
  });

  it("publishes selection and mode through awareness, and sees the other's", () => {
    const { a, b } = setup();
    a.select(["b"]);
    a.setCursor([4, 5]);
    a.setMode("play");
    const peer = b.store.state.peers.find((p) => p.user.id === "ada")!;
    expect(peer).toMatchObject({ selection: [a.keyOf("b")], cursor: [4, 5], mode: "play" });
    expect(b.refOf(peer.selection[0]!)).toBe("b");
  });

  it("validates the merged doc, reporting a dup-id rather than throwing", async () => {
    const { a, b } = setup();
    a.dispatch({ ops: [{ op: "add", entity: { id: "dup", type: "marker", at: [9, 9] } }] });
    // A second create with that id made before Bo heard of Ada's (Bo's own session would refuse it now).
    b.doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set(Z_FIELD, "zz");
      m.set("id", "dup");
      m.set("type", "marker");
      m.set("at", [8, 8]);
      b.doc.getMap("entities").set("remote-dup", m);
    }, "net-sim");
    await new Promise((r) => setTimeout(r, 5));
    expect(a.store.state.issues.some((i) => i.code === "dup-id")).toBe(true);
  });

  it("stops notifying after unsubscribe or destroy", () => {
    const { a, b } = setup();
    const seen: string[] = [];
    const off = a.subscribe((e) => seen.push(e.source));
    off();
    b.dispatch({ ops: [{ op: "remove", refs: ["b"] }] });
    expect(seen).toEqual([]);
    a.destroy();
    b.dispatch({ ops: [{ op: "remove", refs: ["a"] }] });
  });

  it("labels unlabeled batches", () => {
    expect(labelFor({ ops: [{ op: "remove", refs: ["a", "b"] }] })).toBe("Delete 2 entities");
    expect(labelFor({ ops: [{ op: "move", refs: ["a"], by: [1, 1] }] })).toBe("Move a");
    expect(labelFor({ label: "Mine", ops: [] })).toBe("Mine");
  });
});

describe("project history", () => {
  const layout: DocLayout = { as: "map", rest: { as: "atomic" } };
  const card = defineAssetKind({
    storage: "doc",
    kind: "card",
    title: "Card",
    description: "A card.",
    match: { suffixes: [".card.json"] },
    version: 1,
    schemaId: "urn:jams-engine:card:v1",
    schema: () => z.looseObject({ v: z.literal(1) }),
    layout,
    empty: () => ({ v: 1 }),
  });
  const kinds = createKindRegistry(null, [sceneKind, card]);

  async function project(origin = ada) {
    const host = memoryDocHost();
    const entry = (id: string, kind: string, path: string): AssetEntry => ({
      key: id,
      id,
      kind,
      path,
      created: { at: 0, by: "seed" },
    });
    seedProjectDoc(
      host.doc("project:p"),
      {
        meta: { projectId: "p", layout: 1, name: "P" },
        assets: { s: entry("s", "scene", "s.json"), post: entry("post", "card", "post.card.json") },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    sceneToDoc(scene(), { doc: host.doc("scene:p.s"), key: sequentialKeys("srv") });
    layoutToDoc(host.doc("asset:p.post"), layout, { v: 1, color: "grey" });
    const join = (who: SceneOrigin) =>
      createProjectSession({
        project: "p",
        openDoc: host.client().openDoc,
        origin: who,
        registry,
        kinds,
      });
    const p = await join(origin);
    await p.open("scene:p.s");
    const session = createEditorSession({
      doc: p.get("scene:p.s")!.doc,
      origin,
      name: "s",
      registry,
      history: projectHistory(p, "scene:p.s"),
    });
    return { host, p, session, join };
  }

  const both = (color: string): ProjectOpBatch => ({
    v: 1,
    label: `Paint ${color}`,
    ops: [
      { op: "editScene", id: "s", ops: [{ op: "move", refs: ["a"], by: [1, 0] }] },
      { op: "editAsset", id: "post", edits: [{ set: "/color", value: color }] },
    ],
  });

  it("starts with the project's undo state when its stack already holds a step", async () => {
    const { p, session } = await project();
    const r = await applyProjectBatch(
      p,
      {
        v: 1,
        label: "Paint post",
        ops: [{ op: "editAsset", id: "post", edits: [{ set: "/n", value: 2 }] }],
      },
      ada,
    );
    if (!r.ok) throw new Error(r.issue.message);
    session.destroy();
    const fresh = createEditorSession({
      doc: p.get("scene:p.s")!.doc,
      origin: ada,
      name: "s",
      registry,
      history: projectHistory(p, "scene:p.s"),
    });
    expect(fresh.store.state).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoLabel: "Paint post",
    });
    fresh.destroy();
    p.destroy();
  });

  it("shows the doc's log with the project entries that name it once, carrying their docs", async () => {
    const { p, session, join } = await project();
    session.dispatch({ ops: [{ op: "move", refs: ["b"], by: [1, 1] }] });
    const other = await join(bo);
    const r = await applyProjectBatch(other, both("red"), bo);
    if (!r.ok) throw new Error(r.issue.message);
    await applyProjectBatch(
      other,
      { v: 1, ops: [{ op: "editAsset", id: "post", edits: [{ set: "/n", value: 1 }] }] },
      bo,
    );

    const rows = session.store.state.history as HistoryRow[];
    expect(rows.map((row) => [row.label, row.project?.docs])).toEqual([
      ["Move b", undefined],
      ["Paint red", ["scene:p.s", "asset:p.post"]],
    ]);
    expect(rows[1]!.project!.entry).toBe(r.entry!.id);
    expect(session.store.state.undoLabel).toBe("Move b");
    other.destroy();
    p.destroy();
  });

  it("reverts a project entry as one new cross-doc batch, or names the doc that changed since", async () => {
    const { host, p, session, join } = await project();
    const other = await join(bo);
    const r = await applyProjectBatch(other, both("red"), bo);
    if (!r.ok) throw new Error(r.issue.message);
    await Promise.resolve();
    expect(p.get("asset:p.post"), "Revert's docs are held open").toBeDefined();

    const row = session.store.state.history.at(-1)!;
    const reverted = session.revert(row.id);
    expect(reverted.ok).toBe(true);
    expect(session.getDoc().entities![0]!.at).toEqual([1, 1]);
    expect(layoutFromDoc(host.doc("asset:p.post"), layout).color).toBe("grey");
    const entry = readProjectLog(host.doc("project:p")).at(-1)!;
    expect(entry).toMatchObject({ label: "Revert Paint red", actor: ada });
    expect(entry.docs.map((d) => d.doc)).toEqual(["scene:p.s", "asset:p.post"]);
    expect(readLog(host.doc("asset:p.post")).at(-1)).toMatchObject({ kind: "revert" });
    expect(session.store.state.undoLabel).toBe("Revert Paint red");

    expect(session.undo()).toBe(true);
    expect(layoutFromDoc(host.doc("asset:p.post"), layout).color).toBe("red");
    await applyProjectBatch(
      other,
      { v: 1, ops: [{ op: "editAsset", id: "post", edits: [{ set: "/color", value: "blue" }] }] },
      bo,
    );
    const refused = session.revert(row.id);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.issue.message).toMatch(/^asset:p\.post has changed/);
      expect(refused.issue.entityIds).toEqual(["asset:p.post"]);
    }
    expect(session.getDoc().entities![0]!.at).toEqual([2, 1]);
    other.destroy();
    p.destroy();
  });

  it("lists a project entry whose doc entry aged out as a row of its own", () => {
    const at = (n: number) => ({ id: `e${n}`, actor: ada, label: `L${n}`, at: n, keys: [] });
    const rows = historyRows(
      [at(1), at(5)],
      [
        { id: "p1", actor: bo, label: "Both", at: 3, docs: [{ doc: "scene:p.s", entry: "gone" }] },
        { id: "p2", actor: bo, label: "Other", at: 4, docs: [{ doc: "asset:p.x", entry: "x" }] },
        { id: "p3", actor: bo, label: "Mine", at: 5, docs: [{ doc: "scene:p.s", entry: "e5" }] },
      ],
      "scene:p.s",
    );
    expect(rows.map((r) => [r.id, r.project?.entry])).toEqual([
      ["e1", undefined],
      ["p1", "p1"],
      ["e5", "p3"],
    ]);
  });
});

describe("prefab commands across docs", () => {
  const kinds = createKindRegistry(null, [sceneKind, prefabKind]);
  const POST: Prefab = {
    kind: "prefab",
    v: 2,
    id: "post",
    entities: [{ id: "top", type: "marker", at: [0, -40] }],
    bulk: { solid: [["box", 0, 0, 6, 40]] },
  };
  const yard = (): SceneDefinition => ({
    v: 2,
    name: "yard",
    bounds: [0, 0, 2000, 1200],
    entities: [{ id: "lamp", type: "marker", at: [500, 500] }],
    instances: [
      { id: "post-1", prefab: "post", at: [100, 900], overrides: { "top.at": [0, -60] } },
      { id: "post-2", prefab: "post", at: [300, 900] },
    ],
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  async function world() {
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
          yard: entry("yard", "scene", "levels/yard.json"),
          post: entry("post", "prefab", "levels/prefabs/post.json"),
        },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    sceneToDoc(yard(), { doc: host.doc("scene:p.yard"), key: sequentialKeys("srv") });
    prefabToDoc(POST, { doc: host.doc("asset:p.post"), key: sequentialKeys("pre") });
    const p = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: ada,
      registry,
      kinds,
      key: sequentialKeys("new"),
    });
    const prefabs = sessionPrefabSource(p, { scene: "yard" });
    await prefabs.ready();
    await p.open("scene:p.yard");
    const session = createEditorSession({
      doc: p.get("scene:p.yard")!.doc,
      origin: ada,
      name: "yard",
      registry,
      prefabs,
      history: projectHistory(p, "scene:p.yard"),
    });
    const top = (instance: string) =>
      session.getResolved().entities!.find((e) => e.id === `${instance}/top`)!.at;
    return { host, p, prefabs, session, top };
  }

  it("refuses prefab commands in a session with no prefab writer", () => {
    const doc = sceneToDoc(yard(), { key: sequentialKeys("t") });
    const bare = createEditorSession({ doc, origin: ada, name: "yard", registry });
    const r = bare.dispatch(applyToPrefabBatch(bare.getDoc(), "post-1")!);
    expect(r.ok || [r.issue.code, r.issue.message]).toEqual([
      "op-invalid",
      expect.stringContaining("needs the project"),
    ]);
    bare.destroy();
  });

  it("Apply to prefab writes the scene and the prefab's doc, one transaction each, as one undo step", async () => {
    const { host, p, session, top } = await world();
    let sceneTx = 0;
    let prefabTx = 0;
    p.get("scene:p.yard")!.doc.on("afterTransaction", () => sceneTx++);
    p.get("asset:p.post")!.doc.on("afterTransaction", () => prefabTx++);
    const r = session.dispatch(applyToPrefabBatch(session.getDoc(), "post-1")!);
    expect(r.ok).toBe(true);
    expect([sceneTx, prefabTx]).toEqual([1, 1]);
    expect(docToPrefab(host.doc("asset:p.post")).entities[0]!.at).toEqual([0, -60]);
    expect(top("post-2")).toEqual([300, 840]);
    expect(session.getDoc().instances![0]!.overrides).toBeUndefined();
    const entry = readProjectLog(host.doc("project:p")).at(-1)!;
    expect(entry.docs.map((d) => d.doc)).toEqual(["scene:p.yard", "asset:p.post"]);

    expect(session.undo()).toBe(true);
    expect(docToPrefab(host.doc("asset:p.post")).entities[0]!.at).toEqual([0, -40]);
    expect(session.getDoc().instances![0]!.overrides).toEqual({ "top.at": [0, -60] });
    expect(top("post-2")).toEqual([300, 860]);
    expect(session.redo()).toBe(true);
    expect(top("post-2")).toEqual([300, 840]);
    p.destroy();
  });

  it("Create prefab adds a prefab asset beside the scene and seeds its doc; undo takes both back", async () => {
    const { host, p, prefabs, session } = await world();
    const batch = createPrefabBatch(session.getDoc(), ["lamp"], session.getPrefabs())!;
    const r = session.dispatch(batch);
    expect(r.ok).toBe(true);
    const created = Object.values(readProject(host.doc("project:p")).assets).find(
      (e) => e.id === "lamp",
    )!;
    expect(created).toMatchObject({
      key: "lamp",
      kind: "prefab",
      path: "levels/prefabs/lamp.json",
    });
    expect(session.getPrefabs().get("lamp")!.entities).toEqual([
      { id: "lamp", type: "marker", at: [0, 0] },
    ]);
    expect(session.getDoc().instances!.at(-1)).toEqual({
      id: "lamp-1",
      prefab: "lamp",
      at: [500, 500],
    });
    await flush();
    expect(docToPrefab(host.doc("asset:p.lamp")).entities).toEqual([
      { id: "lamp", type: "marker", at: [0, 0] },
    ]);
    expect(prefabs.library().get("lamp")).toBeDefined();

    expect(session.undo()).toBe(true);
    await flush();
    expect(readDoc(host.doc("scene:p.yard")).def.entities!.map((e) => e.id)).toEqual(["lamp"]);
    expect(
      Object.values(readProject(host.doc("project:p")).assets).some((e) => e.id === "lamp"),
    ).toBe(false);
    expect(session.getPrefabs().has("lamp")).toBe(false);
    p.destroy();
  });

  it("Unpack reads the prefab and writes the scene only", async () => {
    const { host, p, session } = await world();
    const before = Y.encodeStateVector(host.doc("asset:p.post"));
    const r = session.dispatch(unpackBatch(session.getDoc(), "post-2")!);
    expect(r.ok && r.docs).toEqual([]);
    expect(session.getDoc().instances!.map((i) => i.id)).toEqual(["post-1"]);
    expect(
      session
        .getDoc()
        .entities!.map((e) => e.id)
        .sort(),
    ).toEqual(["lamp", "top"]);
    expect(Y.encodeStateVector(host.doc("asset:p.post"))).toEqual(before);
    expect(session.undo()).toBe(true);
    expect(session.getDoc().instances!.map((i) => i.id)).toEqual(["post-1", "post-2"]);
    p.destroy();
  });

  it("applyProjectBatch writes editScene's prefab ops through the source's writer, as one step", async () => {
    const { host, p, session } = await world();
    const r = await applyProjectBatch(
      p,
      asProjectBatch("yard", applyToPrefabBatch(session.getDoc(), "post-1")!),
      ada,
    );
    expect(r.ok && r.docs).toEqual(["scene:p.yard", "asset:p.post"]);
    expect(docToPrefab(host.doc("asset:p.post")).entities[0]!.at).toEqual([0, -60]);
    expect(readProjectLog(host.doc("project:p"))).toHaveLength(1);
    expect(p.undo()?.docs).toEqual(["scene:p.yard", "asset:p.post"]);
    expect(docToPrefab(host.doc("asset:p.post")).entities[0]!.at).toEqual([0, -40]);

    const onPrefab = await applyProjectBatch(
      p,
      {
        v: 1,
        ops: [{ op: "editScene", id: "post", ops: [{ op: "move", refs: ["top"], by: [0, 5] }] }],
      },
      ada,
    );
    expect(onPrefab.ok && onPrefab.docs).toEqual(["asset:p.post"]);
    const refused = await applyProjectBatch(
      p,
      {
        v: 1,
        ops: [{ op: "editScene", id: "post", ops: [{ op: "setScene", set: { name: "x" } }] }],
      },
      ada,
    );
    expect(refused.ok || refused.issue.code).toBe("op-invalid");
    p.destroy();
  });
});

describe("a prefab doc's session", () => {
  const wrap: Prefab = {
    kind: "prefab",
    v: 3,
    id: "wrap",
    entities: [],
    bulk: { solid: [["box", 0, 0, 4, 4]] },
    instances: [{ id: "room-1", prefab: "room", at: [300, -50], rot: 1 }],
  };

  function mutableSource(start: PrefabLibrary) {
    let lib = start;
    const listeners = new Set<(changed: readonly string[]) => void>();
    const source: PrefabSource = {
      library: () => lib,
      subscribe: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      open: async () => null,
    };
    const set = (next: PrefabLibrary, changed: string[]) => {
      lib = next;
      for (const l of listeners) l(changed);
    };
    return { source, set };
  }

  const inside = (def: SceneDefinition, lib: PrefabLibrary) => {
    const [minX, minY, maxX, maxY] = def.bounds;
    return (resolveScene(def, engine, lib).entities ?? []).every((e) => {
      const at = e.at as [number, number] | undefined;
      return !at || (at[0] >= minX && at[0] <= maxX && at[1] >= minY && at[1] <= maxY);
    });
  };

  it("holds a nested instance's children, and every reader hashes it alike", () => {
    const lib = prefabLibrary([room, door, gate] as unknown as Prefab[]);
    const { source, set } = mutableSource(lib);
    const doc = prefabToDoc(wrap);
    const session = createEditorSession({
      doc,
      origin: ada,
      name: "wrap",
      registry: engine,
      prefabs: source,
      parentBounds: [0, 0, 20, 20],
      issuesDebounceMs: 0,
    });
    expect(inside(session.getDoc(), lib)).toBe(true);
    expect(session.store.state.issues.filter((i) => i.code === "out-of-bounds")).toEqual([]);
    const bare = readDoc(doc, { registry: engine, parentBounds: [0, 0, 20, 20] }).def;
    expect(session.getDoc().bounds).not.toEqual(bare.bounds);

    const far = structuredClone(room) as unknown as Prefab;
    far.entities[0]!.at = [0, -3000];
    const next = prefabLibrary([far, door, gate] as unknown as Prefab[]);
    const before = session.getHash();
    set(next, ["room"]);
    expect(session.getHash()).not.toBe(before);
    expect(session.getHash()).toBe(
      sceneHash(
        readDoc(doc, { registry: engine, parentBounds: [0, 0, 20, 20], prefabs: next }).def,
      ),
    );
    expect(inside(session.getDoc(), next)).toBe(true);

    const r = session.dispatch({
      base: session.getHash(),
      ops: [{ op: "move", refs: ["~solid:0"], by: [2, 0] }],
    });
    expect(r.ok || r.issue).toBe(true);
    session.destroy();
  });
});

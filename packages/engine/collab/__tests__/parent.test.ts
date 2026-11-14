import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { createRegistry } from "../../game/define";
import { formatScene } from "../../scene/format";
import { sceneHash } from "../../scene/hash";
import { applyOps } from "../../scene/ops";
import { sceneFrames } from "../../scene/resolve";
import type { OpBatch, SceneDefinition } from "../../scene/types";
import { applyOpsToDoc } from "../apply";
import { docToScene, entitiesMap, readDoc, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { readLog } from "../log";
import { revertEntry } from "../revert";
import { createSceneUndo } from "../undo";
import { ada, bo, keyOf, must, pair, sync } from "./helpers";

const engine = createRegistry();
const text = (doc: Y.Doc) => formatScene(docToScene(doc)).text;

/** A turned, mirrored node with a chain below it and two roots beside it. */
const tree = (): SceneDefinition => ({
  v: 4,
  name: "tree",
  bounds: [0, 0, 400, 400],
  entities: [
    { id: "pivot", type: "node", at: [100, 100], rot: 30, flip: true },
    { id: "arm", type: "node", at: [20, 0], rot: 90, parent: "pivot" },
    { id: "eye", type: "marker", at: [5, 7], parent: "arm", tags: ["look"] },
    { id: "crate", type: "solid", shape: ["box", 200, 200, 10, 10] },
    { id: "flag", type: "marker", at: [300, 50] },
  ],
});

const run = (doc: Y.Doc, batch: OpBatch) =>
  must(applyOpsToDoc(doc, batch, ada, engine, { validate: "none" }));

/** The record fields each entity key's `Y.Map` saw written during `fn`, as `key/field`. */
function writes(doc: Y.Doc, fn: () => void): string[] {
  const out: string[] = [];
  const observer = (events: Y.YEvent<Y.Map<unknown>>[]) => {
    for (const ev of events) {
      const path = ev.path.join("/");
      for (const k of ev.changes.keys.keys()) out.push(path ? `${path}/${k}` : k);
    }
  };
  entitiesMap(doc).observeDeep(observer);
  fn();
  entitiesMap(doc).unobserveDeep(observer);
  return out.sort();
}

describe("parent on the doc record", () => {
  it("is one atomic string field, read back as written", () => {
    const doc = sceneToDoc(tree(), { key: sequentialKeys() });
    const rec = entitiesMap(doc).get(keyOf(doc, "eye")!)!;
    expect(rec.get("parent")).toBe("arm");
    expect(text(doc)).toBe(formatScene(tree()).text);
  });

  it("concurrent reparents of one entity settle on one parent on every peer", () => {
    const [a, b] = pair(tree());
    entitiesMap(a).get(keyOf(a, "flag")!)!.set("parent", "pivot");
    entitiesMap(b).get(keyOf(b, "flag")!)!.set("parent", "crate");
    sync(a, b);
    expect(text(a)).toBe(text(b));
    const parent = docToScene(a).entities!.find((e) => e.id === "flag")!.parent;
    expect(["pivot", "crate"]).toContain(parent);
  });
});

describe("applyOpsToDoc with reparent", () => {
  const batches: [string, OpBatch][] = [
    ["into a turned, mirrored node", { ops: [{ op: "reparent", refs: ["flag"], parent: "arm" }] }],
    ["out to the root", { ops: [{ op: "reparent", refs: ["eye"], parent: null }] }],
    ["under a solid", { ops: [{ op: "reparent", refs: ["eye", "flag"], parent: "crate" }] }],
    ["a subtree under another root", { ops: [{ op: "reparent", refs: ["arm"], parent: "crate" }] }],
  ];

  for (const [label, batch] of batches)
    it(`writes what applyOps computes, as the changed records: ${label}`, () => {
      const doc = sceneToDoc(tree(), { key: sequentialKeys() });
      const before = docToScene(doc);
      const expected = applyOps(before, { ...batch, base: sceneHash(before) }, engine, {
        validate: "none",
      });
      if (!expected.ok) throw new Error(expected.issue.message);
      const r = run(doc, batch);
      expect(text(doc)).toBe(formatScene(expected.def).text);
      expect(r.hash).toBe(sceneHash(docToScene(doc)));

      const changed = (expected.def.entities ?? [])
        .filter((e) => {
          const was = before.entities!.find((x) => x.id === e.id);
          return JSON.stringify(was) !== JSON.stringify(e);
        })
        .map((e) => keyOf(doc, e.id)!);
      expect(r.keys.sort()).toEqual(changed.sort());
      expect(readLog(doc).at(-1)).toMatchObject({ ops: ["reparent"], keys: r.keys });
    });

  it("writes only parent and the geometry it re-expresses, so a concurrent edit to another field survives", () => {
    const [a, b] = pair(tree());
    const key = keyOf(a, "eye")!;
    const fields = writes(a, () =>
      run(a, { ops: [{ op: "reparent", refs: ["eye"], parent: null }] }),
    );
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) expect(["parent", "at"].map((k) => `${key}/${k}`)).toContain(f);
    run(b, { ops: [{ op: "update", ref: "eye", set: { tags: ["blink"] } }] });
    sync(a, b);
    expect(text(a)).toBe(text(b));
    const eye = docToScene(a).entities!.find((e) => e.id === "eye")!;
    expect(eye.parent).toBeUndefined();
    expect(eye.tags).toEqual(["blink"]);
  });

  it("refuses what applyOps refuses, writing nothing", () => {
    const doc = sceneToDoc(tree(), { key: sequentialKeys() });
    const vector = Y.encodeStateVector(doc);
    for (const ops of [
      [{ op: "reparent", refs: ["pivot"], parent: "eye" }],
      [{ op: "update", ref: "eye", set: { parent: "crate" } }],
    ] as const) {
      const r = applyOpsToDoc(doc, { ops: [...ops] as never }, ada, engine);
      expect(r.ok, JSON.stringify(ops)).toBe(false);
    }
    expect(Y.encodeStateVector(doc)).toEqual(vector);
  });

  it("removes a parent's whole subtree as removed records", () => {
    const doc = sceneToDoc(tree(), { key: sequentialKeys() });
    const keys = ["pivot", "arm", "eye"].map((id) => keyOf(doc, id)!);
    const r = run(doc, { ops: [{ op: "remove", refs: ["pivot"] }] });
    expect(r.keys.sort()).toEqual([...keys].sort());
    expect(readDoc(doc).def.entities!.map((e) => e.id)).toEqual(["crate", "flag"]);
  });

  it("rewrites every parent naming a renamed entity, on the children's records", () => {
    const doc = sceneToDoc(tree(), { key: sequentialKeys() });
    const pivot = keyOf(doc, "pivot")!;
    const arm = keyOf(doc, "arm")!;
    run(doc, { ops: [{ op: "rename", from: "pivot", to: "hub" }] });
    expect(keyOf(doc, "hub")).toBe(pivot);
    expect(entitiesMap(doc).get(arm)!.get("parent")).toBe("hub");
  });
});

describe("reverting a logged reparent", () => {
  it("puts the stored geometry back exactly, not a re-expression of the world pose", () => {
    const doc = sceneToDoc(tree(), { key: sequentialKeys() });
    const start = text(doc);
    run(doc, { ops: [{ op: "reparent", refs: ["eye", "flag"], parent: "arm" }] });
    run(doc, { ops: [{ op: "reparent", refs: ["eye", "flag"], parent: null }] });
    const middle = text(doc);
    expect(revertEntry(doc, readLog(doc).at(-1)!, bo).ok).toBe(true);
    expect(revertEntry(doc, readLog(doc).at(-3)!, bo).ok).toBe(true);
    expect(text(doc)).toBe(start);
    expect(middle).not.toBe(start);
  });

  it("refuses once another edit changed a reparented record since", () => {
    const doc = sceneToDoc(tree(), { key: sequentialKeys() });
    run(doc, { ops: [{ op: "reparent", refs: ["flag"], parent: "pivot" }] });
    const entry = readLog(doc).at(-1)!;
    run(doc, { ops: [{ op: "update", ref: "flag", set: { tags: ["moved"] } }] });
    const r = revertEntry(doc, entry, bo);
    expect(r.ok || r.issue.code).toBe("op-invalid");
  });

  it("undoes a reparent as one step, and redoes it", () => {
    const doc = sceneToDoc(tree(), { key: sequentialKeys() });
    const undo = createSceneUndo(doc, ada);
    const start = text(doc);
    run(doc, { ops: [{ op: "reparent", refs: ["arm"], parent: null }] });
    const moved = text(doc);
    undo.undo();
    expect(text(doc)).toBe(start);
    undo.redo();
    expect(text(doc)).toBe(moved);
    undo.destroy();
  });
});

describe("a merge that leaves a cycle or a missing parent", () => {
  it("reads leniently on every peer, writing nothing to repair it", () => {
    const [a, b] = pair(tree());
    entitiesMap(a).get(keyOf(a, "crate")!)!.set("parent", "flag");
    entitiesMap(b).get(keyOf(b, "flag")!)!.set("parent", "crate");
    run(b, { ops: [{ op: "remove", refs: ["pivot"] }] });
    entitiesMap(a).get(keyOf(a, "arm")!)!.set("parent", "pivot");
    sync(a, b);
    expect(text(a)).toBe(text(b));
    const def = docToScene(a);
    expect(def.entities!.find((e) => e.id === "crate")!.parent).toBe("flag");
    expect(def.entities!.find((e) => e.id === "flag")!.parent).toBe("crate");
    const frames = sceneFrames(def, engine);
    expect(frames.parentOf("crate")).toBe("flag");
    expect(frames.parentOf("flag")).toBeUndefined();
    expect(sceneHash(docToScene(b))).toBe(sceneHash(def));
  });

  it("takes a reparent to null as the fix, leaving the rest of the cycle alone", () => {
    const [a, b] = pair(tree());
    entitiesMap(a).get(keyOf(a, "crate")!)!.set("parent", "flag");
    entitiesMap(b).get(keyOf(b, "flag")!)!.set("parent", "crate");
    sync(a, b);
    run(a, { ops: [{ op: "reparent", refs: ["crate"], parent: null }] });
    sync(a, b);
    const def = docToScene(b);
    expect(def.entities!.find((e) => e.id === "crate")!.parent).toBeUndefined();
    expect(def.entities!.find((e) => e.id === "flag")!.parent).toBe("crate");
  });
});

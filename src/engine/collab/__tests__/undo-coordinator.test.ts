import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { appendLog, LOG_CAP, readLog } from "../log";
import { appendProjectLog, observeProjectLog, projectLogFor, readProjectLog } from "../project-log";
import type { DocOrigin } from "../types";
import { createUndoCoordinator } from "../undo-coordinator";
import { ada, agent, bo, link } from "./helpers";

const DOCS = ["project:p", "scene:p.yard", "prefab:p.gate"] as const;
type Name = (typeof DOCS)[number];

/** Each doc twice, one copy per client, kept in step live. */
function project() {
  const a = {} as Record<Name, Y.Doc>;
  const b = {} as Record<Name, Y.Doc>;
  const unlinks: (() => void)[] = [];
  for (const name of DOCS) {
    a[name] = new Y.Doc();
    b[name] = new Y.Doc();
    unlinks.push(link(a[name], b[name]));
  }
  return { a, b, unlink: () => unlinks.forEach((u) => u()) };
}

const set = (doc: Y.Doc, origin: unknown, field: string, value: unknown, map = "assets") =>
  doc.transact(() => doc.getMap(map).set(field, value), origin);

const get = (doc: Y.Doc, field: string, map = "assets") => doc.getMap(map).get(field);

function attached(docs: Record<Name, Y.Doc>, origin: DocOrigin, cap?: number) {
  const undo = createUndoCoordinator(origin, cap === undefined ? {} : { cap });
  for (const name of DOCS) undo.attach(name, docs[name]);
  return undo;
}

describe("undo coordinator", () => {
  it("undoes and redoes a step that wrote three docs as one, newest doc first", () => {
    const { a, b, unlink } = project();
    const undo = attached(a, ada);

    set(a["project:p"], ada, "crate", { id: "box" });
    set(a["scene:p.yard"], ada, "ref", "box", "entities");
    set(a["prefab:p.gate"], ada, "ref", "box", "entities");
    undo.commit({
      docs: ["project:p", "scene:p.yard", "prefab:p.gate"],
      label: "Rename crate",
      selection: { doc: "scene:p.yard", before: ["k1"], after: ["k2"] },
    });
    set(a["scene:p.yard"], ada, "other", 1, "entities");
    undo.commit({ docs: ["scene:p.yard"], label: "Move top" });

    expect(undo.undoLabel()).toBe("Move top");
    expect(undo.undo()).toEqual({ label: "Move top", docs: ["scene:p.yard"] });
    expect(undo.undoLabel()).toBe("Rename crate");

    const order: string[] = [];
    for (const name of DOCS)
      a[name].on("afterTransaction", (tr: Y.Transaction) => {
        if (tr.origin instanceof Y.UndoManager) order.push(name);
      });

    expect(undo.undo()).toEqual({
      label: "Rename crate",
      docs: ["project:p", "scene:p.yard", "prefab:p.gate"],
      selection: { doc: "scene:p.yard", before: ["k1"], after: ["k2"] },
    });
    expect(order).toEqual(["prefab:p.gate", "scene:p.yard", "project:p"]);
    for (const doc of [a, b]) {
      expect(get(doc["project:p"], "crate")).toBeUndefined();
      expect(get(doc["scene:p.yard"], "ref", "entities")).toBeUndefined();
      expect(get(doc["prefab:p.gate"], "ref", "entities")).toBeUndefined();
    }
    expect(undo.canUndo()).toBe(false);
    expect(undo.redoLabel()).toBe("Rename crate");

    order.length = 0;
    expect(undo.redo()?.docs).toEqual(["project:p", "scene:p.yard", "prefab:p.gate"]);
    expect(order).toEqual(["project:p", "scene:p.yard", "prefab:p.gate"]);
    for (const doc of [a, b]) {
      expect(get(doc["project:p"], "crate")).toEqual({ id: "box" });
      expect(get(doc["scene:p.yard"], "ref", "entities")).toBe("box");
      expect(get(doc["prefab:p.gate"], "ref", "entities")).toBe("box");
      expect(get(doc["scene:p.yard"], "other", "entities")).toBeUndefined();
    }
    expect(undo.redoLabel()).toBe("Move top");
    unlink();
  });

  it("leaves another origin's edits alone, a peer's, an agent's and an equal-looking origin's", () => {
    const { a, b, unlink } = project();
    const undo = attached(a, ada);

    set(a["project:p"], ada, "mine", 1);
    set(a["scene:p.yard"], ada, "mine", 1, "entities");
    undo.commit({ docs: ["project:p", "scene:p.yard"], label: "Mine" });
    set(b["scene:p.yard"], bo, "theirs", 2, "entities");
    set(a["project:p"], agent, "agent", 3);
    set(a["prefab:p.gate"], { ...ada }, "lookalike", 4, "entities");
    undo.commit({ docs: ["project:p", "prefab:p.gate"], label: "Not mine" });

    expect(undo.undoLabel()).toBe("Mine");
    expect(undo.undo()?.label).toBe("Mine");
    for (const doc of [a, b]) {
      expect(get(doc["project:p"], "mine")).toBeUndefined();
      expect(get(doc["scene:p.yard"], "mine", "entities")).toBeUndefined();
      expect(get(doc["scene:p.yard"], "theirs", "entities")).toBe(2);
      expect(get(doc["project:p"], "agent")).toBe(3);
      expect(get(doc["prefab:p.gate"], "lookalike", "entities")).toBe(4);
    }
    expect(undo.canUndo()).toBe(false);
    unlink();
  });

  it("keeps the newest `cap` steps", () => {
    const { a, unlink } = project();
    const undo = attached(a, ada, 3);
    for (let i = 0; i < 5; i++) {
      const name = DOCS[i % DOCS.length]!;
      set(a[name], ada, `s${i}`, i);
      undo.commit({ docs: [name], label: `Step ${i}` });
    }
    const undone: string[] = [];
    while (undo.canUndo()) undone.push(undo.undo()!.label);
    expect(undone).toEqual(["Step 4", "Step 3", "Step 2"]);
    expect(get(a["project:p"], "s0")).toBe(0);
    expect(get(a["scene:p.yard"], "s1")).toBe(1);
    expect(get(a["prefab:p.gate"], "s2")).toBeUndefined();
    expect(get(a["project:p"], "s3")).toBeUndefined();
    expect(undo.undo()).toBeNull();
    unlink();
  });

  it("defaults the cap to 100", () => {
    const { a, unlink } = project();
    const undo = attached(a, ada);
    for (let i = 0; i < 101; i++) {
      set(a["project:p"], ada, "n", i);
      undo.commit({ docs: ["project:p"], label: `Set ${i}` });
    }
    let steps = 0;
    while (undo.undo()) steps++;
    expect(steps).toBe(100);
    expect(get(a["project:p"], "n")).toBe(0);
    unlink();
  });

  it("pins the docs with steps on either stack, until the steps go", () => {
    const { a, unlink } = project();
    const undo = attached(a, ada);
    expect(undo.pinned()).toEqual([]);

    set(a["scene:p.yard"], ada, "x", 1, "entities");
    undo.commit({ docs: ["scene:p.yard"], label: "One" });
    set(a["prefab:p.gate"], ada, "x", 1, "entities");
    set(a["project:p"], ada, "x", 1);
    undo.commit({ docs: ["prefab:p.gate", "project:p"], label: "Two" });
    expect(undo.pinned()).toEqual(["project:p", "scene:p.yard", "prefab:p.gate"]);

    undo.undo();
    expect(undo.pinned()).toEqual(["project:p", "scene:p.yard", "prefab:p.gate"]);
    set(a["scene:p.yard"], ada, "y", 2, "entities");
    undo.commit({ docs: ["scene:p.yard"], label: "Three" });
    expect(undo.canRedo()).toBe(false);
    expect(undo.pinned()).toEqual(["scene:p.yard"]);

    undo.detach("scene:p.yard");
    expect(undo.pinned()).toEqual([]);
    expect(undo.canUndo()).toBe(false);
    unlink();
  });

  it("an undo never reaches past its step when a peer overwrote part of it", () => {
    const { a, b, unlink } = project();
    const undo = attached(a, ada);

    set(a["scene:p.yard"], ada, "older", 1, "entities");
    undo.commit({ docs: ["scene:p.yard"], label: "Older" });
    set(a["scene:p.yard"], ada, "x", 1, "entities");
    set(a["project:p"], ada, "x", 1);
    undo.commit({ docs: ["scene:p.yard", "project:p"], label: "Both" });
    set(b["scene:p.yard"], bo, "x", 9, "entities");

    expect(undo.undo()).toEqual({ label: "Both", docs: ["project:p"] });
    expect(get(a["scene:p.yard"], "x", "entities")).toBe(9);
    expect(get(a["scene:p.yard"], "older", "entities")).toBe(1);
    expect(get(a["project:p"], "x")).toBeUndefined();
    expect(undo.undoLabel()).toBe("Older");

    expect(undo.redo()).toEqual({ label: "Both", docs: ["project:p"] });
    expect(get(a["project:p"], "x")).toBe(1);
    unlink();
  });

  it("tracks a map first written inside a step, and never undoes the log", () => {
    const { a, unlink } = project();
    const undo = attached(a, ada);
    const doc = a["scene:p.yard"];

    doc.transact(() => {
      doc.getMap("groups").set("g1", { at: [0, 0] });
      appendLog(doc, { actor: ada, label: "Group", keys: ["@group:g1"] });
    }, ada);
    undo.commit({ docs: ["scene:p.yard"], label: "Group" });
    undo.undo();
    expect(doc.getMap("groups").has("g1")).toBe(false);
    expect(readLog(doc).map((e) => e.label)).toEqual(["Group"]);
    unlink();
  });

  it("commits nothing for a step that wrote nothing, and folds uncommitted writes into a step of their own", () => {
    const { a, unlink } = project();
    const undo = attached(a, ada);
    undo.commit({ docs: ["project:p"], label: "Nothing" });
    expect(undo.canUndo()).toBe(false);

    set(a["project:p"], ada, "x", 1);
    undo.commit({ docs: ["project:p"], label: "One" });
    set(a["prefab:p.gate"], ada, "x", 1, "entities");
    expect(undo.undo()?.docs).toEqual(["prefab:p.gate"]);
    expect(get(a["prefab:p.gate"], "x", "entities")).toBeUndefined();
    expect(get(a["project:p"], "x")).toBe(1);
    expect(undo.undoLabel()).toBe("One");
    unlink();
  });

  it("refuses a name or a doc attached twice, and lets go of a destroyed doc", () => {
    const { a, unlink } = project();
    const undo = attached(a, ada);
    undo.attach("project:p", a["project:p"]);
    expect(() => undo.attach("project:p", new Y.Doc())).toThrow(/already attached/);
    expect(() => undo.attach("scene:p.other", a["project:p"])).toThrow(/already attached/);

    set(a["prefab:p.gate"], ada, "x", 1, "entities");
    undo.commit({ docs: ["prefab:p.gate"], label: "Gate" });
    a["prefab:p.gate"].destroy();
    expect(undo.pinned()).toEqual([]);
    expect(undo.undo()).toBeNull();

    undo.destroy();
    set(a["project:p"], ada, "y", 1);
    undo.commit({ docs: ["project:p"], label: "After" });
    expect(undo.canUndo()).toBe(false);
    unlink();
  });
});

describe("project log", () => {
  it("appends cross-doc entries with the batch's origin, capped like a doc's log", () => {
    const doc = new Y.Doc();
    const lengths: number[] = [];
    const off = observeProjectLog(doc, (entries) => lengths.push(entries.length));
    const origins: unknown[] = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => origins.push(tr.origin));

    const first = doc.transact(
      () =>
        appendProjectLog(doc, {
          actor: ada,
          label: "Rename crate",
          at: 5,
          docs: [
            { doc: "scene:p.yard", entry: "e1" },
            { doc: "prefab:p.gate", entry: "e2" },
          ],
        }),
      ada,
    );
    expect(first).toMatchObject({ label: "Rename crate", at: 5 });
    expect(first.id).toMatch(/^[0-9a-z]{12}$/);
    expect(origins).toEqual([ada]);
    off();

    for (let i = 0; i < LOG_CAP + 4; i++)
      appendProjectLog(doc, {
        actor: bo,
        label: `Batch ${i}`,
        docs: [{ doc: "project:p", entry: `b${i}` }],
      });
    const log = readProjectLog(doc);
    expect(log).toHaveLength(LOG_CAP);
    expect(log[0]!.label).toBe("Batch 4");
    expect(lengths).toEqual([1]);
  });

  it("finds the entries that wrote a doc", () => {
    const doc = new Y.Doc();
    const one = appendProjectLog(doc, {
      actor: ada,
      label: "One",
      docs: [
        { doc: "scene:p.yard", entry: "e1" },
        { doc: "project:p", entry: "e2" },
      ],
    });
    appendProjectLog(doc, { actor: ada, label: "Two", docs: [{ doc: "project:p", entry: "e3" }] });
    expect(projectLogFor(readProjectLog(doc), "scene:p.yard")).toEqual([one]);
    expect(projectLogFor(readProjectLog(doc), "project:p").map((e) => e.label)).toEqual([
      "One",
      "Two",
    ]);
  });
});

import { describe, expect, it } from "vite-plus/test";

import { formatScene } from "../../scene/format";
import type {
  ApplyResult,
  OpBatch,
  SceneChange,
  SceneDefinition,
  SceneOp,
} from "../../scene/types";
import { createEditorSession } from "../index";
import { createSessionWith, type ApplyFn, type EditorSessionEvent } from "../session";

function doc(): SceneDefinition {
  return {
    v: 1,
    name: "s",
    bounds: [0, 0, 100, 100],
    spawn: [[1, 1]],
    solid: [["box", 10, 10, 2, 2]],
    entities: [
      { id: "a", b: "anchor", at: [1, 1] },
      { id: "b", b: "anchor", at: [2, 2] },
    ],
  };
}

/**
 * A stand-in for applyOps over a handful of ops, so the session is tested
 * without the scene module. The "hash" is the document's JSON.
 */
function fakeApply(log: OpBatch[]): ApplyFn {
  return (def, batch): ApplyResult => {
    log.push(batch);
    const next = JSON.parse(JSON.stringify(def)) as SceneDefinition;
    const ents = next.entities!;
    const inverse: SceneOp[] = [];
    const touched: string[] = [];
    const diff: SceneChange[] = [];
    const remap: Record<string, string | null> = {};
    const fail = (i: number, message: string): ApplyResult => ({
      ok: false,
      hash: JSON.stringify(def),
      failedAt: i,
      issue: { severity: "error", code: "ref-not-found", message, entityIds: [] },
    });
    for (const [i, op] of batch.ops.entries()) {
      if (op.op === "setScene") {
        inverse.unshift({ op: "setScene", set: { name: next.name } });
        next.name = op.set.name!;
      } else if (op.op === "remove") {
        for (const ref of op.refs) {
          const at = ents.findIndex((e) => e.id === ref);
          if (at < 0) return fail(i, `no ${ref}`);
          inverse.unshift({ op: "add", entity: ents[at]! as never, index: at });
          ents.splice(at, 1);
          remap[ref] = null;
        }
      } else if (op.op === "add") {
        const entity = {
          ...op.entity,
          id: op.entity.id ?? `n-${ents.length}`,
        } as never as (typeof ents)[number];
        ents.splice(op.index ?? ents.length, 0, entity);
        inverse.unshift({ op: "remove", refs: [entity.id] });
        touched.push(entity.id);
      } else if (op.op === "rename") {
        ents.find((e) => e.id === op.from)!.id = op.to;
        inverse.unshift({ op: "rename", from: op.to, to: op.from });
        diff.push({ kind: "renamed", from: op.from, to: op.to });
        remap[op.from] = op.to;
      } else if (op.op === "move") {
        for (const ref of op.refs) {
          const box = next.solid![Number(ref.split(":")[1])]!;
          box[1] = (box[1] as number) + op.by[0];
          touched.push(ref);
        }
        inverse.unshift({ op: "move", refs: op.refs, by: [-op.by[0], -op.by[1]] });
      }
    }
    const errors =
      next.name === "broken"
        ? [
            {
              severity: "error" as const,
              code: "schema" as const,
              message: "broken",
              entityIds: [],
            },
          ]
        : [];
    return {
      ok: true,
      def: next,
      hash: JSON.stringify(next),
      inverse: { ops: inverse },
      touched,
      created: [],
      remap,
      diff,
      issues: errors,
    };
  };
}

function setup(now = () => 1000) {
  const log: OpBatch[] = [];
  const session = createSessionWith({ doc: doc(), name: "s", apply: fakeApply(log), now });
  const events: EditorSessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  return { session, log, events };
}

describe("EditorSession", () => {
  it("starts clean with the document's hash and issues", () => {
    const { session } = setup();
    expect(session.store.state).toMatchObject({
      sceneName: "s",
      hash: session.getHash(),
      dirty: false,
      canUndo: false,
      mode: "edit",
    });
  });

  it("dispatches, records history and notifies", () => {
    const { session, events } = setup();
    const result = session.dispatch(
      { label: "Rename", ops: [{ op: "setScene", set: { name: "broken" } }] },
      { actor: "agent" },
    );
    expect(result.ok).toBe(true);
    expect(session.getDoc().name).toBe("broken");
    expect(session.store.state).toMatchObject({
      dirty: true,
      canUndo: true,
      undoLabel: "Rename",
      lastActor: "agent",
    });
    expect(session.store.state.issues.map((i) => i.code)).toEqual(["schema"]);
    expect(session.history.entries()[0]).toMatchObject({ actor: "agent", label: "Rename" });
    expect(events.map((e) => e.source)).toEqual(["dispatch"]);
  });

  it("defaults the actor to human and labels unlabeled batches", () => {
    const { session } = setup();
    session.dispatch({ ops: [{ op: "remove", refs: ["a"] }] });
    expect(session.history.entries()[0]).toMatchObject({ actor: "human", label: "Delete a" });
  });

  it("leaves everything alone when apply fails", () => {
    const { session, events } = setup();
    const before = session.getDoc();
    const result = session.dispatch({ ops: [{ op: "remove", refs: ["missing"] }] });
    expect(result.ok).toBe(false);
    expect(session.getDoc()).toBe(before);
    expect(session.store.state.canUndo).toBe(false);
    expect(events).toEqual([]);
  });

  it("prunes removed refs from the selection, and undo restores both", () => {
    const { session, events } = setup();
    session.select(["a", "b"]);
    session.dispatch({ ops: [{ op: "remove", refs: ["a"] }] });
    expect(session.store.state.selection).toEqual(["b"]);

    session.undo();
    expect(session.getDoc().entities!.map((e) => e.id)).toEqual(["a", "b"]);
    expect(session.store.state.selection).toEqual(["a", "b"]);
    expect(session.store.state).toMatchObject({
      canUndo: false,
      canRedo: true,
      redoLabel: "Delete a",
    });

    session.redo();
    expect(session.getDoc().entities!.map((e) => e.id)).toEqual(["b"]);
    expect(session.store.state.selection).toEqual(["b"]);
    expect(events.map((e) => e.source)).toEqual(["dispatch", "undo", "redo"]);
  });

  it("follows renames in the selection", () => {
    const { session } = setup();
    session.select(["a"]);
    session.dispatch({ ops: [{ op: "rename", from: "a", to: "z" }] });
    expect(session.store.state.selection).toEqual(["z"]);
  });

  it("takes an explicit selectionAfter", () => {
    const { session } = setup();
    session.dispatch(
      { ops: [{ op: "add", entity: { id: "c", b: "anchor", at: [0, 0] } }] },
      { selectionAfter: ["c"] },
    );
    expect(session.store.state.selection).toEqual(["c"]);
    session.undo();
    expect(session.store.state.selection).toEqual([]);
  });

  it("fills in base for ~ batches, and recomputes it on undo and redo", () => {
    const { session, log } = setup();
    session.dispatch({ ops: [{ op: "move", refs: ["~solid:0"], by: [5, 0] }] });
    const forwardBase = log.at(-1)!.base;
    expect(forwardBase).toBe(JSON.stringify(doc()));

    session.undo();
    expect(log.at(-1)!.base).toBe(JSON.stringify({ ...doc(), solid: [["box", 15, 10, 2, 2]] }));
    session.redo();
    expect(log.at(-1)!.base).toBe(forwardBase);
  });

  it("tracks saving: clean at the marker, dirty after an edit, savedAt from now", () => {
    let t = 1000;
    const { session } = setup(() => t);
    session.dispatch({ ops: [{ op: "setScene", set: { name: "x" } }] });
    t = 5000;
    session.markSaved();
    expect(session.store.state).toMatchObject({ dirty: false, savedAt: 5000 });
    session.undo();
    expect(session.store.state.dirty).toBe(true);
    session.redo();
    expect(session.store.state.dirty).toBe(false);
  });

  it("selects with modes", () => {
    const { session } = setup();
    session.select(["a"]);
    session.select(["b"], "toggle");
    expect(session.store.state.selection).toEqual(["a", "b"]);
    session.select(["a"], "toggle");
    expect(session.store.state.selection).toEqual(["b"]);
  });

  it("replaces the document from outside and clears history", () => {
    const { session, events } = setup();
    session.select(["a"]);
    session.dispatch({ ops: [{ op: "setScene", set: { name: "x" } }] });
    session.replaceDoc({ ...doc(), entities: [{ id: "b", b: "anchor", at: [2, 2] }] });
    expect(session.store.state).toMatchObject({ canUndo: false, dirty: false, selection: [] });
    expect(events.at(-1)!.source).toBe("replace");
  });

  it("sets the mode, and stops notifying after unsubscribe or destroy", () => {
    const { session, events } = setup();
    session.setMode("play");
    expect(session.store.state.mode).toBe("play");
    const extra: EditorSessionEvent[] = [];
    const off = session.subscribe((e) => extra.push(e));
    off();
    session.destroy();
    session.dispatch({ ops: [{ op: "setScene", set: { name: "x" } }] });
    expect(extra).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe("createEditorSession with applyOps", () => {
  it("undoes and redoes real ops byte for byte", () => {
    const start = doc();
    const session = createEditorSession({ doc: start, name: "s" });
    session.dispatch({ ops: [{ op: "move", refs: ["~solid:0", "a"], by: [3, 4] }] });
    session.dispatch({
      ops: [
        { op: "remove", refs: ["b"] },
        { op: "addBulk", key: "cloud", shapes: [["box", 5, 5, 4, 2]] },
      ],
    });
    const edited = formatScene(session.getDoc()).text;

    session.undo();
    session.undo();
    expect(formatScene(session.getDoc()).text).toBe(formatScene(start).text);
    session.redo();
    session.redo();
    expect(formatScene(session.getDoc()).text).toBe(edited);
  });

  it("keeps a bulk selection on the same entry when earlier ones shift", () => {
    const start: SceneDefinition = {
      ...doc(),
      solid: [
        ["box", 10, 10, 2, 2],
        ["box", 20, 10, 2, 2],
        ["box", 30, 10, 2, 2],
      ],
    };
    const session = createEditorSession({ doc: start, name: "s" });
    session.select(["~solid:1", "~solid:2"]);
    session.dispatch({ ops: [{ op: "remove", refs: ["~solid:1"] }] });
    expect(session.store.state.selection).toEqual(["~solid:1"]);
    expect(session.getDoc().solid![1]).toEqual(["box", 30, 10, 2, 2]);

    session.dispatch({ ops: [{ op: "promote", ref: "~solid:1", id: "wall" }] });
    expect(session.store.state.selection).toEqual(["wall"]);

    session.dispatch({ ops: [{ op: "demote", id: "wall" }] });
    expect(session.store.state.selection).toEqual(["~solid:1"]);

    session.select(["~solid:0"]);
    session.dispatch({
      ops: [{ op: "addBulk", key: "solid", index: 0, shapes: [["box", 0, 0, 1, 1]] }],
    });
    expect(session.store.state.selection).toEqual(["~solid:1"]);
    expect(session.getDoc().solid![1]).toEqual(["box", 10, 10, 2, 2]);
  });
});

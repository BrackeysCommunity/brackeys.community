import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import type { AwarenessLike, SceneOrigin } from "../../collab/types";
import { createRegistry } from "../../game/define";
import { formatScene } from "../../scene/format";
import type { SceneDefinition, ShapeTuple } from "../../scene/types";
import { createEditorSession, labelFor, type EditorSessionEvent } from "../session";

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
      m.set("z", "zz");
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

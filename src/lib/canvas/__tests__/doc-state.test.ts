import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  docFromState,
  mergeStates,
  missingFrom,
  replaceText,
  restoreCanvasInto,
  stateVectorOf,
} from "../doc-state";
import { applyJsonCanvas, canvasNodes, docToJsonCanvas } from "../json-canvas";

const card = (id: string, text: string, x = 0) => ({
  id,
  type: "text",
  text,
  x,
  y: 0,
  width: 100,
  height: 50,
});

function canvasDoc(nodes: ReturnType<typeof card>[], edges: object[] = []): Y.Doc {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, { nodes, edges }, { mode: "whole" });
  return doc;
}

describe("mergeStates", () => {
  it("keeps both tabs' work, whichever order they arrive in", () => {
    const base = canvasDoc([card("a", "base")]);
    const stored = Y.encodeStateAsUpdate(base);

    const tab1 = docFromState(stored);
    const tab2 = docFromState(stored);
    applyJsonCanvas(tab1, { nodes: [card("t1", "one")] });
    applyJsonCanvas(tab2, { nodes: [card("t2", "two")] });

    const merged = mergeStates(
      mergeStates(stored, Y.encodeStateAsUpdate(tab2)),
      Y.encodeStateAsUpdate(tab1),
    );
    const texts = docToJsonCanvas(docFromState(merged)).nodes.map((n) => n.text);
    expect(texts.sort((a, b) => a!.localeCompare(b!))).toEqual(["base", "one", "two"]);
  });

  it("discards deleted content instead of growing forever", () => {
    const doc = new Y.Doc();
    let state = Y.encodeStateAsUpdate(doc);
    for (let i = 0; i < 50; i++) {
      applyJsonCanvas(doc, { nodes: [card(`n${i}`, "x".repeat(2_000))] });
      canvasNodes(doc).clear();
      state = mergeStates(state, Y.encodeStateAsUpdate(doc));
    }
    expect(state.length).toBeLessThan(10_000);
  });
});

describe("missingFrom", () => {
  it("returns only what the other side lacks", () => {
    const server = canvasDoc([card("a", "one")]);
    const client = docFromState(Y.encodeStateAsUpdate(server));
    applyJsonCanvas(server, { nodes: [card("b", "two")] });

    const serverState = Y.encodeStateAsUpdate(server);
    const diff = missingFrom(serverState, Y.encodeStateVector(client));
    expect(diff.length).toBeLessThan(serverState.length);
    Y.applyUpdate(client, diff);
    expect(canvasNodes(client).size).toBe(2);
    expect(stateVectorOf(serverState)).toEqual(Y.encodeStateVector(client));
  });
});

describe("replaceText", () => {
  it("edits only the span that changed, so a concurrent edit elsewhere survives", () => {
    const a = new Y.Doc();
    a.getText("t").insert(0, "hello brave world");
    const b = docFromState(Y.encodeStateAsUpdate(a));

    replaceText(a.getText("t"), "hello bold world");
    b.getText("t").insert(b.getText("t").length, "!");

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(a.getText("t").toJSON()).toBe("hello bold world!");
    expect(b.getText("t").toJSON()).toBe("hello bold world!");
  });
});

describe("restoreCanvasInto", () => {
  it("makes the live doc match the version, as an edit other clients merge", () => {
    const version = canvasDoc(
      [card("a", "original", 0), card("b", "kept")],
      [{ id: "e", fromNode: "a", toNode: "b" }],
    );
    const live = docFromState(Y.encodeStateAsUpdate(version));
    const other = docFromState(Y.encodeStateAsUpdate(version));

    // Since the version: a edited and moved, b deleted, c added.
    const a = canvasNodes(live).get("a")!;
    replaceText(a.get("text") as Y.Text, "changed");
    a.set("x", 500);
    canvasNodes(live).delete("b");
    applyJsonCanvas(live, { nodes: [card("c", "new")] });
    Y.applyUpdate(other, Y.encodeStateAsUpdate(live));

    const before = Y.encodeStateVector(live);
    restoreCanvasInto(live, version, "restore");
    expect(docToJsonCanvas(live)).toEqual(docToJsonCanvas(version));

    // Another client that only receives the restore as an update converges.
    Y.applyUpdate(other, Y.encodeStateAsUpdate(live, before));
    expect(docToJsonCanvas(other)).toEqual(docToJsonCanvas(version));
  });
});

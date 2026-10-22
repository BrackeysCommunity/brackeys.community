/**
 * An import is one ⌘Z. `captureImport` takes the import's own structs as
 * that step even when canvas-sync's whole-row apply delivers it in one
 * transaction with other content (another member's import, a delete, a
 * restore), and `asOneUndoStep` keeps a chunked apply together.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  applyJsonCanvas,
  canvasEdges,
  canvasNodes,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";

import { asOneUndoStep, buildImport, captureImport, type FinalCanvas } from "../import-flow";

const PROVIDER = "provider";
const LOCAL = "local";

const cards = (prefix: string, n: number): JsonCanvas => ({
  nodes: Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    type: "text",
    text: `${prefix} ${i}`,
    x: i * 10,
    y: 0,
    width: 10,
    height: 10,
  })),
  edges: [],
});

const final = (canvas: JsonCanvas) => ({ canvas, docFields: {} }) as unknown as FinalCanvas;

/** canvas-sync's live doc, this tab and a peer's, all holding `existing` cards this tab made. */
function setup(existing = 2) {
  const live = new Y.Doc();
  const a = new Y.Doc();
  const peer = new Y.Doc();
  const undo = new Y.UndoManager([canvasNodes(a), canvasEdges(a)], {
    trackedOrigins: new Set([LOCAL]),
  });
  a.transact(() => applyJsonCanvas(a, cards("mine", existing), { mode: "whole" }), LOCAL);
  undo.stopCapturing();
  const state = Y.encodeStateAsUpdate(a);
  Y.applyUpdate(live, state, PROVIDER);
  Y.applyUpdate(peer, state, PROVIDER);
  return { live, a, peer, undo };
}

/** canvas-sync storing several things, then broadcasting them as one update. */
function broadcastTogether(live: Y.Doc, tab: Y.Doc, updates: Uint8Array[]) {
  const before = Y.encodeStateVector(live);
  Y.applyUpdate(live, Y.mergeUpdates(updates), "server-apply");
  Y.applyUpdate(tab, Y.encodeStateAsUpdate(live, before), PROVIDER);
}

const textOf = (doc: Y.Doc, id: string) => {
  const node = canvasNodes(doc).get(id) as Y.Map<unknown> | undefined;
  const text: unknown = node?.get("text");
  return text instanceof Y.Text ? text.toJSON() : (text as string);
};
/** Cards by their text, since fragment imports give them fresh ids. */
const ids = (doc: Y.Doc) => [...canvasNodes(doc).keys()].map((id) => textOf(doc, id)).sort();

describe("captureImport makes ⌘Z take back the import and nothing else", () => {
  it("undoes only this import when the broadcast carries just it", () => {
    const { live, a, undo } = setup(1);
    const importA = buildImport(a, [final(cards("ia", 3))], { x: 0, y: 100 });
    const release = captureImport(a, undo, importA);
    broadcastTogether(live, a, [importA.update]);
    Y.applyUpdate(a, importA.update, PROVIDER);
    release();
    undo.undo();
    expect(canvasNodes(a).size).toBe(1);
  });

  it("leaves another member's import broadcast in the same transaction", () => {
    const { live, a, peer, undo } = setup(1);
    const importA = buildImport(a, [final(cards("ia", 3))], { x: 0, y: 100 });
    const importB = buildImport(peer, [final(cards("ib", 4))], { x: 0, y: 200 });
    const release = captureImport(a, undo, importA);
    broadcastTogether(live, a, [importA.update, importB.update]);
    // The reply lands after: already held, so nothing more happens.
    Y.applyUpdate(a, importA.update, PROVIDER);
    release();

    expect(canvasNodes(a).size).toBe(8);
    undo.undo();
    expect(canvasNodes(a).size).toBe(5);
    undo.redo();
    expect(canvasNodes(a).size).toBe(8);
  });

  it("leaves another member's import applied in its own transaction", () => {
    const { live, a, peer, undo } = setup(1);
    const importA = buildImport(a, [final(cards("ia", 3))], { x: 0, y: 100 });
    const importB = buildImport(peer, [final(cards("ib", 4))], { x: 0, y: 200 });
    const release = captureImport(a, undo, importA);
    for (const update of [importB.update, importA.update]) broadcastTogether(live, a, [update]);
    release();
    undo.undo();
    expect(canvasNodes(a).size).toBe(5);
  });

  it("does not capture another member's import that arrives alone while this one is pending", () => {
    const { live, a, peer, undo } = setup(1);
    const mine = buildImport(a, [final(cards("imp", 2))], { x: 0, y: 100 });
    const theirs = buildImport(peer, [final(cards("their", 3))], { x: 0, y: 300 });
    const release = captureImport(a, undo, mine);
    const steps = undo.undoStack.length;
    broadcastTogether(live, a, [theirs.update]);
    expect(undo.undoStack.length).toBe(steps);
    broadcastTogether(live, a, [mine.update]);
    release();
    expect(undo.undoStack.length).toBe(steps + 1);
    undo.undo();
    expect(ids(a)).toEqual(["mine 0", "their 0", "their 1", "their 2"]);
  });

  it("keeps a collaborator's delete in the same transaction deleted", () => {
    const { live, a, peer, undo } = setup();
    const built = buildImport(a, [final(cards("imp", 3))], { x: 0, y: 100 });
    const release = captureImport(a, undo, built);

    const sv = Y.encodeStateVector(peer);
    canvasNodes(peer).delete("mine0");
    broadcastTogether(live, a, [built.update, Y.encodeStateAsUpdate(peer, sv)]);
    Y.applyUpdate(a, built.update, PROVIDER);
    release();

    expect(canvasNodes(a).has("mine0")).toBe(false);
    expect(canvasNodes(a).size).toBe(4);
    undo.undo();
    expect(canvasNodes(a).has("mine0")).toBe(false);
    expect(canvasNodes(a).size).toBe(1);
    undo.redo();
    expect(canvasNodes(a).size).toBe(4);
    expect(canvasNodes(a).has("mine0")).toBe(false);
  });

  it("keeps a collaborator's text edit in the same transaction", () => {
    const { live, a, peer, undo } = setup();
    const built = buildImport(a, [final(cards("imp", 2))], { x: 0, y: 100 });
    const release = captureImport(a, undo, built);

    const sv = Y.encodeStateVector(peer);
    const node = canvasNodes(peer).get("mine1") as Y.Map<unknown>;
    const text = node.get("text");
    if (text instanceof Y.Text) text.insert(text.length, " edited");
    else node.set("text", `${String(text)} edited`);
    broadcastTogether(live, a, [built.update, Y.encodeStateAsUpdate(peer, sv)]);
    release();

    expect(textOf(a, "mine1")).toBe("mine 1 edited");
    undo.undo();
    expect(ids(a)).toEqual(["mine 0", "mine 1 edited"]);
  });

  it("does not revert a restore that cleared cards in the same transaction", () => {
    const { live, a, peer, undo } = setup(4);
    const built = buildImport(a, [final(cards("imp", 2))], { x: 0, y: 100 });
    const release = captureImport(a, undo, built);

    const sv = Y.encodeStateVector(peer);
    peer.transact(() => {
      for (const id of ["mine0", "mine1", "mine2"]) canvasNodes(peer).delete(id);
    });
    broadcastTogether(live, a, [Y.encodeStateAsUpdate(peer, sv), built.update]);
    release();

    expect(ids(a)).toEqual(["imp 0", "imp 1", "mine 3"]);
    undo.undo();
    expect(ids(a)).toEqual(["mine 3"]);
  });

  it("keeps the member's own edits before and after the import as separate steps", () => {
    const { live, a, undo } = setup(1);
    const built = buildImport(a, [final(cards("imp", 2))], { x: 0, y: 100 });
    const release = captureImport(a, undo, built);
    // Typed while the request was out, inside the capture timeout window.
    a.transact(() => applyJsonCanvas(a, cards("during", 1), { mode: "fragment" }), LOCAL);
    broadcastTogether(live, a, [built.update]);
    release();
    a.transact(() => applyJsonCanvas(a, cards("after", 1), { mode: "fragment" }), LOCAL);

    expect(ids(a)).toEqual(["after 0", "during 0", "imp 0", "imp 1", "mine 0"]);
    undo.undo();
    expect(ids(a)).toEqual(["during 0", "imp 0", "imp 1", "mine 0"]);
    undo.undo();
    expect(ids(a)).toEqual(["during 0", "mine 0"]);
    undo.undo();
    expect(ids(a)).toEqual(["mine 0"]);
  });

  it("leaves the undo manager as it was on release, refused or not", () => {
    const { live, a, peer, undo } = setup(1);
    const capture = undo.captureTransaction;
    const origins = [...undo.trackedOrigins];

    const refused = buildImport(a, [final(cards("no", 2))], { x: 0, y: 100 });
    captureImport(a, undo, refused)();
    expect(undo.captureTransaction).toBe(capture);
    expect([...undo.trackedOrigins]).toEqual(origins);

    // Accepted: the provider origin is tracked only while the import lands.
    const built = buildImport(a, [final(cards("imp", 2))], { x: 0, y: 100 });
    const release = captureImport(a, undo, built);
    broadcastTogether(live, a, [built.update]);
    release();
    expect(undo.captureTransaction).toBe(capture);
    expect([...undo.trackedOrigins]).toEqual(origins);

    const steps = undo.undoStack.length;
    const sv = Y.encodeStateVector(peer);
    peer.transact(() => applyJsonCanvas(peer, cards("peer", 1), { mode: "fragment" }));
    broadcastTogether(live, a, [Y.encodeStateAsUpdate(peer, sv)]);
    expect(undo.undoStack.length).toBe(steps);
  });
});

describe("asOneUndoStep keeps a chunked apply as one ⌘Z", () => {
  const manyCards = cards("n", 450);
  const applyMany = (doc: Y.Doc) =>
    applyJsonCanvas(doc, manyCards, { mode: "fragment", at: { x: 0, y: 0 }, origin: LOCAL });

  it("while each chunk is applied quickly", () => {
    const doc = new Y.Doc();
    const undo = new Y.UndoManager([canvasNodes(doc)], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 400,
    });
    undo.stopCapturing();
    applyMany(doc);
    undo.stopCapturing();
    undo.undo();
    expect(canvasNodes(doc).size).toBe(0);
  });

  // lib0 holds its own `Date.now`, so a zero window stands in for a chunk
  // that outlasts the capture window on a slow device.
  it("when a chunk outlasts the capture window", () => {
    const doc = new Y.Doc();
    const undo = new Y.UndoManager([canvasNodes(doc)], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 0,
    });
    asOneUndoStep(undo, () => applyMany(doc));
    expect(undo.captureTimeout).toBe(0);
    undo.undo();
    expect(canvasNodes(doc).size).toBe(0);
  });

  it("restores the capture window when the apply throws, keeping what landed as its own step", () => {
    const doc = new Y.Doc();
    const nodes = canvasNodes(doc);
    const undo = new Y.UndoManager(nodes, { trackedOrigins: new Set([LOCAL]) });
    doc.transact(() => nodes.set("mine", new Y.Map()), LOCAL);
    expect(() =>
      asOneUndoStep(undo, () => {
        applyJsonCanvas(doc, cards("a", 3), {
          mode: "fragment",
          at: { x: 0, y: 0 },
          origin: LOCAL,
        });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(undo.captureTimeout).toBe(500);
    doc.transact(() => nodes.set("after", new Y.Map()), LOCAL);
    undo.undo();
    expect(nodes.has("after")).toBe(false);
    expect(nodes.size).toBe(4);
    undo.undo();
    expect([...nodes.keys()]).toEqual(["mine"]);
  });
});

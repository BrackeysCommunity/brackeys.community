/**
 * `captureImport` when canvas-sync's whole-row apply carries other content in
 * the same transaction as the import: a collaborator's delete or text edit, a
 * restore that drops cards, the member's own edits around the wait. ⌘Z must
 * take back the import and nothing else, and the capture must leave the undo
 * manager as it found it.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  applyJsonCanvas,
  canvasEdges,
  canvasNodes,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";

import { buildImport, captureImport, type FinalCanvas } from "../import-flow";

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

describe("captureImport keeps other content out of the import's undo step", () => {
  it("a collaborator's delete in the same transaction stays deleted after ⌘Z", () => {
    const { live, a, peer, undo } = setup();
    const built = buildImport(a, [final(cards("imp", 3))], { x: 0, y: 100 });
    const release = captureImport(a, undo, built);

    const sv = Y.encodeStateVector(peer);
    canvasNodes(peer).delete("mine0");
    const peerDelete = Y.encodeStateAsUpdate(peer, sv);
    broadcastTogether(live, a, [built.update, peerDelete]);
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

  it("a collaborator's text edit in the same transaction survives ⌘Z", () => {
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
    expect(textOf(a, "mine1")).toBe("mine 1 edited");
  });

  it("a restore riding with the import (cards cleared) is not reverted by ⌘Z", () => {
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

  it("the member's own edits before and after the import stay separate steps", () => {
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

  it("release leaves the undo manager as it was, refused or not", () => {
    const { live, a, peer, undo } = setup(1);
    const capture = undo.captureTransaction;
    const origins = [...undo.trackedOrigins];

    // Refused: nothing arrives.
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

  it("another member's import alone while this one is pending is not captured", () => {
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
});

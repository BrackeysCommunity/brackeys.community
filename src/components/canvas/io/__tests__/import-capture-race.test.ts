/**
 * `captureImport` against the ways canvas-sync can deliver an import live.
 * canvas-sync's apply reads the whole stored row and applies it in one
 * transaction, so whatever else was stored meanwhile (another member's
 * import, say) reaches the tab in the same transaction as this one.
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

/** Two tabs and canvas-sync's live doc, all holding one card tab A made. */
function setup() {
  const live = new Y.Doc();
  const a = new Y.Doc();
  const b = new Y.Doc();
  const undo = new Y.UndoManager([canvasNodes(a), canvasEdges(a)], {
    trackedOrigins: new Set([LOCAL]),
  });
  a.transact(() => applyJsonCanvas(a, cards("mine", 1), { mode: "fragment" }), LOCAL);
  undo.stopCapturing();
  const state = Y.encodeStateAsUpdate(a);
  Y.applyUpdate(live, state, PROVIDER);
  Y.applyUpdate(b, state, PROVIDER);
  return { live, a, b, undo };
}

describe("captureImport with canvas-sync's apply", () => {
  it("undoes only this import when the broadcast carries just it", () => {
    const { live, a, undo } = setup();
    const importA = buildImport(a, [final(cards("ia", 3))], { x: 0, y: 100 });
    const release = captureImport(a, undo, importA);
    const before = Y.encodeStateVector(live);
    Y.applyUpdate(live, importA.update, "server-apply");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(live, before), PROVIDER);
    Y.applyUpdate(a, importA.update, PROVIDER);
    release();
    undo.undo();
    expect(canvasNodes(a).size).toBe(1);
  });

  // Two members import within one apply's read: canvas-sync applies the row
  // (both imports) in one transaction, Hocuspocus broadcasts it as one
  // update; the undo step keeps only this import's own structs.
  it("⌘Z after a concurrent import elsewhere leaves the other member's cards", () => {
    const { live, a, b, undo } = setup();
    const importA = buildImport(a, [final(cards("ia", 3))], { x: 0, y: 100 });
    const importB = buildImport(b, [final(cards("ib", 4))], { x: 0, y: 200 });
    const release = captureImport(a, undo, importA);

    // Both stored before canvas-sync's first apply reads the row.
    const stored = Y.mergeUpdates([Y.encodeStateAsUpdate(live), importA.update, importB.update]);
    const before = Y.encodeStateVector(live);
    Y.applyUpdate(live, stored, "server-apply");
    const broadcast = Y.encodeStateAsUpdate(live, before);
    Y.applyUpdate(a, broadcast, PROVIDER);
    // The reply lands after: already held, so nothing more happens.
    Y.applyUpdate(a, importA.update, PROVIDER);
    release();

    expect(canvasNodes(a).size).toBe(8);
    undo.undo();
    expect(canvasNodes(a).size).toBe(5);
    undo.redo();
    expect(canvasNodes(a).size).toBe(8);
  });

  it("a concurrent import applied in its own transaction is left alone", () => {
    const { live, a, b, undo } = setup();
    const importA = buildImport(a, [final(cards("ia", 3))], { x: 0, y: 100 });
    const importB = buildImport(b, [final(cards("ib", 4))], { x: 0, y: 200 });
    const release = captureImport(a, undo, importA);
    for (const update of [importB.update, importA.update]) {
      const before = Y.encodeStateVector(live);
      Y.applyUpdate(live, update, "server-apply");
      Y.applyUpdate(a, Y.encodeStateAsUpdate(live, before), PROVIDER);
    }
    release();
    undo.undo();
    expect(canvasNodes(a).size).toBe(5);
  });
});

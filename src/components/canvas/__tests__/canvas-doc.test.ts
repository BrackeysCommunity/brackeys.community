import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
// @vitest-environment jsdom
import * as Y from "yjs";

import {
  applyJsonCanvas,
  canvasEdges,
  canvasNodes,
  docToJsonCanvas,
} from "@/lib/canvas/json-canvas";

import {
  addCard,
  CanvasDocView,
  cardsInside,
  deleteElements,
  LOCAL,
  setCardFields,
} from "../editor/canvas-doc";

const card = (id: string, x = 0, extra: object = {}) => ({
  id,
  type: "text",
  text: id,
  x,
  y: 0,
  width: 100,
  height: 50,
  ...extra,
});

function docWith(nodes: object[], edges: object[] = []): Y.Doc {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, { nodes, edges }, { mode: "whole" });
  return doc;
}

let frames: FrameRequestCallback[] = [];
const flushFrame = () => {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(0);
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("CanvasDocView", () => {
  it("orders cards by z and keeps groups behind", () => {
    const doc = docWith([card("a"), { ...card("g"), type: "group", label: "G" }, card("b")]);
    const view = new CanvasDocView(doc);
    expect(view.nodes.map((n) => n.id)).toEqual(["a", "g", "b"]);
    const z = Object.fromEntries(view.nodes.map((n) => [n.id, n.zIndex]));
    expect(z.g).toBeLessThan(z.a!);
  });

  it("rebuilds once per frame, and only the card that moved gets a new object", () => {
    const doc = docWith([card("a"), card("b")]);
    const view = new CanvasDocView(doc);
    const [a, b] = view.nodes;
    let emits = 0;
    view.subscribe(() => emits++);

    for (let i = 1; i <= 5; i++) setCardFields(doc, new Map([["a", { x: i * 10 }]]));
    expect(emits).toBe(0);
    flushFrame();
    expect(emits).toBe(1);

    const [a2, b2] = view.nodes;
    expect(a2).not.toBe(a);
    expect(a2!.position.x).toBe(50);
    expect(b2).toBe(b);
  });

  it("marks a card changed when only its text changes", () => {
    const doc = docWith([card("a")]);
    const view = new CanvasDocView(doc);
    const before = view.nodes[0]!;
    (canvasNodes(doc).get("a")!.get("text") as Y.Text).insert(0, "hi ");
    flushFrame();
    expect(view.nodes[0]).not.toBe(before);
    expect(view.nodes[0]!.data.card.text).toBe("hi a");
    expect(view.nodes[0]!.data.version).toBeGreaterThan(before.data.version);
  });

  it("draws a side the file didn't give without writing it", () => {
    const doc = docWith([card("a", 0), card("b", 500)], [{ id: "e", fromNode: "a", toNode: "b" }]);
    const view = new CanvasDocView(doc);
    expect(view.edges[0]).toMatchObject({ sourceHandle: "right", targetHandle: "left" });
    expect(canvasEdges(doc).get("e")!.has("fromSide")).toBe(false);
  });
});

describe("CanvasDocView routing", () => {
  const blocked = () =>
    docWith(
      [card("a", 0), card("b", 600), { ...card("c", 300), y: -50, height: 150 }],
      [{ id: "e", fromNode: "a", toNode: "b" }],
    );

  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("routes around a card in the way as the canvas opens", () => {
    const view = new CanvasDocView(blocked());
    expect(view.edges[0]!.data!.drawing!.routed).toBe(true);
  });

  it("re-routes on each write, including lines that don't touch the card that moved", () => {
    const doc = blocked();
    const view = new CanvasDocView(doc);
    setCardFields(doc, new Map([["c", { y: 400 }]]));
    flushFrame();
    expect(view.edges[0]!.data!.drawing).toBeUndefined();

    setCardFields(doc, new Map([["c", { y: -50 }]]));
    flushFrame();
    expect(view.edges[0]!.data!.drawing!.routed).toBe(true);
  });

  it("routes a dragged card's connections from where it is on screen", () => {
    const view = new CanvasDocView(blocked());
    // `a` dragged 300 down, ahead of the doc: the blocker is no longer between.
    const live = view.liveDrawing(
      "a",
      "b",
      { x: 100, y: 325, side: "right" },
      { x: 600, y: 25, side: "left" },
    );
    expect(live).toMatchObject({ routed: false, start: { x: 100, y: 325 } });
    // Back level with `b`, where its own stale copy in the index can't block it.
    const level = view.liveDrawing(
      "a",
      "b",
      { x: 120, y: 25, side: "right" },
      { x: 600, y: 25, side: "left" },
    );
    expect(level).toMatchObject({ routed: true, start: { x: 120, y: 25 } });
  });

  it("leaves plain curves' edge objects alone", () => {
    const doc = docWith([card("a", 0), card("b", 600)], [{ id: "e", fromNode: "a", toNode: "b" }]);
    const view = new CanvasDocView(doc);
    const before = view.edges[0];
    expect(before!.data!.drawing).toBeUndefined();
    setCardFields(doc, new Map([["b", { y: 10 }]]));
    flushFrame();
    vi.runAllTimers();
    expect(view.edges[0]!.data!.drawing).toBeUndefined();
  });

  it("never writes a route to the doc", () => {
    const doc = blocked();
    const before = JSON.stringify(docToJsonCanvas(doc));
    const view = new CanvasDocView(doc);
    setCardFields(doc, new Map([["a", { x: 10 }]]));
    flushFrame();
    vi.runAllTimers();
    setCardFields(doc, new Map([["a", { x: 0 }]]));
    flushFrame();
    vi.runAllTimers();
    expect(view.edges[0]!.data!.drawing!.routed).toBe(true);
    expect(JSON.stringify(docToJsonCanvas(doc))).toBe(before);
    expect(canvasEdges(doc).get("e")!.toJSON()).toEqual({ from: "a", to: "b" });
  });
});

describe("writes", () => {
  it("adds cards on top, as undoable local edits", () => {
    const doc = docWith([card("a")]);
    const undo = new Y.UndoManager([canvasNodes(doc)], { trackedOrigins: new Set([LOCAL]) });
    const id = addCard(doc, { type: "text", text: "new", x: 0, y: 0, w: 10, h: 10 });
    const view = new CanvasDocView(doc);
    expect(view.nodes.at(-1)!.id).toBe(id);
    undo.undo();
    expect(canvasNodes(doc).has(id)).toBe(false);
  });

  it("deleting a card takes its edges with it", () => {
    const doc = docWith(
      [card("a"), card("b"), card("c")],
      [
        { id: "ab", fromNode: "a", toNode: "b" },
        { id: "bc", fromNode: "b", toNode: "c" },
      ],
    );
    deleteElements(doc, ["a"], []);
    expect([...canvasEdges(doc).keys()]).toEqual(["bc"]);
  });

  it("finds the cards a group carries: wholly inside only", () => {
    const group = { id: "g", type: "group" as const, x: 0, y: 0, w: 300, h: 300 };
    const inside = { id: "in", type: "text" as const, x: 10, y: 10, w: 100, h: 100 };
    const straddling = { id: "half", type: "text" as const, x: 250, y: 10, w: 100, h: 100 };
    expect(cardsInside(group, [group, inside, straddling])).toEqual(["in"]);
  });
});

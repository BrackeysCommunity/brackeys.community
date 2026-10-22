/**
 * How big the canvas would be after a paste or duplicate: `stateBytesWith`
 * measures it exactly, on a copy of the doc, and `stateOverCap`'s fast
 * bound decides the same way without encoding when it can.
 */
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { applyJsonCanvas, canvasNodes, type JsonCanvas } from "@/lib/canvas/json-canvas";

import { LOCAL } from "../../editor/canvas-doc";
import { stateBytesWith, stateOverCap } from "../clipboard";

const textCard = (id: string, text: string, x = 0) => ({
  id,
  type: "text" as const,
  text,
  x,
  y: 0,
  width: 200,
  height: 80,
});

const cards = (prefix: string, n: number): JsonCanvas => ({
  nodes: Array.from({ length: n }, (_, i) => textCard(`${prefix}${i}`, `card ${i}`, i * 10)),
  edges: [],
});

const fileCanvas: JsonCanvas = {
  nodes: [{ id: "f", type: "file", file: "n.md", x: 0, y: 0, width: 1, height: 1 }],
  edges: [],
};

/** A doc with history: edits and deletes leave tombstones in the state. */
function existingDoc(): Y.Doc {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, {
    nodes: Array.from({ length: 50 }, (_, i) => textCard(`e${i}`, `existing ${i}`, i * 10)),
    edges: [],
  });
  const nodes = canvasNodes(doc);
  doc.transact(() => {
    for (let i = 0; i < 20; i++) nodes.delete(`e${i}`);
  });
  return doc;
}

/** A client that has made `clock` changes, so its references take 3 or 4 bytes. */
function longLivedDoc(clock: number, client: number, existing: JsonCanvas): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = client;
  applyJsonCanvas(doc, existing);
  if (clock) {
    doc.getText("big").insert(0, "x".repeat(clock));
    doc.getText("big").delete(0, clock);
  }
  return doc;
}

describe("measuring the state a paste leaves", () => {
  it("is the exact state size the paste makes, over many shapes of doc", () => {
    for (let trial = 0; trial < 25; trial++) {
      const doc = new Y.Doc();
      const other = new Y.Doc();
      applyJsonCanvas(other, {
        nodes: Array.from({ length: 1 + (trial % 7) }, (_, i) => ({
          id: `o${i}`,
          type: "text",
          text: "x".repeat(trial * 13 + i),
          x: i,
          y: 0,
          width: 1,
          height: 1,
        })),
      });
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
      applyJsonCanvas(doc, {
        nodes: [
          { id: "mine", type: "text", text: "y".repeat(trial), x: 0, y: 0, width: 1, height: 1 },
        ],
      });
      // Churn: deletes and edits, from both clients.
      const first = [...canvasNodes(doc).keys()][0]!;
      if (trial % 2) canvasNodes(doc).delete(first);
      else canvasNodes(doc).get(first)!.set("x", trial);
      const fragment: JsonCanvas = {
        nodes: Array.from({ length: 1 + (trial % 4) }, (_, i) => ({
          id: `f${i}`,
          type: "text",
          text: "z".repeat(trial * 31 + i),
          x: i * 5,
          y: 1,
          width: 2,
          height: 2,
        })),
        edges: trial % 3 ? [] : [{ id: "e", fromNode: "f0", toNode: "f0" }],
      };
      const at = { x: trial, y: -trial };
      const predicted = stateBytesWith(doc, fragment, { at });
      applyJsonCanvas(doc, fragment, { at, origin: "local" });
      expect(predicted, `trial ${trial}`).toBe(Y.encodeStateAsUpdate(doc).length);
    }
  });

  const fragments: [string, JsonCanvas, Record<string, { text: string }>?][] = [
    ["one text card", { nodes: [textCard("a", "hello")], edges: [] }],
    ["200 short text cards", cards("n", 200)],
    [
      "cards with labelled edges",
      {
        nodes: Array.from({ length: 40 }, (_, i) => textCard(`n${i}`, `card ${i}`, i)),
        edges: Array.from({ length: 39 }, (_, i) => ({
          id: `e${i}`,
          fromNode: `n${i}`,
          toNode: `n${i + 1}`,
          label: `edge ${i}`,
          toEnd: "arrow" as const,
        })),
      },
    ],
    [
      "file cards with long bodies",
      {
        nodes: Array.from({ length: 5 }, (_, i) => ({
          id: `f${i}`,
          type: "file" as const,
          file: `Notes/${i}.md`,
          x: i * 300,
          y: 0,
          width: 250,
          height: 250,
        })),
        edges: [],
      },
      Object.fromEntries(
        Array.from({ length: 5 }, (_, i) => [
          `f${i}`,
          { text: `# Note ${i}\r\n${"x".repeat(50_000)}` },
        ]),
      ),
    ],
  ];

  it.each(fragments)(
    "%s onto a doc with tombstones: the measure covers what the paste leaves",
    (_label, fragment, docFields) => {
      const doc = existingDoc();
      const at = { x: 5_000, y: 5_000 };
      const measured = stateBytesWith(doc, fragment, { at, docFields });
      applyJsonCanvas(doc, fragment, { at, origin: LOCAL, docFields });
      expect(Y.encodeStateAsUpdate(doc).length).toBeLessThanOrEqual(measured);
    },
  );

  it.each([0, 20_000, 2_200_000])(
    "covers 200 short text cards from a client whose clock is %i",
    (clock) => {
      // Client ids are random uint32s; pinned so the result doesn't depend on the draw.
      const doc = longLivedDoc(clock, 2 ** 31 + 7, cards("x", 30));
      const fragment = cards("p", 200);
      const at = { x: 0, y: 0 };
      const measured = stateBytesWith(doc, fragment, { at });
      applyJsonCanvas(doc, fragment, { mode: "fragment", at });
      expect(measured).toBeGreaterThanOrEqual(Y.encodeStateAsUpdate(doc).length);
    },
  );

  it("counts note bodies", () => {
    const at = { x: 0, y: 0 };
    const small = stateBytesWith(new Y.Doc(), fileCanvas, { at });
    const withBody = stateBytesWith(new Y.Doc(), fileCanvas, {
      at,
      docFields: { f: { text: "x".repeat(10_000) } },
    });
    expect(withBody - small).toBeGreaterThanOrEqual(10_000);
  });

  it("leaves the doc it measures untouched", () => {
    const doc = new Y.Doc();
    const before = Y.encodeStateAsUpdate(doc);
    stateBytesWith(doc, fileCanvas, { at: { x: 0, y: 0 } });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});

describe("stateOverCap", () => {
  const linked = (n: number, edges: boolean): JsonCanvas => {
    const nodes = Array.from({ length: n }, (_, i) => ({
      id: `n${i}`,
      type: "text" as const,
      text: `card ${i}`,
      x: i,
      y: 0,
      width: 10,
      height: 10,
    }));
    return {
      nodes,
      edges: edges
        ? nodes.slice(1).map((m, i) => ({ id: `e${i}`, fromNode: nodes[i]!.id, toNode: m.id }))
        : [],
    };
  };

  it.each([0, 20_000, 2_200_000])("decides like the exact measure at clock %i", (clock) => {
    const doc = longLivedDoc(clock, 2 ** 32 - 3, linked(20, false));
    const at = { x: 0, y: 0 };
    for (const fragment of [
      linked(1, false),
      linked(5, true),
      linked(200, false),
      linked(200, true),
    ]) {
      const exact = stateBytesWith(doc, fragment, { at });
      for (const cap of [exact - 1, exact, exact + 1, exact * 4, exact * 10]) {
        expect(stateOverCap(doc, fragment, { at }, cap)).toBe(exact > cap ? exact : null);
      }
    }
  });
});

describe("the paste bound with the costliest references", () => {
  // The smallest cards and edges, where references are most of the bytes.
  const minimal = (n: number, withEdges: boolean): JsonCanvas => ({
    nodes: Array.from({ length: n }, (_, i) => ({
      id: `${i}`,
      type: "text",
      text: "",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    })),
    edges: withEdges
      ? Array.from({ length: n - 1 }, (_, i) => ({
          id: `e${i}`,
          fromNode: `${i}`,
          toNode: `${i + 1}`,
        }))
      : [],
  });
  const aloneBytes = (fragment: JsonCanvas) => {
    const scratch = new Y.Doc();
    scratch.clientID = 1;
    applyJsonCanvas(scratch, fragment, { at: { x: 0, y: 0 } });
    return Y.encodeStateAsUpdate(scratch).length;
  };
  const padded = (clock: number, client: number) => {
    const doc = new Y.Doc();
    doc.clientID = client;
    applyJsonCanvas(doc, { nodes: [], edges: [] }, { mode: "whole" });
    if (clock) doc.getText("pad").insert(0, "p".repeat(clock));
    return doc;
  };

  for (const clock of [0, 20_000, 2_200_000]) {
    for (const client of [1, 0x7fffffff, 0xffffffff]) {
      for (const withEdges of [false, true]) {
        it(`clock ${clock}, client ${client}, edges ${withEdges}`, () => {
          const doc = padded(clock, client);
          const fragment = minimal(300, withEdges);
          const now = Y.encodeStateAsUpdate(doc).length;
          const exact = stateBytesWith(doc, fragment, { at: { x: 0, y: 0 } });
          const alone = aloneBytes(fragment);
          expect(exact).toBeLessThanOrEqual(now + alone * 3 + 4_096);
          expect((exact - now) / alone).toBeLessThan(2);
        });
      }
    }
  }
});

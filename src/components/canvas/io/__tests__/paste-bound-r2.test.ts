/**
 * `stateOverCap`'s fast bound against the costliest references a real doc
 * can have: the largest client id, 4-byte clocks, and fragments made of
 * the smallest cards and edges (where references are most of the bytes).
 */
import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { applyJsonCanvas, type JsonCanvas } from "@/lib/canvas/json-canvas";

import { stateBytesWith } from "../clipboard";

function aloneBytes(fragment: JsonCanvas): number {
  const scratch = new Y.Doc();
  scratch.clientID = 1;
  applyJsonCanvas(scratch, fragment, { at: { x: 0, y: 0 } });
  return Y.encodeStateAsUpdate(scratch).length;
}

function docAt(clock: number, client: number): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = client;
  applyJsonCanvas(doc, { nodes: [], edges: [] }, { mode: "whole" });
  if (clock) doc.getText("pad").insert(0, "p".repeat(clock));
  return doc;
}

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

describe("the paste bound with the costliest references", () => {
  for (const clock of [0, 20_000, 2_200_000]) {
    for (const client of [1, 0x7fffffff, 0xffffffff]) {
      for (const withEdges of [false, true]) {
        it(`clock ${clock}, client ${client}, edges ${withEdges}`, () => {
          const doc = docAt(clock, client);
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

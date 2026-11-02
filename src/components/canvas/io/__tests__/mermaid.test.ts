// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";

import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { docToJsonCanvas, type JsonCanvasNode } from "@/lib/canvas/json-canvas";

import { runCanvasIo } from "../canvas-io-client";
import { readCanvasClipboard } from "../clipboard";
import { MermaidImportError, mermaidSource, mermaidToCanvas } from "../mermaid";

vi.mock("@/orpc/client", () => ({ client: {} }));

const FLOWCHART = `flowchart LR
  %% the jam loop
  A[Pick a theme] -->|48h| B{Fun?}
  B -- Yes --> C["Ship it &amp; sleep"]
  B -- No --> D((Cut<br>scope))
  D -.-> A
  C --- E
  subgraph S1 [After the jam]
    E[Rate games]
  end
  style B fill:#ffec99
  classDef hot fill:#e03131
  class C hot`;

const contains = (outer: JsonCanvasNode, inner: JsonCanvasNode) =>
  outer.x <= inner.x &&
  outer.y <= inner.y &&
  outer.x + outer.width >= inner.x + inner.width &&
  outer.y + outer.height >= inner.y + inner.height;

const overlap = (a: JsonCanvasNode, b: JsonCanvasNode) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("mermaidSource", () => {
  it("finds a supported diagram past fences, front matter and comments", () => {
    expect(mermaidSource("graph TD\n A --> B")).toBe("graph TD\n A --> B");
    expect(mermaidSource("```mermaid\nflowchart LR\n A --> B\n```")).toBe("flowchart LR\n A --> B");
    expect(
      mermaidSource("---\ntitle: Loop\n---\n%%{init: {}}%%\nstateDiagram-v2\n [*] --> A"),
    ).toContain("stateDiagram-v2");
    expect(mermaidSource("mindmap\n  root")).not.toBeNull();
  });

  it("leaves everything else alone", () => {
    expect(mermaidSource("graph theory is fun")).toBeNull();
    expect(mermaidSource("sequenceDiagram\n A->>B: hi")).toBeNull();
    expect(mermaidSource("---\nunterminated")).toBeNull();
    expect(mermaidSource("")).toBeNull();
  });
});

describe("mermaidToCanvas", () => {
  it("lays out a flowchart as cards, a group and edges", async () => {
    const canvas = await mermaidToCanvas(FLOWCHART);
    const node = (id: string) => canvas.nodes.find((n) => n.id === id)!;

    expect(canvas.nodes[0]).toMatchObject({ id: "S1", type: "group", label: "After the jam" });
    expect(node("A")).toMatchObject({ type: "text", text: "Pick a theme" });
    expect(node("B")).toMatchObject({ text: "Fun?", color: "2" });
    expect(node("C")).toMatchObject({ text: "Ship it & sleep", color: "1" });
    expect(node("D")).toMatchObject({ text: "Cut\nscope" });
    expect(contains(node("S1"), node("E"))).toBe(true);

    const cards = canvas.nodes.filter((n) => n.type === "text");
    for (const a of cards) for (const b of cards) if (a !== b) expect(overlap(a, b)).toBe(false);
    // Left to right: the first link leaves A's right side for B's left.
    expect(node("A").x).toBeLessThan(node("B").x);

    const edge = (from: string, to: string) =>
      canvas.edges.find((e) => e.fromNode === from && e.toNode === to)!;
    expect(edge("A", "B")).toMatchObject({ fromSide: "right", toSide: "left", label: "48h" });
    expect(edge("A", "B").toEnd).toBeUndefined();
    expect(edge("B", "C")).toMatchObject({ label: "Yes" });
    expect(edge("C", "E")).toMatchObject({ toEnd: "none" });
    expect(canvas.edges).toHaveLength(5);
  });

  it("reads a state diagram's start, end and composite states", async () => {
    const canvas = await mermaidToCanvas(`stateDiagram-v2
      [*] --> Idle
      Idle --> Playing: start
      state Playing {
        Running --> Paused
      }
      Playing --> [*]`);
    const texts = canvas.nodes.map((n) => (n.type === "group" ? `group:${n.label}` : n.text));
    expect(texts).toEqual(
      expect.arrayContaining(["Start", "End", "Idle", "Running", "Paused", "group:Playing"]),
    );
    expect(canvas.edges.find((e) => e.label === "start")).toBeDefined();
  });

  it("turns a mindmap into a tree without arrowheads", async () => {
    const canvas = await mermaidToCanvas(
      "mindmap\n  root((Jam))\n    Art\n      Sprites\n    Code",
    );
    expect(canvas.nodes.map((n) => n.text)).toEqual(["Jam", "Art", "Sprites", "Code"]);
    expect(canvas.edges).toHaveLength(3);
    expect(canvas.edges.every((e) => e.toEnd === "none")).toBe(true);
  });

  it("says why a diagram can't be read", async () => {
    await expect(mermaidToCanvas("flowchart TD\n A -->")).rejects.toBeInstanceOf(
      MermaidImportError,
    );
    await expect(mermaidToCanvas("sequenceDiagram\n A->>B: hi")).rejects.toThrow(
      "Only flowcharts, state diagrams and mindmaps",
    );
  });
});

describe("importing .mmd files", () => {
  // jsdom's Blob can't be read back; the import reads files as the browser's can.
  beforeAll(() => vi.stubGlobal("Blob", NodeBlob));
  afterAll(() => vi.unstubAllGlobals());
  const file = (path: string, text: string) => ({ path, file: new Blob([text]) });

  it("becomes a canvas, with unreadable diagrams reported", async () => {
    const result = await runCanvasIo("import", {
      source: {
        files: [
          file("Loop.mmd", FLOWCHART),
          file("Chat.mermaid", "sequenceDiagram\n A->>B: hi"),
          file("Broken.mmd", "flowchart TD\n A -->"),
        ],
      },
      options: { mode: "new" },
    });
    if (result.kind !== "import") throw new Error("expected an import");
    expect(result.canvases.map((c) => c.targetPath)).toEqual(["Loop.canvas"]);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, result.canvases[0]!.state);
    expect(docToJsonCanvas(doc).nodes).toHaveLength(6);
    expect(result.report.skipped).toEqual([
      { path: "Chat.mermaid", reason: expect.stringContaining("Only flowcharts") },
      { path: "Broken.mmd", reason: expect.stringContaining("Mermaid couldn't read") },
    ]);
  });
});

describe("pasting Mermaid", () => {
  it("reads a fenced diagram as its own kind", () => {
    const text = "```mermaid\ngraph TD\n A --> B\n```";
    const read = readCanvasClipboard((type) => (type === "text/plain" ? text : ""), []);
    expect(read).toEqual({ kind: "mermaid", text: "graph TD\n A --> B" });
  });

  it("leaves prose that starts with the word alone", () => {
    const read = readCanvasClipboard((type) => (type === "text/plain" ? "graph paper" : ""), []);
    expect(read).toMatchObject({ kind: "text" });
  });
});

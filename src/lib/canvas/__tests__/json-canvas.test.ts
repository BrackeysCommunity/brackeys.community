import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  applyJsonCanvas,
  canvasNodes,
  deriveSnapshot,
  docToJsonCanvas,
  jsonCanvasSchema,
  orderedNodeIds,
  sanitizeSnapshot,
  type JsonCanvas,
} from "../json-canvas";
import { CANVAS_LIMITS } from "../limits";

const FIXTURES = join(import.meta.dirname, "fixtures");
const fixtureNames = readdirSync(FIXTURES).filter((f) => f.endsWith(".canvas"));

function fixture(name: string): JsonCanvas {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as JsonCanvas;
}

/** Obsidian omits `nodes`/`edges` when empty in hand-written files; we always write them. */
function normalized(canvas: JsonCanvas): JsonCanvas {
  return { ...canvas, nodes: canvas.nodes ?? [], edges: canvas.edges ?? [] };
}

function load(canvas: unknown): Y.Doc {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, canvas, { mode: "whole" });
  return doc;
}

describe("JSON Canvas round trip", () => {
  it.each(fixtureNames)("%s: json → doc → json is lossless", (name) => {
    const source = fixture(name);
    const canvasId = (source.brackeys as { id?: string } | undefined)?.id;
    const out = docToJsonCanvas(load(source), { canvasId });
    expect(out).toEqual(normalized(source));
  });

  it.each(fixtureNames)("%s: sanitising a real file changes nothing", (name) => {
    const source = normalized(fixture(name));
    expect(sanitizeSnapshot(source)).toEqual(source);
    const { brackeys: _canvasKey, ...withoutCanvasKey } = source;
    expect(deriveSnapshot(load(source))).toEqual(withoutCanvasKey);
  });

  it("keeps array order as z-order", () => {
    const source = fixture("jsoncanvas-sample.canvas");
    const doc = load(source);
    expect(orderedNodeIds(doc)).toEqual(source.nodes.map((n) => n.id));
  });

  it("keeps other plugins' keys on nodes, edges and the canvas", () => {
    const out = docToJsonCanvas(load(fixture("jcv-demo.canvas")));
    expect(out.metadata).toBeDefined();
    expect(out.nodes.some((n) => n.styleAttributes !== undefined)).toBe(true);
    expect(out.edges.some((e) => e.styleAttributes !== undefined)).toBe(true);
  });

  it("never writes a side or end the source didn't have", () => {
    const out = docToJsonCanvas(
      load({
        nodes: [
          { id: "a", type: "text", text: "", x: 0, y: 0, width: 10, height: 10 },
          { id: "b", type: "text", text: "", x: 0, y: 0, width: 10, height: 10 },
        ],
        edges: [{ id: "e", fromNode: "a", toNode: "b" }],
      }),
    );
    expect(out.edges[0]).toEqual({ id: "e", fromNode: "a", toNode: "b" });
  });

  it("maps our image and entity types to file and link nodes with a brackeys key", () => {
    const doc = load(fixture("synthetic-brackeys.canvas"));
    const nodes = canvasNodes(doc);
    expect(nodes.get("c1c2c3c4c5c60001")?.get("type")).toBe("entity");
    expect(nodes.get("c1c2c3c4c5c60002")?.get("type")).toBe("image");
    const out = docToJsonCanvas(doc);
    expect(out.nodes[0]).toMatchObject({ type: "link", brackeys: { type: "entity" } });
    expect(out.nodes[1]).toMatchObject({ type: "file", brackeys: { type: "image" } });
  });

  it("accepts a file with no nodes or edges keys", () => {
    expect(docToJsonCanvas(load({}))).toEqual({ nodes: [], edges: [] });
  });
});

describe("applyJsonCanvas as a fragment", () => {
  const fragment = {
    nodes: [
      { id: "x", type: "text", text: "one", x: 100, y: 200, width: 50, height: 50 },
      { id: "y", type: "text", text: "two", x: 300, y: 250, width: 50, height: 50 },
      { id: "z", type: "pdf", x: 0, y: 0, width: 1, height: 1 },
    ],
    edges: [
      { id: "e", fromNode: "x", toNode: "y" },
      { id: "dangling", fromNode: "x", toNode: "missing" },
    ],
    center: { x: 1, y: 2 },
  };

  it("gives fresh ids, remaps edges, lands at the paste point and skips unknown types", () => {
    const doc = load(fixture("customframes.canvas"));
    const before = orderedNodeIds(doc);
    const result = applyJsonCanvas(doc, fragment, { at: { x: 0, y: 0 } });

    expect(result.created).toHaveLength(2);
    expect(result.skipped).toEqual([{ id: "z", type: "pdf" }]);
    expect(result.created).not.toContain("x");
    expect(orderedNodeIds(doc)).toEqual([...before, ...result.created]);

    const out = docToJsonCanvas(doc);
    const [one, two] = result.created.map((id) => out.nodes.find((n) => n.id === id)!);
    expect([one!.x, one!.y, two!.x, two!.y]).toEqual([0, 0, 200, 50]);
    expect(out.edges).toEqual([
      expect.objectContaining({ fromNode: result.created[0], toNode: result.created[1] }),
    ]);
    expect(out.center).toBeUndefined();
  });

  it("pasting the same fragment twice keeps both copies apart", () => {
    const doc = new Y.Doc();
    const a = applyJsonCanvas(doc, fragment);
    const b = applyJsonCanvas(doc, fragment);
    expect(new Set([...a.created, ...b.created]).size).toBe(4);
    expect(orderedNodeIds(doc)).toEqual([...a.created, ...b.created]);
  });

  it("splits a large insert into transactions of applyChunkSize cards", () => {
    const doc = new Y.Doc();
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);
    const count = CANVAS_LIMITS.applyChunkSize * 2 + 1;
    applyJsonCanvas(doc, {
      nodes: Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        type: "text",
        text: "",
        x: i,
        y: 0,
        width: 10,
        height: 10,
      })),
      edges: [],
    });
    expect(transactions).toBe(3 + 1);
    expect(canvasNodes(doc).size).toBe(count);
  });

  it("uses the given origin, so the editor's undo can track it", () => {
    const doc = new Y.Doc();
    const LOCAL = Symbol("local");
    const undo = new Y.UndoManager([canvasNodes(doc)], { trackedOrigins: new Set([LOCAL]) });
    applyJsonCanvas(doc, fragment, { origin: LOCAL });
    expect(canvasNodes(doc).size).toBe(2);
    undo.undo();
    expect(canvasNodes(doc).size).toBe(0);
  });
});

describe("sanitizeSnapshot", () => {
  it("drops, clamps, rounds and truncates whatever an editor wrote", () => {
    const L = CANVAS_LIMITS;
    const out = sanitizeSnapshot({
      nodes: [
        {
          id: "a",
          type: "text",
          text: "x".repeat(L.maxCardText + 5),
          x: 1.6,
          y: Number.NaN,
          width: -5,
          height: 1e12,
          color: "red",
        },
        { id: "a", type: "text", text: "duplicate id", x: 0, y: 0, width: 1, height: 1 },
        { id: "b", type: "iframe", x: 0, y: 0, width: 1, height: 1 },
        {
          id: "c",
          type: "text",
          text: "",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          brackeys: { type: "image", attachmentId: "x" },
        },
      ],
      edges: [
        { id: "e1", fromNode: "a", toNode: "b" },
        { id: "e2", fromNode: "a", toNode: "c", fromSide: "middle", label: 7 },
      ],
    } as unknown as JsonCanvas);

    expect(out.nodes).toEqual([
      {
        id: "a",
        type: "text",
        text: "x".repeat(L.maxCardText),
        x: 2,
        y: 0,
        width: L.minSize,
        height: L.maxSize,
      },
      { id: "c", type: "text", text: "", x: 0, y: 0, width: 1, height: 1 },
    ]);
    expect(out.edges).toEqual([{ id: "e2", fromNode: "a", toNode: "c" }]);
  });

  it("applies the node cap", () => {
    const nodes = Array.from({ length: CANVAS_LIMITS.maxNodes + 3 }, (_, i) => ({
      id: `n${i}`,
      type: "text",
      text: "",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }));
    expect(sanitizeSnapshot({ nodes, edges: [] }).nodes).toHaveLength(CANVAS_LIMITS.maxNodes);
  });

  it("drops oversized extra keys", () => {
    const out = sanitizeSnapshot({
      nodes: [
        {
          id: "a",
          type: "text",
          text: "",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          huge: "x".repeat(CANVAS_LIMITS.maxExtraBytes),
        },
      ],
      edges: [],
    });
    expect(out.nodes[0]).not.toHaveProperty("huge");
  });
});

describe("docToJsonCanvas on a hostile doc", () => {
  it("skips nodes with the wrong shapes instead of throwing", () => {
    const doc = new Y.Doc();
    const nodes = canvasNodes(doc) as unknown as Y.Map<unknown>;
    nodes.set("not-a-map", "hello");
    const bad = new Y.Map<unknown>();
    bad.set("type", "image");
    nodes.set("image-without-attachment", bad);
    const ok = new Y.Map<unknown>();
    ok.set("type", "text");
    ok.set("text", "plain string instead of Y.Text");
    ok.set("x", "12");
    nodes.set("ok", ok);
    expect(deriveSnapshot(doc).nodes).toEqual([
      {
        id: "ok",
        type: "text",
        text: "plain string instead of Y.Text",
        x: 0,
        y: 0,
        width: 250,
        height: 60,
      },
    ]);
  });
});

describe("jsonCanvasSchema", () => {
  it("recognises an Obsidian clipboard payload and rejects other JSON", () => {
    expect(
      jsonCanvasSchema.safeParse({
        nodes: [{ id: "1", type: "text", text: "a", x: 0, y: 0, width: 1, height: 1 }],
        edges: [],
        center: { x: 0, y: 0 },
      }).success,
    ).toBe(true);
    expect(jsonCanvasSchema.safeParse({ nodes: [{ id: 1 }] }).success).toBe(false);
  });
});

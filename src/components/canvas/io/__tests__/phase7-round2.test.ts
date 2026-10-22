/**
 * Second-round probes: how close the paste/duplicate size estimate is to
 * what a fragment really adds, an import's undo step when applying is slow,
 * and duplicate images whose shared upload fails or lands elsewhere.
 */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { applyJsonCanvas, canvasNodes, type JsonCanvas } from "@/lib/canvas/json-canvas";

import { LOCAL } from "../../editor/canvas-doc";
import { runImportJob } from "../canvas-io-jobs";
import { stateBytesWith } from "../clipboard";
import { asOneUndoStep, type ImageUploader, resolveImages } from "../import-flow";
import { enc, memoryScope, PNG } from "./vault-fixtures";

vi.mock("@/orpc/client", () => ({ client: {} }));

afterEach(() => {
  vi.restoreAllMocks();
});

const textCard = (id: string, text: string, x = 0) => ({
  id,
  type: "text" as const,
  text,
  x,
  y: 0,
  width: 200,
  height: 80,
});

function existingDoc(): Y.Doc {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, {
    nodes: Array.from({ length: 50 }, (_, i) => textCard(`e${i}`, `existing ${i}`, i * 10)),
    edges: [],
  });
  // Some history: edits and deletes leave tombstones in the state.
  const nodes = canvasNodes(doc);
  doc.transact(() => {
    for (let i = 0; i < 20; i++) nodes.delete(`e${i}`);
  });
  return doc;
}

const fragments: [string, JsonCanvas, Record<string, { text: string }>?][] = [
  ["one text card", { nodes: [textCard("a", "hello")], edges: [] }],
  [
    "200 short text cards",
    { nodes: Array.from({ length: 200 }, (_, i) => textCard(`n${i}`, `card ${i}`, i)), edges: [] },
  ],
  [
    "cards with edges",
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

describe("the paste size measure", () => {
  it.each(fragments)(
    "%s: the measured state is what the paste really leaves",
    (_label, fragment, docFields) => {
      const doc = existingDoc();
      const at = { x: 5_000, y: 5_000 };
      const measured = stateBytesWith(doc, fragment, { at, docFields });
      applyJsonCanvas(doc, fragment, { at, origin: LOCAL, docFields });
      expect(Y.encodeStateAsUpdate(doc).length).toBeLessThanOrEqual(measured);
    },
  );

  it("a paste right at the cap: measure-approved means the merged state fits", () => {
    const doc = existingDoc();
    const fragment: JsonCanvas = {
      nodes: Array.from({ length: 120 }, (_, i) => textCard(`n${i}`, "y".repeat(i * 7), i)),
      edges: [],
    };
    const at = { x: 0, y: 0 };
    const cap = stateBytesWith(doc, fragment, { at }); // exactly what the editor allows
    applyJsonCanvas(doc, fragment, { at, origin: LOCAL });
    expect(Y.encodeStateAsUpdate(doc).length).toBeLessThanOrEqual(cap);
  });
});

describe("an import's undo step", () => {
  it("stays one ⌘Z while each chunk is applied quickly", () => {
    const doc = new Y.Doc();
    const undo = new Y.UndoManager([canvasNodes(doc)], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 400,
    });
    undo.stopCapturing();
    applyJsonCanvas(
      doc,
      { nodes: Array.from({ length: 450 }, (_, i) => textCard(`n${i}`, `c${i}`, i)), edges: [] },
      { mode: "fragment", at: { x: 0, y: 0 }, origin: LOCAL },
    );
    undo.stopCapturing();
    undo.undo();
    expect(canvasNodes(doc).size).toBe(0);
  });

  // On a slow device one 200-card transaction (with the editor's observers
  // running inside it) can outlast the 400 ms capture window. lib0 holds its
  // own `Date.now`, so a zero window stands in for the slow chunk.
  it("stays one ⌘Z when a chunk outlasts the capture window", () => {
    const doc = new Y.Doc();
    const undo = new Y.UndoManager([canvasNodes(doc)], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 0,
    });
    asOneUndoStep(undo, () =>
      applyJsonCanvas(
        doc,
        { nodes: Array.from({ length: 450 }, (_, i) => textCard(`n${i}`, `c${i}`, i)), edges: [] },
        { mode: "fragment", at: { x: 0, y: 0 }, origin: LOCAL },
      ),
    );
    expect(undo.captureTimeout).toBe(0);
    undo.undo();
    expect(canvasNodes(doc).size).toBe(0);
  });
});

const fileNode = (id: string, file: string) => ({
  id,
  type: "file",
  file,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
});

async function prepared(paths: string[]) {
  const nodes = paths.map((p, i) => fileNode(`n${i}`, p));
  const result = await runImportJob({
    source: {
      files: [
        { path: "Board.canvas", file: new Blob([enc(JSON.stringify({ nodes, edges: [] }))]) },
        ...paths.map((p) => ({ path: p, file: new Blob([PNG]) })),
      ],
    },
    options: { mode: "new" },
  });
  if (result.kind !== "import") throw new Error("expected an import");
  return result;
}

describe("duplicate images", () => {
  it("three copies of one image: when the shared upload fails, every copy is reported", async () => {
    const result = await prepared(["a/x.png", "b/y.png", "c/z.png"]);
    const scope = memoryScope();
    const upload = vi.fn(async () => {
      throw new Error("Upload refused.");
    });
    const uploader: ImageUploader = {
      match: (input) => scope.uploader.match(input),
      upload,
    };
    const out = await resolveImages(result.canvases, result.images, uploader);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(out.resolved.size).toBe(0);
    const reported = new Set(out.skipped.map((s) => s.path));
    for (const image of result.images) expect(reported.has(image.path)).toBe(true);
  });

  it("copies follow the first upload to its repaired path, each with its own repair line", async () => {
    const result = await prepared(["a/x.png", "b/y.png"]);
    const scope = memoryScope();
    // The scope already holds a different picture at the first path.
    await scope.uploader.upload(
      new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }),
      "a/x.png",
    );
    const out = await resolveImages(result.canvases, result.images, scope.uploader);
    expect(out.uploaded).toBe(1);
    const landed = [...out.resolved.values()].map((r) => r.path);
    expect(new Set(landed)).toEqual(new Set(["a/x 2.png"]));
    expect(
      out.repairs.map((r) => `${r.from} -> ${r.to}`).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["a/x.png -> a/x 2.png", "b/y.png -> a/x 2.png"]);
  });

  it("a second import of the same vault into the scope uploads nothing", async () => {
    const scope = memoryScope();
    const first = await prepared(["a/x.png", "b/y.png"]);
    await resolveImages(first.canvases, first.images, scope.uploader);
    const again = await prepared(["a/x.png", "b/y.png"]);
    const out = await resolveImages(again.canvases, again.images, scope.uploader);
    expect(out.uploaded).toBe(0);
    expect(scope.rows).toHaveLength(1);
  });
});

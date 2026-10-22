import { EditorView } from "@codemirror/view";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
// @vitest-environment jsdom
/**
 * Third-round probes: the size measure against a long-lived client, imports
 * into one canvas that overlap or outlast their own limit check, a stop
 * that lands between the last upload and the duplicate pass, an import
 * whose apply throws, and CRLF note bodies through the editor's undo.
 */
import { yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";

import { applyJsonCanvas, canvasNodes, type JsonCanvas } from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";

import { CardTextEditor } from "../../editor/CardTextEditor";
import type { PreparedImage } from "../canvas-io-jobs";
import { stateBytesWith } from "../clipboard";
import { asOneUndoStep, type ImageUploader, resolveImages } from "../import-flow";
import { useCanvasImport } from "../use-canvas-import";
import { fakeImportServer } from "./import-server";
import { PNG } from "./vault-fixtures";

const api = vi.hoisted(() => ({
  saveCanvasImport: vi.fn(),
  listCanvasAttachmentMatches: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("@/orpc/client", () => ({
  client: {
    saveCanvasImport: api.saveCanvasImport,
    listCanvasAttachmentMatches: api.listCanvasAttachmentMatches,
  },
  orpc: {},
}));
vi.mock("@/lib/image-upload", () => ({
  postImageForm: (_url: string, file: File, fields: Record<string, string>) =>
    api.upload(file, fields),
}));
vi.mock("@/lib/toast", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn() }),
}));

beforeAll(() => {
  const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects = rects;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.getClientRects = rects;
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function (this: Blob) {
      return new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(this);
      });
    };
  }
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const command = (key: string) => yUndoManagerKeymap.find((b) => b.key === key)!.run!;
const cmUndo = (view: EditorView) => command("Mod-z")(view);
const cmRedo = (view: EditorView) => command("Mod-y")(view);

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

describe("paste size measure against a long-lived client", () => {
  // The estimate used to encode the fragment on a scratch doc whose clocks
  // started at 0, under-counting a long-lived client's 3- and 4-byte clock
  // references. It's now measured on a copy of the doc itself.
  const fragment = cards("p", 200);
  const docAt = (clock: number) => {
    const doc = new Y.Doc();
    // Client ids are random uint32s; pinned so the result doesn't depend on the draw.
    doc.clientID = 2 ** 31 + 7;
    applyJsonCanvas(doc, cards("x", 30));
    if (clock) {
      doc.getText("big").insert(0, "x".repeat(clock));
      doc.getText("big").delete(0, clock);
    }
    return doc;
  };

  it.each([0, 20_000, 2_200_000])(
    "covers 200 short text cards from a client whose clock is %i",
    (clock) => {
      const doc = docAt(clock);
      const at = { x: 0, y: 0 };
      const measured = stateBytesWith(doc, fragment, { at });
      applyJsonCanvas(doc, fragment, { mode: "fragment", at });
      expect(measured).toBeGreaterThanOrEqual(Y.encodeStateAsUpdate(doc).length);
    },
  );
});

function intoHook(doc: Y.Doc) {
  return renderHook(() =>
    useCanvasImport({
      doc,
      canvasId: `c-${Math.random()}`,
      scope: { kind: "personal" },
      undo: new Y.UndoManager(canvasNodes(doc)),
      flush: async () => {},
      applyServerUpdate: (update) => Y.applyUpdate(doc, update),
      center: () => ({ x: 0, y: 0 }),
      onCreated: () => {},
    }),
  ).result;
}

const canvasSource = (name: string, canvas: JsonCanvas) => ({
  files: [{ path: name, file: new File([JSON.stringify(canvas)], name) }],
});

describe("imports into one canvas that overlap their limit check", () => {
  // Checked once in the worker, the caps went stale during uploads and
  // concurrent imports. Now one import runs at a time per canvas and the
  // server checks the merged state under the row lock.
  it("two concurrent drops never leave the canvas over maxNodes", async () => {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, cards("e", 1_000));
    const server = fakeImportServer(doc);
    api.saveCanvasImport.mockImplementation(server.saveCanvasImport);
    const hook = intoHook(doc);
    const a = hook.current.importInto(canvasSource("A.canvas", cards("a", 600)), {});
    const b = hook.current.importInto(canvasSource("B.canvas", cards("b", 600)), {});
    await Promise.allSettled([a, b]);
    expect(canvasNodes(doc).size).toBeLessThanOrEqual(CANVAS_LIMITS.maxNodes);
  });

  it("cards added while images upload are counted before the import is applied", async () => {
    api.listCanvasAttachmentMatches.mockResolvedValue({ byId: {}, bySha: {} });
    let release!: () => void;
    api.upload.mockImplementation(
      (_file: File, fields: Record<string, string>) =>
        new Promise((resolve) => {
          release = () => resolve({ id: "att-1", path: fields.path, url: "/images/1" });
        }),
    );
    const doc = new Y.Doc();
    applyJsonCanvas(doc, cards("e", 1_000));
    const server = fakeImportServer(doc);
    api.saveCanvasImport.mockImplementation(server.saveCanvasImport);
    const hook = intoHook(doc);
    const board = {
      nodes: [
        ...cards("a", 899).nodes,
        { id: "img", type: "file", file: "pic.png", x: 0, y: 0, width: 10, height: 10 },
      ],
      edges: [],
    };
    const run = hook.current
      .importInto(
        {
          files: [
            { path: "Board.canvas", file: new File([JSON.stringify(board)], "Board.canvas") },
            { path: "pic.png", file: new File([PNG], "pic.png", { type: "image/png" }) },
          ],
        },
        {},
      )
      .catch(() => null);
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    applyJsonCanvas(doc, cards("late", 500), { mode: "fragment", at: { x: 0, y: 900 } });
    await act(async () => release());
    await run;
    expect(canvasNodes(doc).size).toBeLessThanOrEqual(CANVAS_LIMITS.maxNodes);
  }, 30_000);
});

const prepared = (path: string, sha256: string): PreparedImage =>
  ({
    path,
    uploadPath: path,
    sha256,
    attachmentIds: [],
    upload: new File([PNG], path, { type: "image/png" }),
  }) as unknown as PreparedImage;

describe("a stop between the last upload and the duplicate pass", () => {
  it("returns without landing or reporting the duplicates, and uploads nothing more", async () => {
    let stopped = false;
    const upload = vi.fn(async (_file: File, path: string) => {
      stopped = true;
      return { id: `att-${path}`, path, url: "/images/x" };
    });
    const uploader: ImageUploader = { match: async () => ({ byId: {}, bySha: {} }), upload };
    const first = prepared("a.png", "s1");
    const dup = prepared("b.png", "s1");
    const out = await resolveImages([], [first, dup], uploader, { shouldStop: () => stopped });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(out.resolved.has(first)).toBe(true);
    expect(out.resolved.has(dup)).toBe(false);
    expect(out.skipped).toEqual([]);
  });
});

describe("asOneUndoStep when the apply throws", () => {
  it("restores the capture window and keeps what landed as one step of its own", () => {
    const doc = new Y.Doc();
    const nodes = canvasNodes(doc);
    const undo = new Y.UndoManager(nodes, { trackedOrigins: new Set(["local"]) });
    doc.transact(() => nodes.set("mine", new Y.Map()), "local");
    expect(() =>
      asOneUndoStep(undo, () => {
        applyJsonCanvas(doc, cards("a", 3), {
          mode: "fragment",
          at: { x: 0, y: 0 },
          origin: "local",
        });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(undo.captureTimeout).toBe(500);
    doc.transact(() => nodes.set("after", new Y.Map()), "local");
    undo.undo();
    expect(nodes.has("after")).toBe(false);
    expect(nodes.size).toBe(4);
    undo.undo();
    expect([...nodes.keys()]).toEqual(["mine"]);
  });
});

describe("a CRLF note body through the editor's undo and redo", () => {
  it("restores the exact bytes on undo and redoes the edit exactly", async () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    const body = "﻿a  \r\nb\r\n\r\nc\rd\n";
    text.insert(0, body);
    const { container } = render(<CardTextEditor text={text} onDone={() => {}} />);
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    const at = view.state.doc.toString().indexOf("c");
    view.dispatch({ changes: { from: at, to: at + 1, insert: "C!" } });
    const edited = "﻿a  \r\nb\r\n\r\nC!\rd\n";
    expect(text.toJSON()).toBe(edited);
    await new Promise((r) => setTimeout(r, 0));
    expect(cmUndo(view)).toBe(true);
    expect(text.toJSON()).toBe(body);
    expect(view.state.doc.toString()).toBe(body);
    expect(cmRedo(view)).toBe(true);
    expect(text.toJSON()).toBe(edited);
    expect(view.state.doc.toString()).toBe(edited);
  });

  it("keeps a remote CRLF edit in step with the open editor", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    text.insert(0, "one\r\ntwo");
    const { container } = render(<CardTextEditor text={text} onDone={() => {}} />);
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    text.insert(0, "zero\r\n");
    expect(view.state.doc.toString()).toBe("zero\r\none\r\ntwo");
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    expect(text.toJSON()).toBe("zero\r\none\r\ntwo!");
  });
});

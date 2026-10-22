// @vitest-environment jsdom
/**
 * Import-into edge cases: a reply lost after the server stored the import,
 * proxy errors versus the server's refusals, the busy guard being per
 * canvas, and a stop requested after the send.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { applyJsonCanvas, canvasNodes, type JsonCanvas } from "@/lib/canvas/json-canvas";

import { SERVER } from "../../editor/canvas-doc";
import { useCanvasImport } from "../use-canvas-import";
import { fakeImportServer } from "./import-server";

const api = vi.hoisted(() => ({
  saveCanvasImport: vi.fn(),
  listCanvasAttachmentMatches: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/orpc/client", () => ({
  client: {
    saveCanvasImport: api.saveCanvasImport,
    listCanvasAttachmentMatches: api.listCanvasAttachmentMatches,
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: Object.assign(vi.fn(), { error: api.toastError, success: vi.fn(), message: vi.fn() }),
}));

beforeAll(() => {
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

beforeEach(() => {
  api.saveCanvasImport.mockReset();
  api.toastError.mockReset();
  api.listCanvasAttachmentMatches.mockResolvedValue({ byId: {}, bySha: {} });
});
afterEach(() => cleanup());

const cards = (prefix: string, n: number): JsonCanvas => ({
  nodes: Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    type: "text",
    text: `card ${i}`,
    x: i * 10,
    y: 0,
    width: 200,
    height: 80,
  })),
  edges: [],
});

const source = (name: string, canvas: JsonCanvas) => ({
  files: [{ path: name, file: new File([JSON.stringify(canvas)], name) }],
});

function hookFor(doc: Y.Doc, canvasId: string) {
  const undo = new Y.UndoManager([canvasNodes(doc)], { trackedOrigins: new Set(["local"]) });
  return renderHook(() =>
    useCanvasImport({
      doc,
      canvasId,
      scope: { kind: "personal" },
      undo,
      flush: async () => {},
      applyServerUpdate: (update) => Y.applyUpdate(doc, update, SERVER),
      center: () => ({ x: 0, y: 0 }),
      onCreated: () => {},
    }),
  ).result;
}

describe("import into the open canvas: edges", { timeout: 60_000 }, () => {
  it("the busy guard is per canvas: another canvas imports meanwhile", async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const serverA = fakeImportServer(docA);
    const serverB = fakeImportServer(docB);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    api.saveCanvasImport.mockImplementation(async (input: { canvasId: string }) => {
      if (input.canvasId === "A") {
        await gate;
        return serverA.saveCanvasImport(input as never);
      }
      return serverB.saveCanvasImport(input as never);
    });
    const a = hookFor(docA, "A");
    const b = hookFor(docB, "B");
    const first = a.current.importInto(source("A.canvas", cards("a", 2)), {});
    await act(() => b.current.importInto(source("B.canvas", cards("b", 3)), {}));
    expect(canvasNodes(docB).size).toBe(3);
    release();
    await act(() => first);
    expect(canvasNodes(docA).size).toBe(2);
  });

  it("a stop asked for after the send still applies what the server stored", async () => {
    const doc = new Y.Doc();
    const server = fakeImportServer(doc);
    let stop = false;
    api.saveCanvasImport.mockImplementation(async (input: never) => {
      const reply = await server.saveCanvasImport(input);
      stop = true;
      return reply;
    });
    const hook = hookFor(doc, "S");
    await act(() =>
      hook.current.importInto(source("A.canvas", cards("a", 4)), { shouldStop: () => stop }),
    );
    expect(canvasNodes(server.stored).size).toBe(4);
    expect(canvasNodes(doc).size).toBe(4);
  });

  it("a reply lost after the server stored the import doesn't claim nothing was added", async () => {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, cards("e", 2), { origin: "local" });
    const server = fakeImportServer(doc);
    api.saveCanvasImport.mockImplementation(async (input: never) => {
      await server.saveCanvasImport(input);
      throw new TypeError("Failed to fetch");
    });
    const hook = hookFor(doc, "L");
    const error = await act(() =>
      hook.current.importInto(source("A.canvas", cards("a", 5)), {}).then(
        () => null,
        (e: Error) => e,
      ),
    );
    expect(canvasNodes(server.stored).size).toBe(7);
    expect(canvasNodes(doc).size).toBe(2);
    // The server has it, so "nothing was added" is wrong; retrying would import twice.
    expect(error?.message ?? "").not.toMatch(/nothing was added/i);
  });

  it.each(["GATEWAY_TIMEOUT", "BAD_GATEWAY", "INTERNAL_SERVER_ERROR"])(
    "a %s isn't reported as a refusal",
    async (code) => {
      const doc = new Y.Doc();
      api.saveCanvasImport.mockRejectedValue(Object.assign(new Error("Gateway Timeout"), { code }));
      const hook = hookFor(doc, `P-${code}`);
      const error = await act(() =>
        hook.current.importInto(source("A.canvas", cards("a", 2)), {}).then(
          () => null,
          (e: Error) => e,
        ),
      );
      expect(error?.message).toMatch(/couldn't confirm the import was saved/i);
    },
  );

  it("the server's own refusal shows its message", async () => {
    const doc = new Y.Doc();
    api.saveCanvasImport.mockRejectedValue(
      Object.assign(new Error("A canvas holds 2,000 cards."), { code: "PAYLOAD_TOO_LARGE" }),
    );
    const hook = hookFor(doc, "R");
    const error = await act(() =>
      hook.current.importInto(source("A.canvas", cards("a", 2)), {}).then(
        () => null,
        (e: Error) => e,
      ),
    );
    expect(error?.message).toBe("A canvas holds 2,000 cards.");
  });
});

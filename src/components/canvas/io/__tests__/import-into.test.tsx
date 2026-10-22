// @vitest-environment jsdom
/**
 * Importing into the open canvas goes through `saveCanvasImport`: nothing
 * lands in the doc until the server took it, over a cap nothing lands at
 * all, one import runs at a time, it undoes in one step, and with the live
 * provider on an import far over one sync message arrives without the
 * provider sending (or refusing) it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { restoreCanvasInto } from "@/lib/canvas/doc-state";
import {
  applyJsonCanvas,
  canvasNodes,
  fileBodyOf,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";
import { CANVAS_IMPORT_LIMITS, CANVAS_LIMITS } from "@/lib/canvas/limits";

import { SERVER } from "../../editor/canvas-doc";
import { useCanvasSync } from "../../editor/use-canvas-sync";
import { IMPORT_BUSY_MESSAGE, useCanvasImport } from "../use-canvas-import";
import { type FakeImportServer, fakeImportServer } from "./import-server";

const api = vi.hoisted(() => ({
  saveCanvasImport: vi.fn(),
  listCanvasAttachmentMatches: vi.fn(),
  toastError: vi.fn(),
  providers: [] as { config: Record<string, unknown>; disconnect: ReturnType<typeof vi.fn> }[],
}));

vi.mock("@/orpc/client", () => ({
  client: {
    saveCanvasImport: api.saveCanvasImport,
    listCanvasAttachmentMatches: api.listCanvasAttachmentMatches,
    getCanvasSyncToken: async () => ({ token: "t", url: "wss://sync.test", access: "write" }),
  },
  orpc: {
    getCanvas: {
      queryOptions: ({ input }: { input: { canvasId: string } }) => ({
        queryKey: ["getCanvas", input.canvasId],
      }),
    },
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: Object.assign(vi.fn(), { error: api.toastError, success: vi.fn(), message: vi.fn() }),
}));
vi.mock("@hocuspocus/provider", () => ({
  WebSocketStatus: {
    Connecting: "connecting",
    Connected: "connected",
    Disconnected: "disconnected",
  },
  HocuspocusProvider: class {
    config: Record<string, unknown>;
    connect = vi.fn();
    disconnect = vi.fn();
    destroy = vi.fn();
    isSynced = true;
    unsyncedChanges = 0;
    hasUnsyncedChanges = false;
    configuration = { websocketProvider: { status: "connected" } };
    constructor(config: Record<string, unknown>) {
      this.config = config;
      api.providers.push(this as never);
    }
  },
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

let server: FakeImportServer;

beforeEach(() => {
  api.saveCanvasImport.mockReset();
  api.toastError.mockReset();
  api.listCanvasAttachmentMatches.mockResolvedValue({ byId: {}, bySha: {} });
  api.providers.length = 0;
});
afterEach(() => cleanup());

const LOCAL = "local";

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

const canvasSource = (
  name: string,
  canvas: JsonCanvas,
  extra: { path: string; text: string }[] = [],
) => ({
  files: [
    { path: name, file: new File([JSON.stringify(canvas)], name) },
    ...extra.map((f) => ({ path: f.path, file: new File([f.text], f.path) })),
  ],
});

/** The solo editor's side: an undo manager on local edits and the save hook's `applyRestored`. */
function soloHook(doc: Y.Doc) {
  server = fakeImportServer(doc);
  api.saveCanvasImport.mockImplementation(server.saveCanvasImport);
  const undo = new Y.UndoManager([canvasNodes(doc)], { trackedOrigins: new Set([LOCAL]) });
  const hook = renderHook(() =>
    useCanvasImport({
      doc,
      canvasId: `solo-${Math.random()}`,
      scope: { kind: "personal" },
      undo,
      flush: async () => {},
      applyServerUpdate: (update) => Y.applyUpdate(doc, update, SERVER),
      center: () => ({ x: 0, y: 0 }),
      onCreated: () => {},
    }),
  );
  return { hook: hook.result, undo };
}

describe("an import into the open canvas", { timeout: 60_000 }, () => {
  it("lands only once the server has stored it, and undoes in one step", async () => {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, cards("e", 3), { origin: LOCAL });
    const { hook, undo } = soloHook(doc);
    let sizeWhenSent = -1;
    api.saveCanvasImport.mockImplementation(async (input) => {
      sizeWhenSent = canvasNodes(doc).size;
      return server.saveCanvasImport(input);
    });

    await act(() => hook.current.importInto(canvasSource("A.canvas", cards("a", 5)), {}));
    expect(sizeWhenSent).toBe(3);
    expect(canvasNodes(doc).size).toBe(8);
    expect(canvasNodes(server.stored).size).toBe(8);

    undo.undo();
    expect(canvasNodes(doc).size).toBe(3);
  });

  it("leaves a pre-import version that restores the canvas as it was", async () => {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, cards("e", 3), { origin: LOCAL });
    const { hook } = soloHook(doc);
    // Edits this tab holds that the server hasn't stored yet (live: the service's debounce).
    applyJsonCanvas(doc, cards("late", 2), { mode: "fragment", origin: LOCAL });

    await act(() => hook.current.importInto(canvasSource("A.canvas", cards("a", 5)), {}));
    expect(server.versions).toHaveLength(1);

    const version = new Y.Doc();
    Y.applyUpdate(version, server.versions[0]!);
    expect(canvasNodes(version).size).toBe(5);
    restoreCanvasInto(server.stored, version, "restore");
    expect(canvasNodes(server.stored).size).toBe(5);
  });

  it("is refused whole when the server's merged state is over the card cap", async () => {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, cards("e", 1_000), { origin: LOCAL });
    const { hook } = soloHook(doc);
    // A collaborator's 500 stored cards this tab hasn't seen yet.
    applyJsonCanvas(server.stored, cards("theirs", 500), { mode: "fragment" });
    const before = Y.encodeStateAsUpdate(doc);

    await expect(
      act(() => hook.current.importInto(canvasSource("A.canvas", cards("a", 900)), {})),
    ).rejects.toThrow(/Nothing was imported/);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(canvasNodes(server.stored).size).toBe(1_500);
    expect(server.versions).toHaveLength(0);
  });

  it("refuses an import this tab can already see is over the cap, without sending it", async () => {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, cards("e", 1_500), { origin: LOCAL });
    const { hook } = soloHook(doc);
    await expect(
      act(() => hook.current.importInto(canvasSource("A.canvas", cards("a", 600)), {})),
    ).rejects.toThrow(/2,100 cards/);
    expect(api.saveCanvasImport).not.toHaveBeenCalled();
    expect(canvasNodes(doc).size).toBe(1_500);
  });

  it("runs one at a time per canvas: a second import is refused while one runs", async () => {
    const doc = new Y.Doc();
    applyJsonCanvas(doc, cards("e", 1_000), { origin: LOCAL });
    const { hook } = soloHook(doc);
    const first = hook.current.importInto(canvasSource("A.canvas", cards("a", 600)), {});
    await expect(
      hook.current.importInto(canvasSource("B.canvas", cards("b", 600)), {}),
    ).rejects.toThrow(IMPORT_BUSY_MESSAGE);
    act(() =>
      hook.current.importDropped([{ path: "C.canvas", file: new File(["{}"], "C.canvas") }], {
        x: 0,
        y: 0,
      }),
    );
    expect(api.toastError).toHaveBeenCalledWith(IMPORT_BUSY_MESSAGE);
    await act(() => first);
    expect(canvasNodes(doc).size).toBe(1_600);

    // Once done, the next one runs (and the server refuses it over the cap).
    await expect(
      act(() => hook.current.importInto(canvasSource("B.canvas", cards("b", 600)), {})),
    ).rejects.toThrow(/2,200 cards/);
    expect(canvasNodes(doc).size).toBe(1_600);
  });
});

describe("an import into a live canvas", { timeout: 60_000 }, () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  function liveHooks(doc: Y.Doc) {
    queryClient = new QueryClient();
    server = fakeImportServer(doc);
    api.saveCanvasImport.mockImplementation(server.saveCanvasImport);
    const undo = new Y.UndoManager([canvasNodes(doc)], { trackedOrigins: new Set([LOCAL]) });
    const canvasId = `live-${Math.random()}`;
    const hook = renderHook(
      () => {
        const saver = useCanvasSync(doc, canvasId, {
          token: "first",
          url: "wss://sync.test",
          access: "write",
        });
        const importer = useCanvasImport({
          doc,
          canvasId,
          scope: { kind: "personal" },
          undo,
          flush: saver.save,
          applyServerUpdate: saver.applyRestored,
          center: () => ({ x: 0, y: 0 }),
          onCreated: () => {},
        });
        return { saver, importer };
      },
      { wrapper },
    );
    const provider = api.providers.at(-1)!;
    const origins: unknown[] = [];
    doc.on("update", (_u: Uint8Array, origin: unknown) => origins.push(origin));
    return { hook: hook.result, provider, origins, undo };
  }

  it("brings in a single note over one sync message, applied as the provider's own", async () => {
    const doc = new Y.Doc();
    const { hook, provider, origins, undo } = liveHooks(doc);
    const body = "x".repeat(CANVAS_IMPORT_LIMITS.maxMarkdownBytes - 16);
    const board: JsonCanvas = {
      nodes: [{ id: "f", type: "file", file: "big.md", x: 0, y: 0, width: 400, height: 400 }],
      edges: [],
    };

    await act(() =>
      hook.current.importer.importInto(
        canvasSource("Board.canvas", board, [{ path: "big.md", text: body }]),
        {},
      ),
    );
    expect(server.calls[0]!.update.length).toBeGreaterThan(CANVAS_LIMITS.maxMessageBytes);
    const [node] = [...canvasNodes(doc).values()];
    expect(fileBodyOf(node!)?.text).toBe(body);
    expect(origins.every((origin) => origin === provider)).toBe(true);
    expect(provider.disconnect).not.toHaveBeenCalled();
    expect(hook.current.saver.status).not.toBe("too-large");

    // ⌘Z still takes it back; that delete is small enough to send.
    undo.undo();
    expect(canvasNodes(doc).size).toBe(0);
    expect(provider.disconnect).not.toHaveBeenCalled();
  });

  it("undoes the import in one step when canvas-sync's broadcast lands before the reply", async () => {
    const doc = new Y.Doc();
    const { hook, provider, undo } = liveHooks(doc);
    const [mine] = applyJsonCanvas(doc, cards("e", 1), { origin: LOCAL }).created;
    undo.stopCapturing();
    const collaborator = new Y.Doc();
    Y.applyUpdate(collaborator, Y.encodeStateAsUpdate(doc));
    const [theirs] = applyJsonCanvas(collaborator, cards("c", 1)).created;
    api.saveCanvasImport.mockImplementation(async (input: never) => {
      // A collaborator's edit, then the stored import, both through the provider.
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(collaborator, Y.encodeStateVector(doc)), provider);
      const reply = await server.saveCanvasImport(input);
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(server.stored, Y.encodeStateVector(doc)), provider);
      return reply;
    });

    await act(() => hook.current.importer.importInto(canvasSource("A.canvas", cards("a", 3)), {}));
    expect(canvasNodes(doc).size).toBe(5);

    undo.undo();
    expect([...canvasNodes(doc).keys()].sort()).toEqual([mine, theirs].sort());
    undo.undo();
    expect([...canvasNodes(doc).keys()]).toEqual([theirs]);
  });

  it("brings in several MB of notes in one import", async () => {
    const doc = new Y.Doc();
    const { hook, provider } = liveHooks(doc);
    const notes = Array.from({ length: 4 }, (_, i) => ({
      path: `n${i}.md`,
      text: `${i}`.repeat(700_000),
    }));
    const board: JsonCanvas = {
      nodes: notes.map((n, i) => ({
        id: `f${i}`,
        type: "file",
        file: n.path,
        x: i * 500,
        y: 0,
        width: 400,
        height: 400,
      })),
      edges: [],
    };
    await act(() =>
      hook.current.importer.importInto(canvasSource("Board.canvas", board, notes), {}),
    );
    expect(server.calls[0]!.update.length).toBeGreaterThan(2_500_000);
    expect(canvasNodes(doc).size).toBe(4);
    expect(provider.disconnect).not.toHaveBeenCalled();
    await waitFor(() => expect(hook.current.saver.status).not.toBe("too-large"));
  });
});

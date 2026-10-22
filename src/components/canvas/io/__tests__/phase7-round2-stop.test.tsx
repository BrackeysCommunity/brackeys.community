// @vitest-environment jsdom
/**
 * Stopping an import while its images upload: the dialog says nothing more
 * is created, and no further upload should start either (each one spends
 * the member's daily image budget).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { ImportDialog } from "../ImportDialog";
import { useCanvasImport } from "../use-canvas-import";
import { PNG } from "./vault-fixtures";

const api = vi.hoisted(() => ({
  listCanvases: vi.fn(),
  createCanvas: vi.fn(),
  listCanvasAttachmentMatches: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/orpc/client", () => ({
  client: {
    listCanvases: api.listCanvases,
    createCanvas: api.createCanvas,
    listCanvasAttachmentMatches: api.listCanvasAttachmentMatches,
  },
  orpc: { listCanvases: { key: () => ["listCanvases"] } },
}));
vi.mock("@/lib/image-upload", () => ({
  postImageForm: (_url: string, file: File, fields: Record<string, string>) =>
    api.upload(file, fields),
}));
vi.mock("@/lib/toast", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn() }),
}));

beforeAll(() => {
  // The jobs chunk loads lazily on the first scan; under full-suite load that can take seconds.
  configure({ asyncUtilTimeout: 15_000 });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
  for (const fn of Object.values(api)) fn.mockReset();
  api.listCanvases.mockResolvedValue([{ path: "Board.canvas" }]);
  api.listCanvasAttachmentMatches.mockResolvedValue({ byId: {}, bySha: {} });
  api.createCanvas.mockImplementation(async ({ path }: { path: string }) => ({
    id: `id-${path}`,
    path,
  }));
  let n = 0;
  api.upload.mockImplementation(async (_file: File, fields: Record<string, string>) => ({
    id: `att-${++n}`,
    path: fields.path,
    url: `/images/${n}`,
  }));
});
afterEach(() => {
  cleanup();
});

function mount(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ImportDialog open onClose={onClose} mode="new" scope={{ kind: "personal" }} />
    </QueryClientProvider>,
  );
  return { onClose };
}

function pick(files: File[]) {
  const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

const canvasFile = (name: string, nodes: object[]) =>
  new File([JSON.stringify({ nodes, edges: [] })], name, { type: "" });

/** Distinct tiny PNGs (a trailing byte past IEND keeps each sha different). */
const pngs = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const bytes = new Uint8Array(PNG.length + 1);
    bytes.set(PNG);
    bytes[PNG.length] = i;
    return new File([bytes], `pic${i}.png`, { type: "image/png" });
  });

const boardWith = (files: File[]) =>
  canvasFile(
    "Board.canvas",
    files.map((f, i) => ({
      id: `i${i}`,
      type: "file",
      file: f.name,
      x: i * 20,
      y: 0,
      width: 10,
      height: 10,
    })),
  );

function gatedUploads() {
  const gates: (() => void)[] = [];
  api.upload.mockImplementation(
    (_file: File, fields: Record<string, string>) =>
      new Promise((resolve) =>
        gates.push(() =>
          resolve({ id: `att-${fields.path}`, path: fields.path, url: "/images/x" }),
        ),
      ),
  );
  return {
    releaseAll: async () => {
      await act(async () => {
        for (let round = 0; round < 10; round++) {
          for (const open of gates.splice(0)) open();
          await new Promise((r) => setTimeout(r, 20));
        }
      });
    },
  };
}

describe("stopping during uploads", { timeout: 60_000 }, () => {
  // Each upload spends the member's daily image budget, so the pool checks
  // the stop before taking the next image.
  it("new mode: no upload starts after STOP", async () => {
    const uploads = gatedUploads();
    mount();
    const images = pngs(9);
    pick([boardWith(images), ...images]);
    await screen.findByText("Board.canvas");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: "STOP" }));
    await uploads.releaseAll();
    expect(api.createCanvas).not.toHaveBeenCalled();
    expect(api.upload).toHaveBeenCalledTimes(3);
  });

  it("into mode (the open canvas's own import): no upload starts after a stop", async () => {
    const uploads = gatedUploads();
    const doc = new Y.Doc();
    const { result } = renderHook(() =>
      useCanvasImport({
        doc,
        canvasId: "c1",
        scope: { kind: "personal" },
        undo: new Y.UndoManager(doc.getMap("nodes")),
        flush: async () => {},
        applyServerUpdate: () => {},
        center: () => ({ x: 0, y: 0 }),
        onCreated: () => {},
      }),
    );
    const images = pngs(9);
    let stop = false;
    const run = result.current.importInto(
      { files: [boardWith(images), ...images].map((file) => ({ path: file.name, file })) },
      { shouldStop: () => stop },
    );
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(3));
    stop = true;
    await uploads.releaseAll();
    expect(await run).toBeNull();
    expect(doc.getMap("nodes").size).toBe(0);
    expect(api.upload).toHaveBeenCalledTimes(3);
  });
});

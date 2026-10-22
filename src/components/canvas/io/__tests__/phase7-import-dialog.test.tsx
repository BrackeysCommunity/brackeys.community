// @vitest-environment jsdom
/**
 * "Import from Obsidian" end to end in the dialog: pick, choose, import,
 * report; a refusal shown with its numbers before anything is uploaded or
 * created; and stopping an import part way.
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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CANVAS_LIMITS } from "@/lib/canvas/limits";

import { ImportDialog } from "../ImportDialog";
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

describe("Import from Obsidian", { timeout: 60_000 }, () => {
  it("imports a picked canvas with its note and image, renaming around a taken path", async () => {
    mount();
    pick([
      canvasFile("Board.canvas", [
        { id: "f", type: "file", file: "Idea.md", x: 0, y: 0, width: 10, height: 10 },
        { id: "i", type: "file", file: "pic.png", x: 50, y: 0, width: 10, height: 10 },
      ]),
      new File(["# Idea\r\n"], "Idea.md"),
      new File([PNG], "pic.png", { type: "image/png" }),
    ]);
    await screen.findByText("Board.canvas");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(api.createCanvas).toHaveBeenCalledTimes(1));
    expect(api.createCanvas.mock.calls[0]![0]).toMatchObject({
      path: "Board 2.canvas",
      source: "obsidian_canvas",
      scope: { kind: "personal" },
    });
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.upload.mock.calls[0]![1]).toMatchObject({ scope: "personal", path: "pic.png" });
  });

  it("shows a refusal with its numbers and uploads or creates nothing", async () => {
    mount();
    const nodes = Array.from({ length: CANVAS_LIMITS.maxNodes + 1 }, (_, i) => ({
      id: `n${i}`,
      type: "file",
      file: `img${i % 3}.png`,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }));
    pick([canvasFile("Huge.canvas", nodes), new File([PNG], "img0.png", { type: "image/png" })]);
    await screen.findByText("Huge.canvas");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText(/2,001 cards.*2,000/);
    expect(api.upload).not.toHaveBeenCalled();
    expect(api.listCanvasAttachmentMatches).not.toHaveBeenCalled();
    expect(api.createCanvas).not.toHaveBeenCalled();
  });

  it("creates nothing more once the import is stopped", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    api.upload.mockImplementation(async (_file: File, fields: Record<string, string>) => {
      await gate;
      return { id: "att", path: fields.path, url: "/images/1" };
    });
    mount();
    pick([
      canvasFile("Board.canvas", [
        { id: "i", type: "file", file: "pic.png", x: 0, y: 0, width: 1, height: 1 },
      ]),
      new File([PNG], "pic.png", { type: "image/png" }),
    ]);
    await screen.findByText("Board.canvas");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(api.upload).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const stop = await screen.findByRole("button", { name: "STOP" });
    fireEvent.click(stop);
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(api.createCanvas).not.toHaveBeenCalled();
  });

  it("into mode: a stop reaches the open canvas's import and no report follows", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let shouldStop: (() => boolean) | undefined;
    const importInto = vi.fn(async (_source: unknown, options: { shouldStop: () => boolean }) => {
      shouldStop = options.shouldStop;
      await gate;
      return options.shouldStop()
        ? null
        : {
            canvases: [],
            skipped: [],
            repairs: [],
            notesAttached: 0,
            imagesUploaded: 0,
            imagesReused: 0,
          };
    });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ImportDialog
          open
          onClose={onClose}
          mode="into"
          scope={{ kind: "personal" }}
          importInto={importInto as never}
        />
      </QueryClientProvider>,
    );
    pick([
      canvasFile("Board.canvas", [
        { id: "t", type: "text", text: "x", x: 0, y: 0, width: 1, height: 1 },
      ]),
    ]);
    await screen.findByText("Board.canvas");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(importInto).toHaveBeenCalled());
    expect(shouldStop!()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: "STOP" }));
    expect(shouldStop!()).toBe(true);
    expect(onClose).toHaveBeenCalled();
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText("Import finished")).toBeNull();
  });
});

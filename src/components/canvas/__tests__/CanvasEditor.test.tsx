// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { bytesToBase64 } from "@/lib/canvas/encoding";
import { applyJsonCanvas, docToJsonCanvas, type JsonCanvas } from "@/lib/canvas/json-canvas";

import type { CanvasDetail } from "../canvas-queries";
import CanvasEditor from "../editor/CanvasEditor";
import { fakeImportServer } from "../io/__tests__/import-server";

const saveCanvas = vi.hoisted(() => vi.fn());
const saveCanvasImport = vi.hoisted(() => vi.fn());

vi.mock("@/orpc/client", () => ({
  client: {
    saveCanvas,
    saveCanvasImport,
    listCanvasAttachments: vi.fn(async () => ({})),
    getCanvasEntities: vi.fn(async () => []),
  },
  orpc: {},
}));

beforeAll(() => {
  // React Flow measures its container and nodes; jsdom has no layout.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22 = 1;
      constructor() {}
    },
  );
  // Wide enough for the inspector.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1280px)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { configurable: true, get: () => 1200 },
    offsetHeight: { configurable: true, get: () => 800 },
    clientWidth: { configurable: true, get: () => 1200 },
    clientHeight: { configurable: true, get: () => 800 },
  });
});
afterEach(cleanup);

// jsdom's Blob has no arrayBuffer(); the import reads dropped files with it.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(this);
    });
  };
}

function detail(extra: JsonCanvas["nodes"] = []): CanvasDetail {
  const doc = new Y.Doc();
  applyJsonCanvas(
    doc,
    {
      nodes: [
        { id: "a", type: "text", text: "Hello **canvas**", x: 0, y: 0, width: 200, height: 80 },
        { id: "g", type: "group", label: "Ideas", x: -50, y: -50, width: 400, height: 300 },
        ...extra,
      ],
      edges: [],
    },
    { mode: "whole", docFields: { f: { text: "# Idea body\r\nmore" } } },
  );
  return {
    id: "c1",
    path: "Plan.canvas",
    title: "Plan",
    scope: { kind: "personal" },
    visibility: "private",
    nodeCount: 2,
    lastEditedById: null,
    lastEditedAt: null,
    hidden: false,
    deletedAt: null,
    updatedAt: new Date(),
    hiddenReason: null,
    access: "owner",
    snapshot: docToJsonCanvas(doc),
    state: bytesToBase64(Y.encodeStateAsUpdate(doc)),
    attachments: {},
  } as CanvasDetail;
}

/** Under StrictMode, as the app runs in dev: effects run, clean up, and run again. */
function mount(canvas = detail()) {
  return render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <div style={{ width: 1200, height: 800 }}>
          <CanvasEditor
            canvas={canvas}
            onStatus={() => {}}
            panel={null}
            onClosePanel={() => {}}
            chrome={{ topLeft: null, toggles: null, status: null }}
          />
        </div>
      </QueryClientProvider>
    </StrictMode>,
  );
}

const cardCount = (container: HTMLElement) =>
  container.querySelectorAll(".react-flow__node").length;

describe("CanvasEditor", () => {
  it("mounts over the doc and renders its cards and tool dock", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("canvas")).toBeTruthy());
    expect(screen.getByText("Ideas")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Tools" })).toBeTruthy();
    expect(screen.getByLabelText("Text")).toBeTruthy();
  });

  it("arms a tool from its shortcut and Escape disarms it", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("canvas")).toBeTruthy());
    fireEvent.keyDown(window, { key: "t" });
    await screen.findByTestId("placement-layer");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("placement-layer")).toBeNull());
  });

  it("shows the selection bar and inspector for a selected card, and Escape clears it", async () => {
    const { container } = mount();
    await waitFor(() => expect(screen.getByText("canvas")).toBeTruthy());
    fireEvent.click(container.querySelector('.react-flow__node[data-id="a"]')!);
    await screen.findByRole("toolbar", { name: "Selection" });
    expect(screen.getByRole("complementary", { name: "Inspector" }).textContent).toContain(
      "Text card",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "Selection" })).toBeNull());
    expect(screen.queryByRole("complementary", { name: "Inspector" })).toBeNull();
  });

  it("opens CodeMirror on a double-clicked text card and closes it on Escape", async () => {
    const { container } = mount();
    await waitFor(() => expect(screen.getByText("canvas")).toBeTruthy());
    fireEvent.doubleClick(screen.getByText("canvas"));
    await waitFor(() => expect(container.querySelector(".cm-content")).not.toBeNull());
    expect(container.querySelector(".cm-content")!.textContent).toBe("Hello **canvas**");
    fireEvent.keyDown(container.querySelector(".cm-content")!, { key: "Escape" });
    await waitFor(() => expect(container.querySelector(".cm-content")).toBeNull());
  });

  it("places a card with a dock tool, drops back to Select, and ⌘Z takes it back", async () => {
    const { container } = mount();
    await waitFor(() => expect(cardCount(container)).toBe(2));
    fireEvent.click(screen.getByLabelText("Group"));
    const layer = await screen.findByTestId("placement-layer");
    fireEvent.pointerDown(layer, { button: 0, clientX: 600, clientY: 400 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 600, clientY: 400 });
    await waitFor(() => expect(cardCount(container)).toBe(3));
    expect(screen.queryByTestId("placement-layer")).toBeNull();
    expect(screen.getByLabelText("Select").getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true });
    });
    await waitFor(() => expect(cardCount(container)).toBe(2));
  });
});

/** A clipboard event carrying a writable, readable DataTransfer stand-in. */
function clipboardEvent(type: "copy" | "paste", data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      setData: (t: string, v: string) => store.set(t, v),
      getData: (t: string) => store.get(t) ?? "",
      files: [],
    },
  });
  return { event, store };
}

describe("CanvasEditor files and clipboard", () => {
  it("copies the selection as Obsidian's type, our HTML payload and a Markdown outline", async () => {
    const { container } = mount();
    await waitFor(() => expect(screen.getByText("canvas")).toBeTruthy());
    fireEvent.click(container.querySelector('.react-flow__node[data-id="a"]')!);
    await screen.findByRole("toolbar", { name: "Selection" });
    const { event, store } = clipboardEvent("copy");
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect([...store.keys()].sort()).toEqual(["obsidian/canvas", "text/html", "text/plain"]);
    expect(JSON.parse(store.get("obsidian/canvas")!).center).toEqual({ x: 100, y: 40 });
    expect(store.get("text/html")).toContain("data-jams-team-canvas");
    expect(store.get("text/plain")).toBe("Hello **canvas**\n");
  });

  it("pastes an Obsidian copy as cards", async () => {
    const { container } = mount();
    await waitFor(() => expect(cardCount(container)).toBe(2));
    const payload = {
      nodes: [
        { id: "x", type: "text", text: "From Obsidian", x: 10, y: 10, width: 200, height: 80 },
        { id: "y", type: "text", text: "Second", x: 300, y: 10, width: 200, height: 80 },
      ],
      edges: [{ id: "xy", fromNode: "x", toNode: "y" }],
      center: { x: 255, y: 50 },
    };
    const { event } = clipboardEvent("paste", { "obsidian/canvas": JSON.stringify(payload) });
    act(() => {
      document.body.dispatchEvent(event);
    });
    await waitFor(() => expect(cardCount(container)).toBe(4));
    expect(screen.getByText("From Obsidian")).toBeTruthy();
  });

  it("shows a file card's note body under a NOTE label", async () => {
    const { container } = mount(
      detail([
        { id: "f", type: "file", file: "Notes/Idea.md", x: 600, y: 0, width: 300, height: 200 },
      ]),
    );
    await waitFor(() => expect(cardCount(container)).toBe(3));
    const card = container.querySelector('.react-flow__node[data-id="f"]')!;
    expect(card.querySelector("[data-note-badge]")?.textContent).toBe("NOTE");
    expect(card.textContent).toContain("Notes/Idea.md");
    expect(card.textContent).toContain("Idea body");
  });

  it("imports a dropped .canvas at the drop point through saveCanvasImport, and one ⌘Z undoes it", async () => {
    saveCanvasImport.mockReset();
    saveCanvasImport.mockImplementation(fakeImportServer().saveCanvasImport);
    const { container } = mount();
    await waitFor(() => expect(cardCount(container)).toBe(2));
    const dropped = JSON.stringify({
      nodes: [
        { id: "d1", type: "text", text: "Dropped one", x: 0, y: 0, width: 200, height: 80 },
        { id: "d2", type: "text", text: "Dropped two", x: 300, y: 0, width: 200, height: 80 },
      ],
      edges: [],
    });
    const file = new File([dropped], "Board.canvas", { type: "" });
    const host = screen.getByRole("application", { name: "Canvas editor" });
    await act(async () => {
      fireEvent.drop(host, {
        clientX: 500,
        clientY: 300,
        dataTransfer: { files: [file], items: [], getData: () => "" },
      });
    });
    await waitFor(() => expect(cardCount(container)).toBe(4), { timeout: 3000 });
    expect(saveCanvasImport).toHaveBeenCalledWith(expect.objectContaining({ canvasId: "c1" }));
    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true });
    });
    await waitFor(() => expect(cardCount(container)).toBe(2));
  });
});

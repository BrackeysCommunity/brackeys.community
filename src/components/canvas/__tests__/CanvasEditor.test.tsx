// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { bytesToBase64 } from "@/lib/canvas/encoding";
import { applyJsonCanvas, docToJsonCanvas } from "@/lib/canvas/json-canvas";

import type { CanvasDetail } from "../canvas-queries";
import CanvasEditor from "../editor/CanvasEditor";

vi.mock("@/orpc/client", () => ({
  client: {
    saveCanvas: vi.fn(),
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

function detail(): CanvasDetail {
  const doc = new Y.Doc();
  applyJsonCanvas(
    doc,
    {
      nodes: [
        { id: "a", type: "text", text: "Hello **canvas**", x: 0, y: 0, width: 200, height: 80 },
        { id: "g", type: "group", label: "Ideas", x: -50, y: -50, width: 400, height: 300 },
      ],
      edges: [],
    },
    { mode: "whole" },
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
function mount() {
  return render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <div style={{ width: 1200, height: 800 }}>
          <CanvasEditor
            canvas={detail()}
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

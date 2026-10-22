// @vitest-environment jsdom
/**
 * The editor's files and clipboard wiring, read through the live doc the
 * editor hands its page (`exportDoc`): what a copy writes, what a paste and
 * a drop create and where, how an import undoes, and what it saves.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { base64ToBytes, bytesToBase64 } from "@/lib/canvas/encoding";
import {
  applyJsonCanvas,
  canvasNodes,
  docOnlyFields,
  docToJsonCanvas,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";

import type { CanvasDetail } from "../canvas-queries";
import CanvasEditor, { type CanvasEditorHandle } from "../editor/CanvasEditor";
import { fakeImportServer } from "../io/__tests__/import-server";
import { parseCanvasHtml } from "../io/clipboard";

const saveCanvas = vi.hoisted(() => vi.fn());
const saveCanvasImport = vi.hoisted(() => vi.fn());
const toasts = vi.hoisted(() => ({ error: [] as string[] }));

vi.mock("@/orpc/client", () => ({
  client: {
    saveCanvas,
    saveCanvasImport,
    listCanvasAttachments: vi.fn(async () => ({})),
    listCanvasAttachmentMatches: vi.fn(async () => ({ byId: {}, bySha: {} })),
    getCanvasEntities: vi.fn(async () => []),
  },
  orpc: {},
}));
vi.mock("@/lib/toast", () => ({
  toast: Object.assign(vi.fn(), {
    error: (m: string) => toasts.error.push(m),
    success: vi.fn(),
    message: vi.fn(),
  }),
}));

beforeAll(() => {
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
    },
  );
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
  toasts.error = [];
  saveCanvas.mockReset();
  saveCanvas.mockImplementation(async () => ({
    update: bytesToBase64(Y.encodeStateAsUpdate(new Y.Doc())),
    stateVector: bytesToBase64(new Uint8Array([0])),
  }));
  saveCanvasImport.mockReset();
  saveCanvasImport.mockImplementation(fakeImportServer().saveCanvasImport);
});
afterEach(cleanup);

const ATTACHMENT = "11111111-1111-4111-8111-111111111111";

const everyCard: JsonCanvas = {
  nodes: [
    {
      id: "t",
      type: "text",
      text: "Hello **canvas**",
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      color: "2",
    },
    { id: "l", type: "link", url: "https://example.com/", x: 300, y: 0, width: 200, height: 80 },
    { id: "g", type: "group", label: "Ideas", x: -50, y: -50, width: 1200, height: 700 },
    {
      id: "f",
      type: "file",
      file: "Notes/Idea.md",
      subpath: "#H",
      x: 0,
      y: 200,
      width: 300,
      height: 200,
    },
    { id: "p", type: "file", file: "Docs/a.pdf", x: 400, y: 200, width: 200, height: 80 },
    {
      id: "i",
      type: "file",
      file: "attachments/boss.png",
      x: 700,
      y: 0,
      width: 200,
      height: 200,
      jamsTeam: { type: "image", attachmentId: ATTACHMENT },
    },
    {
      id: "e",
      type: "link",
      url: "https://jams.team/jams/x",
      x: 700,
      y: 300,
      width: 300,
      height: 200,
      jamsTeam: { type: "entity", entity: { kind: "jam", id: "jam-1" } },
    },
  ],
  edges: [{ id: "e1", fromNode: "t", fromSide: "right", toNode: "f", toEnd: "arrow", label: "to" }],
};

function detail(canvas: JsonCanvas = everyCard): CanvasDetail {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, canvas, {
    mode: "whole",
    docFields: { f: { text: "# Idea\r\n\ttrailing  \r\n", bom: true } },
  });
  return {
    id: "c1",
    path: "Plan.canvas",
    title: "Plan",
    scope: { kind: "personal" },
    visibility: "private",
    nodeCount: canvas.nodes.length,
    lastEditedById: null,
    lastEditedAt: null,
    hidden: false,
    deletedAt: null,
    updatedAt: new Date(),
    hiddenReason: null,
    access: "owner",
    snapshot: docToJsonCanvas(doc),
    state: bytesToBase64(Y.encodeStateAsUpdate(doc)),
    attachments: {
      [ATTACHMENT]: { path: "attachments/boss.png", url: "/images/canvas-images/k/boss.png" },
    },
  } as unknown as CanvasDetail;
}

function mount(canvas = detail()) {
  let handle: Partial<CanvasEditorHandle> = {};
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <div style={{ width: 1200, height: 800 }}>
        <CanvasEditor
          canvas={canvas}
          onStatus={(h) => {
            handle = h as CanvasEditorHandle;
          }}
          panel={null}
          onClosePanel={() => {}}
          chrome={{ topLeft: null, toggles: null, status: null }}
        />
      </div>
    </QueryClientProvider>,
  );
  const doc = () => handle.exportDoc!().doc;
  return { ...view, doc, handle: () => handle };
}

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

const cardCount = (container: HTMLElement) =>
  container.querySelectorAll(".react-flow__node").length;

async function selectAll(container: HTMLElement, count: number) {
  await waitFor(() => expect(cardCount(container)).toBe(count));
  fireEvent.keyDown(window, { key: "a", metaKey: true });
  await waitFor(() =>
    expect(container.querySelectorAll(".react-flow__node.selected").length).toBe(count),
  );
}

/** Every card as JSON without ids and with positions relative to the top-left one. */
function shape(doc: Y.Doc, ids?: Set<string>) {
  const json = docToJsonCanvas(doc);
  const nodes = json.nodes.filter((n) => !ids || ids.has(n.id));
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fields = docOnlyFields(doc);
  const key = (id: string) => {
    const n = byId.get(id)!;
    return `${n.type}:${n.text ?? n.file ?? n.url ?? n.label}`;
  };
  return {
    nodes: nodes
      .map(({ id, x, y, ...rest }) => ({ ...rest, x: x - minX, y: y - minY, body: fields[id] }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    edges: json.edges
      .filter((e) => byId.has(e.fromNode) && byId.has(e.toNode))
      .map(({ id: _id, fromNode, toNode, ...rest }) => ({
        ...rest,
        from: key(fromNode),
        to: key(toNode),
      })),
  };
}

describe("copy", () => {
  it("writes the three types for a selection of every card type", async () => {
    const { container } = mount();
    await selectAll(container, 7);
    const { event, store } = clipboardEvent("copy");
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect([...store.keys()].sort()).toEqual(["obsidian/canvas", "text/html", "text/plain"]);

    const obsidian = JSON.parse(store.get("obsidian/canvas")!) as JsonCanvas & { center: unknown };
    expect(obsidian.center).toBeDefined();
    const image = obsidian.nodes.find((n) => n.id === "i")!;
    expect(image.type).toBe("link");
    expect(image.url).toBe(`${window.location.origin}/images/canvas-images/k/boss.png`);
    expect(image.jamsTeam).toEqual({ type: "image", attachmentId: ATTACHMENT });
    expect(store.get("obsidian/canvas")).not.toContain("trailing");

    const payload = parseCanvasHtml(store.get("text/html")!)!;
    expect(payload.fields.f).toEqual({ text: "# Idea\r\n\ttrailing  \r\n", bom: true });
    expect(store.get("text/plain")).toContain("Hello **canvas**");
    expect(() => JSON.parse(store.get("text/plain")!)).toThrow();
  });

  it("cut removes the cards after writing them", async () => {
    const { container } = mount();
    await selectAll(container, 7);
    const { event, store } = clipboardEvent("copy");
    const cut = new Event("cut", { bubbles: true, cancelable: true });
    Object.defineProperty(cut, "clipboardData", {
      value: (event as unknown as { clipboardData: unknown }).clipboardData,
    });
    act(() => {
      document.body.dispatchEvent(cut);
    });
    expect(store.has("text/html")).toBe(true);
    await waitFor(() => expect(cardCount(container)).toBe(0));
  });
});

describe("paste", () => {
  it("copy → paste on the same canvas recreates every card type losslessly", async () => {
    const { container, doc } = mount();
    await selectAll(container, 7);
    const before = new Set(canvasNodes(doc()).keys());
    const copy = clipboardEvent("copy");
    act(() => {
      document.body.dispatchEvent(copy.event);
    });
    const paste = clipboardEvent("paste", Object.fromEntries(copy.store));
    act(() => {
      document.body.dispatchEvent(paste.event);
    });
    await waitFor(() => expect(cardCount(container)).toBe(14));
    const pasted = new Set([...canvasNodes(doc()).keys()].filter((id) => !before.has(id)));
    expect(shape(doc(), pasted)).toEqual(shape(doc(), before));
  });

  it("a real Obsidian payload pastes at the cursor with its layout kept", async () => {
    const { container, doc } = mount();
    await waitFor(() => expect(cardCount(container)).toBe(7));
    const before = new Set(canvasNodes(doc()).keys());
    const payload = `{"nodes":[{"id":"aa","x":-338,"y":-1140,"width":504,"height":294,"color":"6","type":"text","text":"# Purple"},{"id":"bb","x":151,"y":540,"width":250,"height":173,"type":"text","text":"Phil"}],"edges":[{"id":"ee","fromNode":"aa","fromSide":"bottom","toNode":"bb","toSide":"top"}],"center":{"x":-50,"y":-200}}`;
    const { event } = clipboardEvent("paste", { "obsidian/canvas": payload });
    act(() => {
      document.body.dispatchEvent(event);
    });
    await waitFor(() => expect(cardCount(container)).toBe(9));
    const added = docToJsonCanvas(doc()).nodes.filter((n) => !before.has(n.id));
    const a = added.find((n) => n.text === "# Purple")!;
    const b = added.find((n) => n.text === "Phil")!;
    expect([b.x - a.x, b.y - a.y]).toEqual([489, 1680]);
    expect(a.color).toBe("6");
    expect(
      docToJsonCanvas(doc()).edges.some((e) => e.fromSide === "bottom" && e.toSide === "top"),
    ).toBe(true);
  });

  it("a paste that would pass the card cap is refused with a message", async () => {
    const nodes = Array.from({ length: CANVAS_LIMITS.maxNodes - 1 }, (_, i) => ({
      id: `n${i}`,
      type: "text" as const,
      text: "",
      x: (i % 50) * 30,
      y: Math.floor(i / 50) * 30,
      width: 20,
      height: 20,
    }));
    const { container, doc } = mount(detail({ nodes, edges: [] }));
    await waitFor(() => expect(canvasNodes(doc()).size).toBe(CANVAS_LIMITS.maxNodes - 1));
    const two = JSON.stringify({
      nodes: [
        { id: "x", type: "text", text: "x", x: 0, y: 0, width: 1, height: 1 },
        { id: "y", type: "text", text: "y", x: 0, y: 0, width: 1, height: 1 },
      ],
    });
    const { event } = clipboardEvent("paste", { "obsidian/canvas": two });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(canvasNodes(doc()).size).toBe(CANVAS_LIMITS.maxNodes - 1);
    expect(toasts.error.join(" ")).toMatch(/2,?000/);
    void container;
  }, 60_000);

  // A pasted HTML payload's note bodies aren't size-checked, so a payload
  // carrying several megabytes of body text lands in the doc and the canvas
  // can no longer be saved (the server refuses the state as too large).
  it("refuses a paste whose note bodies would push the canvas over the state cap", async () => {
    const { container, doc } = mount();
    await waitFor(() => expect(cardCount(container)).toBe(7));
    const huge = "z".repeat(CANVAS_LIMITS.maxStateBytes + 1);
    const html = `<div data-jams-team-canvas="${JSON.stringify({
      v: 1,
      canvas: {
        nodes: [{ id: "f", type: "file", file: "n.md", x: 0, y: 0, width: 1, height: 1 }],
        edges: [],
      },
      fields: { f: { text: huge } },
    })
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")}"></div>`;
    const { event } = clipboardEvent("paste", { "text/html": html });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(Y.encodeStateAsUpdate(doc()).length).toBeLessThanOrEqual(CANVAS_LIMITS.maxStateBytes);
  });
});

describe("dropping files", () => {
  function drop(container: HTMLElement, files: File[], at = { x: 500, y: 300 }) {
    const host = screen.getByRole("application", { name: "Canvas editor" });
    void container;
    return act(async () => {
      // jsdom has no DragEvent, so the coordinates are set by hand.
      const event = createEvent.drop(host, {
        dataTransfer: { files, items: [], getData: () => "" },
      });
      Object.defineProperties(event, { clientX: { value: at.x }, clientY: { value: at.y } });
      fireEvent(host, event);
    });
  }

  it("a .canvas lands with its top-left at the drop point", async () => {
    const { container, doc } = mount();
    await waitFor(() => expect(cardCount(container)).toBe(7));
    const before = new Set(canvasNodes(doc()).keys());
    const file = new File(
      [
        JSON.stringify({
          nodes: [
            { id: "d1", type: "text", text: "one", x: -900, y: 4000, width: 200, height: 80 },
            { id: "d2", type: "text", text: "two", x: -600, y: 4100, width: 200, height: 80 },
          ],
        }),
      ],
      "Board.canvas",
    );
    await drop(container, [file], { x: 640, y: 360 });
    await waitFor(() => expect(cardCount(container)).toBe(9), { timeout: 3000 });
    const added = docToJsonCanvas(doc()).nodes.filter((n) => !before.has(n.id));
    // jsdom's flow transform is the identity and the host sits at 0,0.
    expect(Math.min(...added.map((n) => n.x))).toBe(640);
    expect(Math.min(...added.map((n) => n.y))).toBe(360);
    expect(added.find((n) => n.text === "two")!.x - added.find((n) => n.text === "one")!.x).toBe(
      300,
    );
  });

  it("a big import lands once the server stored it, sent with the state before it, and one ⌘Z undoes it", async () => {
    const { container, doc } = mount();
    await waitFor(() => expect(cardCount(container)).toBe(7));
    const count = 450;
    const file = new File(
      [
        JSON.stringify({
          nodes: Array.from({ length: count }, (_, i) => ({
            id: `n${i}`,
            type: "text",
            text: `card ${i}`,
            x: (i % 30) * 60,
            y: Math.floor(i / 30) * 60,
            width: 50,
            height: 50,
          })),
          edges: [{ id: "e", fromNode: "n0", toNode: "n1" }],
        }),
      ],
      "Big.canvas",
    );
    await drop(container, [file]);
    await waitFor(() => expect(canvasNodes(doc()).size).toBe(7 + count), { timeout: 5000 });

    // One import call: everything the tab held as the base, the import on top.
    expect(saveCanvasImport).toHaveBeenCalledTimes(1);
    const sent = saveCanvasImport.mock.calls[0]![0];
    const server = new Y.Doc();
    Y.applyUpdate(server, base64ToBytes(sent.base));
    expect(canvasNodes(server).size).toBe(7);
    Y.applyUpdate(server, base64ToBytes(sent.update));
    expect(canvasNodes(server).size).toBe(7 + count);

    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true });
    });
    await waitFor(() => expect(canvasNodes(doc()).size).toBe(7));
    expect(docToJsonCanvas(doc()).edges).toHaveLength(1);
  }, 60_000);

  it("an import over the card cap is refused with the numbers and changes nothing", async () => {
    const { container, doc } = mount();
    await waitFor(() => expect(cardCount(container)).toBe(7));
    const file = new File(
      [
        JSON.stringify({
          nodes: Array.from({ length: CANVAS_LIMITS.maxNodes - 6 }, (_, i) => ({
            id: `n${i}`,
            type: "text",
            text: "",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          })),
        }),
      ],
      "Huge.canvas",
    );
    await drop(container, [file]);
    await waitFor(() => expect(toasts.error.length).toBe(1), { timeout: 3000 });
    expect(toasts.error[0]).toMatch(/2,001.*2,000/);
    expect(canvasNodes(doc()).size).toBe(7);
    expect(saveCanvasImport).not.toHaveBeenCalled();
  });

  it("a dropped note referenced by a dropped canvas becomes its file card's body", async () => {
    const { container, doc } = mount();
    await waitFor(() => expect(cardCount(container)).toBe(7));
    const canvasFile = new File(
      [
        JSON.stringify({
          nodes: [{ id: "k", type: "file", file: "New.md", x: 0, y: 0, width: 300, height: 200 }],
        }),
      ],
      "Board.canvas",
    );
    const note = new File(
      [new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Body\r\n")])],
      "New.md",
    );
    await drop(container, [canvasFile, note]);
    await waitFor(() => expect(cardCount(container)).toBe(8), { timeout: 3000 });
    const fields = Object.values(docOnlyFields(doc()));
    expect(fields).toContainEqual({ text: "Body\r\n", bom: true });
    const card = [...container.querySelectorAll(".react-flow__node")].find((n) =>
      n.textContent?.includes("New.md"),
    )!;
    expect(card.querySelector("[data-note-badge]")).not.toBeNull();
    expect(card.textContent).toContain("Body");
  });

  it("a file card with a body opens its editor on Enter", async () => {
    const { container } = mount();
    await waitFor(() => expect(cardCount(container)).toBe(7));
    fireEvent.click(container.querySelector('.react-flow__node[data-id="f"]')!);
    await screen.findByRole("toolbar", { name: "Selection" });
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(container.querySelector(".cm-content")).not.toBeNull());
    expect(container.querySelector(".cm-content")!.textContent).toContain("# Idea");
  });
});

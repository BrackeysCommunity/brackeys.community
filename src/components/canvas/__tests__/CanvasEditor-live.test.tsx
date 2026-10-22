// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { bytesToBase64 } from "@/lib/canvas/encoding";
import { applyJsonCanvas, docToJsonCanvas } from "@/lib/canvas/json-canvas";

import type { CanvasDetail } from "../canvas-queries";
import CanvasEditor, { type CanvasEditorHandle } from "../editor/CanvasEditor";

const fake = vi.hoisted(() => ({
  multiplayer: false,
  tokenError: null as null | { code: string },
  tokenCalls: 0,
  saveCalls: 0,
  providers: [] as {
    config: { url: string; name: string; document: import("yjs").Doc };
    destroyed: boolean;
  }[],
}));

vi.mock("@/lib/hooks/use-flag", () => ({
  useFlag: (flag: string) => (flag === "canvases-multiplayer" ? fake.multiplayer : false),
}));

vi.mock("@hocuspocus/provider", () => ({
  WebSocketStatus: {
    Connecting: "connecting",
    Connected: "connected",
    Disconnected: "disconnected",
  },
  HocuspocusProvider: class {
    config: never;
    destroyed = false;
    isSynced = false;
    unsyncedChanges = 0;
    configuration = { websocketProvider: { status: "connecting" } };
    get hasUnsyncedChanges() {
      return this.unsyncedChanges > 0;
    }
    connect() {}
    disconnect() {}
    destroy() {
      this.destroyed = true;
    }
    constructor(config: never) {
      this.config = config;
      fake.providers.push(this as never);
    }
  },
}));

vi.mock("@/orpc/client", () => ({
  client: {
    saveCanvas: async () => {
      fake.saveCalls++;
      return { update: "AAA=", stateVector: "AA==" };
    },
    getCanvasSyncToken: async () => {
      fake.tokenCalls++;
      if (fake.tokenError) throw fake.tokenError;
      return { token: `t${fake.tokenCalls}`, url: "wss://sync.test", access: "write" };
    },
    listCanvasAttachments: vi.fn(async () => ({})),
    getCanvasEntities: vi.fn(async () => []),
  },
  orpc: {
    getCanvas: {
      queryOptions: ({ input }: { input: { canvasId: string } }) => ({
        queryKey: ["getCanvas", input.canvasId],
      }),
    },
  },
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
      constructor() {}
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
});

beforeEach(() => {
  fake.multiplayer = false;
  fake.tokenError = null;
  fake.tokenCalls = 0;
  fake.saveCalls = 0;
  fake.providers.length = 0;
});
afterEach(cleanup);

function detail(id = "c1", nodeId = "a"): CanvasDetail {
  const doc = new Y.Doc();
  applyJsonCanvas(
    doc,
    {
      nodes: [
        { id: nodeId, type: "text", text: "Hello **canvas**", x: 0, y: 0, width: 200, height: 80 },
      ],
      edges: [],
    },
    { mode: "whole" },
  );
  return {
    id,
    path: "Plan.canvas",
    title: "Plan",
    scope: { kind: "personal" },
    visibility: "private",
    nodeCount: 1,
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

function mount(canvas = detail()) {
  const handle = { current: null as CanvasEditorHandle | null };
  const queryClient = new QueryClient();
  const tree = (canvas: CanvasDetail) => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <div style={{ width: 1200, height: 800 }}>
          <CanvasEditor
            canvas={canvas}
            onStatus={(h) => {
              handle.current = h;
            }}
            panel={null}
            onClosePanel={() => {}}
            chrome={{ topLeft: null, toggles: null, status: null }}
            fallback={<p>reader view</p>}
          />
        </div>
      </QueryClientProvider>
    </StrictMode>
  );
  const view = render(tree(canvas));
  return { ...view, handle, open: (next: CanvasDetail) => view.rerender(tree(next)) };
}

const liveProviders = () => fake.providers.filter((p) => !p.destroyed);

/** Places a group card with the dock, the way a person would. */
async function placeCard(container: HTMLElement) {
  await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBe(1));
  fireEvent.click(screen.getByLabelText("Group"));
  const layer = await screen.findByTestId("placement-layer");
  fireEvent.pointerDown(layer, { button: 0, clientX: 600, clientY: 400 });
  fireEvent.pointerUp(layer, { button: 0, clientX: 600, clientY: 400 });
  await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBe(2));
}

describe("CanvasEditor persistence mode", () => {
  it("flag off: no token, no provider, and edits go through saveCanvas as before", async () => {
    const { container, handle } = mount();
    await placeCard(container);
    await act(async () => {
      await handle.current!.flush();
    });
    expect(fake.saveCalls).toBeGreaterThan(0);
    expect(fake.tokenCalls).toBe(0);
    expect(fake.providers).toHaveLength(0);
  });

  it("flag on: shows the fallback until the first token, then goes live and never calls saveCanvas", async () => {
    fake.multiplayer = true;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { client } = await import("@/orpc/client");
    const original = client.getCanvasSyncToken;
    (client as { getCanvasSyncToken: unknown }).getCanvasSyncToken = async (input: never) => {
      await gate;
      return original(input);
    };
    const { container, handle } = mount();
    expect(screen.getByText("reader view")).toBeTruthy();
    release();
    await waitFor(() => expect(liveProviders()).toHaveLength(1));
    (client as { getCanvasSyncToken: unknown }).getCanvasSyncToken = original;

    const [provider] = liveProviders();
    expect(provider!.config.url).toBe("wss://sync.test");
    expect(provider!.config.name).toBe("canvas:c1");
    // Painted from the loaded state before any sync.
    expect(provider!.config.document.getMap("nodes").has("a")).toBe(true);

    await placeCard(container);
    expect(provider!.config.document.getMap("nodes").size).toBe(2);
    await act(async () => {
      await handle.current!.flush();
      await new Promise((resolve) => setTimeout(resolve, 1700));
    });
    expect(fake.saveCalls).toBe(0);
  });

  it.each(["NOT_FOUND", "PRECONDITION_FAILED", "INTERNAL_SERVER_ERROR"])(
    "flag on but the first token fails with %s: the solo save, unchanged",
    async (code) => {
      fake.multiplayer = true;
      fake.tokenError = { code };
      const { container, handle } = mount();
      await placeCard(container);
      await act(async () => {
        await handle.current!.flush();
      });
      expect(fake.saveCalls).toBeGreaterThan(0);
      expect(fake.providers).toHaveLength(0);
    },
  );

  it("destroys the provider when the editor unmounts", async () => {
    fake.multiplayer = true;
    const { unmount } = mount();
    await waitFor(() => expect(liveProviders()).toHaveLength(1));
    unmount();
    expect(liveProviders()).toHaveLength(0);
  });

  it("opening another canvas in place starts a fresh doc and provider", async () => {
    fake.multiplayer = true;
    const { open } = mount(detail("c1", "a"));
    await waitFor(() => expect(liveProviders()).toHaveLength(1));
    open(detail("c2", "b"));
    await waitFor(() => expect(liveProviders().map((p) => p.config.name)).toEqual(["canvas:c2"]));
    const nodes = liveProviders()[0]!.config.document.getMap("nodes");
    expect(nodes.has("b")).toBe(true);
    expect(nodes.has("a")).toBe(false);
  });

  it("opening another canvas in place swaps the solo editor's doc too", async () => {
    const { container, open } = mount(detail("c1", "a"));
    await placeCard(container);
    open(detail("c2", "b"));
    await waitFor(() => expect(container.querySelector('[data-id="b"]')).toBeTruthy());
    expect(container.querySelector('[data-id="a"]')).toBeNull();
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(1);
  });
});

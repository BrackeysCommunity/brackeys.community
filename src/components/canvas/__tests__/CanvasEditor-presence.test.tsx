// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";

import { bytesToBase64 } from "@/lib/canvas/encoding";
import { applyJsonCanvas, docToJsonCanvas } from "@/lib/canvas/json-canvas";

import type { CanvasDetail } from "../canvas-queries";
import CanvasEditor from "../editor/CanvasEditor";

const fake = vi.hoisted(() => ({
  cardBodyRenders: 0,
  providers: [] as {
    awareness: import("y-protocols/awareness").Awareness;
    document: import("yjs").Doc;
    destroyed: boolean;
  }[],
}));

vi.mock("../canvas-cards", async (importOriginal) => {
  const original = await importOriginal<typeof import("../canvas-cards")>();
  return {
    ...original,
    CardBody: (props: Parameters<typeof original.CardBody>[0]) => {
      fake.cardBodyRenders++;
      return original.CardBody(props);
    },
  };
});

vi.mock("@/lib/hooks/use-flag", () => ({
  useFlag: (flag: string) => flag === "canvases-multiplayer",
}));

vi.mock("@hocuspocus/provider", async () => {
  const { Awareness } = await import("y-protocols/awareness");
  return {
    WebSocketStatus: {
      Connecting: "connecting",
      Connected: "connected",
      Disconnected: "disconnected",
    },
    HocuspocusProvider: class {
      destroyed = false;
      isSynced = true;
      unsyncedChanges = 0;
      hasUnsyncedChanges = false;
      configuration = { websocketProvider: { status: "connected" } };
      awareness: InstanceType<typeof Awareness>;
      document: import("yjs").Doc;
      connect() {}
      disconnect() {}
      destroy() {
        this.destroyed = true;
        this.awareness.destroy();
      }
      constructor(config: { document: import("yjs").Doc }) {
        this.document = config.document;
        this.awareness = new Awareness(config.document);
        fake.providers.push(this as never);
      }
    },
  };
});

vi.mock("@/orpc/client", () => ({
  client: {
    getCanvasSyncToken: async () => ({
      token: "t",
      url: "wss://sync.test",
      access: "write",
      self: { id: "me", name: "Me", avatarUrl: null },
    }),
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
  fake.cardBodyRenders = 0;
  fake.providers.length = 0;
});
afterEach(cleanup);

const CARDS = 12;

function detail(): CanvasDetail {
  const doc = new Y.Doc();
  applyJsonCanvas(
    doc,
    {
      nodes: Array.from({ length: CARDS }, (_, i) => ({
        id: `card-${i}`,
        type: "text" as const,
        text: `Card ${i}`,
        x: (i % 4) * 240,
        y: Math.floor(i / 4) * 140,
        width: 200,
        height: 100,
      })),
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
    nodeCount: CARDS,
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

async function mount() {
  const view = render(
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
  await waitFor(() =>
    expect(view.container.querySelectorAll(".react-flow__node").length).toBe(CARDS),
  );
  const provider = fake.providers.find((p) => !p.destroyed)!;
  return { ...view, awareness: provider.awareness, doc: provider.document };
}

/** Another person's tab: its own awareness, relayed into ours as the provider would. */
function peer(target: Awareness, id: string, name: string) {
  const own = new Awareness(new Y.Doc());
  const relay = () =>
    act(() => {
      applyAwarenessUpdate(target, encodeAwarenessUpdate(own, [own.clientID]), "remote");
    });
  own.setLocalState({
    user: { id, name, avatarUrl: null },
    pointer: null,
    selection: [],
    editing: null,
  });
  relay();
  return {
    set(field: string, value: unknown) {
      own.setLocalStateField(field, value);
      relay();
    },
    leave() {
      act(() => removeAwarenessStates(target, [own.clientID], "remote"));
      own.destroy();
    },
  };
}

describe("presence on a live canvas", () => {
  it("draws five peers' pointers without re-rendering a single card", async () => {
    const { container, awareness, doc } = await mount();
    const peers = Array.from({ length: 5 }, (_, i) => peer(awareness, `u${i}`, `Peer ${i}`));
    const before = fake.cardBodyRenders;
    expect(before).toBeGreaterThan(0);

    for (let step = 0; step < 25; step++) {
      peers.forEach((p, i) => p.set("pointer", { x: 30 * step + i, y: 20 * i + step }));
    }

    expect(container.querySelectorAll("[data-peer-cursor]")).toHaveLength(5);
    expect(screen.getByText("Peer 3")).toBeTruthy();
    expect(fake.cardBodyRenders - before).toBe(0);

    // The counter does see a card render: a remote text edit re-renders that card.
    act(() => {
      const text = (doc.getMap("nodes").get("card-0") as Y.Map<unknown>).get("text") as Y.Text;
      doc.transact(() => text.insert(0, "Edited "), "remote");
    });
    await waitFor(() => expect(fake.cardBodyRenders - before).toBeGreaterThan(0));
  });

  it("outlines a peer's selection and shows who is typing, still without card renders", async () => {
    const { container, awareness } = await mount();
    const ana = peer(awareness, "ana", "Ana");
    const rin = peer(awareness, "rin", "Rin");
    const before = fake.cardBodyRenders;

    rin.set("selection", ["card-1", "card-2"]);
    ana.set("editing", "card-1");
    // A caret moving inside the open card is no news to the canvas.
    ana.set("cursor", { anchor: { item: null }, head: { item: null } });

    const card1 = container.querySelector('.react-flow__node[data-id="card-1"]')!;
    expect(card1.textContent).toContain("Ana is typing");
    expect(card1.textContent).toContain("Rin");
    expect(container.querySelector('.react-flow__node[data-id="card-2"]')!.textContent).toContain(
      "Rin",
    );
    expect(fake.cardBodyRenders - before).toBe(0);

    rin.leave();
    expect(
      container.querySelector('.react-flow__node[data-id="card-2"]')!.textContent,
    ).not.toContain("Rin");
  });

  it("stacks connected people once each in the top right", async () => {
    const { awareness } = await mount();
    peer(awareness, "ana", "Ana");
    peer(awareness, "ana", "Ana");
    peer(awareness, "rin", "Rin");
    const group = screen.getByRole("group", { name: "People here" });
    expect(group.querySelectorAll("button")).toHaveLength(2);
    expect(screen.getByLabelText("Go to Ana")).toBeTruthy();
  });

  it("publishes this tab's pointer in flow coordinates, its selection and clears on leave", async () => {
    const { container, awareness } = await mount();
    expect(awareness.getLocalState()?.user).toMatchObject({ id: "me", name: "Me" });
    const host = container.querySelector('[role="application"]')!;
    fireEvent.pointerMove(host, { clientX: 100, clientY: 120 });
    expect(awareness.getLocalState()?.pointer).toEqual(
      expect.objectContaining({ x: expect.any(Number) }),
    );
    fireEvent.pointerLeave(host);
    expect(awareness.getLocalState()?.pointer).toBeNull();

    fireEvent.click(container.querySelector('.react-flow__node[data-id="card-0"]')!);
    await waitFor(() => expect(awareness.getLocalState()?.selection).toEqual(["card-0"]));
  });
});

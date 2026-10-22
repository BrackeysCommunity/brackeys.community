// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { useCanvasSync } from "../editor/use-canvas-sync";

const fake = vi.hoisted(() => ({
  providers: [] as {
    config: Record<string, (...args: never[]) => unknown> & { url: string; name: string };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    isSynced: boolean;
    unsyncedChanges: number;
    readonly hasUnsyncedChanges: boolean;
    configuration: { websocketProvider: { status: string } };
  }[],
  tokenCalls: 0,
  tokenError: null as null | { code: string },
  tokenAccess: "write" as "read" | "write",
  saveCalls: 0,
}));

vi.mock("@hocuspocus/provider", () => ({
  WebSocketStatus: {
    Connecting: "connecting",
    Connected: "connected",
    Disconnected: "disconnected",
  },
  HocuspocusProvider: class {
    config: never;
    connect = vi.fn();
    disconnect = vi.fn();
    destroy = vi.fn();
    isSynced = false;
    unsyncedChanges = 0;
    configuration = { websocketProvider: { status: "connected" } };
    get hasUnsyncedChanges() {
      return this.unsyncedChanges > 0;
    }
    constructor(config: never) {
      this.config = config;
      fake.providers.push(this as never);
    }
  },
}));

vi.mock("@/orpc/client", () => ({
  client: {
    getCanvasSyncToken: async () => {
      fake.tokenCalls++;
      if (fake.tokenError) throw fake.tokenError;
      return {
        token: `token-${fake.tokenCalls}`,
        url: "wss://sync.test",
        access: fake.tokenAccess,
      };
    },
    saveCanvas: async () => {
      fake.saveCalls++;
    },
  },
  orpc: {
    getCanvas: {
      queryOptions: ({ input }: { input: { canvasId: string } }) => ({
        queryKey: ["getCanvas", input.canvasId],
      }),
    },
  },
}));

const session = {
  token: "first",
  url: "wss://sync.test",
  access: "write" as const,
  self: { id: "u1", name: "Ana", avatarUrl: null },
};
let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function mount(doc = new Y.Doc(), first: typeof session | { access: "read" } = session) {
  const hook = renderHook(() => useCanvasSync(doc, "c1", { ...session, ...first }), { wrapper });
  const provider = fake.providers.at(-1)!;
  const fire = (name: string, payload?: unknown) =>
    act(() => {
      (provider.config[name] as (payload: unknown) => void)(payload);
    });
  return { ...hook, provider, fire };
}

beforeEach(() => {
  fake.providers.length = 0;
  fake.tokenCalls = 0;
  fake.tokenError = null;
  fake.tokenAccess = "write";
  fake.saveCalls = 0;
  queryClient = new QueryClient();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * The History panel hands a restore's update to the saver (CanvasEditor's
 * `onRestored`). The restore already reached the service through the apply
 * publish, so the live saver must not treat that update as a local change:
 * not stop on its size, and not send it back.
 */
describe("useCanvasSync with a restore applied by the History panel", () => {
  it("doesn't stop as too large when the restore brings back over 1 MB", () => {
    const doc = new Y.Doc();
    const { result, provider } = mount(doc);
    const restored = new Y.Doc();
    restored.getText("big").insert(0, "x".repeat(1_100_000));
    const origins: unknown[] = [];
    doc.on("update", (_update: Uint8Array, origin: unknown) => origins.push(origin));
    act(() => {
      result.current.applyRestored(Y.encodeStateAsUpdate(restored), Y.encodeStateVector(restored));
    });
    expect(doc.getText("big").length).toBe(1_100_000);
    expect(result.current.status).not.toBe("too-large");
    expect(provider.disconnect).not.toHaveBeenCalled();
    // The provider skips updates whose origin is itself, so nothing is sent back.
    expect(origins).toEqual([provider]);
  });

  it("still stops on a local edit over 1 MB", () => {
    const doc = new Y.Doc();
    const { result } = mount(doc);
    act(() => {
      doc.transact(() => doc.getText("big").insert(0, "x".repeat(1_100_000)), "local");
    });
    expect(result.current.status).toBe("too-large");
  });
});

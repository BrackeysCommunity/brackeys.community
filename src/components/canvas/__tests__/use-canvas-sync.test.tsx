// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { SYNC_CLOSE, syncClose } from "@/lib/canvas/sync-channels";

import { firstSyncSession, useCanvasSync } from "../editor/use-canvas-sync";

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

const session = { token: "first", url: "wss://sync.test", access: "write" as const };
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

describe("useCanvasSync", () => {
  it("connects to the canvas's document with the first token, then mints fresh ones", async () => {
    const { provider } = mount();
    expect(provider.config.url).toBe("wss://sync.test");
    expect(provider.config.name).toBe("canvas:c1");
    const token = provider.config.token as () => Promise<string>;
    expect(await token()).toBe("first");
    expect(await token()).toBe("token-1");
  });

  it("reports connecting, then saved and saving from the provider", () => {
    const { result, provider, fire } = mount();
    expect(result.current.status).toBe("connecting");
    provider.isSynced = true;
    fire("onSynced", { state: true });
    expect(result.current.status).toBe("saved");
    provider.unsyncedChanges = 2;
    fire("onUnsyncedChanges", { number: 2 });
    expect(result.current.status).toBe("saving");
  });

  it("stops for good on 4413", () => {
    vi.useFakeTimers();
    const { result, provider, fire } = mount();
    fire("onClose", { event: syncClose(SYNC_CLOSE.tooLarge, "canvas too large") });
    expect(result.current.status).toBe("too-large");
    expect(provider.disconnect).toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(provider.connect).not.toHaveBeenCalled();
  });

  it("stops and re-reads the canvas on 4403", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result, provider, fire } = mount();
    fire("onClose", { event: { code: 1000, reason: "4403 revoked" } });
    expect(result.current.status).toBe("offline");
    expect(provider.disconnect).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["getCanvas", "c1"] });
  });

  it("treats a refused token as a revoke", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { provider } = mount();
    const token = provider.config.token as () => Promise<string>;
    await token();
    fake.tokenError = { code: "NOT_FOUND" };
    await act(async () => {
      await expect(token()).rejects.toEqual({ code: "NOT_FOUND" });
    });
    expect(provider.disconnect).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
  });

  it("backs off and reconnects after a rate limit", () => {
    vi.useFakeTimers();
    const { provider, fire } = mount();
    fire("onClose", { event: { code: 1000, reason: "4429 rate-limited" } });
    expect(provider.disconnect).toHaveBeenCalled();
    expect(provider.connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(provider.connect).toHaveBeenCalledTimes(1);
  });

  it("flushes by waiting for the server, never through saveCanvas", async () => {
    const { result, provider } = mount();
    provider.unsyncedChanges = 1;
    let done = false;
    const flushing = result.current.save().then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(done).toBe(false);
    provider.unsyncedChanges = 0;
    await flushing;
    expect(done).toBe(true);
    expect(fake.saveCalls).toBe(0);
  });

  it("destroys the provider on unmount", () => {
    const { provider, unmount } = mount();
    unmount();
    expect(provider.destroy).toHaveBeenCalled();
  });
});

describe("firstSyncSession", () => {
  it("returns the session, or null to stay on the solo save", async () => {
    expect(await firstSyncSession("c1")).toEqual({
      token: "token-1",
      url: "wss://sync.test",
      access: "write",
    });
    fake.tokenError = { code: "NOT_FOUND" };
    expect(await firstSyncSession("c1")).toBeNull();
    fake.tokenError = { code: "PRECONDITION_FAILED" };
    expect(await firstSyncSession("c1")).toBeNull();
  });
});

describe("useCanvasSync close paths", () => {
  it("treats a websocket closed for an oversize frame (1009) as too large", () => {
    vi.useFakeTimers();
    const { result, provider, fire } = mount();
    fire("onClose", { event: { code: 1009, reason: "" } });
    expect(result.current.status).toBe("too-large");
    vi.advanceTimersByTime(60_000);
    expect(provider.connect).not.toHaveBeenCalled();
  });

  it("stops on a 4413 that arrives as a refused authentication", () => {
    vi.useFakeTimers();
    const { result, provider, fire } = mount();
    fire("onAuthenticationFailed", { reason: "4413 too-large: canvas too large" });
    expect(result.current.status).toBe("too-large");
    vi.advanceTimersByTime(60_000);
    expect(provider.connect).not.toHaveBeenCalled();
  });

  it("retries a revoke once after the canvas is re-read, then stays stopped", async () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result, provider, fire } = mount();
    fire("onClose", { event: { code: 1000, reason: "4403 revoked" } });
    await act(async () => {
      await invalidate.mock.results[0]!.value;
    });
    expect(provider.connect).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(provider.connect).toHaveBeenCalledTimes(1);
    fire("onClose", { event: { code: 1000, reason: "4403 revoked" } });
    await act(async () => {
      await invalidate.mock.results[1]!.value;
    });
    expect(provider.connect).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("offline");
  });

  it("backs off on a refused token (4401), then reconnects", () => {
    vi.useFakeTimers();
    const { result, provider, fire } = mount();
    fire("onAuthenticationFailed", { reason: "4401 unauthorized: invalid token" });
    expect(result.current.status).not.toBe("too-large");
    expect(provider.connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(provider.connect).toHaveBeenCalledTimes(1);
  });

  it("backs off longer each time it's rate-limited", () => {
    vi.useFakeTimers();
    const { provider, fire } = mount();
    fire("onClose", { event: { code: 4429, reason: "" } });
    vi.advanceTimersByTime(2_000);
    expect(provider.connect).toHaveBeenCalledTimes(1);
    fire("onClose", { event: { code: 4429, reason: "" } });
    vi.advanceTimersByTime(2_000);
    expect(provider.connect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_000);
    expect(provider.connect).toHaveBeenCalledTimes(2);
  });

  it("keeps trying after a token call that fails for a network reason", async () => {
    vi.useFakeTimers();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { provider } = mount();
    const token = provider.config.token as () => Promise<string>;
    await token();
    fake.tokenError = { code: "INTERNAL_SERVER_ERROR" };
    await act(async () => {
      await expect(token()).rejects.toEqual({ code: "INTERNAL_SERVER_ERROR" });
    });
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(provider.connect).toHaveBeenCalledTimes(1);
  });

  it("reconnects when the server drops the document but keeps the socket", () => {
    vi.useFakeTimers();
    const { provider, fire } = mount();
    provider.configuration.websocketProvider.status = "connected";
    fire("onClose", { event: { code: 1000, reason: "" } });
    vi.advanceTimersByTime(1_000);
    expect(provider.connect).toHaveBeenCalledTimes(1);
  });

  it("doesn't make a flush wait once it has stopped for good", async () => {
    const { result, provider, fire } = mount();
    provider.unsyncedChanges = 3;
    fire("onClose", { event: { code: 4413, reason: "" } });
    const started = Date.now();
    await result.current.save();
    expect(Date.now() - started).toBeLessThan(500);
    expect(fake.saveCalls).toBe(0);
  });

  it("stops before sending a local change over the message cap", () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const { result, provider } = mount(doc);
    act(() => {
      doc.getMap("nodes").set("small", new Y.Map());
    });
    expect(result.current.status).not.toBe("too-large");
    act(() => {
      doc.getText("big").insert(0, "x".repeat(1_100_000));
    });
    expect(result.current.status).toBe("too-large");
    expect(provider.disconnect).toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(provider.connect).not.toHaveBeenCalled();
  });

  it("ignores large updates that come from the server", () => {
    const doc = new Y.Doc();
    const { result, provider } = mount(doc);
    const remote = new Y.Doc();
    remote.getText("big").insert(0, "x".repeat(1_100_000));
    act(() => {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), provider);
    });
    expect(result.current.status).not.toBe("too-large");
    expect(provider.disconnect).not.toHaveBeenCalled();
  });

  it("stops listening to the doc on unmount", () => {
    const doc = new Y.Doc();
    const { unmount, provider } = mount(doc);
    unmount();
    doc.getText("big").insert(0, "x".repeat(1_100_000));
    expect(provider.disconnect).not.toHaveBeenCalled();
  });
});

describe("useCanvasSync with read access", () => {
  it("treats a fresh token that only reads as a revoke", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result, provider } = mount();
    const token = provider.config.token as () => Promise<string>;
    expect(await token()).toBe("first");
    fake.tokenAccess = "read";
    await act(async () => {
      await expect(token()).rejects.toThrow();
    });
    expect(provider.disconnect).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["getCanvas", "c1"] });
    expect(["offline", "connecting"]).toContain(result.current.status);
  });

  it("stops at once when the first token only reads, and never uses it", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { provider } = mount(new Y.Doc(), { access: "read" });
    expect(provider.disconnect).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["getCanvas", "c1"] });
    const token = provider.config.token as () => Promise<string>;
    expect(await token()).toBe("token-1");
  });
});

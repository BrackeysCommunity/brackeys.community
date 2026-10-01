// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { docFromState, mergeStates, missingFrom, stateVectorOf } from "@/lib/canvas/doc-state";
import { base64ToBytes, bytesToBase64 } from "@/lib/canvas/encoding";
import { applyJsonCanvas, canvasNodes } from "@/lib/canvas/json-canvas";

import { useCanvasSave } from "../editor/use-canvas-save";

/** A fake server holding merged state, like `saveCanvas`. */
const server = vi.hoisted(() => ({
  state: new Uint8Array([0, 0]) as Uint8Array,
  fail: 0,
  calls: 0,
}));

vi.mock("@/orpc/client", () => ({
  client: {
    saveCanvas: async (input: { update: string; stateVector: string }) => {
      server.calls++;
      if (server.fail > 0) {
        server.fail--;
        throw new Error("offline");
      }
      server.state = mergeStates(server.state, base64ToBytes(input.update));
      return {
        update: bytesToBase64(missingFrom(server.state, base64ToBytes(input.stateVector))),
        stateVector: bytesToBase64(stateVectorOf(server.state)),
      };
    },
  },
}));
vi.mock("@/lib/product-insights", () => ({ reportMutationError: () => {} }));

const card = (id: string) => ({ id, type: "text", text: id, x: 0, y: 0, width: 10, height: 10 });

beforeEach(() => {
  vi.useFakeTimers();
  server.state = new Uint8Array([0, 0]) as Uint8Array;
  server.fail = 0;
  server.calls = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCanvasSave", () => {
  it("debounces edits into one save and picks up another tab's work", async () => {
    const other = new Y.Doc();
    applyJsonCanvas(other, { nodes: [card("from-other-tab")] });
    server.state = Y.encodeStateAsUpdate(other);

    const doc = new Y.Doc();
    const { result } = renderHook(() => useCanvasSave(doc, "c1", new Uint8Array([0])));
    act(() => {
      applyJsonCanvas(doc, { nodes: [card("a")] });
      applyJsonCanvas(doc, { nodes: [card("b")] });
    });
    expect(result.current.status).toBe("pending");

    await act(() => vi.advanceTimersByTimeAsync(1_600));
    expect(server.calls).toBe(1);
    expect(result.current.status).toBe("saved");
    expect(canvasNodes(docFromState(server.state)).size).toBe(3);
    expect(canvasNodes(doc).size).toBe(3);
  });

  it("goes offline on failure and retries until it lands", async () => {
    server.fail = 1;
    const doc = new Y.Doc();
    const { result } = renderHook(() => useCanvasSave(doc, "c1", new Uint8Array([0])));
    applyJsonCanvas(doc, { nodes: [card("a")] });

    await act(() => vi.advanceTimersByTimeAsync(1_600));
    expect(result.current.status).toBe("offline");
    await act(() => vi.advanceTimersByTimeAsync(2_100));
    expect(result.current.status).toBe("saved");
    expect(canvasNodes(docFromState(server.state)).size).toBe(1);
  });

  it("flushes when the tab is hidden", async () => {
    const doc = new Y.Doc();
    renderHook(() => useCanvasSave(doc, "c1", new Uint8Array([0])));
    applyJsonCanvas(doc, { nodes: [card("a")] });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(server.calls).toBe(1);
  });
});

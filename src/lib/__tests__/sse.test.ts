import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { sseResponse } from "@/lib/sse";

const decoder = new TextDecoder();

function harness(opts: { heartbeatMs?: number; maxMs?: number } = {}) {
  const abort = new AbortController();
  const request = new Request("http://test/stream", { signal: abort.signal });
  const unsubscribe = vi.fn();
  let send: ((event: string, data: unknown) => void) | undefined;
  const response = sseResponse(request, {
    ...opts,
    subscribe: async (fn) => {
      send = fn;
      return unsubscribe;
    },
  });
  const reader = response.body!.getReader();
  let text = "";
  let done = false;
  const pump = (async () => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    done = true;
  })();
  return {
    response,
    abort,
    reader,
    unsubscribe,
    pump,
    send: (event: string, data: unknown) => send?.(event, data),
    text: () => text,
    done: () => done,
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("sseResponse", () => {
  it("sets the event-stream headers", () => {
    const { response, abort } = harness();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    abort.abort();
  });

  it("says connected, writes events and pings every heartbeat", async () => {
    const h = harness({ heartbeatMs: 1000 });
    await flush();
    expect(h.text()).toBe(": connected\n\n");
    h.send("post", { id: 1 });
    await flush();
    expect(h.text()).toBe(': connected\n\nevent: post\ndata: {"id":1}\n\n');
    await vi.advanceTimersByTimeAsync(2500);
    expect(h.text().match(/: ping\n\n/g)).toHaveLength(2);
    h.abort.abort();
    await h.pump;
  });

  it("pings every 25 seconds by default", async () => {
    const h = harness();
    await flush();
    await vi.advanceTimersByTimeAsync(24_999);
    expect(h.text()).not.toContain(": ping");
    await vi.advanceTimersByTimeAsync(1);
    expect(h.text()).toContain(": ping");
    h.abort.abort();
    await h.pump;
  });

  it("closes at maxMs and unsubscribes once", async () => {
    const h = harness({ heartbeatMs: 1000, maxMs: 5000 });
    await flush();
    await vi.advanceTimersByTimeAsync(4999);
    expect(h.done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await h.pump;
    expect(h.done()).toBe(true);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    h.send("post", { id: 2 });
    expect(h.text()).not.toContain("event: post");
  });

  it("cleans up on abort", async () => {
    const h = harness({ heartbeatMs: 1000 });
    await flush();
    h.abort.abort();
    await h.pump;
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    h.abort.abort();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("cleans up on cancel", async () => {
    const h = harness({ heartbeatMs: 1000, maxMs: 60_000 });
    await flush();
    await h.reader.cancel();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes at once when the request ends while subscribing", async () => {
    const abort = new AbortController();
    const unsubscribe = vi.fn();
    let resolve!: (fn: () => void) => void;
    const response = sseResponse(new Request("http://test/stream", { signal: abort.signal }), {
      subscribe: () => new Promise((r) => (resolve = r)),
    });
    const reading = response.body!.getReader().read();
    await flush();
    abort.abort();
    resolve(unsubscribe);
    await flush();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect((await reading).done).toBe(true);
  });
});

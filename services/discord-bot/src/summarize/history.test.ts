import { afterEach, describe, expect, test } from "bun:test";

import { DiscordBackoffError, type GuardRedis } from "../../../../src/lib/discord-guard.ts";
import { createHistoryReader } from "./history.ts";

const CHANNEL = "243005537342586880";
const realFetch = globalThis.fetch;

function memoryRedis(): GuardRedis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => void store.set(key, value),
  };
}

const page = (headers: Record<string, string> = {}) =>
  new Response("[]", { status: 200, headers: { "x-ratelimit-remaining": "4", ...headers } });

const limited = (scope: string | null) =>
  new Response("{}", {
    status: 429,
    headers: {
      "retry-after": "1",
      "x-ratelimit-reset-after": "0.01",
      ...(scope ? { "x-ratelimit-scope": scope } : {}),
    },
  });

/** Answers each request with the next response in `script`, counting overlap. */
function serve(script: (() => Response)[]) {
  let open = 0;
  const seen = { calls: 0, maxOpen: 0 };
  globalThis.fetch = (async () => {
    open++;
    seen.maxOpen = Math.max(seen.maxOpen, open);
    await new Promise((resolve) => setTimeout(resolve, 5));
    open--;
    return script[seen.calls++]?.() ?? page();
  }) as unknown as typeof fetch;
  return seen;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("createHistoryReader", () => {
  test("reads one page at a time per channel, however many summaries are paging it", async () => {
    const seen = serve([]);
    const read = createHistoryReader("token", memoryRedis());
    await Promise.all([read(CHANNEL, "1"), read(CHANNEL, "2"), read("other", "3")]);
    expect(seen.calls).toBe(3);
    expect(seen.maxOpen).toBe(2);
  });

  test("a failed page doesn't stall the channel's queue", async () => {
    serve([() => new Response("{}", { status: 500 })]);
    const read = createHistoryReader("token", memoryRedis());
    const [first, second] = await Promise.allSettled([read(CHANNEL, "1"), read(CHANNEL, "2")]);
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("fulfilled");
  });

  test("waits out a route 429 and retries, without opening the shared backoff", async () => {
    const seen = serve([() => limited("user"), () => page()]);
    const redis = memoryRedis();
    await createHistoryReader("token", redis)(CHANNEL, "1");
    expect(seen.calls).toBe(2);
    expect(redis.store.size).toBe(0);
  });

  test("gives up as throttled when the route keeps refusing", async () => {
    serve(Array.from({ length: 4 }, () => () => limited("user")));
    const read = createHistoryReader("token", memoryRedis());
    await expect(read(CHANNEL, "1")).rejects.toBeInstanceOf(DiscordBackoffError);
  });

  test("a global or Cloudflare 429 opens the shared backoff and isn't retried", async () => {
    for (const scope of ["global", null]) {
      const seen = serve([() => limited(scope)]);
      const redis = memoryRedis();
      await expect(createHistoryReader("token", redis)(CHANNEL, "1")).rejects.toBeInstanceOf(
        DiscordBackoffError,
      );
      expect(seen.calls).toBe(1);
      expect(redis.store.get("discord:backoff-until")).toBeDefined();
    }
  });
});

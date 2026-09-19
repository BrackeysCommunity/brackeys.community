import type { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * The subscriber socket is opened per connection with the offline queue
 * off, so a subscribe issued before `ready` rejects. What matters is that
 * the route subscribes on every `ready` — the first and each reconnect —
 * so a connection that opened during a Redis blip still gets live push.
 */
type FakeSubscriber = EventEmitter & {
  status: string;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
};

const state = vi.hoisted(() => ({
  subscriber: undefined as unknown,
  captureServerException: vi.fn(),
}));

vi.mock("@/polyfill", () => ({}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "u1" } }) } },
}));
vi.mock("@/lib/presence", () => ({
  presenceChannel: (userId: string) => `notifications:user:${userId}`,
  registerConnection: vi.fn(async () => {}),
  refreshConnection: vi.fn(async () => {}),
  unregisterConnection: vi.fn(async () => {}),
}));
vi.mock("@/lib/posthog-server", () => ({
  captureServerException: state.captureServerException,
  bestEffort: async (_scope: string, _ctx: unknown, fn: () => unknown) => {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  },
  withErrorReporting: (_route: string, fn: unknown) => fn,
}));
vi.mock("@/lib/redis", () => ({ createRedisClient: async () => state.subscriber }));

import { Route } from "../api.notifications.stream";

async function fakeSubscriber(status: string): Promise<FakeSubscriber> {
  const { EventEmitter } = await import("node:events");
  const emitter = new EventEmitter() as FakeSubscriber;
  emitter.status = status;
  emitter.subscribe = vi.fn(async () => {
    if (emitter.status !== "ready") {
      throw new Error("Stream isn't writeable and enableOfflineQueue options is false");
    }
  });
  emitter.unsubscribe = vi.fn(async () => {});
  emitter.quit = vi.fn(async () => {});
  return emitter;
}

const GET = (
  Route as unknown as {
    options: { server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } } };
  }
).options.server.handlers.GET;

async function open(subscriber: FakeSubscriber) {
  state.subscriber = subscriber;
  const controller = new AbortController();
  const response = await GET({
    request: new Request("https://brackeys.community/api/notifications/stream", {
      signal: controller.signal,
    }),
  });
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  return { response, first, close: () => controller.abort() };
}

let close: (() => void) | undefined;
afterEach(() => {
  close?.();
  vi.restoreAllMocks();
});

describe("/api/notifications/stream subscriber", () => {
  it("subscribes on every ready — the first connect and each reconnect", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const subscriber = await fakeSubscriber("connecting");
    const stream = await open(subscriber);
    close = stream.close;

    expect(stream.response.status).toBe(200);
    expect(stream.first).toContain(": connected");
    // Still connecting: no subscribe fired against a socket that would
    // reject it.
    expect(subscriber.subscribe).not.toHaveBeenCalled();

    subscriber.status = "ready";
    subscriber.emit("ready");
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith("notifications:user:u1");

    // A drop and reconnect re-issues it rather than trusting ioredis to.
    subscriber.emit("ready");
    expect(subscriber.subscribe).toHaveBeenCalledTimes(2);

    stream.close();
    await vi.waitFor(() => expect(subscriber.quit).toHaveBeenCalled());
    subscriber.emit("ready");
    expect(subscriber.subscribe).toHaveBeenCalledTimes(2);
    expect(state.captureServerException).not.toHaveBeenCalled();
  });

  it("subscribes at once when the socket is already up", async () => {
    const subscriber = await fakeSubscriber("ready");
    const stream = await open(subscriber);
    close = stream.close;
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
  });
});

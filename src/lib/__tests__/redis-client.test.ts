import type { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { captureServerException } = vi.hoisted(() => ({ captureServerException: vi.fn() }));
vi.mock("@/lib/posthog-server", () => ({ captureServerException }));
vi.mock("ioredis", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeRedis extends EventEmitter {
    status = "ready";
    constructor(_url: string, _options: unknown) {
      super();
    }
  }
  return { default: FakeRedis };
});

import { createRedisClient } from "@/lib/redis";

async function client(name: string): Promise<EventEmitter> {
  return (await createRedisClient(name)) as unknown as EventEmitter;
}

beforeEach(() => {
  captureServerException.mockClear();
  process.env.REDIS_URL = "redis://test";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("createRedisClient error capture", () => {
  it("reports once per client name per window, not once per instance", async () => {
    // The SSE route opens one client per connection; five connections
    // timing out during one outage are one report, not five.
    const a = await client("sse-subscriber");
    const b = await client("sse-subscriber");
    a.emit("error", new Error("connect ETIMEDOUT"));
    b.emit("error", new Error("connect ETIMEDOUT"));
    expect(captureServerException).toHaveBeenCalledTimes(1);
    expect(captureServerException).toHaveBeenCalledWith(expect.any(Error), {
      scope: "redis.sse-subscriber",
    });
  });

  it("keeps separately named clients on their own window", async () => {
    const presence = await client("presence");
    presence.emit("error", new Error("connect ETIMEDOUT"));
    expect(captureServerException).toHaveBeenCalledWith(expect.any(Error), {
      scope: "redis.presence",
    });
  });
});

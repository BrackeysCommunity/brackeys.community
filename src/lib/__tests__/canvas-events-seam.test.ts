import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { type CanvasEvent, emitCanvasEvent, onCanvasEvent, revokesFor } from "@/lib/canvas-events";

const redis = vi.hoisted(() => ({
  clients: 0,
  failConnect: false,
  order: [] as string[],
  published: [] as { channel: string; message: string }[],
}));

vi.mock("@/lib/redis", () => ({
  createRedisClient: async (name: string) => {
    if (redis.failConnect) throw new Error(`cannot connect ${name}`);
    redis.clients += 1;
    return {
      publish: async (channel: string, message: string) => {
        redis.order.push("publish");
        redis.published.push({ channel, message });
        return 0;
      },
    };
  },
}));

const personal = { kind: "personal", ownerId: "alice" } as const;
const team = { kind: "team", teamId: "t1" } as const;

const everyType: CanvasEvent[] = [
  { type: "hidden", canvasId: "c", scope: personal },
  { type: "unhidden", canvasId: "c", scope: team },
  { type: "deleted", canvasId: "c", scope: personal },
  { type: "restored", canvasId: "c", scope: personal },
  { type: "visibility_changed", canvasId: "c", scope: team, from: "team", to: "public" },
  { type: "member_added", canvasId: "c", scope: personal, userId: "bob", role: "viewer" },
  { type: "member_role_changed", canvasId: "c", scope: personal, userId: "bob", role: "editor" },
  { type: "member_removed", canvasId: "c", scope: personal, userId: "bob" },
  { type: "moved_to_team", canvasId: "c", scope: team, fromOwnerId: "alice" },
];

let saved: string | undefined;
let quiet: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  saved = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://test";
  redis.clients = 0;
  redis.failConnect = false;
  redis.order.length = 0;
  redis.published.length = 0;
  globalThis.__appCanvasEventsPublisher = undefined;
  quiet = [
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
  ];
});
afterEach(() => {
  if (saved === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = saved;
  for (const spy of quiet) spy.mockRestore();
});

describe("the canvas:events seam", () => {
  it("publishes every event type as JSON that round-trips to the same event", async () => {
    for (const event of everyType) await emitCanvasEvent(event);
    expect(redis.published.map((p) => p.channel)).toEqual(
      Array(everyType.length).fill("canvas:events"),
    );
    expect(redis.published.map((p) => JSON.parse(p.message))).toEqual(everyType);
  });

  it("tells in-process listeners before it publishes, and reuses one Redis client", async () => {
    const off = onCanvasEvent(() => redis.order.push("listener"));
    await emitCanvasEvent(everyType[0]!);
    await emitCanvasEvent(everyType[1]!);
    off();
    expect(redis.order).toEqual(["listener", "publish", "listener", "publish"]);
    expect(redis.clients).toBe(1);
  });

  it("never throws when Redis can't even connect, and still tells listeners", async () => {
    redis.failConnect = true;
    const heard = vi.fn();
    const off = onCanvasEvent(heard);
    await expect(emitCanvasEvent(everyType[0]!)).resolves.toBeUndefined();
    off();
    expect(heard).toHaveBeenCalledOnce();
    // A later emit retries the connection rather than caching the failure.
    redis.failConnect = false;
    await emitCanvasEvent(everyType[0]!);
    expect(redis.published).toHaveLength(1);
  });

  it("a listener that unsubscribes itself mid-emit doesn't skip the others", async () => {
    const second = vi.fn();
    const off1 = onCanvasEvent(() => off1());
    const off2 = onCanvasEvent(second);
    await emitCanvasEvent(everyType[0]!);
    await emitCanvasEvent(everyType[0]!);
    off2();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("unsubscribing twice is harmless", async () => {
    const heard = vi.fn();
    const off = onCanvasEvent(heard);
    off();
    off();
    await emitCanvasEvent(everyType[0]!);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("revokesFor covers §Revocation", () => {
  it("narrowing to the roster revokes everyone; widening never revokes", () => {
    const vis = (from: string, to: string) =>
      revokesFor({ type: "visibility_changed", canvasId: "c", scope: personal, from, to });
    const all = [{ canvasId: "c" }];
    for (const [from, to] of [
      ["public", "private"],
      ["public", "team"],
      ["public", "unlisted"],
      ["unlisted", "private"],
      ["unlisted", "team"],
    ]) {
      expect(vis(from!, to!), `${from} → ${to}`).toEqual(all);
    }
    for (const [from, to] of [
      ["private", "unlisted"],
      ["private", "public"],
      ["team", "unlisted"],
      ["unlisted", "public"],
      ["public", "public"],
    ]) {
      expect(vis(from!, to!), `${from} → ${to}`).toEqual([]);
    }
  });

  it("is pure: never mutates its input, same answer twice", () => {
    for (const event of everyType) {
      const copy = structuredClone(event);
      const first = revokesFor(event);
      expect(revokesFor(event)).toEqual(first);
      expect(event).toEqual(copy);
    }
  });

  it("every revoke names the event's canvas, and a member revoke names only that member", () => {
    for (const event of everyType) {
      for (const revoke of revokesFor(event)) {
        expect(revoke.canvasId).toBe(event.canvasId);
        if ("userId" in revoke) expect(revoke.userId).toBe("bob");
      }
    }
  });
});

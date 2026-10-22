import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { type CanvasEvent, emitCanvasEvent, onCanvasEvent, revokesFor } from "@/lib/canvas-events";

const published: { channel: string; message: string }[] = [];
let failPublish = false;

vi.mock("@/lib/redis", () => ({
  createRedisClient: async () => ({
    publish: async (channel: string, message: string) => {
      if (failPublish) throw new Error("redis down");
      published.push({ channel, message });
      return 1;
    },
  }),
}));

const personal = { kind: "personal", ownerId: "alice" } as const;
const hidden: CanvasEvent = { type: "hidden", canvasId: "c1", scope: personal };

let redisUrl: string | undefined;
beforeEach(() => {
  redisUrl = process.env.REDIS_URL;
  published.length = 0;
  failPublish = false;
  globalThis.__appCanvasEventsPublisher = undefined;
});
afterEach(() => {
  if (redisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = redisUrl;
});

describe("emitCanvasEvent", () => {
  it("calls listeners and stops after unsubscribe", async () => {
    const heard: CanvasEvent[] = [];
    const off = onCanvasEvent((event) => heard.push(event));
    await emitCanvasEvent(hidden);
    off();
    await emitCanvasEvent(hidden);
    expect(heard).toEqual([hidden]);
  });

  it("publishes JSON on canvas:events only with REDIS_URL", async () => {
    delete process.env.REDIS_URL;
    await emitCanvasEvent(hidden);
    expect(published).toEqual([]);

    process.env.REDIS_URL = "redis://test";
    await emitCanvasEvent(hidden);
    expect(published).toEqual([{ channel: "canvas:events", message: JSON.stringify(hidden) }]);
  });

  it("swallows a failing publish and a throwing listener", async () => {
    process.env.REDIS_URL = "redis://test";
    failPublish = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const later = vi.fn();
    const offA = onCanvasEvent(() => {
      throw new Error("listener broke");
    });
    const offB = onCanvasEvent(later);
    await expect(emitCanvasEvent(hidden)).resolves.toBeUndefined();
    expect(later).toHaveBeenCalledOnce();
    offA();
    offB();
    error.mockRestore();
    warn.mockRestore();
  });
});

describe("revokesFor", () => {
  const base = { canvasId: "c1", scope: personal };
  const all = [{ canvasId: "c1" }];
  const one = [{ canvasId: "c1", userId: "bob" }];

  it.each<[string, CanvasEvent, unknown]>([
    ["hidden", { ...base, type: "hidden" }, all],
    ["deleted", { ...base, type: "deleted" }, all],
    [
      "moved to a team",
      {
        canvasId: "c1",
        type: "moved_to_team",
        scope: { kind: "team", teamId: "t" },
        fromOwnerId: "alice",
      },
      all,
    ],
    ["unhidden", { ...base, type: "unhidden" }, []],
    ["restored", { ...base, type: "restored" }, []],
    [
      "public → private",
      { ...base, type: "visibility_changed", from: "public", to: "private" },
      all,
    ],
    [
      "public → unlisted",
      { ...base, type: "visibility_changed", from: "public", to: "unlisted" },
      all,
    ],
    ["unlisted → team", { ...base, type: "visibility_changed", from: "unlisted", to: "team" }, all],
    [
      "private → public",
      { ...base, type: "visibility_changed", from: "private", to: "public" },
      [],
    ],
    ["team → unlisted", { ...base, type: "visibility_changed", from: "team", to: "unlisted" }, []],
    ["member added", { ...base, type: "member_added", userId: "bob", role: "editor" }, []],
    ["member removed", { ...base, type: "member_removed", userId: "bob" }, one],
    [
      "member downgraded",
      { ...base, type: "member_role_changed", userId: "bob", role: "viewer" },
      one,
    ],
    [
      "member upgraded",
      { ...base, type: "member_role_changed", userId: "bob", role: "editor" },
      [],
    ],
  ])("%s", (_name, event, expected) => {
    expect(revokesFor(event)).toEqual(expected);
  });
});

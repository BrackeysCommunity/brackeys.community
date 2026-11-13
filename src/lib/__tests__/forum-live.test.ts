import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { announceForumPost, onForumPost, parseForumLiveEvent } from "@/lib/forum-live";

type Handler = (...args: string[]) => void;

const bus = vi.hoisted(() => ({
  clients: [] as { channels: Set<string>; handlers: Map<string, Handler[]> }[],
}));

vi.mock("@/lib/redis", () => ({
  createRedisClient: async () => {
    const client = { channels: new Set<string>(), handlers: new Map<string, Handler[]>() };
    bus.clients.push(client);
    return {
      status: "ready",
      on(event: string, fn: Handler) {
        client.handlers.set(event, [...(client.handlers.get(event) ?? []), fn]);
      },
      async subscribe(channel: string) {
        client.channels.add(channel);
      },
      async publish(channel: string, message: string) {
        for (const other of bus.clients) {
          if (!other.channels.has(channel)) continue;
          for (const fn of other.handlers.get("message") ?? []) fn(channel, message);
        }
        return 1;
      },
    };
  },
}));

vi.mock("@/lib/posthog-server", () => ({
  bestEffort: async (_scope: string, _ctx: unknown, fn: () => unknown) => fn(),
}));

const post = { id: 7, kind: "discussion", category: "general", authorId: "u1" };

describe("parseForumLiveEvent", () => {
  it("keeps a well-formed event, with or without an author", () => {
    expect(parseForumLiveEvent(post)).toEqual(post);
    expect(parseForumLiveEvent({ ...post, authorId: null })).toEqual({ ...post, authorId: null });
  });

  it("keeps only the announced fields", () => {
    expect(parseForumLiveEvent({ ...post, body: "secret" })).toEqual(post);
  });

  it.each([
    ["a non-object", "post"],
    ["null", null],
    ["a non-number id", { ...post, id: "7" }],
    ["a non-string kind", { ...post, kind: 1 }],
    ["a non-string category", { ...post, category: undefined }],
    ["an authorId that is neither null nor a string", { ...post, authorId: 42 }],
    ["a missing authorId", { id: 7, kind: "discussion", category: "general" }],
  ])("rejects %s", (_label, raw) => {
    expect(parseForumLiveEvent(raw)).toBeNull();
  });
});

describe("forum broadcast over Redis", () => {
  let redisUrl: string | undefined;
  beforeEach(() => {
    redisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://test";
  });
  afterEach(() => {
    if (redisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = redisUrl;
  });

  it("hands listeners announced posts and drops malformed payloads", async () => {
    const heard: unknown[] = [];
    const off = await onForumPost((event) => heard.push(event));

    await announceForumPost(post);
    const raw = (message: string) => {
      for (const client of bus.clients) {
        for (const fn of client.handlers.get("message") ?? []) fn("forum:new-posts", message);
      }
    };
    raw(JSON.stringify({ ...post, id: "8" }));
    raw(JSON.stringify({ ...post, authorId: 42 }));
    raw("not json");

    expect(heard).toEqual([post]);
    off();
    await announceForumPost({ ...post, id: 9 });
    expect(heard).toEqual([post]);
  });
});

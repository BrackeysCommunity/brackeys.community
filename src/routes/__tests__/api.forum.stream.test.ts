import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  flagOn: false,
  flagCalls: [] as [string, string][],
  listener: undefined as ((event: unknown) => void) | undefined,
  unsubscribed: 0,
}));

vi.mock("@/polyfill", () => ({}));
vi.mock("@/lib/route-session", () => ({
  readRouteSession: async () => ({ user: { id: "u1" } }),
}));
vi.mock("@/lib/posthog-server", () => ({
  ANONYMOUS_FLAG_DISTINCT_ID: "anonymous",
  isServerFlagEnabled: async (flag: string, distinctId: string) => {
    state.flagCalls.push([flag, distinctId]);
    return state.flagOn;
  },
  withErrorReporting: (_route: string, fn: unknown) => fn,
}));
vi.mock("@/lib/forum-live", () => ({
  onForumPost: async (listener: (event: unknown) => void) => {
    state.listener = listener;
    return () => {
      state.unsubscribed++;
      state.listener = undefined;
    };
  },
}));

import { Route } from "../api.forum.stream";

const GET = (
  Route as unknown as {
    options: { server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } } };
  }
).options.server.handlers.GET;

const decoder = new TextDecoder();
let close: (() => void) | undefined;
afterEach(() => {
  close?.();
  close = undefined;
  state.flagOn = false;
  state.flagCalls.length = 0;
  state.unsubscribed = 0;
});

describe("/api/forum/stream", () => {
  it("answers 404 with the forum flag off, without subscribing", async () => {
    const response = await GET({ request: new Request("https://jams.team/api/forum/stream") });
    expect(response.status).toBe(404);
    expect(state.flagCalls).toEqual([["forum-enabled", "u1"]]);
    expect(state.listener).toBeUndefined();
  });

  it("writes one `post` event per announced post with the flag on", async () => {
    state.flagOn = true;
    const controller = new AbortController();
    close = () => controller.abort();
    const response = await GET({
      request: new Request("https://jams.team/api/forum/stream", { signal: controller.signal }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    expect(decoder.decode((await reader.read()).value)).toContain(": connected");

    const post = { id: 7, kind: "discussion", category: "general", authorId: null };
    state.listener?.(post);
    expect(decoder.decode((await reader.read()).value)).toBe(
      `event: post\ndata: ${JSON.stringify(post)}\n\n`,
    );

    controller.abort();
    expect(state.unsubscribed).toBe(1);
  });
});

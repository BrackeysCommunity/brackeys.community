import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const api = vi.hoisted(() => {
  class MapRequestError extends Error {
    constructor(readonly status: number) {
      super(`map read failed: ${status}`);
    }
  }
  return { loadTick: vi.fn(), MapRequestError };
});
vi.mock("@/components/map/map-api", () => ({
  loadTick: api.loadTick,
  MapRequestError: api.MapRequestError,
  TICK_KEY: ["mmo-map", "tick"],
}));
vi.mock("@/components/map/MapPage", () => ({ MapPage: () => null }));

const { Route, serverFromSearch, validateMapSearch } = await import("../../../routes/map");

type Meta = { name?: string; property?: string; content?: string; title?: string };

function head() {
  const h = (Route.options.head as () => { meta: Meta[]; links: { rel: string }[] })();
  return { meta: h.meta, links: h.links };
}

function load(queryClient = new QueryClient()) {
  const loader = Route.options.loader as (ctx: unknown) => Promise<unknown>;
  return loader({ context: { queryClient } });
}

describe("/map", () => {
  beforeEach(() => {
    api.loadTick.mockReset();
  });

  it("takes over the window", () => {
    expect(Route.options.staticData).toEqual({ shell: "takeover" });
  });

  it("is kept out of the index and names no canonical", () => {
    const { meta, links } = head();
    expect(meta.find((m) => m.name === "robots")?.content).toBe("noindex, nofollow");
    expect(meta.find((m) => m.title)?.title).toMatch(/^(\[.*\] )?Live map · /);
    expect(links.some((l) => l.rel === "canonical")).toBe(false);
  });

  it("opens when the tick route answers, and keeps its index for the page", async () => {
    const index = { tick: 3, tickSeconds: 600, chunks: [] };
    api.loadTick.mockResolvedValue(index);
    const queryClient = new QueryClient();
    await expect(load(queryClient)).resolves.toBeUndefined();
    expect(queryClient.getQueryData(["mmo-map", "tick"])).toBe(index);
  });

  it("is a 404 when the tick route answers 404", async () => {
    api.loadTick.mockRejectedValue(new api.MapRequestError(404));
    const thrown = await load().catch((e: unknown) => e);
    expect(isNotFound(thrown)).toBe(true);
  });

  it.each([
    ["a 502", new api.MapRequestError(502)],
    ["a 503", new api.MapRequestError(503)],
    ["a 429", new api.MapRequestError(429)],
    ["a plain error", new Error("network down")],
  ])("opens without a tick on %s", async (_, err) => {
    api.loadTick.mockRejectedValue(err);
    const queryClient = new QueryClient();
    await expect(load(queryClient)).resolves.toBeUndefined();
    expect(queryClient.getQueryData(["mmo-map", "tick"])).toBeUndefined();
  });

  it("keeps a link's camera and drops anything else", () => {
    expect(validateMapSearch({ q: 3, r: "-2", z: "14" })).toEqual({ q: 3, r: -2, z: 14 });
    expect(validateMapSearch({ q: 3 })).toEqual({});
    expect(validateMapSearch({ q: "x", r: 1, z: -1, server: "guild" })).toEqual({});
    expect(validateMapSearch({ server: "1234" })).toEqual({});
    expect(validateMapSearch({ server: "123456789012345678" })).toEqual({
      server: "123456789012345678",
    });
  });

  it("reads a Discord server id as written, past a double's precision", () => {
    expect(serverFromSearch("?server=123456789012345678")).toBe("123456789012345678");
    expect(serverFromSearch("?server=abc")).toBeUndefined();
    expect(serverFromSearch("")).toBeUndefined();
  });
});

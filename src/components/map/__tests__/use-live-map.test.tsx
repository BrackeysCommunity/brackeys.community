import { readFileSync } from "node:fs";
import { join } from "node:path";

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  MapChunk,
  MapIndex,
  MapOverlay,
  MapRegions,
  MapStyle,
} from "../../../../packages/mmo-api/src/index.ts";
import {
  centreOn,
  hexCentre,
  MAX_OVERLAY_CHUNKS,
  resolveStyle,
} from "../../../../packages/mmo-map/src/index.ts";
import {
  countInView,
  type LiveMapOptions,
  planView,
  pollMs,
  POLL_MIN_MS,
  readLayers,
  SETTLE_MS,
  useLiveMap,
  writeLayers,
} from "../use-live-map";

const toast = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast }));

// The Activity's map fixtures: a 469-tile world read through the world's own filter.
const FIXTURES = join(import.meta.dirname, "../../../../services/mmo-activity/test/fixtures/map");

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

const INDEX = fixture<MapIndex>("index.json");
const STYLE = fixture<MapStyle>("style.json");
const REGIONS = fixture<MapRegions>("regions.json");
const CHUNKS = fixture<MapChunk[]>("chunks.json");
const OVERLAY = fixture<MapOverlay>("overlay.json");
const VIEW = { width: 1000, height: 600 };

describe("planView", () => {
  const style = resolveStyle(STYLE);

  it("asks for the one regions payload and the viewer's sight at region level", () => {
    const plan = planView(INDEX, style, centreOn(INDEX.home, 2), VIEW);
    expect(plan.level).toBe("region");
    expect(plan.chunks).toEqual([]);
    expect(plan.overlay).toEqual({ sight: true });
  });

  it("asks for each chunk in view at its rev, and the overlay for them, at tile level", () => {
    const plan = planView(INDEX, style, centreOn(INDEX.home, 14), VIEW);
    expect(plan.level).toBe("tile");
    expect(plan.chunks.length).toBeGreaterThan(0);
    for (const ask of plan.chunks) {
      expect(ask.rev).toBe(ask.ref.tile);
      expect(ask.url).toBe(
        `/api/public/mmo/map/chunk/tile/${ask.ref.a}/${ask.ref.b}/${ask.ref.tile}`,
      );
    }
    const ids = plan.overlay?.chunks ?? [];
    expect(ids).toHaveLength(plan.chunks.length);
    expect(ids).toEqual([...ids].sort((x, y) => x.a - y.a || x.b - y.b));
  });

  it("uses the area rev between the two thresholds", () => {
    const plan = planView(INDEX, style, centreOn(INDEX.home, 6), VIEW);
    expect(plan.level).toBe("area");
    for (const ask of plan.chunks) expect(ask.rev).toBe(ask.ref.area);
  });

  it("names at most 64 chunks in an overlay, the nearest", () => {
    const many: MapIndex = {
      ...INDEX,
      chunks: Array.from({ length: 100 }, (_, i) => ({
        a: i,
        b: 0,
        centre: { q: 0, r: 0 },
        tiles: 1,
        area: `a${i}`,
        tile: `t${i}`,
      })),
    };
    const plan = planView(many, style, centreOn({ q: 0, r: 0 }, 14), VIEW);
    expect(plan.chunks).toHaveLength(100);
    expect(plan.overlay?.chunks).toHaveLength(MAX_OVERLAY_CHUNKS);
  });

  it("asks for nothing live when no chunk is in view", () => {
    const plan = planView(INDEX, style, centreOn({ q: 5000, r: 5000 }, 14), VIEW);
    expect(plan.chunks).toEqual([]);
    expect(plan.overlay).toBeUndefined();
  });
});

describe("pollMs", () => {
  it("polls every tick, never under 30 seconds", () => {
    expect(pollMs(undefined)).toBe(POLL_MIN_MS);
    expect(pollMs({ tickSeconds: 3 })).toBe(30_000);
    expect(pollMs({ tickSeconds: 600 })).toBe(600_000);
  });
});

describe("countInView", () => {
  it("counts discovered tiles in view by fog state", () => {
    const style = resolveStyle(STYLE);
    const chunks = new Map(CHUNKS.map((c) => [`${c.level}/${c.a}.${c.b}/${c.rev}`, c]));
    const camera = centreOn(OVERLAY.self!, 14);
    const counts = countInView({ index: INDEX, style, chunks, overlay: OVERLAY }, camera, VIEW);
    expect(counts.sight).toBeGreaterThan(0);
    expect(counts.never).toBeGreaterThan(0);
    const anonymous = countInView({ index: INDEX, style, chunks }, camera, VIEW);
    expect(anonymous.sight).toBe(0);
    expect(anonymous.seen).toBe(0);
    expect(anonymous.never).toBe(counts.sight + counts.seen + counts.never);
  });
});

describe("layer toggles", () => {
  it("round-trips through storage and survives storage that throws", () => {
    const kept = new Map<string, string>();
    const store = {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    };
    const on = readLayers(store);
    on.delete("busy");
    writeLayers(store, on);
    expect(readLayers(store).has("busy")).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLayers(broken).has("busy")).toBe(true);
    expect(() => writeLayers(broken, on)).not.toThrow();
  });
});

interface Served {
  url: string;
}

let calls: Served[] = [];
let tick: MapIndex = INDEX;
let tickStatus = 200;

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function serve(url: string): Response {
  calls.push({ url });
  if (url === "/api/public/mmo/map/tick") {
    return tickStatus === 200 ? reply(tick) : reply({ code: "busy" }, tickStatus);
  }
  if (url.startsWith("/api/public/mmo/map/style/")) return reply(STYLE);
  if (url.startsWith("/api/public/mmo/map/regions/")) return reply(REGIONS);
  if (url.startsWith("/api/public/mmo/map/focus"))
    return reply({ centre: { q: -34, r: 16 }, settlements: 1 });
  const chunk = /^\/api\/public\/mmo\/map\/chunk\/(\w+)\/(-?\d+)\/(-?\d+)\//.exec(url);
  if (chunk) {
    const [, level, a, b] = chunk;
    const hit = CHUNKS.find((c) => c.level === level && c.a === Number(a) && c.b === Number(b));
    return hit ? reply(hit) : reply({ code: "not-found" }, 404);
  }
  if (url.startsWith("/api/mmo/map/overlay")) return reply(OVERLAY);
  return reply({ code: "not-found" }, 404);
}

const asked = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix));

// A timer's fetch resolves over several microtask turns, and each answer renders once.
async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

function mount(options: LiveMapOptions) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook((p: LiveMapOptions) => useLiveMap(p), { wrapper, initialProps: options });
}

describe("useLiveMap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    tick = INDEX;
    tickStatus = 200;
    toast.warning.mockReset();
    toast.error.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => serve(input)),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks for the index once a tick, and never more often than every 30 seconds", async () => {
    tick = { ...INDEX, tickSeconds: 3 };
    mount({ search: {}, userId: null });
    await flush();
    expect(asked("/api/public/mmo/map/tick")).toHaveLength(1);
    await flush(POLL_MIN_MS - 100);
    expect(asked("/api/public/mmo/map/tick")).toHaveLength(1);
    await flush(100);
    expect(asked("/api/public/mmo/map/tick")).toHaveLength(2);
  });

  it("waits a whole tick when the tick is longer than 30 seconds", async () => {
    mount({ search: {}, userId: null });
    await flush();
    await flush(POLL_MIN_MS);
    expect(asked("/api/public/mmo/map/tick")).toHaveLength(1);
    await flush(INDEX.tickSeconds * 1000 - POLL_MIN_MS);
    expect(asked("/api/public/mmo/map/tick")).toHaveLength(2);
  });

  it("reads the style and regions by the index's revs, once", async () => {
    mount({ search: {}, userId: null });
    await flush();
    expect(asked("/api/public/mmo/map/style/").map((c) => c.url)).toEqual([
      `/api/public/mmo/map/style/${INDEX.style}`,
    ]);
    expect(asked("/api/public/mmo/map/regions/").map((c) => c.url)).toEqual([
      `/api/public/mmo/map/regions/${INDEX.regions}`,
    ]);
  });

  it("fits the world for an anonymous visitor and never asks for an overlay", async () => {
    const { result } = mount({ search: {}, userId: null });
    await flush();
    act(() => result.current.resized(VIEW));
    await flush();
    expect(result.current.camera).toBeDefined();
    expect(result.current.viewer).toBe("anonymous");
    act(() => result.current.moved(centreOn(INDEX.home, 14)));
    await flush(SETTLE_MS);
    expect(asked("/api/public/mmo/map/chunk/").length).toBeGreaterThan(0);
    expect(asked("/api/mmo/map/overlay")).toHaveLength(0);
    expect(result.current.overlay).toBeUndefined();
  });

  it("centres a signed-in character on their own tile from their sight", async () => {
    const { result } = mount({ search: {}, userId: "u1" });
    await flush();
    act(() => result.current.resized(VIEW));
    await flush();
    expect(asked("/api/mmo/map/overlay")[0]?.url).toBe("/api/mmo/map/overlay?scope=sight");
    const self = hexCentre(OVERLAY.self!, 1);
    expect(result.current.camera).toMatchObject({ x: self.x, y: self.y });
    expect(result.current.viewer).toBe("character");
  });

  it("centres a server's view on its focus", async () => {
    const { result } = mount({ search: { server: "123456789012345678" }, userId: null });
    await flush();
    act(() => result.current.resized(VIEW));
    await flush();
    expect(asked("/api/public/mmo/map/focus")[0]?.url).toBe(
      "/api/public/mmo/map/focus?server=123456789012345678",
    );
    const at = hexCentre({ q: -34, r: 16 }, 1);
    expect(result.current.camera).toMatchObject({ x: at.x, y: at.y });
  });

  it("asks for the overlay 300 ms after a pan settles, and not before", async () => {
    const { result } = mount({ search: { q: INDEX.home.q, r: INDEX.home.r, z: 14 }, userId: "u1" });
    await flush();
    act(() => result.current.resized(VIEW));
    await flush();
    expect(asked("/api/mmo/map/overlay")).toHaveLength(1);

    const far = INDEX.chunks.at(-1)!.centre;
    for (const step of [0.2, 0.6, 1]) {
      const h = {
        q: Math.round(INDEX.home.q + (far.q - INDEX.home.q) * step),
        r: Math.round(INDEX.home.r + (far.r - INDEX.home.r) * step),
      };
      act(() => result.current.moved(centreOn(h, 14)));
      await flush(100);
    }
    expect(asked("/api/mmo/map/overlay")).toHaveLength(1);
    await flush(SETTLE_MS - 101);
    expect(asked("/api/mmo/map/overlay")).toHaveLength(1);
    await flush(1);
    const overlays = asked("/api/mmo/map/overlay");
    expect(overlays).toHaveLength(2);
    expect(overlays[1]!.url).toMatch(/^\/api\/mmo\/map\/overlay\?chunks=-?\d+\.-?\d+/);
    expect(overlays[1]!.url).not.toBe(overlays[0]!.url);
  });

  it("does not ask again when a settled view names the same chunks", async () => {
    const { result } = mount({ search: { q: INDEX.home.q, r: INDEX.home.r, z: 14 }, userId: "u1" });
    await flush();
    act(() => result.current.resized(VIEW));
    await flush();
    const camera = result.current.camera!;
    act(() => result.current.moved({ ...camera, x: camera.x + 0.01 }));
    await flush(SETTLE_MS);
    expect(asked("/api/mmo/map/overlay")).toHaveLength(1);
  });

  it("asks for the overlay again when the tick moves", async () => {
    tick = { ...INDEX, tickSeconds: 3 };
    const { result } = mount({ search: { q: INDEX.home.q, r: INDEX.home.r, z: 14 }, userId: "u1" });
    await flush();
    act(() => result.current.resized(VIEW));
    await flush();
    expect(asked("/api/mmo/map/overlay")).toHaveLength(1);
    await flush(POLL_MIN_MS);
    expect(asked("/api/mmo/map/overlay")).toHaveLength(1);
    tick = { ...tick, tick: tick.tick + 1 };
    await flush(POLL_MIN_MS);
    // A fetch answered inside a fake tick settles a millisecond later.
    await flush(1);
    expect(asked("/api/mmo/map/overlay")).toHaveLength(2);
  });

  it("keeps fetched chunks for the visit by rev", async () => {
    const { result } = mount({ search: { q: INDEX.home.q, r: INDEX.home.r, z: 14 }, userId: null });
    await flush();
    act(() => result.current.resized(VIEW));
    await flush();
    const held = result.current.chunks.size;
    expect(held).toBeGreaterThan(0);
    act(() => result.current.moved(centreOn({ q: 5000, r: 5000 }, 14)));
    await flush(SETTLE_MS);
    expect(result.current.chunks.size).toBe(held);
  });

  it("tells the visitor once when the map is busy", async () => {
    tickStatus = 429;
    mount({ search: {}, userId: null });
    await flush();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0]![1]).toMatchObject({ id: "mmo-map-busy" });
  });

  it("tells the visitor when the world is not answering", async () => {
    tickStatus = 502;
    const { result } = mount({ search: {}, userId: null });
    await flush();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(result.current.problem).toBe("down");
  });
});

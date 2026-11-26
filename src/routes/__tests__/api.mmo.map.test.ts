import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Viewer = { kind: "anonymous" } | { kind: "user"; userId: string; discordId?: string };

const state = vi.hoisted(() => ({
  env: {} as { MMO_WORLD_URL?: string; MMO_MAP_TOKEN?: string },
  allowed: true,
  limits: [] as [string, string, number][],
  viewer: { kind: "anonymous" } as Viewer,
  getSession: vi.fn(async () => ({ user: { id: "should-not-be-read" } })),
  mapViewer: vi.fn(),
}));

vi.mock("@/env", () => ({ env: state.env }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: state.getSession } } }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (bucket: string, key: string, limit: number) => {
    state.limits.push([bucket, key, limit]);
    return state.allowed;
  },
}));
vi.mock("@/lib/mmo-map/viewer", () => ({
  mapViewer: async (request: Request) => {
    state.mapViewer(request);
    return state.viewer;
  },
}));

import { Route as OverlayRoute } from "../api.mmo.map.overlay";
import { Route as ChunkRoute } from "../api.public.mmo.map.chunk.$level.$a.$b.$rev";
import { Route as FocusRoute } from "../api.public.mmo.map.focus";
import { Route as RegionsRoute } from "../api.public.mmo.map.regions.$rev";
import { Route as StyleRoute } from "../api.public.mmo.map.style.$rev";
import { Route as TickRoute } from "../api.public.mmo.map.tick";

type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>;

function handler(route: unknown): Handler {
  return (route as { options: { server: { handlers: { GET: Handler } } } }).options.server.handlers
    .GET;
}

const WORLD = "http://world.test:18080";
const REV = "0123456789abcdef";
const OTHER_REV = "fedcba9876543210";
const SITE = "https://example.test";

const BROWSER_HEADERS = {
  cookie: "better-auth.session_token=secret",
  authorization: "Bearer browser-token",
  "cf-connecting-ip": "203.0.113.9",
};

interface Call {
  url: URL;
  headers: Record<string, string>;
}

let calls: Call[];
let reply: () => Promise<Response>;

function worldReplies(status: number, body: unknown, headers: Record<string, string> = {}) {
  reply = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "set-cookie": "world=1", ...headers },
    });
}

beforeEach(() => {
  state.env.MMO_WORLD_URL = WORLD;
  state.env.MMO_MAP_TOKEN = "map-token";
  state.allowed = true;
  state.limits = [];
  state.viewer = { kind: "anonymous" };
  state.getSession.mockClear();
  state.mapViewer.mockClear();
  calls = [];
  worldReplies(200, { tick: 7 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({
        url: new URL(String(input)),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      return reply();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function get(route: unknown, path: string, params: Record<string, string> = {}) {
  return handler(route)({
    request: new Request(`${SITE}${path}`, { headers: BROWSER_HEADERS }),
    params,
  });
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("cdn-cache-control")).toBe("no-store");
}

/** Every route, as a browser would call it, with a query that tries to name a viewer. */
const ROUTES = [
  { name: "tick", route: TickRoute, path: "/api/public/mmo/map/tick", params: {} },
  { name: "focus", route: FocusRoute, path: "/api/public/mmo/map/focus?server=42", params: {} },
  {
    name: "style",
    route: StyleRoute,
    path: `/api/public/mmo/map/style/${REV}`,
    params: { rev: REV },
  },
  {
    name: "regions",
    route: RegionsRoute,
    path: `/api/public/mmo/map/regions/${REV}`,
    params: { rev: REV },
  },
  {
    name: "chunk",
    route: ChunkRoute,
    path: `/api/public/mmo/map/chunk/tile/3/-2/${REV}`,
    params: { level: "tile", a: "3", b: "-2", rev: REV },
  },
  { name: "overlay", route: OverlayRoute, path: "/api/mmo/map/overlay?scope=sight", params: {} },
] as const;

const PUBLIC_ROUTES = ROUTES.filter((r) => r.name !== "overlay");

describe("the public map routes", () => {
  it.each([
    ["tick", TickRoute, "/api/public/mmo/map/tick", {}, "/v1/map/index", {}],
    [
      "focus",
      FocusRoute,
      "/api/public/mmo/map/focus?server=42",
      {},
      "/v1/map/focus",
      { server: "42" },
    ],
    ["style", StyleRoute, `/api/public/mmo/map/style/${REV}`, { rev: REV }, "/v1/map/style", {}],
    [
      "regions",
      RegionsRoute,
      `/api/public/mmo/map/regions/${REV}`,
      { rev: REV },
      "/v1/map/regions",
      {},
    ],
    [
      "chunk",
      ChunkRoute,
      `/api/public/mmo/map/chunk/area/3/-2/${REV}`,
      { level: "area", a: "3", b: "-2", rev: REV },
      "/v1/map/chunk",
      { a: "3", b: "-2", level: "area" },
    ],
  ] as const)("%s asks the world's path with the map token and no identity", async (...args) => {
    const [, route, path, params, worldPath, worldParams] = args;
    worldReplies(200, { rev: REV, tick: 7 });
    const response = await get(
      route,
      `${path}${path.includes("?") ? "&" : "?"}discordId=1`,
      params,
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.origin).toBe(WORLD);
    expect(calls[0].url.pathname).toBe(worldPath);
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual(worldParams);
    expect(calls[0].headers).toEqual({
      accept: "application/json",
      authorization: "Bearer map-token",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ rev: REV, tick: 7 });
    expect(state.getSession).not.toHaveBeenCalled();
    expect(state.mapViewer).not.toHaveBeenCalled();
  });

  it("sends no token when the site holds none", async () => {
    delete state.env.MMO_MAP_TOKEN;
    await get(TickRoute, "/api/public/mmo/map/tick");
    expect(calls[0].headers).toEqual({ accept: "application/json" });
  });

  it("asks the world's focus with no server for the world's home", async () => {
    await get(FocusRoute, "/api/public/mmo/map/focus");
    expect([...calls[0].url.searchParams]).toEqual([]);
  });

  it("keys the index by tick at the edge", async () => {
    const response = await get(TickRoute, "/api/public/mmo/map/tick");
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=30");
    expect(response.headers.get("cdn-cache-control")).toBeNull();
  });

  it.each([
    ["style", StyleRoute, `/api/public/mmo/map/style/${REV}`, { rev: REV }],
    ["regions", RegionsRoute, `/api/public/mmo/map/regions/${REV}`, { rev: REV }],
    [
      "chunk",
      ChunkRoute,
      `/api/public/mmo/map/chunk/tile/0/0/${REV}`,
      { level: "tile", a: "0", b: "0", rev: REV },
    ],
  ] as const)(
    "%s is kept at the edge only when the rev matches",
    async (_name, route, path, params) => {
      worldReplies(200, { rev: REV });
      const fresh = await get(route, path, params);
      expect(fresh.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=31536000");
      expect(fresh.headers.get("cdn-cache-control")).toBeNull();

      worldReplies(200, { rev: OTHER_REV });
      const moved = await get(route, path, params);
      expect(moved.status).toBe(200);
      expectNoStore(moved);
      expect(await moved.json()).toEqual({ rev: OTHER_REV });
    },
  );

  it.each([
    ["level", { level: "region", a: "0", b: "0", rev: REV }],
    ["a", { level: "tile", a: "x", b: "0", rev: REV }],
    ["b", { level: "tile", a: "0", b: "1.5", rev: REV }],
    ["rev", { level: "tile", a: "0", b: "0", rev: "latest" }],
  ])("refuses a chunk with a bad %s without asking the world", async (_name, params) => {
    const response = await get(ChunkRoute, "/api/public/mmo/map/chunk/x", params);
    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(calls).toHaveLength(0);
  });

  it("refuses a focus server that is not a Discord id", async () => {
    const response = await get(FocusRoute, "/api/public/mmo/map/focus?server=..%2Fv1");
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("counts public reads by address, never by session", async () => {
    await get(TickRoute, "/api/public/mmo/map/tick");
    expect(state.limits).toHaveLength(1);
    expect(state.limits[0][0]).toBe("mmo-map-read");
    expect(state.limits[0][1]).toMatch(/^ip:203\.0\.113\.9:\d+$/);
    expect(state.limits[0][2]).toBe(600);
  });
});

describe("the overlay route", () => {
  it("forwards the session's Discord id and ignores the browser's", async () => {
    state.viewer = { kind: "user", userId: "u1", discordId: "111222333" };
    worldReplies(200, { viewer: "character", tiles: [] });
    const response = await get(
      OverlayRoute,
      "/api/mmo/map/overlay?chunks=0.0,1.-1&discordId=999&characterId=c9&viewer=character",
    );

    expect(response.status).toBe(200);
    expect(calls[0].url.pathname).toBe("/v1/map/overlay");
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
      chunks: "0.0,1.-1",
      discordId: "111222333",
    });
    expect(calls[0].headers).toEqual({
      accept: "application/json",
      authorization: "Bearer map-token",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(state.limits[0]).toEqual(["mmo-map-overlay", expect.stringMatching(/^user:u1:/), 120]);
  });

  it("sends no Discord id for an anonymous viewer, whatever the query says", async () => {
    worldReplies(200, { viewer: "anonymous", tiles: [], fronts: [] });
    const response = await get(
      OverlayRoute,
      "/api/mmo/map/overlay?scope=sight&discordId=111222333",
    );

    expect(response.status).toBe(200);
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ scope: "sight" });
    expect(state.limits[0]).toEqual([
      "mmo-map-overlay",
      expect.stringMatching(/^ip:203\.0\.113\.9:/),
      30,
    ]);
  });

  it("sends no Discord id for a user with no Discord link", async () => {
    state.viewer = { kind: "user", userId: "u2" };
    worldReplies(200, { viewer: "anonymous", tiles: [], fronts: [] });
    const response = await get(OverlayRoute, "/api/mmo/map/overlay?chunks=0.0&discordId=111222333");
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ chunks: "0.0" });
    expect(state.limits[0][1]).toMatch(/^user:u2:/);
    expect(await response.json()).toEqual({ viewer: "player", tiles: [], fronts: [] });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  });

  it("refuses an oversized chunk list without asking the world", async () => {
    const chunks = Array.from({ length: 400 }, (_, i) => `${i}.${i}`).join(",");
    const response = await get(OverlayRoute, `/api/mmo/map/overlay?chunks=${chunks}`);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("every map route", () => {
  it.each(ROUTES)("$name is 404 when the site knows no world", async ({ route, path, params }) => {
    delete state.env.MMO_WORLD_URL;
    const response = await get(route, path, params);
    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(calls).toHaveLength(0);
  });

  it.each(ROUTES)("$name is 502 when the world is down", async ({ route, path, params }) => {
    reply = () => Promise.reject(new TypeError("fetch failed"));
    const response = await get(route, path, params);
    expect(response.status).toBe(502);
    expectNoStore(response);
  });

  it.each(ROUTES)("$name is 502 when the world times out", async ({ route, path, params }) => {
    reply = () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    const response = await get(route, path, params);
    expect(response.status).toBe(502);
    expectNoStore(response);
  });

  it.each(ROUTES)(
    "$name passes the world's refusal on, uncached",
    async ({ route, path, params }) => {
      worldReplies(404, { code: "not-found", message: "No such chunk." });
      const response = await get(route, path, params);
      expect(response.status).toBe(404);
      expectNoStore(response);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.json()).toEqual({ code: "not-found", message: "No such chunk." });
    },
  );

  it.each(ROUTES)("$name hides a token the world refused", async ({ route, path, params }) => {
    worldReplies(401, { code: "forbidden", message: "Bad token." });
    const response = await get(route, path, params);
    expect(response.status).toBe(502);
    expectNoStore(response);
  });

  it.each(ROUTES)("$name relays the world's own cap", async ({ route, path, params }) => {
    worldReplies(429, { code: "busy", message: "Busy." }, { "retry-after": "1" });
    const response = await get(route, path, params);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    expectNoStore(response);
  });

  it.each(ROUTES)("$name refuses past the site's limit", async ({ route, path, params }) => {
    state.allowed = false;
    const response = await get(route, path, params);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expectNoStore(response);
    expect(await response.json()).toMatchObject({ code: "busy" });
    expect(calls).toHaveLength(0);
  });

  it.each(PUBLIC_ROUTES)("$name never reads the session", async ({ route, path, params }) => {
    worldReplies(200, { rev: REV });
    await get(route, path, params);
    expect(state.getSession).not.toHaveBeenCalled();
    expect(state.mapViewer).not.toHaveBeenCalled();
  });
});

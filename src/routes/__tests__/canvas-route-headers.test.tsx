import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { mergeHeaders } from "@tanstack/start-client-core";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/components/canvas/CanvasPage", () => ({ CanvasPage: () => null }));
vi.mock("@/components/canvas/canvas-queries", () => ({
  canvasQueryOptions: (canvasId: string) => ({ queryKey: ["canvas", canvasId] }),
}));

import { Route as CanvasRoute } from "../canvases.$canvasId";

/**
 * Drives the real `/canvases/$canvasId` loader/head/headers through a router
 * load, then merges the matches' headers the way Start's SSR handler builds
 * the document response, so the robots rule is pinned past the helper.
 */
async function render(canvas: Record<string, unknown> | null) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: "/canvases/$canvasId",
    loader: CanvasRoute.options.loader as never,
    head: CanvasRoute.options.head as never,
    headers: CanvasRoute.options.headers as never,
  });
  const queryClient = {
    ensureQueryData: async () => {
      if (!canvas) {
        const { ORPCError } = await import("@orpc/client");
        throw new ORPCError("NOT_FOUND");
      }
      return canvas;
    },
  };
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/canvases/c1"] }),
    context: { queryClient } as never,
    isServer: true,
  });
  await router.load();
  const headers = mergeHeaders(
    { "Content-Type": "text/html; charset=utf-8" },
    ...router.state.matches.map((m) => m.headers),
  );
  const meta = router.state.matches.flatMap((m) => m.meta ?? []);
  const robots = meta.find((m) => m && "name" in m && m.name === "robots")?.content;
  const ogImage = meta.find((m) => m && "property" in m && m.property === "og:image")?.content;
  return { headers, robots, ogImage, status: router.state.matches.at(-1)?.status };
}

const base = {
  id: "c1",
  title: "Level ideas",
  visibility: "public",
  hidden: false,
  deletedAt: null,
  nodeCount: 2,
};

describe("/canvases/$canvasId response headers", () => {
  it("public: indexable, no X-Robots-Tag, own card", async () => {
    const r = await render(base);
    expect(r.headers.get("x-robots-tag")).toBeNull();
    expect(r.robots).toBeUndefined();
    expect(r.ogImage).toMatch(/\/og\/canvas\/c1\.png/);
  });

  it("unlisted: card preview plus noindex in both meta and header", async () => {
    const r = await render({ ...base, visibility: "unlisted" });
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
    expect(r.robots).toMatch(/^noindex/);
    expect(r.ogImage).toMatch(/\/og\/canvas\/c1\.png/);
  });

  it.each([
    ["team", { visibility: "team" }],
    ["private", { visibility: "private" }],
    ["hidden public", { hidden: true }],
    ["deleted unlisted", { visibility: "unlisted", deletedAt: new Date().toISOString() }],
  ])("%s: noindex header, no card", async (_n, patch) => {
    const r = await render({ ...base, ...patch });
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
    expect(r.ogImage).toBeUndefined();
  });

  it("an unknown visibility string is treated as closed", async () => {
    const r = await render({ ...base, visibility: "PUBLIC" });
    expect(r.headers.get("x-robots-tag")).toBe("noindex");
    expect(r.ogImage).toBeUndefined();
  });

  it("a canvas the viewer can't read never leaks an indexable response", async () => {
    const r = await render(null);
    expect(r.ogImage).toBeUndefined();
    expect(r.headers.get("x-robots-tag") ?? "noindex").toBe("noindex");
  });
});

describe("/canvases/$canvasId when the read fails", () => {
  it("fails closed: an errored load still sends noindex", async () => {
    const root = createRootRoute();
    const route = createRoute({
      getParentRoute: () => root,
      path: "/canvases/$canvasId",
      loader: CanvasRoute.options.loader as never,
      head: CanvasRoute.options.head as never,
      headers: CanvasRoute.options.headers as never,
    });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ["/canvases/c1"] }),
      context: {
        queryClient: {
          ensureQueryData: async () => {
            throw new Error("db down");
          },
        },
      } as never,
      isServer: true,
    });
    await router.load();
    const headers = mergeHeaders(...router.state.matches.map((m) => m.headers));
    expect(headers.get("x-robots-tag")).toBe("noindex");
  });
});

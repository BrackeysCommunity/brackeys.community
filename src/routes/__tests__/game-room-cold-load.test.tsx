// @vitest-environment jsdom
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { hydrate } from "@tanstack/router-core/ssr/client";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/components/game/GameCanvas", () => ({
  GameCanvas: ({ roomId, edit }: { roomId: string; edit: boolean }) => (
    <p>{edit ? `editor ${roomId}` : `room ${roomId}`}</p>
  ),
}));
vi.mock("@/components/layout/PageSkeleton", () => ({ PageSkeleton: () => <p>pending</p> }));
vi.mock("@/components/layout/NotFoundPage", () => ({ NotFoundPage: () => <p>not found</p> }));
vi.mock("@/lib/motion-timing", () => ({ installMotionTiming: () => {} }));
vi.mock("@/lib/product-insights", () => ({ captureEvent: () => {}, initAnalytics: () => {} }));
vi.mock("@/lib/reload-on-chunk-error", () => ({ reloadOnChunkError: () => {} }));
vi.mock("@/lib/storage-handoff", () => ({ bootStorageHandoff: () => {} }));

// The site's real `/game` subtree under a bare root: the real root route
// mounts the whole shell, which this test doesn't need.
vi.mock("@/routeTree.gen", async () => {
  const { createRootRoute, Outlet } = await import("@tanstack/react-router");
  const { Route: game } = await import("../game");
  const { Route: lobby } = await import("../game/index");
  const { Route: room } = await import("../game/$roomId");
  const root = createRootRoute({ component: () => <Outlet /> });
  const gameRoute = game.update({
    id: "/game",
    path: "/game",
    getParentRoute: () => root,
  } as never);
  const children = [
    lobby.update({ id: "/", path: "/", getParentRoute: () => gameRoute } as never),
    room.update({ id: "/$roomId", path: "/$roomId", getParentRoute: () => gameRoute } as never),
  ];
  return { routeTree: root.addChildren([gameRoute.addChildren(children)]) };
});

import { makeQueryClient } from "@/integrations/tanstack-query/query-client";
import { routeTree } from "@/routeTree.gen";

import { getRouter } from "../../router";

type Tsr = {
  router: { matches: unknown[]; lastMatchId?: string; dehydratedData: unknown };
  buffer: unknown[];
};
const tsrWindow = window as unknown as { $_TSR?: Tsr };

/**
 * A browser's view transition runs its update callback asynchronously, after
 * the old state is captured; on a busy page that is well past the router's
 * pending hold. Recorded so a test can tell whether a commit used one.
 */
const transitions: number[] = [];
function slowViewTransitions(ms: number) {
  (document as unknown as { startViewTransition: unknown }).startViewTransition = (
    update: () => unknown,
  ) => {
    transitions.push(Date.now());
    const done = new Promise((r) => setTimeout(r, ms)).then(() => update());
    return { finished: done, ready: done, updateCallbackDone: done, skipTransition() {} };
  };
}

/** What the server streams for `url`: its matches, dehydrated as Start does. */
async function serverRender(url: string) {
  const server = createRouter({
    routeTree,
    context: { queryClient: makeQueryClient() },
    history: createMemoryHistory({ initialEntries: [url] }),
    isServer: true,
  });
  await server.load();
  const matches = server.state.matches.map((m) => ({
    i: m.id,
    u: m.updatedAt,
    s: m.status,
    ...(m.ssr === undefined ? {} : { ssr: m.ssr }),
  }));
  // No loader on this subtree prefetches a query, so the query stream is empty.
  const queryStream = new ReadableStream({ start: (c) => c.close() });
  tsrWindow.$_TSR = {
    router: { matches, lastMatchId: matches.at(-1)?.i, dehydratedData: { queryStream } },
    buffer: [],
  };
}

/** A hard load: the server's document, then the client hydrating it, as `StartClient` does. */
async function coldLoad(url: string) {
  await serverRender(url);
  window.history.replaceState(null, "", url);
  const router = getRouter();
  await hydrate(router);
  const { RouterProvider } = await import("@tanstack/react-router");
  const caught: unknown[] = [];
  const view = render(<RouterProvider router={router} />, {
    onCaughtError: (error: unknown) => caught.push(error),
  } as never);
  return { router, view, caught };
}

async function settle(ms: number) {
  for (let t = 0; t < ms; t += 50) {
    await act(() => new Promise((r) => setTimeout(r, 50)));
  }
}

beforeEach(() => {
  transitions.length = 0;
  slowViewTransitions(600);
});

afterEach(() => {
  cleanup();
  delete tsrWindow.$_TSR;
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
});

describe("/game/$roomId from a cold load", () => {
  it("renders the game room", async () => {
    const { view, caught } = await coldLoad("/game/test-room");
    await settle(1000);
    expect(caught).toEqual([]);
    expect(view.container.textContent).toBe("room test-room");
  });

  it("renders the editor", async () => {
    const { view, caught } = await coldLoad("/game/test-room?edit=1");
    await settle(1000);
    expect(caught).toEqual([]);
    expect(view.container.textContent).toBe("editor test-room");
  });

  it("still navigates in the site, with its view transition", async () => {
    const { router, view, caught } = await coldLoad("/game");
    await settle(200);
    expect(view.container.textContent).toContain("Enter Test Room");

    await act(() => router.navigate({ to: "/game/$roomId", params: { roomId: "test-room" } }));
    await settle(1000);
    expect(caught).toEqual([]);
    expect(view.container.textContent).toBe("room test-room");
    expect(transitions).toHaveLength(1);
  });
});

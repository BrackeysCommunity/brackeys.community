// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const loading = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => (release = resolve));
  return { ready, release };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/canvas/shell/SiteMenu", () => ({ SiteMenu: () => <nav>site menu</nav> }));
vi.mock("../editor-host", async () => {
  await loading.ready;
  return { SiteSceneEditor: () => <div>package editor</div> };
});

/** A game the room builds through a stand-in `createGame`, whose events the test fires. */
const played = vi.hoisted(() => ({
  handlers: new Map<string, Set<(payload: never) => void>>(),
  started: [] as string[],
  emit(event: string, payload: unknown) {
    for (const h of played.handlers.get(event) ?? []) h(payload as never);
  },
}));
vi.mock("@jams/engine", async (original) => {
  const real = await original<typeof import("@jams/engine")>();
  const { Store } = await import("@tanstack/store");
  return {
    ...real,
    createGame: async () => ({
      on: (event: string, handler: (payload: never) => void) => {
        played.started.push(`on ${event}`);
        let set = played.handlers.get(event);
        if (!set) played.handlers.set(event, (set = new Set()));
        set.add(handler);
      },
      off: (event: string, handler: (payload: never) => void) =>
        played.handlers.get(event)?.delete(handler),
      start: () => played.started.push("start"),
      destroy: () => {},
      resize: () => {},
      getStore: () => new Store({ phase: "running", fps: 60, debugMode: "off" }),
      input: { bindings: () => ({}) },
      flow: { restart: async () => ({ ok: true }) },
    }),
  };
});
vi.mock("../hosted-games", async (original) => {
  const real = await original<typeof import("../hosted-games")>();
  const modules = {
    game: { id: "mirror", actions: [] },
    registry: {},
    ui: null,
    flow: { list: () => [], scene: () => null },
    prefabs: {},
    project: { engine: {} },
    assets: null,
  };
  const game = {
    id: "mirror",
    name: "Mirror",
    load: async () => modules,
    debugLayers: async () => [],
  };
  return { ...real, hostedGame: (id: string) => (id === "mirror" ? game : real.hostedGame(id)) };
});

const { GameCanvas } = await import("../GameCanvas");
const { GameCanvasLoading } = await import("../game-canvas-loading");

afterEach(() => {
  cleanup();
  loading.release();
});

const panelSkeletons = (root: HTMLElement) =>
  root.querySelectorAll(".je-panel-group .je-skeleton").length;

describe("GameCanvas while the editor loads", () => {
  it("says it is loading at once, then draws the skeleton frame, then the editor", async () => {
    const { container } = render(<GameCanvas roomId="lobby-1" edit />);
    expect(container.querySelector(".je-frame")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Loading the editor");
    expect(screen.getByRole("heading", { name: "lobby-1" })).toBeTruthy();

    await waitFor(() => expect(panelSkeletons(container)).toBeGreaterThan(0), { timeout: 10_000 });
    expect(screen.getByRole("heading", { name: "lobby-1" })).toBeTruthy();
    expect(screen.getByText("site menu")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Loading the editor");
    expect(screen.queryByText("package editor")).toBeNull();

    loading.release();
    expect(await screen.findByText("package editor")).toBeTruthy();
    expect(screen.queryByText("Loading the editor")).toBeNull();
    expect(container.querySelector(".je-frame")).toBeNull();
  }, 20_000);

  it("keeps editor code out of the play route's chunk", () => {
    const read = (file: string) => readFileSync(join(import.meta.dirname, "..", file), "utf8");
    for (const file of ["GameCanvas.tsx", "editor-loading.tsx"]) {
      const source = read(file);
      expect(source).not.toMatch(/^\s*import[^;]*from\s+["']@jams\/engine\/editor-ui[^"']*["']/m);
      expect(source).not.toMatch(/^\s*import\s+["']@jams\/engine\/editor-ui[^"']*["']/m);
    }
    expect(read("editor-loading.tsx")).toMatch(/import\(\s*["']@jams\/engine\/editor-ui["']\s*\)/);
  });

  it("keeps the route's pending view out of every page's preload", () => {
    const source = readFileSync(join(import.meta.dirname, "../game-canvas-loading.tsx"), "utf8");
    const staticImports = [...source.matchAll(/^\s*import[^;]*?from\s+["']([^"']+)["']/gm)].map(
      (m) => m[1],
    );
    expect(staticImports).toEqual(["react"]);
  });
});

describe("GameCanvas playing", () => {
  it("mirrors the renderer's state on the root element from before start, and clears it on unmount", async () => {
    const { unmount } = render(<GameCanvas roomId="lobby-1" gameId="mirror" />);
    await waitFor(() => expect(played.started).toContain("start"));
    const listening = played.started.indexOf("on render:fallback");
    expect(listening).toBeGreaterThanOrEqual(0);
    expect(listening).toBeLessThan(played.started.indexOf("start"));

    const { dataset } = document.documentElement;
    played.emit("render:fallback", { from: "webgpu", reason: "init" });
    expect(dataset.jamsRenderFallback).toBe("init");
    played.emit("render:lost", { backend: "webgl" });
    expect(dataset.jamsRender).toBe("lost");
    played.emit("render:restored", { backend: "webgl", rebuilt: true });
    expect(dataset.jamsRender).toBe("rebuilt");
    played.emit("render:lost", { backend: "webgl" });
    played.emit("render:restored", { backend: "webgl", rebuilt: false });
    expect(dataset.jamsRender).toBe("restored");

    unmount();
    expect(dataset.jamsRender).toBeUndefined();
    expect(dataset.jamsRenderFallback).toBeUndefined();
    expect([...played.handlers.values()].every((set) => set.size === 0)).toBe(true);
  }, 20_000);
});

describe("GameCanvasLoading", () => {
  it("draws the bare canvas outside the editor", () => {
    const { container } = render(<GameCanvasLoading roomId="lobby-1" />);
    expect(container.querySelector("[role=status]")).toBeNull();
    expect(container.firstElementChild?.className).toContain("bg-[#1a1a2e]");
  });

  it("says it is loading at once with edit, then draws the editor's loading frame", async () => {
    render(<GameCanvasLoading roomId="lobby-1" edit />);
    expect(screen.getByRole("status").textContent).toContain("Loading the editor");
    expect(await screen.findByRole("heading", { name: "lobby-1" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Loading the editor");
  });
});

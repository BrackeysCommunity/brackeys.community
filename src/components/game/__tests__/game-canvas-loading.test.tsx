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

const { GameCanvas } = await import("../GameCanvas");

afterEach(() => {
  cleanup();
  loading.release();
});

const panelSkeletons = (root: HTMLElement) =>
  root.querySelectorAll(".je-panel-group .je-skeleton").length;

describe("GameCanvas while the editor loads", () => {
  it("draws the editor's skeleton frame in the room's chrome, then the editor", async () => {
    const { container } = render(<GameCanvas roomId="lobby-1" edit />);
    expect(container.querySelector(".je-frame")).toBeNull();
    expect(container.firstElementChild?.className).toContain("bg-[#1a1a2e]");

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
    const source = readFileSync(join(import.meta.dirname, "../GameCanvas.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*import[^;]*from\s+["']@jams\/engine\/editor-ui[^"']*["']/m);
    expect(source).not.toMatch(/^\s*import\s+["']@jams\/engine\/editor-ui[^"']*["']/m);
    expect(source).toMatch(/import\(\s*["']@jams\/engine\/editor-ui["']\s*\)/);
  });
});

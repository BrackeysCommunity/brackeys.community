// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

describe("GameCanvas while the editor loads", () => {
  it("keeps the room's chrome and says the editor is loading", async () => {
    render(<GameCanvas roomId="lobby-1" edit />);
    expect(screen.getByRole("heading", { name: "lobby-1" })).toBeTruthy();
    expect(screen.getByText("site menu")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading the editor");
    expect(screen.queryByText("package editor")).toBeNull();
    loading.release();
    expect(await screen.findByText("package editor")).toBeTruthy();
    expect(screen.queryByText("Loading the editor")).toBeNull();
  });
});

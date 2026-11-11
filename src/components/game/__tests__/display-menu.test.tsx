// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fakes = vi.hoisted(() => ({
  createGame: vi.fn(),
  flags: { "game-display-menu": false } as Record<string, boolean>,
}));

vi.mock("@jams/engine", async (original) => ({
  ...(await original<typeof import("@jams/engine")>()),
  createGame: fakes.createGame,
}));
vi.mock("@/lib/hooks/use-flag", () => ({
  useFlag: (flag: string) => fakes.flags[flag] ?? false,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/canvas/shell/SiteMenu", () => ({ SiteMenu: () => <nav>site menu</nav> }));
vi.mock("../editor-host", () => ({ SiteSceneEditor: () => <div>package editor</div> }));

const { GameCanvas } = await import("../GameCanvas");

function fakeGame() {
  return {
    start: vi.fn(),
    destroy: vi.fn(),
    resize: vi.fn(),
    getStore: () => new Store({ phase: "running", fps: 60, debugMode: "off" }),
    input: { bindings: () => ({}) },
  };
}

function configAt(call: number) {
  const args = fakes.createGame.mock.calls[call] as [HTMLCanvasElement, Record<string, unknown>];
  return args[1];
}

function openMenu() {
  if (!screen.queryByRole("menu")) fireEvent.click(screen.getByRole("button", { name: "Display" }));
}

function pick(name: string) {
  openMenu();
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // No storage in this environment: the menu starts at Native either way.
  }
  fakes.createGame.mockImplementation(async () => fakeGame());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fakes.flags["game-display-menu"] = false;
});

describe("the game room's display menu", () => {
  it("renders no menu and passes no resolution with the flag off", async () => {
    render(<GameCanvas roomId="lobby-1" />);
    await waitFor(() => expect(fakes.createGame).toHaveBeenCalledOnce());
    expect(configAt(0)).not.toHaveProperty("resolution");
    expect(screen.queryByRole("button", { name: "Display" })).toBeNull();
  });

  it("starts at Native, passing no resolution", async () => {
    fakes.flags["game-display-menu"] = true;
    render(<GameCanvas roomId="lobby-1" />);
    await waitFor(() => expect(fakes.createGame).toHaveBeenCalledOnce());
    expect(configAt(0)).not.toHaveProperty("resolution");
    expect(screen.getByRole("button", { name: "Display" }).textContent).toContain("Native");
  });

  it("rebuilds the game with the chosen fit and virtual size", async () => {
    fakes.flags["game-display-menu"] = true;
    render(<GameCanvas roomId="lobby-1" />);
    await waitFor(() => expect(fakes.createGame).toHaveBeenCalledOnce());
    const first = (await fakes.createGame.mock.results[0]!.value) as ReturnType<typeof fakeGame>;

    pick("Letterbox");
    await waitFor(() => expect(fakes.createGame).toHaveBeenCalledTimes(2));
    expect(first.destroy).toHaveBeenCalled();
    expect(configAt(1).resolution).toEqual({
      virtual: { width: 1920, height: 1080 },
      fit: "letterbox",
    });

    pick("320×180");
    await waitFor(() => expect(fakes.createGame).toHaveBeenCalledTimes(3));
    expect(configAt(2).resolution).toEqual({
      virtual: { width: 320, height: 180 },
      fit: "letterbox",
    });

    openMenu();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Whole-pixel scaling" }));
    await waitFor(() => expect(fakes.createGame).toHaveBeenCalledTimes(4));
    expect(configAt(3).resolution).toEqual({
      virtual: { width: 320, height: 180 },
      fit: "letterbox",
      integer: true,
    });

    pick("Native");
    await waitFor(() => expect(fakes.createGame).toHaveBeenCalledTimes(5));
    expect(configAt(4)).not.toHaveProperty("resolution");
  });

  it("restores the viewer's last choice", async () => {
    fakes.flags["game-display-menu"] = true;
    localStorage.setItem(
      "game-display",
      JSON.stringify({ fit: "crop", size: { width: 640, height: 360 }, integer: false }),
    );
    render(<GameCanvas roomId="lobby-1" />);
    await waitFor(() => expect(fakes.createGame).toHaveBeenCalledOnce());
    expect(configAt(0).resolution).toEqual({ virtual: { width: 640, height: 360 }, fit: "crop" });
    expect(screen.getByRole("button", { name: "Display" }).textContent).toContain("640×360");
  });
});

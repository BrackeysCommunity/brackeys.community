// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { BUNDLED_PREFABS, BUNDLED_SCENE, SCENE_REGISTRY } from "../platformer-scene";

const fakes = vi.hoisted(() => ({
  createGame: vi.fn(),
  navigate: vi.fn(async () => {}),
  editor: vi.fn(),
}));

vi.mock("@jams/engine", async (original) => ({
  ...(await original<typeof import("@jams/engine")>()),
  createGame: fakes.createGame,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => fakes.navigate,
}));
vi.mock("@/components/canvas/shell/SiteMenu", () => ({ SiteMenu: () => <nav>site menu</nav> }));
vi.mock("../editor-host", () => ({
  SiteSceneEditor: (props: { roomId: string; scene?: string }) => {
    fakes.editor(props);
    return <div>package editor</div>;
  },
}));

const { GameCanvas } = await import("../GameCanvas");

function fakeGame() {
  return {
    start: vi.fn(),
    destroy: vi.fn(),
    resize: vi.fn(),
    getStore: () => new Store({ phase: "running", fps: 60, debugMode: "off" }),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GameCanvas", () => {
  it("plays the bundled scene with its prefabs, without the editor", async () => {
    const game = fakeGame();
    fakes.createGame.mockResolvedValue(game);
    render(<GameCanvas roomId="lobby-1" />);
    await waitFor(() => expect(game.start).toHaveBeenCalledOnce());
    const [, options] = fakes.createGame.mock.calls[0] as [
      HTMLCanvasElement,
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({
      registry: SCENE_REGISTRY,
      scene: BUNDLED_SCENE,
      prefabs: BUNDLED_PREFABS,
    });
    expect(options).not.toHaveProperty("assets");
    expect(screen.getByRole("heading", { name: "lobby-1" })).toBeTruthy();
    expect(await screen.findByText("60 FPS")).toBeTruthy();
    expect(fakes.editor).not.toHaveBeenCalled();
  });

  it("renders the package's editor with ?edit=1 and builds no game of its own", async () => {
    render(<GameCanvas roomId="lobby-1" edit scene="kitchen" />);
    expect(await screen.findByText("package editor")).toBeTruthy();
    expect(fakes.createGame).not.toHaveBeenCalled();
    expect(fakes.editor).toHaveBeenLastCalledWith(
      expect.objectContaining({ roomId: "lobby-1", scene: "kitchen" }),
    );
  });

  it("leaves following the opened scene in ?scene= to the editor's own default", async () => {
    render(<GameCanvas roomId="lobby-1" edit />);
    await screen.findByText("package editor");
    expect(fakes.editor.mock.lastCall![0]).not.toHaveProperty("onSceneChange");
  });
});

// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const fakes = vi.hoisted(() => ({
  createGame: vi.fn(),
  mountUi: vi.fn(() => () => {}),
  navigate: vi.fn(async () => {}),
  editor: vi.fn(),
}));

vi.mock("@jams/engine", async (original) => ({
  ...(await original<typeof import("@jams/engine")>()),
  createGame: fakes.createGame,
  mountUi: fakes.mountUi,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => fakes.navigate,
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/components/canvas/shell/SiteMenu", () => ({ SiteMenu: () => <nav>site menu</nav> }));
vi.mock("@/components/layout/NotFoundPage", () => ({
  NotFoundPage: ({ subject }: { subject?: string }) => <p>not found: {subject}</p>,
}));
vi.mock("../editor-host", () => ({
  SiteSceneEditor: (props: { roomId: string; project?: string; scene?: string }) => {
    fakes.editor(props);
    return <div>package editor</div>;
  },
}));

const { GameCanvas } = await import("../GameCanvas");
const { hostedGame } = await import("../hosted-games");
const { Route } = (await import("@/routes/game/$roomId")) as unknown as {
  Route: { options: { validateSearch: (search: Record<string, unknown>) => { game?: string } } };
};

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
  it("plays the platformer's first scene with its prefabs, without the editor", async () => {
    const game = fakeGame();
    fakes.createGame.mockResolvedValue(game);
    const platformer = await hostedGame("platformer")!.load();
    render(<GameCanvas roomId="lobby-1" />);
    await waitFor(() => expect(game.start).toHaveBeenCalledOnce());
    const [, options] = fakes.createGame.mock.calls[0] as [
      HTMLCanvasElement,
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({
      game: platformer.game,
      registry: platformer.registry,
      scene: platformer.scene,
      prefabs: platformer.prefabs,
    });
    expect(platformer.scene.name).toBe("test-yard");
    expect(options.rapier).toBeTypeOf("function");
    expect(options).not.toHaveProperty("assets");
    expect(fakes.mountUi).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "lobby-1" })).toBeTruthy();
    expect(await screen.findByText("60 FPS")).toBeTruthy();
    expect(fakes.editor).not.toHaveBeenCalled();
  });

  it("shows the house skeleton while the hosted game's modules load", async () => {
    const game = fakeGame();
    fakes.createGame.mockResolvedValue(game);
    render(<GameCanvas roomId="lobby-1" gameId="platformer" />);
    const pending = screen.getByRole("status", { name: "Loading Platformer" });
    expect(pending.querySelector("[data-slot=skeleton]")).toBeTruthy();
    await waitFor(() => expect(game.start).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status", { name: "Loading Platformer" })).toBeNull();
  });

  it("gives the hosted game its project: tactics' unit classes, settings and input map", async () => {
    const game = fakeGame();
    fakes.createGame.mockResolvedValue(game);
    const tactics = await hostedGame("tactics")!.load();
    render(<GameCanvas roomId="lobby-1" gameId="tactics" />);
    await waitFor(() => expect(game.start).toHaveBeenCalledOnce());
    const [, options] = fakes.createGame.mock.calls[0] as [
      HTMLCanvasElement,
      { project: typeof tactics.project; rapier?: unknown },
    ];
    expect(options.project).toBe(tactics.project);
    expect(options.project.table("unit-class").map((r) => r.id)).toContain("knight");
    expect(options.project.settings).toMatchObject({ aiStepTicks: 20 });
    expect(options.project.inputMap?.deadzone).toBe(0.3);
    expect(options).not.toHaveProperty("rapier");
  });

  it("says the hosted game failed to load in place of the skeleton, and retries", async () => {
    const game = fakeGame();
    fakes.createGame.mockResolvedValue(game);
    const platformer = hostedGame("platformer")!;
    const load = vi.spyOn(platformer, "load").mockRejectedValueOnce(new Error("chunk gone"));
    try {
      render(<GameCanvas roomId="lobby-1" />);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Platformer couldn't load");
      expect(alert.textContent).toContain("chunk gone");
      expect(screen.queryByRole("status", { name: "Loading Platformer" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(game.start).toHaveBeenCalledOnce());
      expect(screen.queryByRole("alert")).toBeNull();
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      load.mockRestore();
    }
  });

  it("keeps a ?game= the project-id pattern refuses, so it renders the not-found page", () => {
    const { validateSearch } = Route.options;
    for (const raw of ["Tactics", "no_such", "", 123]) {
      const { game } = validateSearch({ game: raw });
      expect(game).toBe(String(raw));
      render(<GameCanvas roomId="lobby-1" gameId={game} />);
      expect(screen.getByText("not found: Game")).toBeTruthy();
      cleanup();
    }
    expect(validateSearch({})).not.toHaveProperty("game");
    expect(fakes.createGame).not.toHaveBeenCalled();
  });

  it("opens the editor on the hosted game ?game= names when ?project= is absent", async () => {
    render(<GameCanvas roomId="lobby-1" gameId="tactics" edit />);
    await screen.findByText("package editor");
    expect(fakes.editor.mock.lastCall![0]).toMatchObject({ project: "tactics" });
    cleanup();
    render(<GameCanvas roomId="lobby-1" gameId="tactics" edit project="engine" />);
    await screen.findByText("package editor");
    expect(fakes.editor.mock.lastCall![0]).toMatchObject({ project: "engine" });
    cleanup();
    render(<GameCanvas roomId="lobby-1" gameId="no-such-game" edit />);
    await screen.findByText("package editor");
    expect(fakes.editor.mock.lastCall![0].project).toBeUndefined();
  });

  it("renders the not-found page for a game the site doesn't host", () => {
    render(<GameCanvas roomId="lobby-1" gameId="no-such-game" />);
    expect(screen.getByText("not found: Game")).toBeTruthy();
    expect(fakes.createGame).not.toHaveBeenCalled();
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

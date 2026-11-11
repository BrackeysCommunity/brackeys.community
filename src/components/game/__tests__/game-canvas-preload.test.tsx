import type { SceneSource } from "@jams/engine";
import type { Binding } from "@jams/engine/game";
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

const { resolveBindings } = await import("@jams/engine");
const { flowIssue } = await import("@jams/engine/game");
const { GameCanvas } = await import("../GameCanvas");
const { hostedGame } = await import("../hosted-games");
const { Route } = (await import("@/routes/game/$roomId")) as unknown as {
  Route: { options: { validateSearch: (search: Record<string, unknown>) => { game?: string } } };
};

type FlowOptions = { flow: { source: SceneSource } };

/**
 * A game whose `flow.restart` judges the start of the source `createGame` was
 * given, as the engine's does, and loads nothing.
 */
function fakeGame(
  state: { phase: string; fps: number } = { phase: "running", fps: 60 },
  bindings: Record<string, readonly Binding[]> = {},
) {
  let source: SceneSource | null = null;
  return {
    start: vi.fn(),
    destroy: vi.fn(),
    resize: vi.fn(),
    getStore: () => new Store({ ...state, debugMode: "off" }),
    input: { bindings: () => bindings },
    flow: {
      restart: vi.fn(async () => {
        const start = source?.start() ?? null;
        const issue = flowIssue(source?.list() ?? [], start, "start");
        return issue ? { ok: false, issue } : { ok: true, scene: start };
      }),
    },
    given(options: FlowOptions) {
      source = options.flow.source;
    },
  };
}

/** `createGame` resolving `game`, with the flow source it was given. */
function creates(game: ReturnType<typeof fakeGame>) {
  fakes.createGame.mockImplementation(async (_canvas: unknown, options: FlowOptions) => {
    game.given(options);
    return game;
  });
}

const options = (call: number) =>
  (fakes.createGame.mock.calls[call] as [HTMLCanvasElement, Record<string, unknown>])[1];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GameCanvas", () => {
  it("plays the platformer's scene list from its start, with its prefabs, without the editor", async () => {
    const game = fakeGame();
    creates(game);
    const platformer = await hostedGame("platformer")!.load();
    render(<GameCanvas roomId="lobby-1" scene="elsewhere" />);
    await waitFor(() => expect(game.flow.restart).toHaveBeenCalledOnce());
    expect(game.start).toHaveBeenCalledOnce();
    expect(game.start.mock.invocationCallOrder[0]).toBeLessThan(
      game.flow.restart.mock.invocationCallOrder[0]!,
    );
    const [, options] = fakes.createGame.mock.calls[0] as [
      HTMLCanvasElement,
      Record<string, unknown>,
    ];
    expect(options).toMatchObject({
      game: platformer.game,
      registry: platformer.registry,
      flow: { source: platformer.flow },
      prefabs: platformer.prefabs,
    });
    expect(options).not.toHaveProperty("scene");
    expect(platformer.flow.start()).toBe("test-yard");
    expect(await game.flow.restart.mock.results[0]!.value).toMatchObject({
      ok: true,
      scene: "test-yard",
    });
    expect(options.rapier).toBeTypeOf("function");
    expect(options).not.toHaveProperty("assets");
    expect(fakes.mountUi).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "lobby-1" })).toBeTruthy();
    expect(await screen.findByText("60 FPS")).toBeTruthy();
    expect(fakes.editor).not.toHaveBeenCalled();
  });

  it("says on the page that a project without a scene list has no start scene", async () => {
    const game = fakeGame();
    creates(game);
    const platformer = hostedGame("platformer")!;
    const modules = await platformer.load();
    const unlisted: SceneSource = { list: () => [], start: () => null, scene: () => null };
    const load = vi.spyOn(platformer, "load").mockResolvedValue({ ...modules, flow: unlisted });
    try {
      render(<GameCanvas roomId="lobby-1" />);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("Platformer couldn't start");
      expect(alert.textContent).toContain("start-scene-missing");
      expect(options(0)).not.toHaveProperty("rapier");
    } finally {
      load.mockRestore();
    }
  });

  it("shows the platformer's controls from the game's own bindings", async () => {
    const platformer = await hostedGame("platformer")!.load();
    const game = fakeGame(undefined, {
      ...resolveBindings({ game: platformer.game.actions }).bindings(),
      jump: [{ device: "key", code: "KeyJ" }],
    });
    creates(game);
    render(<GameCanvas roomId="lobby-1" />);
    const controls = await screen.findByRole("list", { name: "Controls" });
    const rows = [...controls.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows).toEqual([
      "←AMove left",
      "→DMove right",
      "JJump",
      "↓SMove down",
      "ShiftDash",
      "EGrapple",
    ]);
  });

  it("shows the house skeleton while the hosted game's modules load", async () => {
    const game = fakeGame();
    creates(game);
    render(<GameCanvas roomId="lobby-1" gameId="platformer" />);
    const pending = screen.getByRole("status", { name: "Loading Platformer" });
    expect(pending.querySelector("[data-slot=skeleton]")).toBeTruthy();
    await waitFor(() => expect(game.start).toHaveBeenCalledOnce());
    expect(screen.queryByRole("status", { name: "Loading Platformer" })).toBeNull();
  });

  it("gives the hosted game its project: tactics' unit classes, settings and input map", async () => {
    const game = fakeGame();
    creates(game);
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

  it("gives tactics a loader over its art, the view it draws from and its kinds", async () => {
    const game = fakeGame();
    creates(game);
    const tactics = await hostedGame("tactics")!.load();
    const { unmount } = render(<GameCanvas roomId="lobby-1" gameId="tactics" />);
    await waitFor(() => expect(game.start).toHaveBeenCalledOnce());
    const [, options] = fakes.createGame.mock.calls[0] as [
      HTMLCanvasElement,
      { assets: { loader: { load: unknown; destroy: unknown }; view: unknown; kinds: unknown } },
    ];
    expect(options.assets.view).toBe(tactics.assets!.view);
    expect(options.assets.kinds).toBe(tactics.assets!.kinds);
    expect(options.assets.loader.load).toBeTypeOf("function");
    unmount();
    expect(game.destroy).toHaveBeenCalledOnce();
  });

  it("shows a turns game's phase but no frame rate, and no game's controls", async () => {
    const game = fakeGame();
    creates(game);
    render(<GameCanvas roomId="lobby-1" gameId="tactics" />);
    await waitFor(() => expect(game.start).toHaveBeenCalledOnce());
    const status = await screen.findByRole("status");
    expect(status.textContent).not.toMatch(/FPS/);
    expect(status.textContent).not.toMatch(/WASD|jump/i);
    expect(screen.queryByRole("list", { name: "Controls" })).toBeNull();
    expect(status.textContent).toContain("F3 debug overlay");
    cleanup();
    const paused = fakeGame({ phase: "paused", fps: 0 });
    creates(paused);
    render(<GameCanvas roomId="lobby-1" gameId="tactics" />);
    expect(await screen.findByText("paused")).toBeTruthy();
  });

  it("says the game couldn't start in place of the canvas, and starts it again on retry", async () => {
    const game = fakeGame();
    creates(game);
    fakes.createGame.mockRejectedValueOnce(new Error("no WebGL"));
    render(<GameCanvas roomId="lobby-1" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Platformer couldn't start");
    expect(alert.textContent).toContain("no WebGL");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(game.start).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fakes.createGame).toHaveBeenCalledTimes(2);
  });

  it("says the hosted game failed to load in place of the skeleton, and retries", async () => {
    const game = fakeGame();
    creates(game);
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
    render(<GameCanvas roomId="lobby-1" gameId="no-such-game" edit project="engine" />);
    await screen.findByText("package editor");
    expect(fakes.editor.mock.lastCall![0]).toMatchObject({ project: "engine" });
  });

  it("renders the not-found page for ?edit=1 on a game the site doesn't host", () => {
    render(<GameCanvas roomId="lobby-1" gameId="no-such-game" edit />);
    expect(screen.getByText("not found: Game")).toBeTruthy();
    expect(fakes.editor).not.toHaveBeenCalled();
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

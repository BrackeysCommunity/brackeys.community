// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectSession,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  type ProjectSession,
} from "../../collab/index";
import { defineGame } from "../../game/index";
import type { GameInstance } from "../../index";
import { createKindRegistry, type AssetEntry } from "../../project/index";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/index";
import type { EditorHost, ProjectConnection, ProjectConnectionState } from "../host";
import { mountSceneEditor, SceneEditor, type SceneEditorHandle } from "../index";

// jsdom has no WebGL, so the Pixi application is a stand-in; the containers are real.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return {
    ...pixi,
    Application,
    Assets: { load: async () => pixi.Texture.WHITE, unload: async () => {} },
  };
});

const games = vi.hoisted(() => ({
  made: [] as { destroyed: boolean; game: unknown }[],
  /** What each game's `preload` reports as failed. */
  failed: [] as { id: string }[],
  /** While set, games being built wait for it. */
  hold: null as Promise<void> | null,
}));

// Records every game the editor builds and whether it was destroyed.
vi.mock("../../index", async (importOriginal) => {
  const engine = await importOriginal<typeof import("../../index")>();
  return {
    ...engine,
    createGame: async (...args: Parameters<typeof engine.createGame>) => {
      await games.hold;
      const game: GameInstance = await engine.createGame(...args);
      const made = { destroyed: false, game: game as unknown };
      games.made.push(made);
      const preload = game.preload;
      game.preload = vi.fn(async (...a: Parameters<typeof preload>) => {
        const result = await preload(...a);
        return { failed: [...result.failed, ...(games.failed as typeof result.failed)] };
      });
      game.resize = vi.fn(game.resize);
      const destroy = game.destroy;
      game.destroy = () => {
        made.destroyed = true;
        destroy();
      };
      return game;
    },
  };
});

const yardGame = defineGame({
  id: "scene-editor",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const kinds = createKindRegistry(yardGame);

const yard: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "yard",
  bounds: [0, 0, 2000, 1200],
  entities: [
    { id: "zone", type: "sensor", shape: ["circle", 900, 600, 12], tags: ["goal"] },
    { id: "pad", type: "marker", at: [1000, 1010] },
  ],
} as SceneDefinition;

const yardEntry: AssetEntry = {
  key: "yard",
  id: "yard",
  kind: "scene",
  path: "scenes/yard.json",
  created: { at: 0, by: "seed" },
};

/** A project in memory and a host whose `connect` opens it, as the dev server's would. */
function fakeProject() {
  const server = memoryDocHost();
  seedProjectDoc(
    server.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: { yard: yardEntry },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  sceneToDoc(yard, { doc: server.doc("scene:p.yard"), key: sequentialKeys("yard") });

  const connections: { destroy: ReturnType<typeof vi.fn>; session: ProjectSession | null }[] = [];
  const connect = vi.fn<EditorHost["connect"]>(({ project, registry, origin }) => {
    let state: ProjectConnectionState = {
      status: "connecting",
      session: null,
      access: "write",
      stopped: {},
      error: null,
      unsynced: 0,
    };
    const listeners = new Set<() => void>();
    const record = {
      session: null as ProjectSession | null,
      destroy: vi.fn(() => record.session?.destroy()),
    };
    connections.push(record);
    void createProjectSession({
      project,
      openDoc: server.client().openDoc,
      origin,
      registry,
      kinds,
    }).then((session) => {
      record.session = session;
      state = { ...state, status: "live", session };
      for (const l of listeners) l();
    });
    const connection: ProjectConnection = {
      getState: () => state,
      subscribe(l) {
        listeners.add(l);
        return () => void listeners.delete(l);
      },
      onAssetChanged: () => () => {},
      destroy: record.destroy,
    };
    return connection;
  });
  const host: EditorHost = {
    assetUrl: (project, entry) => `/blobs/${project}/${entry.sha256}`,
    storage: null,
    connect,
  };
  return { host, connect, connections };
}

const rapier = () => import("@dimforge/rapier2d");

const outliner = () => within(screen.getByRole("navigation", { name: "Outliner" }));

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  games.made.length = 0;
  games.failed = [];
  games.hold = null;
  vi.unstubAllGlobals();
});

describe("SceneEditor", () => {
  it("opens the project's scene, lists it in the outliner and fills the inspector", async () => {
    const { host, connect, connections } = fakeProject();
    const ready = vi.fn<(handle: SceneEditorHandle) => void>();
    const view = render(
      <SceneEditor
        host={host}
        game={yardGame}
        project="p"
        scene="yard"
        rapier={rapier}
        onReady={ready}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/scene server|Opening the editor/);

    const row = await waitFor(() => outliner().getByRole("button", { name: /zone/ }), {
      timeout: 10_000,
    });
    expect(outliner().getByRole("button", { name: /pad/ })).toBeTruthy();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect.mock.lastCall![0]).toMatchObject({ project: "p" });
    expect(ready).toHaveBeenCalledTimes(1);

    fireEvent.click(row);
    expect(screen.getByRole("region", { name: "Identity" })).toBeTruthy();
    expect((screen.getByLabelText("shape.r") as HTMLInputElement).value).toBe("12");

    expect(games.made.some((g) => !g.destroyed)).toBe(true);
    const session = connections[0]!.session!;
    const destroySession = vi.spyOn(session, "destroy");
    view.unmount();
    expect(connections.every((c) => c.destroy.mock.calls.length === 1)).toBe(true);
    expect(destroySession).toHaveBeenCalled();
    expect(games.made.every((g) => g.destroyed)).toBe(true);
  }, 20_000);

  it("boots with every panel's tab over an empty scene, no counts and skeleton bodies", () => {
    const pending: ProjectConnection = {
      getState: () => ({
        status: "connecting",
        session: null,
        access: "write",
        stopped: {},
        error: null,
        unsynced: 0,
      }),
      subscribe: () => () => {},
      onAssetChanged: () => () => {},
      destroy: () => {},
    };
    const host: EditorHost = { assetUrl: () => "", storage: null, connect: () => pending };
    const view = render(
      <SceneEditor host={host} game={yardGame} project="p" scene="yard" rapier={rapier} />,
    );
    const problems = screen.getByRole("tab", { name: /Problems/ });
    expect(problems.textContent).toBe("Problems");
    for (const tab of screen.getAllByRole("tab")) fireEvent.click(tab);
    expect(view.container.querySelectorAll(".je-panel-group .je-skeleton").length).toBeGreaterThan(
      0,
    );
    expect(() => view.unmount()).not.toThrow();
  });

  it("reveals a panel through the ready handle", async () => {
    const { host } = fakeProject();
    let handle: SceneEditorHandle | null = null;
    render(
      <SceneEditor
        host={host}
        game={yardGame}
        project="p"
        rapier={rapier}
        onReady={(h) => (handle = h)}
      />,
    );
    await waitFor(() => expect(handle).not.toBeNull(), { timeout: 10_000 });
    act(() => handle!.openPanel("history"));
    expect(screen.getByRole("tab", { name: /History/, selected: true })).toBeDefined();
    const history = screen.getByRole("region", { name: "History" });
    expect(history.closest(".je-panel-group")?.contains(document.activeElement)).toBe(true);
    expect(() => handle!.resetLayout()).not.toThrow();
  }, 20_000);

  it("hands out its current game through the ready handle: null while it builds and after unmount", async () => {
    const { host } = fakeProject();
    let handle: SceneEditorHandle | null = null;
    const props = {
      host,
      project: "p",
      scene: "yard",
      rapier,
      onReady: (h: SceneEditorHandle) => (handle = h),
    };
    const view = render(<SceneEditor game={yardGame} {...props} />);
    await waitFor(() => expect(handle).not.toBeNull(), { timeout: 10_000 });
    const first = games.made.at(-1)!;
    expect(handle!.game()).toBe(first.game);

    let release!: () => void;
    games.hold = new Promise((resolve) => (release = resolve));
    const regame = defineGame({ ...yardGame });
    view.rerender(<SceneEditor game={regame} {...props} />);
    expect(first.destroyed).toBe(true);
    expect(handle!.game()).toBeNull();

    games.hold = null;
    release();
    await waitFor(() => expect(games.made).toHaveLength(2), { timeout: 10_000 });
    const second = games.made.at(-1)!;
    await waitFor(() => expect(handle!.game()).toBe(second.game));

    view.unmount();
    expect(second.destroyed).toBe(true);
    expect(handle!.game()).toBeNull();
  }, 20_000);

  it("names the scene it opened when the one asked for isn't in the project", async () => {
    const { host } = fakeProject();
    const onSceneChange = vi.fn();
    render(
      <SceneEditor
        host={{ ...host, onSceneChange }}
        game={yardGame}
        project="p"
        scene="nowhere"
        rapier={rapier}
      />,
    );
    await waitFor(() => expect(onSceneChange).toHaveBeenCalledWith("yard"), { timeout: 10_000 });
  }, 20_000);

  it("keeps the scene doc open when the host's route follows the fallback", async () => {
    const { host, connections } = fakeProject();
    const onSceneChange = vi.fn();
    const props = { host: { ...host, onSceneChange }, game: yardGame, project: "p", rapier };
    const view = render(<SceneEditor {...props} scene="nowhere" />);
    await waitFor(() => outliner().getByRole("button", { name: /pad/ }), { timeout: 10_000 });
    expect(onSceneChange).toHaveBeenCalledWith("yard");
    const session = connections[0]!.session!;
    const release = vi.spyOn(session, "release");
    const open = vi.spyOn(session, "open");
    const built = games.made.length;

    view.rerender(<SceneEditor {...props} scene="yard" />);
    await act(async () => {});
    const sceneDocs = (calls: [string][]) => calls.filter(([name]) => name.startsWith("scene:"));
    expect(sceneDocs(release.mock.calls)).toEqual([]);
    expect(sceneDocs(open.mock.calls)).toEqual([]);
    expect(games.made.length).toBe(built);
    expect(outliner().getByRole("button", { name: /pad/ })).toBeTruthy();
    expect(onSceneChange).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("tells a host that named no scene nothing about the one it opened", async () => {
    const { host } = fakeProject();
    const onSceneChange = vi.fn();
    render(
      <SceneEditor host={{ ...host, onSceneChange }} game={yardGame} project="p" rapier={rapier} />,
    );
    await waitFor(() => outliner().getByRole("button", { name: /pad/ }), { timeout: 10_000 });
    expect(onSceneChange).not.toHaveBeenCalled();
  }, 20_000);

  it("resizes the game to the box the canvas sits in when that box changes", async () => {
    const observers: { callback: () => void; targets: Element[] }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets: Element[] = [];
        constructor(readonly callback: () => void) {
          observers.push(this);
        }
        observe(target: Element) {
          this.targets.push(target);
        }
        disconnect() {
          this.targets = [];
        }
      },
    );
    let box = { width: 1440, height: 900 };
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return (
          this.classList.contains("je-frame-document") ? { ...box } : { width: 0, height: 0 }
        ) as DOMRect;
      });
    const { host } = fakeProject();
    const { container } = render(
      <SceneEditor host={host} game={yardGame} project="p" scene="yard" rapier={rapier} />,
    );
    await waitFor(() => outliner().getByRole("button", { name: /pad/ }), { timeout: 10_000 });
    const frameBox = container.querySelector(".je-frame-document")!;
    const watching = observers.find((o) => o.targets.includes(frameBox));
    expect(watching).toBeTruthy();
    const game = games.made.at(-1)!.game as GameInstance;

    box = { width: 900, height: 700 };
    act(() => watching!.callback());
    expect(game.resize).toHaveBeenLastCalledWith(900, 700);

    box = { width: 1440, height: 900 };
    act(() => window.dispatchEvent(new Event("resize")));
    expect(game.resize).toHaveBeenLastCalledWith(1440, 900);
    rect.mockRestore();
  }, 20_000);

  it("preloads the opened scene and names the textures that failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    games.failed = [{ id: "crate-art" }, { id: "sky" }];
    const { host } = fakeProject();
    render(<SceneEditor host={host} game={yardGame} project="p" scene="yard" rapier={rapier} />);
    await waitFor(
      () =>
        expect(warn).toHaveBeenCalledWith(
          "[assets] yard: 2 texture(s) failed to load: crate-art, sky",
        ),
      { timeout: 10_000 },
    );
    const game = games.made.at(-1)!.game as GameInstance;
    expect(game.preload).toHaveBeenCalledTimes(1);
    expect(vi.mocked(game.preload).mock.lastCall![0]).toMatchObject({ name: "yard" });
    warn.mockRestore();
  }, 20_000);

  it("takes no inspector edits when the host is read-only", async () => {
    const { host } = fakeProject();
    render(
      <SceneEditor
        host={{ ...host, readOnly: true }}
        game={yardGame}
        project="p"
        scene="yard"
        rapier={rapier}
      />,
    );
    const row = await waitFor(() => outliner().getByRole("button", { name: /zone/ }), {
      timeout: 10_000,
    });
    fireEvent.click(row);
    const radius = screen.getByLabelText("shape.r") as HTMLInputElement;
    expect(radius.closest("fieldset")?.disabled).toBe(true);
    expect(radius.matches(":disabled")).toBe(true);
  }, 20_000);
});

describe("mountSceneEditor", () => {
  it("mounts into an element, updates and unmounts cleanly", async () => {
    const { host, connections } = fakeProject();
    const element = document.createElement("div");
    document.body.append(element);
    const props = { host, game: yardGame, project: "p", scene: "yard", rapier };
    let mounted!: ReturnType<typeof mountSceneEditor>;
    act(() => {
      mounted = mountSceneEditor(element, props);
    });
    await waitFor(() => expect(within(element).getByRole("button", { name: /pad/ })).toBeTruthy(), {
      timeout: 10_000,
    });
    act(() => mounted.update({ ...props }));
    expect(within(element).getByRole("button", { name: /pad/ })).toBeTruthy();

    act(() => mounted.unmount());
    expect(element.childElementCount).toBe(0);
    expect(connections.every((c) => c.destroy.mock.calls.length === 1)).toBe(true);
    expect(games.made.every((g) => g.destroyed)).toBe(true);
    expect(() => mounted.unmount()).not.toThrow();
    expect(() => mounted.update(props)).not.toThrow();
    element.remove();
  }, 20_000);
});

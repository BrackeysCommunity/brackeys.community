// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import type { SceneDefinition } from "../../editor/index";
import { defineGame } from "../../game/index";
import { createGame, type GameInstance, type RapierModule } from "../../index";
import { EditorFrame, editorChrome } from "../frame/EditorFrame";
import { editorIdentity, openLiveEditor, type LiveEditor } from "../session/live-scene-editor";

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

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
);

/** Primitives only, with an actor shape so "play from here" casts and refuses. */
const editorGame = defineGame({
  id: "editor-play",
  types: [],
  actions: [{ action: "right", keys: ["d"], description: "Right." }],
  play: { spawnShape: { type: "box", hw: 0.2, hh: 0.2 } },
  createRuntime: () => ({ snapshot: () => null }),
});

/** A floor from y 10.2 to 10.6 across x 0 to 10. */
function yard(): SceneDefinition {
  return {
    v: 4,
    name: "play-yard",
    bounds: [0, 0, 20, 12],
    solid: [["box", 5, 10.4, 5, 0.2]],
    entities: [
      { id: "zone", type: "sensor", shape: ["circle", 9, 6, 0.12], tags: ["goal"] },
      { id: "pad", type: "marker", at: [10, 10.1] },
    ],
  };
}

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

let game: GameInstance | null = null;
let live: LiveEditor | null = null;

beforeEach(() => {
  toast.mockReset();
  toast.error.mockReset();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  live?.destroy();
  game?.destroy();
  live = game = null;
  vi.unstubAllGlobals();
});

/** The editor on a real game, its keys read from the window as GameCanvas sets it up. */
async function setup(scene: SceneDefinition = yard()) {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  game = await createGame(canvas, {
    game: editorGame,
    rapier: async () => rapier,
    keyTarget: window,
    dev: true,
  });
  game.start();
  const doc = sceneToDoc(scene, { key: sequentialKeys("t") });
  live = openLiveEditor({
    game,
    doc,
    name: scene.name,
    identity: editorIdentity("Ada"),
    notify: toast,
    issuesDebounceMs: 0,
  });
  const { session, host } = live;
  render(
    <EditorFrame
      topLeft={null}
      {...editorChrome({
        session,
        host,
        game,
        onPlay: live.play,
        onReplay: live.replay,
        onStop: live.stop,
        onRestart: live.restart,
        notify: toast,
      })}
    >
      <div />
    </EditorFrame>,
  );
  return { game, live, canvas };
}

const state = () => game!.getStore().state;

describe("the editor driving a game", () => {
  it("plays on Mod+Enter and stops on Escape, through the game's router", async () => {
    const { live } = await setup();
    expect(state().mode).toBe("edit");

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(state().mode).toBe("play");
    expect(state().session).toMatchObject({ outcome: null });
    expect(live.session.store.state.mode).toBe("play");
    expect(screen.getByText("Playing · Esc to stop")).toBeTruthy();

    fireEvent.keyDown(window, { key: "p" });
    expect(state().sim.paused).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(state().mode).toBe("edit");
    expect(state().session).toBeNull();
    expect(state().sim.paused).toBe(false);
    expect(live.session.store.state.mode).toBe("edit");
  });

  it("plays from the pointer, and refuses inside a solid with a toast", async () => {
    const { canvas } = await setup();
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1920, 1080));
    /** Points the pointer at a world position on the default 1920x1080 display. */
    const pointAt = (x: number, y: number) => {
      const { position, scale } = state().camera;
      fireEvent.pointerMove(canvas, {
        clientX: (x - position.x) * scale + 960,
        clientY: (y - position.y) * scale + 540,
      });
    };

    pointAt(3, 5);
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, shiftKey: true });
    expect(state().mode).toBe("play");
    expect(game!.runtime()).toMatchObject({
      ctx: { play: { at: { x: expect.closeTo(3, 4), y: expect.closeTo(10, 4) } } },
    });
    fireEvent.keyDown(window, { key: "Escape" });

    pointAt(5, 10.4);
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true, shiftKey: true });
    expect(toast.error).toHaveBeenCalledWith("Can't play from here", {
      description: expect.stringMatching(/inside a solid/),
    });
    expect(state().mode).toBe("edit");
  });

  it("blocks Play on the scene's errors with a toast", async () => {
    const broken = yard();
    broken.entities!.push({ ...broken.entities![1]! });
    await setup(broken);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/^Fix \d+ errors? before you play$/),
      expect.anything(),
    );
    expect(state().mode).toBe("edit");
  });

  it("keeps keys typed into the inspector from the editor and the game", async () => {
    const { live } = await setup();
    const reached: string[] = [];
    game!.router.register({
      id: "below-play",
      priority: -1,
      accepts(e) {
        if (e.kind === "key" && e.type === "down") reached.push(e.key);
        return false;
      },
      handle() {},
    });
    act(() => live.session.select(["zone"]));
    const field = screen.getByLabelText("shape.r");
    field.focus();
    for (const key of ["d", "a", "Backspace", "Escape"]) fireEvent.keyDown(field, { key });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    expect(state().mode).toBe("edit");
    expect(live.session.store.state.selection).toEqual(["zone"]);
    expect(reached).toEqual([]);
  });
});

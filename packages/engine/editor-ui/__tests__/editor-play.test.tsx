// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import type { SceneDefinition } from "../../editor/index";
import { defineGame } from "../../game/index";
import { createGame, type GameInstance, type RapierModule } from "../../index";
import type { MountUi } from "../../ui/types";
import { EditorFrame, editorChrome, type FramePanels } from "../frame/EditorFrame";
import type { EditorStorage } from "../host";
import { LAYOUT_WRITE_DELAY } from "../layout/use-layout";
import { PANELS } from "../panels/registry";
import { usePlayUi } from "../SceneEditor";
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

const ui = vi.hoisted(() => ({ unmount: vi.fn(), mountUi: vi.fn() }));
vi.mock("../../ui/layer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ui/layer")>()),
  mountUi: ui.mountUi,
}));

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
  ui.unmount.mockReset();
  ui.mountUi.mockReset().mockReturnValue(ui.unmount);
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

/**
 * The editor on a real game, its keys read from the window as GameCanvas sets
 * it up. `rerender` draws it again, as a rebuild does, with `panels` changed.
 */
async function setup(
  scene: SceneDefinition = yard(),
  frameHost: { storage?: EditorStorage | null } = {},
) {
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
  const chrome = editorChrome({
    session,
    host,
    game,
    onPlay: live.play,
    onReplay: live.replay,
    onStop: live.stop,
    onRestart: live.restart,
    notify: toast,
  });
  const frame = (panels: FramePanels | undefined = chrome.panels) => (
    <EditorFrame topLeft={null} host={frameHost} {...chrome} panels={panels}>
      <div />
    </EditorFrame>
  );
  const view = render(frame());
  const rerender = (panels?: FramePanels) => view.rerender(frame(panels));
  return { game, live, canvas, chrome, rerender };
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

describe("the game's UI during Play", () => {
  it("mounts over the editor's canvas while Play runs and unmounts on Stop", async () => {
    const { live, canvas } = await setup();
    const hud: MountUi = () => ({ destroy() {} });
    const { unmount } = renderHook(() => usePlayUi(game, () => canvas, hud));
    expect(ui.mountUi).not.toHaveBeenCalled();

    act(() => live.play());
    expect(state().mode).toBe("play");
    expect(ui.mountUi).toHaveBeenCalledExactlyOnceWith(game, canvas, hud);
    expect(ui.unmount).not.toHaveBeenCalled();

    act(() => live.stop());
    expect(ui.unmount).toHaveBeenCalledOnce();

    act(() => live.play());
    expect(ui.mountUi).toHaveBeenCalledTimes(2);
    unmount();
    expect(ui.unmount).toHaveBeenCalledTimes(2);
  });

  it("mounts nothing without a UI", async () => {
    const { live, canvas } = await setup();
    renderHook(() => usePlayUi(game, () => canvas, null));
    act(() => live.play());
    expect(ui.mountUi).not.toHaveBeenCalled();
  });
});

/** The game's display, which the frame around it fills: the engine's default 1920x1080. */
function fillWindow() {
  Object.assign(window, { innerWidth: 1920, innerHeight: 1080 });
  window.dispatchEvent(new Event("resize"));
}

/** Where a world point is drawn, in px from the canvas's corner. */
function screenOf(x: number, y: number) {
  const { position, scale } = state().camera;
  return { x: (x - position.x) * scale + 960, y: (y - position.y) * scale + 540 };
}

/** The part of the canvas the columns leave visible, from their drawn edges. */
function visibleSpan() {
  const left = document.querySelector<HTMLElement>(".je-frame-column.je-frame-left")!;
  const right = document.querySelector<HTMLElement>(".je-frame-column.je-frame-right")!;
  const px = (el: HTMLElement, prop: "left" | "width") => Number.parseFloat(el.style[prop]);
  return { from: px(left, "left") + px(left, "width"), to: px(right, "left") };
}

const outlinerRow = (name: string) =>
  within(screen.getByRole("navigation", { name: "Outliner" })).getByRole("button", {
    name: new RegExp(`^${name}`),
  });

describe("the editor's camera", () => {
  beforeEach(fillWindow);
  afterEach(() => {
    Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
  });

  it("frames a selection made in the outliner when f is pressed there", async () => {
    await setup();
    const row = outlinerRow("zone");
    fireEvent.click(row);
    row.focus();
    fireEvent.keyDown(row, { key: "f", code: "KeyF" });
    expect(state().camera.zoom).toBe(5);
    const { from, to } = visibleSpan();
    expect(screenOf(9, 6).x).toBeCloseTo((from + to) / 2, 6);
    expect(screenOf(9, 6).y).toBeCloseTo(540, 6);
  });

  it("pans an off-screen outliner selection into the visible canvas, never zooming", async () => {
    await setup();
    act(() => game!.panBy({ x: 1500, y: 0 }));
    const zoom = state().camera.zoom;
    const { from, to } = visibleSpan();
    expect(screenOf(10, 10.1).x).toBeGreaterThan(to);

    fireEvent.click(outlinerRow("pad"));
    expect(state().camera.zoom).toBe(zoom);
    expect(screenOf(10, 10.1).x).toBeCloseTo((from + to) / 2, 6);

    const seen = { ...state().camera.position };
    fireEvent.click(outlinerRow("zone"));
    expect(state().camera.position).toEqual(seen);
  });

  it("keeps the world point under the pointer through a wheel zoom, in px and in lines", async () => {
    const { canvas } = await setup();
    // Framing the whole scene leaves it smaller than the canvas, offset for the columns.
    fireEvent.keyDown(window, { key: "f", code: "KeyF" });
    const framed = state().camera.zoom;
    expect(2000 * framed).toBeLessThan(1920);
    const pointer = { x: 420, y: 300 };
    const under = game!.screenToWorld(pointer);

    fireEvent.wheel(canvas, { clientX: pointer.x, clientY: pointer.y, deltaY: -100 });
    expect(state().camera.zoom).toBeCloseTo(framed * 1.15, 6);
    expect(game!.screenToWorld(pointer).x).toBeCloseTo(under.x, 6);
    expect(game!.screenToWorld(pointer).y).toBeCloseTo(under.y, 6);

    fireEvent.wheel(canvas, { clientX: pointer.x, clientY: pointer.y, deltaY: 3, deltaMode: 1 });
    expect(state().camera.zoom).toBeCloseTo(framed, 6);
    expect(game!.screenToWorld(pointer).x).toBeCloseTo(under.x, 6);
    expect(game!.screenToWorld(pointer).y).toBeCloseTo(under.y, 6);
  });
});

describe("the layout through Play", () => {
  const leftOpen = () => screen.queryByRole("separator", { name: "Left column edge" }) !== null;

  it("keeps a column collapsed before Play collapsed after Stop, through the rebuild Stop lets in", async () => {
    const { chrome, rerender } = await setup(yard(), { storage: null });
    fireEvent.click(screen.getByRole("button", { name: "Collapse the left column" }));
    expect(leftOpen()).toBe(false);
    // Long enough for the layout to settle and be written, as it is by the time anyone plays.
    await act(() => new Promise((done) => setTimeout(done, LAYOUT_WRITE_DELAY + 50)));

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(state().mode).toBe("play");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(state().mode).toBe("edit");
    expect(leftOpen()).toBe(false);

    // A rebuild draws the booting panels, then the editor's, which may bring one more.
    const extra = { ...PANELS[0]!, id: "extra", title: "Extra" };
    rerender({ ...chrome.panels!, defs: PANELS.filter((p) => p.id !== "history") });
    rerender({ ...chrome.panels!, defs: [...PANELS, extra] });
    expect(leftOpen()).toBe(false);
    expect(screen.getByRole("navigation", { name: "Left panels" })).toBeTruthy();
  });
});

// @vitest-environment jsdom
import {
  createGame,
  TOOL_PRIORITY,
  type GameInstance,
  type GameStoreState,
  type ToolRouter,
} from "@jams/engine";
import {
  sceneToDoc,
  sequentialKeys,
  type AwarenessLike,
  type SceneOrigin,
} from "@jams/engine/collab";
import { createEditorSession, type SceneDefinition } from "@jams/engine/editor";
import { createRegistry, defineGame } from "@jams/engine/game";
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import * as Y from "yjs";

import { CanvasShell } from "@/components/canvas/shell/CanvasShell";
import { editorChrome, type EditorChromeGame } from "@/components/game/editor/EditorShell";
import type { EditorHostState } from "@/components/game/live-scene-editor";

// jsdom has no WebGL, so the Pixi application is a stand-in; the containers are real.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return { ...pixi, Application, Assets: { addBundle: () => {}, loadBundle: async () => {} } };
});

const toasts = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), toasts) }));

const registry = createRegistry();
/** A game with one editor key of its own, and one the engine already binds. */
const shellGame = defineGame({
  id: "shell",
  types: [],
  actions: [],
  editorKeys: [
    { key: "1", scope: "edit", command: "shell:one", description: "A game command." },
    { key: "p", scope: "play", command: "shell:p", description: "Shadowed by pause." },
    { key: "Tab", scope: "play", command: "shell:tab", description: "A play tool." },
  ],
  createRuntime: () => ({ snapshot: () => null }),
});
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const bo: SceneOrigin = { kind: "user", userId: "bo", name: "Bo" };

function scene(): SceneDefinition {
  return {
    v: 1,
    name: "shell-yard",
    bounds: [0, 0, 2000, 1200],
    solid: [["box", 500, 1040, 500, 20]],
    entities: [
      { id: "zone", type: "sensor", shape: ["circle", 900, 600, 12], tags: ["goal"] },
      { id: "pad", type: "marker", at: [1000, 1010] },
    ],
  };
}

/** An in-memory awareness the two sessions share, as a provider would relay it. */
function sharedAwareness() {
  const states = new Map<number, Record<string, unknown>>();
  const handlers = new Set<() => void>();
  return (clientID: number): AwarenessLike => ({
    clientID,
    getLocalState: () => states.get(clientID) ?? null,
    setLocalStateField(field, value) {
      states.set(clientID, { ...states.get(clientID), [field]: value });
      for (const h of handlers) h();
    },
    getStates: () => states,
    on: (_e, cb) => handlers.add(cb as () => void),
    off: (_e, cb) => handlers.delete(cb as () => void),
  });
}

/** Two docs seeded from one "server" copy and linked so every update reaches the other at once. */
function linkedDocs() {
  const server = sceneToDoc(scene(), { key: sequentialKeys("srv") });
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  for (const d of [docA, docB]) Y.applyUpdate(d, Y.encodeStateAsUpdate(server));
  for (const [from, to] of [
    [docA, docB],
    [docB, docA],
  ] as const) {
    from.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "net") Y.applyUpdate(to, u, "net");
    });
  }
  return { docA, docB };
}

function setup() {
  const { docA, docB } = linkedDocs();
  const awareness = sharedAwareness();
  const session = (doc: Y.Doc, origin: SceneOrigin, id: number) =>
    createEditorSession({
      doc,
      origin,
      name: "shell-yard",
      registry,
      awareness: awareness(id),
      user: {
        id: (origin as { userId: string }).userId,
        name: (origin as { name: string }).name,
        color: "#000",
      },
      issuesDebounceMs: 0,
    });
  const a = session(docA, ada, 1);
  const b = session(docB, bo, 2);
  const host = new Store<EditorHostState>({ connection: "live", sceneChanged: false });
  const game = fakeGame();
  const handlers = { onPlay: vi.fn(), onReplay: vi.fn(), onStop: vi.fn(), onRestart: vi.fn() };
  render(
    <CanvasShell topLeft={null} {...editorChrome({ session: a, host, game, ...handlers })}>
      <canvas tabIndex={0} />
    </CanvasShell>,
  );
  return { a, b, host, game, ...handlers };
}

/**
 * A real game for its router, reading keys from the window as GameCanvas
 * sets it up; it sits in edit mode, so play input takes no key presses.
 */
let shared: GameInstance;
let sharedCanvas: HTMLCanvasElement;
beforeAll(async () => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  sharedCanvas = document.createElement("canvas");
  document.body.append(sharedCanvas);
  shared = await createGame(sharedCanvas, {
    game: shellGame,
    rapier: () => import("@dimforge/rapier2d"),
    keyTarget: window,
  });
  shared.start();
  shared.stop();
});
afterAll(() => {
  shared.destroy();
  vi.unstubAllGlobals();
});

/** The parts of a game the chrome drives, on a real router; sim controls write the store. */
function fakeGame() {
  const store = new Store({
    camera: { position: { x: 1000, y: 600 }, zoom: 1, bounds: { min: {}, max: {} }, mode: "free" },
    sim: { paused: false, timeScale: 1 },
  } as unknown as GameStoreState);
  const sim = (patch: Partial<GameStoreState["sim"]>) =>
    store.setState((s) => ({ ...s, sim: { ...s.sim, ...patch } }));
  return {
    getStore: () => store,
    registry: createRegistry(shellGame),
    router: shared.router,
    pause: vi.fn(() => sim({ paused: true })),
    resume: vi.fn(() => sim({ paused: false })),
    step: vi.fn(),
    setTimeScale: vi.fn((timeScale: number) => sim({ timeScale })),
    command: vi.fn(() => true),
    cancel: vi.fn(() => false),
    pointerWorld: vi.fn(() => ({ x: 640, y: 480 })),
    screenToWorld: (screen: { x: number; y: number }) => screen,
    panBy: vi.fn(),
    zoomAt: vi.fn(),
    frame: vi.fn(),
    runtime: () => null,
  } satisfies EditorChromeGame;
}

/** Unregisters what a test put on the shared router. */
const unregister: (() => void)[] = [];

const outliner = () => within(screen.getByRole("navigation", { name: "Outliner" }));
const history = () => within(screen.getByRole("region", { name: "History" }));
const rows = () => history().getAllByRole("listitem");

beforeEach(() => {
  for (const fn of Object.values(toasts)) fn.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has storage; the guard matches the component's.
  }
});
afterEach(() => {
  cleanup();
  for (const off of unregister.splice(0)) off();
});

describe("editorChrome", () => {
  it("lists the scene in the outliner and selects a row on click", () => {
    const { a } = setup();
    const row = outliner().getByRole("button", { name: /zone/ });
    expect(row.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(row);
    expect(a.store.state.selection).toEqual(["zone"]);
    expect(row.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(outliner().getByRole("button", { name: /pad/ }), { ctrlKey: true });
    expect(a.store.state.selection).toEqual(["zone", "pad"]);
    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("groups rows by registered type and keeps bulk arrays closed until opened", () => {
    setup();
    expect(outliner().getByRole("button", { name: /^sensor/, expanded: true })).toBeTruthy();
    expect(outliner().queryByRole("button", { name: /~solid:0/ })).toBeNull();
    fireEvent.click(outliner().getByRole("button", { name: /^solid/, expanded: false }));
    expect(outliner().getByRole("button", { name: /~solid:0/ })).toBeTruthy();
  });

  it("commits one update from the inspector, which reaches the other doc, then undo restores it", () => {
    const { a, b } = setup();
    const logged = a.store.state.history.length;
    fireEvent.click(outliner().getByRole("button", { name: /zone/ }));

    const radius = screen.getByLabelText("shape.r") as HTMLInputElement;
    expect(radius.value).toBe("12");
    fireEvent.change(radius, { target: { value: "20" } });
    fireEvent.keyDown(radius, { key: "Enter" });

    expect(a.getDoc().entities![0]).toMatchObject({ shape: ["circle", 900, 600, 20] });
    expect(b.getDoc().entities![0]).toMatchObject({ shape: ["circle", 900, 600, 20] });
    expect(a.store.state.history).toHaveLength(logged + 1);
    expect(a.store.state.history.at(-1)).toMatchObject({ actor: ada, ops: ["update"] });

    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);

    expect(a.getDoc().entities![0]).toMatchObject({ shape: ["circle", 900, 600, 12] });
    expect(b.getDoc().entities![0]).toMatchObject({ shape: ["circle", 900, 600, 12] });
    expect((screen.getByLabelText("shape.r") as HTMLInputElement).value).toBe("12");
    expect(undo.disabled).toBe(true);
  });

  it("shows an invalid draft inline without committing it", () => {
    const { a } = setup();
    const logged = a.store.state.history.length;
    fireEvent.click(outliner().getByRole("button", { name: /zone/ }));
    const radius = screen.getByLabelText("shape.r");
    fireEvent.change(radius, { target: { value: "-3" } });
    fireEvent.blur(radius);
    expect(screen.getByText("Must be above 0.")).toBeTruthy();
    expect(a.store.state.history).toHaveLength(logged);
  });

  it("routes editor keys: Mod+Z undoes, Delete removes the selection, Mod+Enter plays", () => {
    const { a, onPlay } = setup();
    fireEvent.click(outliner().getByRole("button", { name: /pad/ }));
    fireEvent.keyDown(window, { key: "Delete" });
    expect(a.getDoc().entities!.map((e) => e.id)).toEqual(["zone"]);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(a.getDoc().entities!.map((e) => e.id)).toEqual(["zone", "pad"]);
    expect(a.store.state.selection).toEqual(["pad"]);
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it("has no save: Mod+S does nothing and there is no Save button", () => {
    const { a } = setup();
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
    const logged = a.store.state.history.length;
    const event = new KeyboardEvent("keydown", { key: "s", metaKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(a.store.state.history).toHaveLength(logged);
  });

  it("hides the panels in play mode, stops on Escape and offers a restart when the scene changed", () => {
    const { a, host, onStop, onRestart } = setup();
    act(() => a.setMode("play"));
    expect(screen.queryByRole("navigation", { name: "Outliner" })).toBeNull();
    expect(screen.getByText("Playing · Esc to stop")).toBeTruthy();
    expect(screen.queryByText("Scene changed")).toBeNull();

    act(() => host.setState((s) => ({ ...s, sceneChanged: true })));
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(onRestart).toHaveBeenCalledOnce();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onStop).toHaveBeenCalledOnce();
  });
});

describe("the editor keymap", () => {
  /** A consumer below everything that records each key the router offers the game's side. */
  function gameSide(router: ToolRouter) {
    const seen: string[] = [];
    const off = router.register({
      id: "spy",
      priority: TOOL_PRIORITY.play - 1,
      accepts(e) {
        if (e.kind === "key" && e.type === "down") seen.push(e.key);
        return false;
      },
      handle() {},
    });
    unregister.push(off);
    return seen;
  }

  it("plays on Mod+Enter, from the pointer on Shift+Mod+Enter, and stops on Escape", () => {
    const { a, game, onPlay, onStop } = setup();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(onPlay).toHaveBeenCalledWith();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true, shiftKey: true });
    expect(onPlay).toHaveBeenLastCalledWith({ at: { x: 640, y: 480 } });

    act(() => a.setMode("play"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(game.cancel).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("lets the game cancel its own selection before Escape stops play", () => {
    const { a, game, onStop } = setup();
    act(() => a.setMode("play"));
    game.cancel.mockReturnValueOnce(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onStop).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("pauses, steps and changes time scale in play, from the keys and the play bar", () => {
    const { a, game } = setup();
    act(() => a.setMode("play"));
    expect(screen.getByText("Playing · Esc to stop")).toBeTruthy();

    fireEvent.keyDown(window, { key: "p" });
    expect(game.pause).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "." });
    expect(game.step).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Step" }));
    expect(game.step).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "[" });
    expect(game.setTimeScale).toHaveBeenLastCalledWith(0.5);
    fireEvent.keyDown(window, { key: "[" });
    fireEvent.keyDown(window, { key: "[" });
    expect(game.setTimeScale).toHaveBeenLastCalledWith(0.25);
    fireEvent.keyDown(window, { key: "]" });
    expect(game.setTimeScale).toHaveBeenLastCalledWith(0.5);
    fireEvent.click(screen.getByRole("button", { name: "1×" }));
    expect(game.getStore().state.sim.timeScale).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(game.resume).toHaveBeenCalledOnce();
  });

  it("means something else by P and [ in edit: the pen tool and the hierarchy", () => {
    const { a, game } = setup();
    const seen = gameSide(game.router);
    fireEvent.keyDown(window, { key: "p" });
    expect(a.store.state.tool).toBe("pen");
    fireEvent.keyDown(window, { key: "[" });
    expect(game.pause).not.toHaveBeenCalled();
    expect(game.setTimeScale).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(a.store.state.tool).toBe("select");
  });

  it("sends the game's keys to its commands, never one that shadows the engine's", () => {
    const { a, game } = setup();
    fireEvent.keyDown(window, { key: "1" });
    expect(game.command).toHaveBeenCalledWith("shell:one");
    act(() => a.setMode("play"));
    fireEvent.keyDown(window, { key: "p" });
    expect(game.command).toHaveBeenCalledOnce();
    expect(game.pause).toHaveBeenCalledOnce();
  });

  it("takes the game's play keys only with the canvas focused, so a panel keeps Tab", () => {
    const { a, game } = setup();
    act(() => a.setMode("play"));
    const fromPanel = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    window.dispatchEvent(fromPanel);
    expect(game.command).not.toHaveBeenCalled();
    expect(fromPanel.defaultPrevented).toBe(false);

    const fromCanvas = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    sharedCanvas.dispatchEvent(fromCanvas);
    expect(game.command).toHaveBeenCalledWith("shell:tab");
    expect(fromCanvas.defaultPrevented).toBe(true);
  });

  it("works with focus on a panel, and keeps typing in the inspector from the editor and the game", () => {
    const { a, game, onPlay } = setup();
    const seen = gameSide(game.router);
    const zone = outliner().getByRole("button", { name: /zone/ });
    fireEvent.click(zone);
    zone.focus();
    fireEvent.keyDown(zone, { key: "Escape" });
    expect(a.store.state.selection).toEqual([]);

    fireEvent.click(outliner().getByRole("button", { name: /zone/ }));
    const radius = screen.getByLabelText("shape.r") as HTMLInputElement;
    radius.focus();
    for (const key of ["Backspace", "Delete", "d", "1", "Escape"])
      fireEvent.keyDown(radius, { key });
    fireEvent.keyDown(radius, { key: "z", ctrlKey: true });
    fireEvent.keyDown(radius, { key: "Enter", ctrlKey: true });
    expect(a.getDoc().entities!.map((e) => e.id)).toEqual(["zone", "pad"]);
    expect(a.store.state.selection).toEqual(["zone"]);
    expect(game.command).not.toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();
    expect(seen).toEqual([]);

    const save = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    radius.dispatchEvent(save);
    expect(save.defaultPrevented).toBe(true);
  });

  it("leaves keys alone while a dialog has focus", () => {
    const { a } = setup();
    fireEvent.click(outliner().getByRole("button", { name: /pad/ }));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("button");
    dialog.append(inside);
    document.body.append(dialog);
    fireEvent.keyDown(inside, { key: "Delete" });
    expect(a.getDoc().entities!.map((e) => e.id)).toEqual(["zone", "pad"]);
    dialog.remove();
  });
});

describe("editorChrome with someone else on the doc", () => {
  it("shows the connection and how many others are here", () => {
    const { host } = setup();
    const status = within(
      screen.getAllByRole("status").find((s) => s.textContent?.includes("Live"))!,
    );
    expect(status.getByText("1 other here")).toBeTruthy();
    expect(status.getByRole("img", { name: "Here: Bo" })).toBeTruthy();
    act(() => host.setState((s) => ({ ...s, connection: "reconnecting" })));
    expect(status.getByText("Reconnecting")).toBeTruthy();
  });

  it("marks their selection in the outliner, on a closed bucket, and on the canvas", () => {
    const { b } = setup();
    act(() => b.select(["zone"]));
    const zone = outliner().getByRole("button", { name: /zone/ });
    expect(within(zone).getByRole("img", { name: "Selected by Bo" })).toBeTruthy();
    expect(document.querySelector('[data-selection="Bo"] path')).toBeTruthy();

    act(() => b.select(["~solid:0"]));
    expect(within(zone).queryByRole("img")).toBeNull();
    const solid = outliner().getByRole("button", { name: /^solid/, expanded: false });
    expect(within(solid).getByRole("img", { name: "Selected inside by Bo" })).toBeTruthy();

    act(() => b.select([]));
    expect(document.querySelector('[data-selection="Bo"]')).toBeNull();
  });

  it("draws their drag in progress as a ghost of what they're moving", () => {
    const { b } = setup();
    act(() => b.setGhost({ keys: [b.keyOf("zone")!], by: [50, 0] }));
    const ghost = document.querySelector('[data-ghost="Bo"]')!;
    expect(ghost.getAttribute("transform")).toBe("translate(50 0)");
    expect(ghost.querySelector("path")).toBeTruthy();
    act(() => b.setGhost(undefined));
    expect(document.querySelector('[data-ghost="Bo"]')).toBeNull();
  });

  it("follows their selection when an edit shifts bulk refs", () => {
    const { a, b } = setup();
    act(() => {
      a.dispatch({ ops: [{ op: "addBulk", key: "solid", shapes: [["box", 10, 10, 5, 5]] }] });
    });
    act(() => b.select(["~solid:1"]));
    act(() => {
      a.dispatch({ ops: [{ op: "remove", refs: ["~solid:0"] }] });
    });
    expect(b.store.state.selection).toEqual(["~solid:0"]);
    fireEvent.click(outliner().getByRole("button", { name: /^solid/, expanded: false }));
    const marked = outliner()
      .getAllByRole("img", { name: "Selected by Bo" })
      .map((img) => img.closest("button")!.textContent);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain("~solid:0");
  });

  it("lists history newest first with actors, and reverts someone else's entry", () => {
    const { a, b } = setup();
    act(() => {
      a.dispatch({ ops: [{ op: "update", ref: "zone", set: { tags: ["goal", "mine"] } }] });
    });
    act(() => {
      b.dispatch({ ops: [{ op: "update", ref: "pad", set: { at: [1100, 1010] } }] });
    });

    const [newest, older] = rows();
    expect(newest!.getAttribute("aria-label")).toBe("Edit pad");
    expect(within(newest!).getByText("Bo")).toBeTruthy();
    expect(older!.getAttribute("aria-label")).toBe("Edit zone");
    expect(within(older!).getByText("You")).toBeTruthy();

    fireEvent.click(within(newest!).getByRole("button", { name: "Revert" }));
    expect(a.getDoc().entities![1]).toMatchObject({ at: [1000, 1010] });
    expect(b.getDoc().entities![1]).toMatchObject({ at: [1000, 1010] });
    expect(rows()[0]!.getAttribute("aria-label")).toBe("Revert Edit pad");
    expect(within(rows()[0]!).getByText("You")).toBeTruthy();
    expect(toasts.error).not.toHaveBeenCalled();
    // The revert is this client's own batch, so undo takes it back.
    expect(a.store.state.undoLabel).toBe("Revert Edit pad");
  });

  it("refuses to revert an entry whose entities changed since, with a toast", () => {
    const { a, b } = setup();
    act(() => {
      b.dispatch({ ops: [{ op: "update", ref: "pad", set: { at: [1100, 1010] } }] });
    });
    act(() => {
      b.dispatch({ ops: [{ op: "update", ref: "pad", set: { at: [1200, 1010] } }] });
    });
    fireEvent.click(within(rows()[1]!).getByRole("button", { name: "Revert" }));
    expect(toasts.error).toHaveBeenCalledOnce();
    expect(toasts.error.mock.calls[0]![1]).toMatchObject({
      description: expect.stringContaining("changed since"),
    });
    expect(a.getDoc().entities![1]).toMatchObject({ at: [1200, 1010] });
  });

  it("keeps undo local: their edits aren't on this client's stack", () => {
    const { a, b } = setup();
    const undo = screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    act(() => {
      b.dispatch({ ops: [{ op: "update", ref: "pad", set: { at: [1100, 1010] } }] });
    });
    expect(undo.disabled).toBe(true);

    act(() => {
      a.dispatch({ ops: [{ op: "update", ref: "zone", set: { tags: ["mine"] } }] });
    });
    act(() => {
      b.dispatch({ ops: [{ op: "update", ref: "pad", set: { at: [1200, 1010] } }] });
    });
    expect(undo.disabled).toBe(false);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    expect(a.getDoc().entities![0]!.tags).toEqual(["goal"]);
    expect(a.getDoc().entities![1]).toMatchObject({ at: [1200, 1010] });
    expect(b.getDoc().entities![0]!.tags).toEqual(["goal"]);
    expect(undo.disabled).toBe(true);
  });
});

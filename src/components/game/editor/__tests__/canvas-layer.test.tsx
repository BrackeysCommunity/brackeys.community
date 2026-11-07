// @vitest-environment jsdom
import { createGame, type GameInstance, type RapierModule } from "@jams/engine";
import { sceneToDoc, sequentialKeys } from "@jams/engine/collab";
import { defineEditorTool, type Pt, type SceneDefinition } from "@jams/engine/editor";
import { defineGame } from "@jams/engine/game";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Y from "yjs";

import { CanvasShell } from "@/components/canvas/shell/CanvasShell";
import { viewOf, toScreen } from "@/components/game/editor/canvas-layer/view";
import { editorChrome } from "@/components/game/editor/EditorShell";
import {
  editorIdentity,
  openLiveEditor,
  type LiveEditor,
} from "@/components/game/live-scene-editor";

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

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
);
vi.mock("@/lib/toast", () => ({ toast }));

/** Stamps a marker per click; `tool:stamp:<size>` picks it with a size. */
const stampTool = defineEditorTool({
  id: "stamp",
  label: "Stamp",
  description: "Click to stamp a marker.",
  create(ctx) {
    let size = "small";
    return {
      command(command) {
        if (command !== "small" && command !== "big") return false;
        size = command;
        return true;
      },
      pointer(e) {
        if (e.type !== "down" || e.button !== 0) return false;
        const at: Pt = [Math.round(e.world[0]), Math.round(e.world[1])];
        ctx.commit({ ops: [{ op: "add", entity: { type: "marker", at, tags: [size] } }] });
        return true;
      },
      cursor: () => "crosshair",
    };
  },
});

const layerGame = defineGame({
  id: "canvas-layer",
  types: [],
  actions: [],
  editorKeys: [
    { key: "1", scope: "edit", command: "tool:stamp:big", description: "Stamp big markers." },
  ],
  editor: { tools: () => Promise.resolve([stampTool]) },
  createRuntime: () => ({ snapshot: () => null }),
});

function yard(): SceneDefinition {
  return {
    v: 1,
    name: "layer-yard",
    bounds: [0, 0, 2000, 1200],
    solid: [["box", 500, 1040, 500, 20]],
    entities: [{ id: "zone", type: "sensor", shape: ["circle", 900, 600, 40], tags: ["goal"] }],
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
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has storage; the guard matches the component's.
  }
});

afterEach(() => {
  cleanup();
  live?.destroy();
  game?.destroy();
  live = game = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** The editor on a real game sized to the window, its canvas the router's input target. */
async function setup() {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, window.innerWidth, window.innerHeight),
  );
  game = await createGame(canvas, {
    game: layerGame,
    rapier: async () => rapier,
    keyTarget: window,
    displayWidth: window.innerWidth,
    displayHeight: window.innerHeight,
    dev: true,
  });
  game.start();
  const doc = sceneToDoc(yard(), { key: sequentialKeys("t") });
  live = openLiveEditor({
    game,
    doc,
    name: "layer-yard",
    identity: editorIdentity("Ada"),
    issuesDebounceMs: 0,
  });
  const { session } = live;
  const origin = session.origin;
  let writes = 0;
  doc.on("afterTransaction", (tr: Y.Transaction) => {
    if (tr.origin === origin) writes++;
  });
  render(
    <CanvasShell
      topLeft={null}
      {...editorChrome({
        session,
        host: live.host,
        game,
        onPlay: live.play,
        onReplay: live.replay,
        onStop: live.stop,
        onRestart: live.restart,
        canvas: () => canvas,
      })}
    >
      <div />
    </CanvasShell>,
  );
  // The game's tools load through a promise before the tool host starts.
  await act(async () => {});
  const g = game;

  /** Where a world point is on screen, as the overlay draws it. */
  const screenOf = (at: Pt) =>
    toScreen(viewOf(g.getStore().state.camera, window.innerWidth, window.innerHeight), at);
  const pointer = (type: "down" | "move" | "up", at: Pt, init: PointerEventInit = {}) => {
    const [clientX, clientY] = screenOf(at);
    const fire = {
      down: fireEvent.pointerDown,
      move: fireEvent.pointerMove,
      up: fireEvent.pointerUp,
    }[type];
    act(() => {
      fire(canvas, { clientX, clientY, button: 0, pointerId: 1, ...init });
    });
  };
  const zone = () => session.getDoc().entities!.find((e) => e.id === "zone");
  return {
    game: g,
    session,
    canvas,
    writes: () => writes,
    history: () => session.store.state.history.length,
    screenOf,
    pointer,
    zone,
  };
}

const layer = () => document.querySelector("[data-canvas-layer]")!;

describe("the canvas layer", () => {
  it("draws on the game's camera: a screen point maps back to the world point under it", async () => {
    const { game: g, screenOf } = await setup();
    const [x, y] = screenOf([900, 600]);
    const world = g.screenToWorld({ x, y });
    expect(world.x).toBeCloseTo(900);
    expect(world.y).toBeCloseTo(600);
  });

  it("commits a drag over an entity as exactly one transaction on release", async () => {
    const { pointer, writes, history, zone, session } = await setup();
    const logged = history();
    pointer("down", [900, 600]);
    pointer("move", [940, 600]);
    pointer("move", [1000, 640]);
    expect(session.store.state.selection).toEqual(["zone"]);
    expect(writes()).toBe(0);
    expect(zone()?.shape).toEqual(["circle", 900, 600, 40]);
    expect(layer().querySelector('[data-outline="selected"]')).toBeTruthy();
    expect(layer().querySelector("[data-readout]")?.textContent).toMatch(/^Δ /);

    pointer("up", [1000, 640]);
    expect(writes()).toBe(1);
    expect(history()).toBe(logged + 1);
    expect(zone()?.shape).not.toEqual(["circle", 900, 600, 40]);
    expect(layer().querySelector("[data-readout]")).toBeNull();
  });

  it("commits nothing when Escape cancels a drag", async () => {
    const { pointer, writes, history, zone, session } = await setup();
    const logged = history();
    pointer("down", [900, 600]);
    pointer("move", [1000, 700]);
    fireEvent.keyDown(window, { key: "Escape" });
    pointer("up", [1000, 700]);
    expect(writes()).toBe(0);
    expect(history()).toBe(logged);
    expect(zone()?.shape).toEqual(["circle", 900, 600, 40]);
    expect(session.store.state.selection).toEqual(["zone"]);
  });

  it("shows the selection's handles, and a marquee while dragging empty space", async () => {
    const { pointer, session } = await setup();
    act(() => session.select(["zone"]));
    expect(layer().querySelectorAll("[data-handle]").length).toBeGreaterThan(0);

    pointer("down", [1500, 200]);
    pointer("move", [1600, 300]);
    expect(layer().querySelector("[data-marquee]")).toBeTruthy();
    pointer("up", [1600, 300]);
    expect(layer().querySelector("[data-marquee]")).toBeNull();
  });

  it("offers Convert to chain after a vertex drag leaves a poly concave", async () => {
    const { pointer, session, writes } = await setup();
    fireEvent.keyDown(window, { key: "g" });
    act(() => {
      session.dispatch({
        ops: [
          {
            op: "add",
            entity: {
              id: "rock",
              type: "solid",
              shape: ["poly", 600, 600, 700, 600, 700, 500, 600, 500],
            },
          },
        ],
      });
    });
    const start = writes();
    pointer("down", [650, 550]);
    pointer("up", [650, 550]);
    fireEvent.keyDown(window, { key: "Enter" });
    pointer("down", [600, 600]);
    pointer("move", [640, 560]);
    pointer("move", [680, 520]);
    pointer("up", [680, 520]);
    expect(writes()).toBe(start + 1);

    fireEvent.click(screen.getByRole("button", { name: "Convert to chain" }));
    expect(writes()).toBe(start + 2);
    const rock = session.getDoc().entities!.find((e) => e.id === "rock");
    expect((rock?.shape as unknown[] | undefined)?.[0]).toBe("chain");
    expect(screen.queryByRole("button", { name: "Convert to chain" })).toBeNull();
  });

  it("switches tools from the toolbar and from their keys", async () => {
    const { session } = await setup();
    const box = screen.getByRole("button", { name: "Box" });
    expect(box.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(box);
    expect(session.store.state.tool).toBe("box");
    expect(box.getAttribute("aria-pressed")).toBe("true");

    fireEvent.keyDown(window, { key: "c" });
    expect(session.store.state.tool).toBe("circle");
    expect(screen.getByRole("button", { name: "Circle" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(session.store.state.tool).toBe("select");
  });

  it("picks the game's tool from its edit key, with its argument, and shows its cursor", async () => {
    const { session, canvas, pointer } = await setup();
    expect(screen.getByRole("button", { name: "Stamp" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "1" });
    expect(session.store.state.tool).toBe("stamp");
    expect(screen.getByRole("button", { name: "Stamp" }).getAttribute("aria-pressed")).toBe("true");
    expect(canvas.style.cursor).toBe("crosshair");
    pointer("down", [300, 300]);
    pointer("up", [300, 300]);
    expect(session.getDoc().entities!.at(-1)).toMatchObject({ type: "marker", tags: ["big"] });
  });

  it("toggles snapping from the toolbar and its key, and remembers it for this viewer", async () => {
    await setup();
    const snap = screen.getByRole("button", { name: "Snap to grid" });
    expect(snap.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "g" });
    expect(snap.getAttribute("aria-pressed")).toBe("false");
    expect(JSON.parse(window.localStorage.getItem("game-editor:snap")!)).toEqual({
      enabled: false,
      step: 64,
    });

    cleanup();
    live?.destroy();
    game?.destroy();
    await setup();
    expect(screen.getByRole("button", { name: "Snap to grid" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("copies the selection and pastes it back as one batch through clipboard events", async () => {
    const { session, history, pointer } = await setup();
    act(() => session.select(["zone"]));
    const store = new Map<string, string>();
    const clipboard = (type: "copy" | "paste") => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          setData: (t: string, v: string) => store.set(t, v),
          getData: (t: string) => store.get(t) ?? "",
        },
      });
      return event;
    };

    const copy = clipboard("copy");
    act(() => void document.body.dispatchEvent(copy));
    expect(copy.defaultPrevented).toBe(true);
    expect(JSON.parse(store.get("text/plain")!)).toMatchObject({ kind: "scene-fragment" });

    pointer("move", [1400, 300]);
    const logged = history();
    const paste = clipboard("paste");
    act(() => void document.body.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(history()).toBe(logged + 1);
    expect(session.getDoc().entities!.map((e) => e.id)).toEqual(["zone", "zone-2"]);
    expect(session.store.state.selection).toEqual(["zone-2"]);
  });

  it("leaves a copy alone while typing in a field", async () => {
    const { session } = await setup();
    act(() => session.select(["zone"]));
    const field = screen.getByLabelText("shape.r");
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { setData: vi.fn(), getData: () => "" },
    });
    field.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

import { Container } from "pixi.js";
import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";

import {
  createDebugOverlay,
  debugModes,
  ENGINE_DEBUG_LAYERS,
  type DebugFrame,
  type DebugLayerFactory,
  type DebugSceneSource,
  type DebugTick,
} from "../debug";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import { createGameStore, selectDebugMode, setDebugMode } from "../store";
import { createToolRouter, TOOL_PRIORITY, type ToolRouter } from "../tool-router";
import type { RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { ENGINE_YARD_EXPANDED } from "./fixtures/engine-yard.expanded";
import { testGame } from "./fixtures/test-game";

function pressF3(router: ToolRouter): string | null {
  const native = { key: "F3", preventDefault() {} } as KeyboardEvent;
  return router.dispatch({ kind: "key", type: "down", key: "F3", native });
}

/** A game layer that records what the overlay does to it. */
function spyLayer(id: string) {
  const frames: DebugFrame[] = [];
  const visible: boolean[] = [];
  const created = vi.fn();
  const destroyed = vi.fn();
  const factory: DebugLayerFactory = {
    id,
    create(host) {
      created(host);
      return {
        update: (frame) => void frames.push(frame),
        setVisible: (v) => void visible.push(v),
        destroy: destroyed,
      };
    },
  };
  return { factory, frames, visible, created, destroyed };
}

const TICK: DebugTick = {
  dtMs: 16,
  mouseWorld: { x: 1, y: 2 },
  viewport: { x: 0, y: 0, width: 100, height: 100 },
  info: { speed: 3 },
};
const FRAME: DebugFrame = { ...TICK, scene: null };

function loadedRuntime(rapier: RapierModule, entities: number): SceneRuntimeHandle {
  const runtime = createSceneRuntime({ rapier, view: null, game: testGame });
  const report = runtime.load({
    ...ENGINE_YARD_EXPANDED,
    entities: ENGINE_YARD_EXPANDED.entities.slice(0, entities),
  });
  expect(report.ok).toBe(true);
  return runtime;
}

// ─── Debug modes ─────────────────────────────────────────

describe("debugModes", () => {
  it("is off, then the engine's layers", () => {
    expect(debugModes(ENGINE_DEBUG_LAYERS)).toEqual(["off", "grid", "physics"]);
  });

  it("appends a game's layers in order", () => {
    const layers = [...ENGINE_DEBUG_LAYERS, spyLayer("arcs").factory, spyLayer("scale").factory];
    expect(debugModes(layers)).toEqual(["off", "grid", "physics", "arcs", "scale"]);
  });

  it("rejects a layer id used twice", () => {
    expect(() => debugModes([...ENGINE_DEBUG_LAYERS, spyLayer("grid").factory])).toThrow(
      /duplicate debug layer "grid"/,
    );
  });
});

// ─── Overlay with game layers ────────────────────────────

describe("createDebugOverlay", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const target = createToolRouter();
    const store = createGameStore();
    const game = spyLayer("arcs");
    const overlay = createDebugOverlay({
      worldContainer: new Container(),
      uiContainer: new Container(),
      store,
      router: target,
      layers: [game.factory],
    });
    return { target, store, game, overlay };
  }

  it("creates a game layer only once F3 reaches it, and feeds it the game's debug info", () => {
    const { target, store, game, overlay } = setup();
    overlay.update(TICK);
    expect(game.created).not.toHaveBeenCalled();

    pressF3(target); // grid
    pressF3(target); // physics
    expect(game.created).not.toHaveBeenCalled();
    pressF3(target); // arcs
    expect(selectDebugMode(store.state)).toBe("arcs");
    expect(game.created).toHaveBeenCalledOnce();
    expect(game.visible).toEqual([true]);

    overlay.update(TICK);
    expect(game.frames).toEqual([FRAME]);

    overlay.destroy();
    expect(game.destroyed).toHaveBeenCalledOnce();
  });

  it("hands every layer the world bound last, even after an earlier one is freed", async () => {
    const rapier = await loadCompatRapier();
    const { target, game, overlay } = setup();
    for (let i = 0; i < 3; i++) pressF3(target);
    const runtimeA = loadedRuntime(rapier, 1);
    const runtimeB = loadedRuntime(rapier, ENGINE_YARD_EXPANDED.entities.length);
    const a: DebugSceneSource = runtimeA.ctx;
    const b: DebugSceneSource = runtimeB.ctx;

    overlay.update(TICK);
    overlay.setPhysics(a);
    overlay.update(TICK);
    overlay.setPhysics(b);
    runtimeA.destroy();
    overlay.update(TICK);
    overlay.setPhysics(null);
    overlay.update(TICK);

    expect(game.frames.map((f) => f.scene)).toEqual([null, a, b, null]);
    expect(game.frames[2]).toEqual({ ...TICK, scene: b });
    expect(game.frames[2]!.scene!.physics.world.colliders.len()).toBeGreaterThan(1);
    overlay.destroy();
    runtimeB.destroy();
  });

  it("hides the game layer when F3 wraps back to off and stops updating it", () => {
    const { target, store, game, overlay } = setup();
    for (let i = 0; i < 4; i++) pressF3(target);
    expect(selectDebugMode(store.state)).toBe("off");
    expect(game.visible).toEqual([true, false]);

    overlay.update(TICK);
    expect(game.frames).toEqual([]);
    overlay.destroy();
  });
});

// ─── Store integration ───────────────────────────────────

describe("debugMode in store", () => {
  it("initializes with off", () => {
    const store = createGameStore();
    expect(selectDebugMode(store.state)).toBe("off");
  });

  it("setDebugMode updates the store", () => {
    const store = createGameStore();

    setDebugMode(store, "grid");
    expect(selectDebugMode(store.state)).toBe("grid");

    setDebugMode(store, "physics");
    expect(selectDebugMode(store.state)).toBe("physics");

    setDebugMode(store, "off");
    expect(selectDebugMode(store.state)).toBe("off");
  });
});

// ─── localStorage persistence ────────────────────────────

describe("debug panel localStorage", () => {
  const mockStorage: Record<string, string> = {};

  beforeEach(() => {
    // Mock localStorage for Node environment
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const MODES = ["off", "grid", "physics"];

  it("reads initial mode from localStorage", async () => {
    mockStorage["debug-overlay-mode"] = "physics";

    const { createDebugPanel } = await import("../debug/debug-panel");
    const modes: string[] = [];
    const target = createToolRouter();
    const panel = createDebugPanel(target, MODES, (mode) => modes.push(mode));

    expect(panel.getMode()).toBe("physics");
    expect(modes[0]).toBe("physics");

    panel.destroy();
  });

  it("falls back to off when localStorage has invalid value", async () => {
    mockStorage["debug-overlay-mode"] = "invalid-mode";

    const { createDebugPanel } = await import("../debug/debug-panel");
    const modes: string[] = [];
    const target = createToolRouter();
    const panel = createDebugPanel(target, MODES, (mode) => modes.push(mode));

    expect(panel.getMode()).toBe("off");
    panel.destroy();
  });

  it("persists mode on F3 keypress", async () => {
    const { createDebugPanel } = await import("../debug/debug-panel");
    const modes: string[] = [];
    const target = createToolRouter();
    const panel = createDebugPanel(target, MODES, (mode) => modes.push(mode));

    expect(pressF3(target)).toBe("debug:overlay");

    // oxlint-disable-next-line typescript/unbound-method
    expect(localStorage.setItem).toHaveBeenCalledWith("debug-overlay-mode", "grid");
    expect(panel.getMode()).toBe("grid");

    panel.destroy();
  });

  it("takes F3 ahead of an editor tool, and lets go of it on destroy", async () => {
    const { createDebugPanel } = await import("../debug/debug-panel");
    const router = createToolRouter();
    router.register({
      id: "editor",
      priority: TOOL_PRIORITY.editor,
      accepts: (e) => e.kind === "key",
      handle() {},
    });
    const panel = createDebugPanel(router, MODES, () => {});
    expect(pressF3(router)).toBe("debug:overlay");
    panel.destroy();
    expect(pressF3(router)).toBe("editor");
  });
});

// ─── Grid viewport culling ──────────────────────────────

describe("grid viewport culling logic", () => {
  it("calculates correct grid line start positions", () => {
    const MINOR = 64;
    const MAJOR = 256;

    // Viewport at x=150, width=800
    const left = 150;
    const minorStart = Math.floor(left / MINOR) * MINOR;
    const majorStart = Math.floor(left / MAJOR) * MAJOR;

    // Minor start should snap to nearest 64-unit boundary below 150
    expect(minorStart).toBe(128); // 2 * 64 = 128
    expect(majorStart).toBe(0); // 0 * 256 = 0
  });

  it("negative coordinates snap correctly", () => {
    const MINOR = 64;
    const left = -100;
    const minorStart = Math.floor(left / MINOR) * MINOR;

    expect(minorStart).toBe(-128); // -2 * 64 = -128
  });
});

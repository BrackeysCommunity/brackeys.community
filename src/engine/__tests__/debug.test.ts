import { Container, type Graphics, type Text } from "pixi.js";
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
import { gridLayer, gridOverlayPlan, type GridSegment } from "../debug/grid-overlay";
import { gridGeometry } from "../grid/geometry";
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
  viewport: { x: 0, y: 0, width: 19.2, height: 10.8 },
  scale: 100,
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
    expect(game.created.mock.calls[0]![0]).toMatchObject({ pxPerMetre: 100 });
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
    expect(game.frames[2]!.scene!.physics!.world.colliders.len()).toBeGreaterThan(1);
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

// ─── Grid overlay ───────────────────────────────────────

describe("gridOverlayPlan", () => {
  const VIEW = { x: 1.5, y: -2.25, width: 19.2, height: 10.8 };
  const xs = (segments: readonly GridSegment[]) =>
    segments.filter(([x1, , x2]) => x1 === x2).map(([x]) => x);
  const ys = (segments: readonly GridSegment[]) =>
    segments.filter(([, y1, , y2]) => y1 === y2).map(([, y]) => y);

  it("without a scene grid draws a line every metre, a major one every ten, and the axes", () => {
    const plan = gridOverlayPlan(VIEW, 100);
    // The region reaches a major step past the view, aligned to the major lines.
    expect(xs(plan.major)).toEqual([-10, 10, 20, 30, 40]);
    expect(ys(plan.major)).toEqual([-20, -10, 10, 20]);
    expect(xs(plan.minor)).toContain(1);
    expect(xs(plan.minor)).toContain(-9);
    expect(xs(plan.minor).every((x) => Number.isInteger(x) && x % 10 !== 0)).toBe(true);
    expect(plan.axisX).toEqual([-10, 0, 40, 0]);
    expect(plan.axisY).toEqual([0, -20, 0, 20]);
    expect(plan.labels.map((l) => l.text)).toContain("10,-10");
    expect(plan.labels.find((l) => l.text === "0,0")).toMatchObject({ x: 0, y: 0 });
    expect(plan.cells).toEqual([]);
  });

  it("draws a square scene grid's cells from its origin, a major line every ten cells", () => {
    const geometry = gridGeometry({ kind: "square", cell: [0.32, 0.5], origin: [0.16, 0] });
    const plan = gridOverlayPlan(VIEW, 100, geometry);
    const minor = xs(plan.minor);
    for (const x of minor) {
      const cells = (x - 0.16) / 0.32;
      expect(Math.abs(cells - Math.round(cells))).toBeLessThan(1e-9);
    }
    expect(minor.length).toBeGreaterThan(19.2 / 0.32);
    for (const x of xs(plan.major)) {
      const tens = (x - 0.16) / 3.2;
      expect(Math.abs(tens - Math.round(tens))).toBeLessThan(1e-9);
    }
    expect(ys(plan.minor).every((y) => Math.abs(y / 0.5 - Math.round(y / 0.5)) < 1e-9)).toBe(true);
    expect(plan.labels[0]?.text).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
  });

  it("at 32 px per metre spaces a 1 m grid 32 screen px apart", () => {
    const geometry = gridGeometry({ kind: "square", cell: [1, 1] });
    const plan = gridOverlayPlan({ x: 0, y: 0, width: 60, height: 33.75 }, 32, geometry);
    // The y axis stands in for the x = 0 line.
    const lines = [...xs(plan.minor), ...xs(plan.major), plan.axisY![0]].sort((a, b) => a - b);
    const gaps = new Set(lines.slice(1).map((x, i) => (x - lines[i]!) * 32));
    expect([...gaps]).toEqual([32]);
  });

  it("outlines a hex grid's cells", () => {
    const geometry = gridGeometry({
      kind: "hex",
      cell: [0.64, 0.56],
      side: 0.32,
      stagger: "y",
      index: "odd",
    });
    const plan = gridOverlayPlan({ x: 0, y: 0, width: 4, height: 3 }, 100, geometry);
    expect(plan.minor).toEqual([]);
    expect(plan.cells.length).toBeGreaterThan(20);
    expect(plan.cells.every((c) => c.length === 6)).toBe(true);
    expect(plan.cells).toContainEqual(geometry.corners([0, 0]).map(([x, y]) => [x, y]));
  });

  it("leaves out lines closer than a few screen px, so a far zoom stays light", () => {
    const far = gridOverlayPlan({ x: 0, y: 0, width: 1920, height: 1080 }, 1);
    expect(far.minor).toEqual([]);
    expect(far.major.length).toBeGreaterThan(0);
    expect(gridOverlayPlan({ x: 0, y: 0, width: 19_200, height: 10_800 }, 0.1).major).toEqual([]);
  });

  it("reaches `margin` major steps past the view, and outlines at most `maxCells` hex cells", () => {
    const tight = gridOverlayPlan(VIEW, 100, null, { margin: 0 });
    expect(xs(tight.major)).toEqual([10, 20, 30]);
    expect(tight.axisY).toEqual([0, -10, 0, 10]);
    const hex = gridGeometry({
      kind: "hex",
      cell: [0.64, 0.56],
      side: 0.32,
      stagger: "y",
      index: "odd",
    });
    const view = { x: 0, y: 0, width: 4, height: 3 };
    const all = gridOverlayPlan(view, 100, hex).cells.length;
    expect(gridOverlayPlan(view, 100, hex, { maxCells: all }).cells).toHaveLength(all);
    expect(gridOverlayPlan(view, 100, hex, { maxCells: all - 1 }).cells).toEqual([]);
  });

  it("keys a plan by its drawn region, its scale and the grid, not by small pans", () => {
    const a = gridOverlayPlan(VIEW, 100).key;
    expect(gridOverlayPlan({ ...VIEW, x: VIEW.x + 0.5 }, 100).key).toBe(a);
    expect(gridOverlayPlan({ ...VIEW, x: VIEW.x + 12 }, 100).key).not.toBe(a);
    expect(gridOverlayPlan(VIEW, 150).key).not.toBe(a);
    const square = gridGeometry({ kind: "square", cell: [1, 1] });
    expect(gridOverlayPlan(VIEW, 100, square).key).not.toBe(a);
  });
});

describe("the grid layer", () => {
  it("strokes in screen px and reads the bound scene's grid", () => {
    const worldContainer = new Container();
    const layer = gridLayer.create({
      worldContainer,
      uiContainer: new Container(),
      pxPerMetre: 100,
    });
    const geometry = gridGeometry({ kind: "square", cell: [0.5, 0.5] });
    const scene = { grid: { geometry } } as unknown as DebugSceneSource;
    layer.update({ ...TICK, scale: 250, scene });
    const container = worldContainer.children[0]!;
    expect(container.label).toBe("debug-grid");
    const graphics = container.children[0] as Graphics;
    const widths = graphics.context.instructions
      .filter((i) => i.action === "stroke")
      .map((i) => (i.data.style as { width: number }).width);
    expect(widths).toEqual([1 / 250, 2 / 250, 2 / 250, 2 / 250]);
    const labels = container.children[1]!.children.filter((c) => c.visible) as Text[];
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => l.scale.x === 1 / 250)).toBe(true);
    // The cell lines: every half metre, a major one every 5 m.
    const plan = gridOverlayPlan(TICK.viewport, 250, geometry);
    expect(plan.minor.length).toBeGreaterThan(0);
    layer.destroy();
  });
});

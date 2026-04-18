import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";

import { computeJumpArc } from "../debug/jump-arc";
import { createGameStore, selectDebugMode, setDebugMode } from "../store";
import { DEBUG_MODES } from "../types";
import type { DebugMode } from "../types";

// ─── Debug Mode cycling ──────────────────────────────────

describe("DEBUG_MODES", () => {
  it("defines the correct mode sequence", () => {
    expect(DEBUG_MODES).toEqual(["off", "grid", "grid+physics", "grid+physics+arcs", "all"]);
  });

  it("cycles through all modes", () => {
    let index = 0;
    const visited: DebugMode[] = [];

    for (let i = 0; i < DEBUG_MODES.length; i++) {
      visited.push(DEBUG_MODES[index]);
      index = (index + 1) % DEBUG_MODES.length;
    }

    expect(visited).toEqual(DEBUG_MODES);
    expect(index).toBe(0); // wraps back to start
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

    setDebugMode(store, "all");
    expect(selectDebugMode(store.state)).toBe("all");

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

  it("reads initial mode from localStorage", async () => {
    mockStorage["debug-overlay-mode"] = "grid+physics";

    const { createDebugPanel } = await import("../debug/debug-panel");
    const modes: DebugMode[] = [];
    const target = new EventTarget();
    const panel = createDebugPanel(target as unknown as Window, (mode) => modes.push(mode));

    expect(panel.getMode()).toBe("grid+physics");
    expect(modes[0]).toBe("grid+physics");

    panel.destroy();
  });

  it("falls back to off when localStorage has invalid value", async () => {
    mockStorage["debug-overlay-mode"] = "invalid-mode";

    const { createDebugPanel } = await import("../debug/debug-panel");
    const modes: DebugMode[] = [];
    const target = new EventTarget();
    const panel = createDebugPanel(target as unknown as Window, (mode) => modes.push(mode));

    expect(panel.getMode()).toBe("off");
    panel.destroy();
  });

  it("persists mode on F3 keypress", async () => {
    const { createDebugPanel } = await import("../debug/debug-panel");
    const modes: DebugMode[] = [];
    const target = new EventTarget();
    const panel = createDebugPanel(target as unknown as Window, (mode) => modes.push(mode));

    // Simulate F3 press — KeyboardEvent not available in Node, use plain Event with key property
    const event = new Event("keydown") as Event & { key: string; repeat: boolean };
    Object.defineProperty(event, "key", { value: "F3" });
    Object.defineProperty(event, "repeat", { value: false });
    target.dispatchEvent(event);

    // oxlint-disable-next-line typescript/unbound-method
    expect(localStorage.setItem).toHaveBeenCalledWith("debug-overlay-mode", "grid");
    expect(panel.getMode()).toBe("grid");

    panel.destroy();
  });
});

// ─── Jump arc computation ────────────────────────────────

describe("computeJumpArc", () => {
  it("returns points starting at the given position", () => {
    const points = computeJumpArc(100, 960, 0);

    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual({ x: 100, y: 960 });
  });

  it("standing jump has no horizontal displacement", () => {
    const points = computeJumpArc(200, 960, 0);

    // All x values should be approximately 200
    for (const p of points) {
      expect(p.x).toBeCloseTo(200, 0);
    }
  });

  it("right jump has positive horizontal displacement", () => {
    const points = computeJumpArc(100, 960, 300);
    const lastPoint = points[points.length - 1];

    expect(lastPoint.x).toBeGreaterThan(100);
  });

  it("left jump has negative horizontal displacement", () => {
    const points = computeJumpArc(100, 960, -300);
    const lastPoint = points[points.length - 1];

    expect(lastPoint.x).toBeLessThan(100);
  });

  it("arc goes above the start position (negative y direction)", () => {
    const points = computeJumpArc(100, 960, 0);
    const minY = Math.min(...points.map((p) => p.y));

    expect(minY).toBeLessThan(960);
  });

  it("arc ends at or below the floor", () => {
    const points = computeJumpArc(100, 960, 300);
    const lastPoint = points[points.length - 1];

    // FLOOR_Y - PLAYER_HEIGHT = 1020 - 60 = 960
    expect(lastPoint.y).toBeCloseTo(960, 0);
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

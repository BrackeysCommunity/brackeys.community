// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createDebugOverlay, TIMING_ATTRIBUTE, TIMING_STORAGE_KEY } from "../debug";
import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import type { TimingReport } from "../runtime/timing";
import { parseSceneOrThrow } from "../scene/parse";
import engineYardJson from "../scenes/engine-yard.json";
import type { GameConfig, GameInstance, RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { testGame } from "./fixtures/test-game";

/** jsdom has no GPU: the Application is a stand-in whose `draw` runs Pixi's runners around nothing. */
const gpu = vi.hoisted(() => ({ draws: [] as (() => void)[] }));

vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  type Item = Record<string, () => void>;
  const runner = (name: string) => {
    const items: Item[] = [];
    return {
      add: (item: Item) => void items.push(item),
      emit: () => items.forEach((i) => i[name]!()),
    };
  };
  class Application {
    stage = new pixi.Container();
    screen = new pixi.Rectangle(0, 0, 0, 0);
    renderer: unknown = null;
    async init() {
      const runners = { prerender: runner("prerender"), postrender: runner("postrender") };
      this.renderer = { name: "webgl", resize: () => {}, runners };
      gpu.draws.push(() => {
        runners.prerender.emit();
        runners.postrender.emit();
      });
    }
    start() {}
    stop() {}
    destroy() {
      this.stage.destroy({ children: true });
    }
  }
  return { ...pixi, Application };
});

const TICK_MS = 1000 / 60;
const registry = createRegistry(testGame);
const yard = () => parseSceneOrThrow(engineYardJson, registry);

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await loadCompatRapier();
});

/** The loop's frame callback, run by hand. */
let frame: FrameRequestCallback | null = null;
let now = 0;
let canvas: HTMLCanvasElement;
const games: GameInstance[] = [];
const stored = new Map<string, string>();

beforeEach(() => {
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  gpu.draws.length = 0;
  now = 0;
  frame = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frame = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function frames(n: number): void {
  for (let i = 0; i < n; i++) {
    now += TICK_MS;
    frame?.(now);
  }
}

async function playing(config: Partial<GameConfig> = {}): Promise<GameInstance> {
  const game = await createGame(canvas, {
    game: testGame,
    registry,
    rapier: async () => rapier,
    scene: yard(),
    ...config,
  });
  games.push(game);
  game.start();
  return game;
}

const readout = () => document.querySelector(`script[${TIMING_ATTRIBUTE}]`);

describe("GameConfig.timing", () => {
  it("is off by default: the runtime's stats hold no timing", async () => {
    const game = await playing();
    game.step(3);
    frames(3);
    expect("timing" in game.runtime()!.stats()).toBe(false);
  });

  it("times the runtime's step, the shell's tick around it, the frame and the draw", async () => {
    const game = await playing({ timing: true });
    game.step(5);
    frames(4);
    gpu.draws[0]!();
    const timing = game.runtime()!.stats().timing!;

    expect(timing.tick.calls).toBeGreaterThanOrEqual(5);
    expect(timing.tick.parts["physics.step"]!.calls).toBe(timing.tick.calls);
    expect(timing.shell!.calls).toBe(timing.tick.calls);
    expect(Object.keys(timing.shell!.parts)).toEqual([
      "input",
      "step",
      "listeners",
      "session",
      "camera",
    ]);
    expect(timing.shell!.parts.step!.totalMs).toBeGreaterThanOrEqual(timing.tick.totalMs);
    expect(Object.keys(timing.frame!.parts)).toEqual([
      "input",
      "view.frame",
      "behaviors.render",
      "store",
    ]);
    expect(timing.draw).toMatchObject({ calls: 1, parts: {} });
  });
});

describe("the debug overlay's timing readout", () => {
  it("follows the debug-timing flag and keeps the report on the page as JSON", async () => {
    const game = await playing({ dev: true, debug: createDebugOverlay });
    game.step(2);
    expect(readout()).toBeNull();
    expect("timing" in game.runtime()!.stats()).toBe(false);

    stored.set(TIMING_STORAGE_KEY, "1");
    game.step(70);
    const shown = JSON.parse(readout()!.textContent) as TimingReport;
    expect(shown.tick.calls).toBeGreaterThan(0);
    expect(shown.tick.parts["physics.step"]).toBeDefined();
    expect(shown.shell!.parts.step).toBeDefined();
    expect(game.runtime()!.stats().timing).toBeDefined();

    stored.delete(TIMING_STORAGE_KEY);
    game.step(40);
    expect(readout()).toBeNull();
    expect("timing" in game.runtime()!.stats()).toBe(false);
  });

  it("goes with the game", async () => {
    stored.set(TIMING_STORAGE_KEY, "1");
    const game = await playing({ dev: true, debug: createDebugOverlay });
    game.step(1);
    expect(readout()).not.toBeNull();
    game.destroy();
    expect(readout()).toBeNull();
  });
});

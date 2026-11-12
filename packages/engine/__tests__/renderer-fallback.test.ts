// @vitest-environment jsdom
import type { Texture } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import { createKindRegistry } from "../project/kinds";
import { projectView } from "../project/view";
import { createAssetLoader, type AssetLoader } from "../render/asset-loader";
import { CONTEXT_RESTORE_MS, createRenderer } from "../renderer";
import { snapshotDigest } from "../runtime/recorder";
import { parseSceneOrThrow } from "../scene/parse";
import engineYardJson from "../scenes/engine-yard.json";
import {
  DEFAULT_GAME_CONFIG,
  type GameEventMap,
  type GameInstance,
  type RapierModule,
} from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { testGame } from "./fixtures/test-game";

type Backend = "webgpu" | "webgl";

/** jsdom has no GPU: each Application is a stand-in over a real stage, logged in `apps`. */
const gpu = vi.hoisted(() => ({
  webgpu: false,
  apps: [] as {
    preference: Backend;
    canvas: HTMLCanvasElement;
    destroyed: boolean;
    stopped: boolean;
    loseDevice: () => void;
  }[],
  textures: [] as { source: { unload: () => void } }[],
}));

vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    screen = new pixi.Rectangle(0, 0, 0, 0);
    renderer: unknown = null;
    async init(opts: {
      preference: Backend;
      canvas: HTMLCanvasElement;
      width: number;
      height: number;
    }) {
      if (opts.preference === "webgpu" && !gpu.webgpu) throw new Error("no WebGPU adapter");
      let loseDevice = () => {};
      const lost = new Promise<{ reason: string }>(
        (done) => (loseDevice = () => done({ reason: "unknown" })),
      );
      const entry = {
        preference: opts.preference,
        canvas: opts.canvas,
        destroyed: false,
        stopped: false,
        loseDevice,
      };
      gpu.apps.push(entry);
      this.screen.width = opts.width;
      this.screen.height = opts.height;
      this.renderer = {
        name: opts.preference,
        resize: (w: number, h: number) => {
          this.screen.width = w;
          this.screen.height = h;
        },
        extract: { pixels: () => ({ pixels: new Uint8ClampedArray(4) }) },
        ...(opts.preference === "webgpu" ? { gpu: { device: { lost } } } : {}),
      };
      this.entry = entry;
    }
    entry: (typeof gpu.apps)[number] | null = null;
    start() {
      if (this.entry) this.entry.stopped = false;
    }
    stop() {
      if (this.entry) this.entry.stopped = true;
    }
    destroy() {
      if (this.entry) this.entry.destroyed = true;
      this.stage.destroy({ children: true });
    }
  }
  const Assets = {
    load: async () => {
      const texture = { width: 2, height: 2, source: { unload: vi.fn() } };
      gpu.textures.push(texture);
      return texture;
    },
    unload: async () => {},
  };
  return { ...pixi, Application, Assets };
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  gpu.webgpu = false;
  gpu.apps.length = 0;
  gpu.textures.length = 0;
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
  vi.useRealTimers();
});

function frames(n: number): void {
  for (let i = 0; i < n; i++) {
    now += TICK_MS;
    frame?.(now);
  }
}

/** Runs frames until the store has counted `tick` ticks. */
function runTo(game: GameInstance, tick: number): void {
  for (let guard = 0; game.getStore().state.tick < tick; guard++) {
    if (guard > tick * 4) throw new Error("the loop stopped ticking");
    frames(1);
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function fakeLoader(reupload: () => void): AssetLoader {
  return {
    async load() {
      return { failed: [] };
    },
    retain() {},
    release() {},
    trim() {},
    stats: () => ({ textures: 0, bytes: 0, resident: [] }),
    get: () => null,
    onLoad: () => () => {},
    reupload,
    destroy() {},
  };
}

type Logged = { [K in keyof GameEventMap]?: GameEventMap[K][] };

async function playing(opts: { renderer?: Parameters<typeof createGame>[1]["renderer"] } = {}) {
  const kinds = createKindRegistry(testGame);
  const view = projectView(
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {},
      history: {},
      code: {},
      build: {},
    },
    kinds,
  );
  const reupload = vi.fn();
  const loader = fakeLoader(reupload);
  const game = await createGame(canvas, {
    game: testGame,
    registry,
    rapier: async () => rapier,
    scene: yard(),
    assets: { loader, view, kinds },
    ...opts,
  });
  games.push(game);
  const log: Logged = {};
  const order: string[] = [];
  const track = <K extends "render:lost" | "render:restored" | "render:fallback">(name: K) =>
    game.on(name, (payload) => {
      ((log[name] ??= []) as GameEventMap[K][]).push(payload);
      order.push(name);
    });
  track("render:lost");
  track("render:restored");
  track("render:fallback");
  game.start();
  expect(game.play(yard()).ok).toBe(true);
  frames(1);
  return { game, log, order, loader: { reupload } };
}

const lose = (on: HTMLCanvasElement) => {
  const event = new Event("webglcontextlost", { cancelable: true });
  on.dispatchEvent(event);
  return event;
};

const overlay = () => document.querySelector("[data-jams-render-lost]");

describe("createRenderer's start", () => {
  it("retries a failed WebGPU init with WebGL and says so with reason init", async () => {
    const fallback = vi.fn();
    const renderer = await createRenderer(
      canvas,
      { ...DEFAULT_GAME_CONFIG, game: testGame },
      undefined,
      {
        fallback,
      },
    );
    expect(gpu.apps.map((a) => a.preference)).toEqual(["webgl"]);
    expect(fallback).toHaveBeenCalledWith("init");
    expect(renderer.app.stage.children.map((c) => c.label)).toEqual(["world", "bars", "ui"]);
    renderer.destroy();
  });

  it("keeps WebGPU when it starts, and asks for WebGL first when the config does", async () => {
    gpu.webgpu = true;
    const fallback = vi.fn();
    const config = { ...DEFAULT_GAME_CONFIG, game: testGame };
    (await createRenderer(canvas, config, undefined, { fallback })).destroy();
    (await createRenderer(canvas, { ...config, renderer: { preference: "webgl" } })).destroy();
    expect(gpu.apps.map((a) => a.preference)).toEqual(["webgpu", "webgl"]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("tells the shell's host of the init fallback once it starts", async () => {
    const { log } = await playing();
    expect(log["render:fallback"]).toEqual([{ from: "webgpu", reason: "init" }]);
  });
});

describe("a lost GPU context", () => {
  it("pauses behind the overlay and, with no restore in 3 s, rebuilds with WebGL and resumes", async () => {
    const { game, log, order, loader } = await playing();
    runTo(game, 10);
    const first = gpu.apps[0]!;

    expect(lose(first.canvas).defaultPrevented).toBe(true);
    expect(log["render:lost"]).toEqual([{ backend: "webgl" }]);
    expect(game.getStore().state.sim.paused).toBe(true);
    expect(first.stopped).toBe(true);
    expect(overlay()?.textContent).toBe("Restoring graphics…");

    await vi.advanceTimersByTimeAsync(CONTEXT_RESTORE_MS - 1);
    expect(gpu.apps).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(first.destroyed).toBe(true);
    const rebuilt = gpu.apps[1]!;
    expect(rebuilt.preference).toBe("webgl");
    // A fresh canvas over the host's, which keeps its place and its input.
    expect(rebuilt.canvas).not.toBe(canvas);
    expect(canvas.isConnected).toBe(true);
    expect(rebuilt.canvas.closest("[data-jams-renderer]")).not.toBeNull();
    expect(loader.reupload).toHaveBeenCalledTimes(1);
    expect(log["render:restored"]).toEqual([{ backend: "webgl", rebuilt: true }]);
    // A WebGL renderer replacing a WebGL one is no fallback.
    expect(order).toEqual(["render:fallback", "render:lost", "render:restored"]);
    expect(overlay()).toBeNull();
    expect(game.getStore().state.sim.paused).toBe(false);

    const tick = game.getStore().state.tick;
    runTo(game, tick + 5);
    expect(game.getStore().state.tick).toBe(tick + 5);
  });

  it("lets a WebGL restore within 3 s rebuild in place", async () => {
    const { game, log, loader } = await playing();
    const first = gpu.apps[0]!;
    lose(first.canvas);
    await vi.advanceTimersByTimeAsync(1000);
    first.canvas.dispatchEvent(new Event("webglcontextrestored"));

    expect(log["render:restored"]).toEqual([{ backend: "webgl", rebuilt: false }]);
    expect(first.stopped).toBe(false);
    expect(overlay()).toBeNull();
    expect(game.getStore().state.sim.paused).toBe(false);
    await vi.advanceTimersByTimeAsync(CONTEXT_RESTORE_MS);
    expect(gpu.apps).toHaveLength(1);
    expect(loader.reupload).not.toHaveBeenCalled();
  });

  it("rebuilds at once on a WebGPU device loss and stays on WebGL", async () => {
    gpu.webgpu = true;
    const { game, log, order } = await playing();
    gpu.apps[0]!.loseDevice();
    await settle();

    expect(gpu.apps.map((a) => a.preference)).toEqual(["webgpu", "webgl"]);
    expect(log["render:lost"]).toEqual([{ backend: "webgpu" }]);
    expect(log["render:fallback"]).toEqual([{ from: "webgpu", reason: "lost" }]);
    expect(log["render:restored"]).toEqual([{ backend: "webgl", rebuilt: true }]);
    expect(order).toEqual(["render:lost", "render:fallback", "render:restored"]);
    expect(game.getStore().state.sim.paused).toBe(false);
  });

  it("runs no tick while lost, whatever the host asks", async () => {
    const { game } = await playing();
    runTo(game, 5);
    lose(gpu.apps[0]!.canvas);
    const tick = game.getStore().state.tick;
    frames(30);
    game.resume();
    game.step(3);
    frames(30);
    expect(game.getStore().state.tick).toBe(tick);
    expect(game.getStore().state.sim.paused).toBe(true);

    await vi.advanceTimersByTimeAsync(CONTEXT_RESTORE_MS);
    await settle();
    frames(3);
    expect(game.getStore().state.tick).toBeGreaterThan(tick);
  });

  it("leaves a host's own pause in place after the restore", async () => {
    const { game } = await playing();
    lose(gpu.apps[0]!.canvas);
    game.pause();
    await vi.advanceTimersByTimeAsync(CONTEXT_RESTORE_MS);
    await settle();
    expect(game.getStore().state.sim.paused).toBe(true);
    game.resume();
    expect(game.getStore().state.sim.paused).toBe(false);
  });

  it("draws the config's lostOverlay in place of the default", async () => {
    const destroy = vi.fn();
    await playing({
      renderer: {
        lostOverlay: (layer) => {
          layer.append(Object.assign(document.createElement("p"), { textContent: "hold on" }));
          return { destroy };
        },
      },
    });
    lose(gpu.apps[0]!.canvas);
    expect(overlay()?.textContent).toBe("hold on");
    await vi.advanceTimersByTimeAsync(CONTEXT_RESTORE_MS);
    await settle();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(overlay()).toBeNull();
  });

  it("leaves the digest of a run with a loss equal to one without", async () => {
    const TICKS = 90;
    const clean = await playing();
    runTo(clean.game, TICKS);
    const expected = snapshotDigest(clean.game.runtime()!.snapshot());
    for (const g of games.splice(0)) g.destroy();
    document.body.replaceChildren();
    canvas = document.createElement("canvas");
    document.body.appendChild(canvas);

    const lossy = await playing();
    runTo(lossy.game, 40);
    lose(gpu.apps.at(-1)!.canvas);
    frames(60);
    await vi.advanceTimersByTimeAsync(CONTEXT_RESTORE_MS);
    await settle();
    runTo(lossy.game, TICKS);

    expect(lossy.game.getStore().state.tick).toBe(TICKS);
    expect(snapshotDigest(lossy.game.runtime()!.snapshot())).toBe(expected);
    expect(expected).not.toBe(snapshotDigest(null));
  });

  it("stops listening when destroyed, so the app's own teardown isn't a loss", async () => {
    const lost = vi.fn();
    const renderer = await createRenderer(
      canvas,
      { ...DEFAULT_GAME_CONFIG, game: testGame },
      undefined,
      {
        lost,
      },
    );
    renderer.destroy();
    lose(canvas);
    expect(lost).not.toHaveBeenCalled();
  });
});

describe("AssetLoader.reupload", () => {
  it("drops every resident texture's GPU copy so the next renderer uploads it again", async () => {
    const loader = createAssetLoader({ project: "p", url: (_p, e) => `/blob/${e.sha256}` });
    const bundle = {
      name: "b",
      entries: [
        { id: "a", sha256: "1".repeat(64), bytes: 4, kind: "texture" },
        { id: "b", sha256: "2".repeat(64), bytes: 4, kind: "texture" },
      ],
    } as unknown as Parameters<AssetLoader["load"]>[0];
    await loader.load(bundle);
    expect(gpu.textures).toHaveLength(2);
    loader.reupload!();
    for (const t of gpu.textures) expect(t.source.unload).toHaveBeenCalledTimes(1);
    expect(loader.get("1".repeat(64))).toBe(gpu.textures[0] as unknown as Texture);
    loader.destroy();
  });
});

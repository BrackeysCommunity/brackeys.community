// @vitest-environment jsdom
import { Assets, Container, type Texture } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { DebugOverlayFactory, DebugSceneSource } from "../debug";
import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import type { TimeModel } from "../game/time";
import type { GameCommand, GameDefinition, GameShell } from "../game/types";
import { createKindRegistry } from "../project/kinds";
import type { AssetEntry, Sha256 } from "../project/types";
import { projectView } from "../project/view";
import { createAssetLoader } from "../render/asset-loader";
import type { LoadReport, SceneRuntimeHandle } from "../runtime/types";
import { expandScene, isExpandedScene } from "../scene/expand";
import { parseSceneOrThrow } from "../scene/parse";
import type { SceneDefinition } from "../scene/types";
import engineYardJson from "../scenes/engine-yard.json";
import { TOOL_PRIORITY, type ToolEvent } from "../tool-router";
import type { GameInstance, InputAction, RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { ENGINE_PARITY_SCRIPT } from "./fixtures/parity-script";
import { testGame } from "./fixtures/test-game";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

/** The alpha of each frame any Pixi view is asked to render. */
const frameAlphas = vi.hoisted(() => [] as number[]);
vi.mock("../render/pixi-view", async (importOriginal) => {
  const real = await importOriginal<typeof import("../render/pixi-view")>();
  return {
    ...real,
    createPixiView: (...args: Parameters<typeof real.createPixiView>) => {
      const view = real.createPixiView(...args);
      const recording: typeof view = {
        ...view,
        frame(f) {
          frameAlphas.push(f.alpha);
          view.frame!(f);
        },
      };
      return recording;
    },
  };
});

const TICK_MS = 1000 / 60;

const registry = createRegistry(testGame);
const sceneA: SceneDefinition = parseSceneOrThrow(engineYardJson, registry);
const sceneB: SceneDefinition = {
  v: 1,
  name: "floor-only",
  bounds: [0, 0, 500, 500],
  solid: [["box", 250, 490, 250, 10]],
};

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await loadCompatRapier();
});

/** The test game, recording every shell and runtime the engine attaches it to. */
function recordingGame() {
  const attached: { shell: GameShell; runtime: SceneRuntimeHandle }[] = [];
  const game: GameDefinition = {
    ...testGame,
    attach(shell, runtime) {
      attached.push({ shell, runtime });
      return { destroy() {} };
    },
  };
  return { game, attached, last: () => attached[attached.length - 1]! };
}

/** An overlay that records which world it is bound to and how many colliders each tick sees. */
function recordingOverlay() {
  const bound: (DebugSceneSource | null)[] = [];
  const colliders: (number | null)[] = [];
  const factory: DebugOverlayFactory = () => {
    let source: DebugSceneSource | null = null;
    return {
      setPhysics(next) {
        source = next;
        bound.push(next);
      },
      update: () => void colliders.push(source?.physics?.world.colliders.len() ?? null),
      destroy() {},
    };
  };
  return { factory, bound, colliders };
}

/** Drives the loop's frames by hand. */
function manualFrames() {
  let pending: FrameRequestCallback[] = [];
  let now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => pending.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return {
    advance(ms: number) {
      now += ms;
      const due = pending;
      pending = [];
      for (const cb of due) cb(now);
    },
  };
}

const games: GameInstance[] = [];
let canvas: HTMLCanvasElement;

async function makeGame(
  config: Partial<Parameters<typeof createGame>[1]> & { game: GameDefinition },
): Promise<GameInstance> {
  const instance = await createGame(canvas, { rapier: async () => rapier, ...config });
  games.push(instance);
  return instance;
}

beforeEach(() => {
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Plays the parity script for `ticks` ticks straight on the runtime, collecting each snapshot. */
function play(runtime: SceneRuntimeHandle, ticks: number): unknown[] {
  const snapshots: unknown[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const actions: InputAction[] = ENGINE_PARITY_SCRIPT.inputs
      .filter(([t]) => t === tick)
      .map(([, action, pressed]) => ({ action, pressed: pressed === 1, tick, timestamp: 0 }));
    snapshots.push(runtime.step(TICK_MS, actions).game);
  }
  return snapshots;
}

const withoutMs = (report: LoadReport) => (report.ok ? { ...report, ms: 0 } : report);

describe("createGame config", () => {
  it("lets the host leave Rapier out", () => {
    const config: Parameters<typeof createGame>[1] = { game: testGame };
    expect(config).not.toHaveProperty("rapier");
  });
});

describe("lazy Rapier", () => {
  const freeGame: GameDefinition = { ...testGame, world: { physics: "none" } };
  const markers: SceneDefinition = {
    v: 1,
    name: "markers",
    bounds: [0, 0, 500, 500],
    entities: [
      { id: "a", type: "marker", at: [100, 100] },
      { id: "b", type: "marker", at: [300, 200], tags: ["spawn"] },
    ],
  };
  const withRapier: SceneDefinition = { ...sceneB, settings: { physics: "rapier" } };

  const world = (game: GameInstance) => game.runtime() as SceneRuntimeHandle | null;

  async function spied(game: GameDefinition, extra: { scene?: SceneDefinition } = {}) {
    const load = vi.fn(async () => rapier);
    const instance = await createGame(canvas, { game, rapier: load, dev: true, ...extra });
    games.push(instance);
    return { instance, load };
  }

  it("loads it once at start for a game whose default physics is Rapier", async () => {
    const { instance, load } = await spied(testGame);
    expect(load).toHaveBeenCalledTimes(1);
    expect(instance.loadScene(sceneB).ok).toBe(true);
    await instance.preload(sceneA);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never calls GameConfig.rapier in the shell of a physics-free game", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { instance, load } = await spied(freeGame, { scene: markers });
    instance.start();
    expect(world(instance)?.ctx.physics).toBeNull();
    await instance.preload(markers);
    expect(instance.loadScene(markers).ok).toBe(true);
    expect(instance.play(markers).ok).toBe(true);
    instance.step(10);
    expect(instance.getStore().state.tick).toBe(10);
    instance.stop();
    expect(load).not.toHaveBeenCalled();
  });

  it("loads it at start for a physics-free game whose start-up scene runs on Rapier", async () => {
    const { instance, load } = await spied(freeGame, { scene: withRapier });
    expect(load).toHaveBeenCalledTimes(1);
    expect(world(instance)?.ctx.physics).not.toBeNull();
  });

  it("preload brings it in, once, for a Rapier scene", async () => {
    const { instance, load } = await spied(freeGame);
    await instance.preload(sceneB);
    expect(load).not.toHaveBeenCalled();
    await Promise.all([instance.preload(withRapier), instance.preload(withRapier)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(instance.loadScene(withRapier).ok).toBe(true);
    expect(world(instance)?.ctx.physics).not.toBeNull();
  });

  it("reports physics-not-loaded for loadScene, play and replay of a Rapier scene before it", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { instance, load } = await spied(freeGame, { scene: markers });
    instance.start();
    expect(instance.loadScene(withRapier)).toMatchObject({
      ok: false,
      reason: "physics-not-loaded",
    });
    expect(instance.play(withRapier)).toMatchObject({ ok: false, reason: "physics-not-loaded" });

    expect(instance.play(markers).ok).toBe(true);
    instance.step(3);
    instance.stop();
    const recording = instance.recording()!;
    expect(instance.replay(withRapier, recording)).toMatchObject({
      ok: false,
      reason: "physics-not-loaded",
    });
    expect(world(instance)?.scene()?.name).toBe("markers");
    expect(load).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("lets a failed preload retry, and loads report physics-not-loaded until one succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error("offline");
      return rapier;
    });
    const instance = await createGame(canvas, { game: freeGame, rapier: load, dev: true });
    games.push(instance);
    await expect(instance.preload(withRapier)).resolves.toEqual({ failed: [] });
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/Rapier failed to load/),
      expect.anything(),
    );
    expect(instance.loadScene(withRapier)).toMatchObject({ reason: "physics-not-loaded" });
    fail = false;
    await instance.preload(withRapier);
    expect(load).toHaveBeenCalledTimes(2);
    expect(instance.loadScene(withRapier).ok).toBe(true);
    warn.mockRestore();
  });
});

describe("isExpandedScene", () => {
  it("tells a document from its expansion", () => {
    expect(isExpandedScene(sceneA)).toBe(false);
    expect(isExpandedScene(expandScene(sceneA, registry))).toBe(true);
  });
});

describe("loadScene", () => {
  it("loads a definition exactly as its expandScene output", async () => {
    const rec = recordingGame();
    const game = await makeGame({ game: rec.game });

    const fromDef = game.loadScene(sceneA);
    const runtimeDef = rec.last().runtime;
    const defScene = runtimeDef.scene();
    const defSnapshots = play(runtimeDef, 240);
    const defStats = runtimeDef.stats();

    const fromExpanded = game.loadScene(expandScene(sceneA, game.registry));
    const runtimeExp = rec.last().runtime;
    expect(runtimeExp).not.toBe(runtimeDef);
    const expScene = runtimeExp.scene();
    const expSnapshots = play(runtimeExp, 240);

    expect(fromDef.ok).toBe(true);
    expect(withoutMs(fromExpanded)).toStrictEqual(withoutMs(fromDef));
    expect(expScene).toStrictEqual(defScene);
    expect(expSnapshots).toStrictEqual(defSnapshots);
    expect(runtimeExp.stats()).toStrictEqual(defStats);
  });

  it("accepts a definition as the start-up scene", async () => {
    const rec = recordingGame();
    const game = await makeGame({ game: rec.game, scene: sceneA });
    expect(rec.last().runtime.scene()).toStrictEqual(expandScene(sceneA, game.registry));
  });

  it("reports a document that fails to expand and keeps the current scene", async () => {
    const rec = recordingGame();
    const game = await makeGame({ game: rec.game, scene: sceneA });
    const before = rec.last().runtime;
    const report = game.loadScene({ ...sceneB, game: "another-game" });
    expect(report).toMatchObject({ ok: false, error: expect.stringMatching(/another-game/) });
    expect(rec.attached).toHaveLength(1);
    expect(before.scene()?.name).toBe("engine-yard");
  });
});

describe("debug overlay rebinding", () => {
  it("binds each loaded runtime's world, so after A then B it reads B", async () => {
    const frames = manualFrames();
    const rec = recordingGame();
    const overlay = recordingOverlay();
    const game = await makeGame({ game: rec.game, dev: true, debug: overlay.factory });

    game.loadScene(sceneA);
    const a = rec.last().runtime;
    const aColliders = a.stats().colliders;
    game.loadScene(sceneB);
    const b = rec.last().runtime;

    expect(overlay.bound).toEqual([a.ctx, null, b.ctx]);
    expect(overlay.bound.at(-1)!.physics).toBe(b.ctx.physics);

    game.start();
    frames.advance(0);
    frames.advance(TICK_MS + 1);
    expect(overlay.colliders).toEqual([b.stats().colliders]);
    expect(b.stats().colliders).not.toBe(aColliders);

    game.unloadScene();
    expect(overlay.bound.at(-1)).toBeNull();
    frames.advance(TICK_MS + 1);
    expect(overlay.colliders.at(-1)).toBeNull();
  });

  it("keeps the current binding when a load fails", async () => {
    const rec = recordingGame();
    const overlay = recordingOverlay();
    const game = await makeGame({ game: rec.game, dev: true, debug: overlay.factory });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    game.loadScene(sceneB);
    const b = rec.last().runtime;
    const broken = expandScene(sceneB, game.registry);
    const report = game.loadScene({
      ...broken,
      entities: [broken.entities[0]!, broken.entities[0]!],
    });

    expect(report.ok).toBe(false);
    expect(overlay.bound).toEqual([b.ctx]);
    warn.mockRestore();
  });
});

describe("input target and router", () => {
  const keydown = (key: string) => new KeyboardEvent("keydown", { key, bubbles: true });
  const keyEvent = (key: string): ToolEvent => ({
    kind: "key",
    type: "down",
    key,
    native: keydown(key),
  });

  it("defaults to the canvas, made focusable and focused on start", async () => {
    const rec = recordingGame();
    const game = await makeGame({ game: rec.game });
    expect(canvas.tabIndex).toBe(0);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    game.start();
    expect(document.activeElement).toBe(canvas);
  });

  it("leaves a tabindex the host set", async () => {
    canvas.tabIndex = -1;
    await makeGame({ game: recordingGame().game });
    expect(canvas.getAttribute("tabindex")).toBe("-1");
  });

  it("registers play input and hands games and the editor the same router", async () => {
    const rec = recordingGame();
    const game = await makeGame({ game: rec.game, scene: sceneA });
    expect(rec.last().shell.router).toBe(game.router);
    expect(game.router.dispatch(keyEvent("d"))).toBe("play");

    const editor = vi.fn();
    const unregister = game.router.register({
      id: "editor:test",
      priority: TOOL_PRIORITY.editor,
      accepts: (e) => e.kind === "key",
      handle: editor,
    });
    expect(game.router.dispatch(keyEvent("d"))).toBe("editor:test");
    unregister();
    expect(game.router.dispatch(keyEvent("d"))).toBe("play");
  });

  it("listens on the input target once started, and stops on destroy", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const host = document.createElement("div");
    host.tabIndex = 0;
    document.body.appendChild(host);
    const game = await makeGame({ game: recordingGame().game, inputTarget: host });
    const seen = vi.fn();
    game.router.register({
      id: "spy",
      priority: TOOL_PRIORITY.editor,
      accepts: (e) => e.kind === "key",
      handle: (e) => seen(e.kind === "key" ? e.key : null),
    });

    host.dispatchEvent(keydown("a"));
    expect(seen).not.toHaveBeenCalled();

    game.start();
    expect(canvas.hasAttribute("tabindex")).toBe(false);
    expect(document.activeElement).toBe(host);
    canvas.dispatchEvent(keydown("b"));
    window.dispatchEvent(keydown("c"));
    host.dispatchEvent(keydown("d"));
    expect(seen.mock.calls).toEqual([["d"]]);

    game.destroy();
    host.dispatchEvent(keydown("e"));
    expect(seen.mock.calls).toEqual([["d"]]);
  });

  it("refocuses the input target when play resumes", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const game = await makeGame({ game: recordingGame().game });
    game.start();
    game.setMode("edit");
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    game.setMode("play");
    expect(document.activeElement).toBe(canvas);
  });
});

describe("preload and the scene's textures", () => {
  const kinds = createKindRegistry(testGame);
  const sha = (n: number) => n.toString(16).padStart(64, "0") as Sha256;
  const texture = (id: string, n: number): AssetEntry => ({
    key: id,
    id,
    kind: "texture",
    path: `art/${id}.png`,
    sha256: sha(n),
    bytes: 10 * n,
    meta: { format: "png", width: 2, height: 2 },
    created: { at: 0, by: "test" },
  });
  const view = projectView(
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: Object.fromEntries([texture("sky", 1), texture("ground", 2)].map((e) => [e.key, e])),
      history: {},
      code: {},
      build: {},
    },
    kinds,
  );
  const sky: SceneDefinition = { ...sceneB, name: "sky", assets: ["sky"] };
  const ground: SceneDefinition = { ...sceneB, name: "ground", assets: ["ground", "sky"] };

  function setup() {
    const fetched: string[] = [];
    vi.spyOn(Assets, "load").mockImplementation((async (asset: { src: string }) => {
      fetched.push(asset.src);
      return { width: 2, height: 2, source: { pixelWidth: 2, pixelHeight: 2 } } as Texture;
    }) as typeof Assets.load);
    vi.spyOn(Assets, "unload").mockImplementation(async () => {});
    const loader = createAssetLoader({ project: "p", url: (_p, e) => `/blob/${e.sha256}` });
    return { loader, fetched, assets: { loader, view, kinds } };
  }

  afterEach(() => vi.restoreAllMocks());

  it("loads a definition's header textures, then loadScene draws with them resident", async () => {
    const { loader, fetched, assets } = setup();
    const game = await makeGame({ game: testGame, assets });
    const progress: number[] = [];

    expect(await game.preload(sky, (p) => progress.push(p.loaded))).toEqual({ failed: [] });
    expect(fetched).toEqual([`/blob/${sha(1)}`]);
    expect(progress.at(-1)).toBe(1);
    expect(loader.get(sha(1))).not.toBeNull();

    expect(game.loadScene(sky).ok).toBe(true);
    expect(fetched).toHaveLength(1);
    expect(loader.stats().resident).toEqual(["project", "sky"]);
  });

  it("retains the loaded scene's bundle and releases the previous one", async () => {
    const { loader, assets } = setup();
    const game = await makeGame({ game: testGame, assets });

    await game.preload(sky);
    game.loadScene(sky);
    await game.preload(ground);
    game.loadScene(ground);
    expect(loader.stats().resident).toEqual(["ground", "project"]);

    game.unloadScene();
    expect(loader.stats().resident).toEqual(["project"]);
    game.destroy();
    expect(loader.stats().resident).toEqual([]);
  });

  it("fetches what loadScene needs when nothing preloaded it", async () => {
    const { loader, fetched, assets } = setup();
    const game = await makeGame({ game: testGame, assets });
    const arrived: Sha256[] = [];
    loader.onLoad((h) => arrived.push(h));

    expect(game.loadScene(ground).ok).toBe(true);
    await vi.waitFor(() => expect(arrived).toHaveLength(2));
    expect(fetched.sort()).toEqual([`/blob/${sha(1)}`, `/blob/${sha(2)}`]);
  });

  it("bundles an expanded scene's entities and settings only, with no header", async () => {
    const { fetched, assets } = setup();
    const game = await makeGame({ game: testGame, assets });
    expect(await game.preload(expandScene(sky, game.registry))).toEqual({ failed: [] });
    expect(fetched).toEqual([]);
  });

  it("keeps the edit scene's textures through Play and back", async () => {
    const { loader, assets } = setup();
    const game = await makeGame({ game: testGame, assets });
    game.loadScene(sky);
    expect(game.play(ground).ok).toBe(true);
    expect(loader.stats().resident).toEqual(["ground", "project", "sky"]);
    game.stop();
    expect(loader.stats().resident).toEqual(["project", "sky"]);
  });

  it("without config.assets resolves with nothing failed and retains nothing", async () => {
    const { loader, fetched } = setup();
    const game = await makeGame({ game: testGame });
    expect(await game.preload(sky)).toEqual({ failed: [] });
    expect(game.loadScene(sky).ok).toBe(true);
    expect(fetched).toEqual([]);
    expect(loader.stats()).toEqual({ textures: 0, bytes: 0, resident: [] });
  });
});

describe("render frames", () => {
  it("interpolate in play and render at alpha 1 paused or editing", async () => {
    const frames = manualFrames();
    const game = await makeGame({ game: recordingGame().game });
    game.loadScene(sceneB);
    game.setMode("play");
    game.start();
    frames.advance(0);
    frames.advance(TICK_MS * 1.5);
    expect(frameAlphas.at(-1)).toBeCloseTo(0.5);

    game.pause();
    frames.advance(TICK_MS / 2);
    expect(frameAlphas.at(-1)).toBe(1);

    game.resume();
    game.setMode("edit");
    const before = frameAlphas.length;
    frames.advance(TICK_MS / 2);
    frames.advance(TICK_MS * 1.5);
    expect(frameAlphas.length).toBeGreaterThan(before);
    expect(frameAlphas.slice(before).every((a) => a === 1)).toBe(true);
  });
});

describe("the clock", () => {
  type Step = { dtMs: number; actions: string[]; commands: GameCommand[] };

  /** The test game on `time`, logging each step; `busy` is read through `state`. */
  function timedGame(time: TimeModel) {
    const steps: Step[] = [];
    const state = { busy: false };
    const game: GameDefinition = {
      ...testGame,
      time,
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        return {
          ...base,
          beforeStep(dtMs, actions, commands) {
            steps.push({
              dtMs,
              actions: actions.map((a) => `${a.action}:${a.pressed ? 1 : 0}`),
              commands: [...commands],
            });
            base.beforeStep?.(dtMs, actions, commands);
          },
          busy: () => state.busy,
        };
      },
    };
    return { game, steps, state };
  }

  const press = (game: GameInstance, key: string, type: "down" | "up" = "down") =>
    game.router.dispatch({
      kind: "key",
      type,
      key,
      native: new KeyboardEvent(type === "down" ? "keydown" : "keyup", { key, bubbles: true }),
    });

  async function playing(time: TimeModel) {
    const frames = manualFrames();
    const timed = timedGame(time);
    const game = await makeGame({ game: timed.game });
    expect(game.play(sceneB).ok).toBe(true);
    game.start();
    frames.advance(0);
    return { ...timed, game, frames };
  }

  /** `ms` of wall time in 120 Hz frames. */
  function wall(frames: ReturnType<typeof manualFrames>, ms: number) {
    for (let t = 0; t < ms; t += 1000 / 120) frames.advance(1000 / 120);
  }

  it("gives a 30 Hz game 33.33… ms ticks, 30 a wall second", async () => {
    const { steps, frames, game } = await playing({ kind: "fixed", rate: 30 });
    expect(game.getStore().state.mode).toBe("play");
    wall(frames, 1000);
    expect(steps).toHaveLength(30);
    expect(steps.every((s) => s.dtMs === 1000 / 30)).toBe(true);
    expect(steps[0]!.dtMs).toBeCloseTo(33.333, 3);
  });

  it("ignores targetFPS", async () => {
    const frames = manualFrames();
    const { game, steps } = timedGame({ kind: "fixed", rate: 30 });
    const instance = await makeGame({ game, targetFPS: 144 });
    instance.play(sceneB);
    instance.start();
    frames.advance(0);
    wall(frames, 1000);
    expect(steps).toHaveLength(30);
  });

  it("idles a turns game: no ticks for wall time or key edges, frames at alpha 1", async () => {
    const { steps, frames, game } = await playing({ kind: "turns", rate: 30 });
    const before = frameAlphas.length;
    wall(frames, 1000);
    press(game, "d");
    wall(frames, 500);
    expect(steps).toHaveLength(0);
    expect(game.getStore().state.tick).toBe(0);
    expect(frameAlphas.length).toBeGreaterThan(before);
    expect(frameAlphas.slice(before).every((a) => a === 1)).toBe(true);
  });

  it("step(n) simulates a turns game with nothing waking it, delivering the held keys", async () => {
    const { steps, game } = await playing({ kind: "turns", rate: 30 });
    press(game, "d");
    game.step(2);
    expect(steps.map((s) => s.actions)).toEqual([["right:1"], []]);
  });

  it("wakes an event game for one tick on a key edge, with edges in arrival order", async () => {
    const { steps, frames, game } = await playing({ kind: "event", rate: 30 });
    wall(frames, 500);
    expect(steps).toHaveLength(0);
    press(game, "d");
    press(game, "a");
    frames.advance(1000 / 120);
    expect(steps.map((s) => s.actions)).toEqual([["right:1", "left:1"]]);
    wall(frames, 500);
    expect(steps).toHaveLength(1);
    press(game, "d", "up");
    frames.advance(1000 / 120);
    expect(steps.map((s) => s.actions)).toEqual([["right:1", "left:1"], ["right:0"]]);
  });

  it("wakes an event game on a pointer move only with wakeOnPointerMove", async () => {
    const move = (game: GameInstance, x: number) =>
      game.router.dispatch({
        kind: "pointer",
        type: "move",
        screen: { x, y: 10 },
        button: 0,
        deltaY: 0,
        native: new MouseEvent("pointermove"),
      });
    const still = await playing({ kind: "event" });
    move(still.game, 40);
    wall(still.frames, 100);
    expect(still.steps).toHaveLength(0);

    const hover = await playing({ kind: "event", wakeOnPointerMove: true });
    move(hover.game, 40);
    wall(hover.frames, 100);
    expect(hover.steps).toHaveLength(1);
    move(hover.game, 40);
    wall(hover.frames, 100);
    expect(hover.steps).toHaveLength(1);
  });

  it("keeps a woken game stepping at its rate while busy, then idles", async () => {
    const { steps, frames, game, state } = await playing({ kind: "event", rate: 30 });
    press(game, "d");
    state.busy = true;
    frames.advance(1000 / 120);
    expect(steps).toHaveLength(1);
    wall(frames, 1000);
    expect(steps).toHaveLength(31);
    state.busy = false;
    wall(frames, 1000);
    expect(steps).toHaveLength(31);
  });

  describe("catch-up", () => {
    let hidden = false;
    let now = 0;

    beforeEach(() => {
      hidden = false;
      now = 0;
      Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
      vi.spyOn(performance, "now").mockImplementation(() => now);
    });

    afterEach(() => {
      delete (document as { hidden?: boolean }).hidden;
      vi.restoreAllMocks();
    });

    function hideFor(ms: number) {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      now += ms;
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    }

    const elapsed = (steps: Step[]) =>
      steps.flatMap((s) => s.commands).filter((c) => c.name === "@elapsed");

    it("queues one @elapsed clamped to maxMs for a hidden tab, which wakes a turns game", async () => {
      const { steps, frames } = await playing({ kind: "turns", catchUp: { maxMs: 2000 } });
      hideFor(10_000);
      wall(frames, 100);
      expect(elapsed(steps)).toEqual([{ name: "@elapsed", args: { ms: 2000 } }]);
      expect(steps).toHaveLength(1);
    });

    it("passes the time away whole when it is under maxMs, and skips a short absence", async () => {
      const { steps, frames } = await playing({ kind: "fixed", catchUp: { maxMs: 60_000 } });
      hideFor(500);
      wall(frames, 100);
      expect(elapsed(steps)).toEqual([]);
      hideFor(4321.7);
      wall(frames, 100);
      expect(elapsed(steps)).toEqual([{ name: "@elapsed", args: { ms: 4321 } }]);
    });

    it("queues nothing without catchUp", async () => {
      const { steps, frames, game } = await playing({ kind: "fixed" });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      hideFor(10_000);
      game.elapse(10_000);
      wall(frames, 100);
      expect(steps.length).toBeGreaterThan(0);
      expect(elapsed(steps)).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });

    it("elapse queues the same command, and warns in dev without catchUp", async () => {
      const { steps, frames, game } = await playing({ kind: "turns", catchUp: { maxMs: 1000 } });
      game.elapse(250);
      game.elapse(9000);
      wall(frames, 100);
      expect(elapsed(steps)).toEqual([
        { name: "@elapsed", args: { ms: 250 } },
        { name: "@elapsed", args: { ms: 1000 } },
      ]);
      expect(steps).toHaveLength(1);

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const plain = await makeGame({ game: timedGame({ kind: "fixed" }).game, dev: true });
      plain.elapse(1000);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/elapse\(1000\).*catchUp/));
    });

    it("drops what was queued at Stop", async () => {
      const { steps, frames, game } = await playing({ kind: "turns", catchUp: { maxMs: 1000 } });
      game.elapse(500);
      game.stop();
      expect(game.play(sceneB).ok).toBe(true);
      wall(frames, 100);
      expect(steps).toHaveLength(0);
    });
  });
});

// @vitest-environment jsdom
import { Assets, Container, type Texture } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { DebugOverlayFactory, DebugSceneSource } from "../debug";
import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import type { TimeModel } from "../game/time";
import type { GameCommand, GameDefinition, GameShell } from "../game/types";
import { createKindRegistry } from "../project/kinds";
import { INPUT_MAP_KIND, INPUT_MAP_VERSION } from "../project/kinds/input-map";
import type { ProjectRuntimeView } from "../project/runtime-view";
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

describe("devices", () => {
  type Pad = { axes: number[]; pressed: boolean[] };
  /** A standard pad behind a fake `navigator.getGamepads`, counting its reads. */
  function fakePads() {
    const pad: Pad = { axes: [0, 0, 0, 0], pressed: Array.from({ length: 17 }, () => false) };
    const reads = { count: 0 };
    const getGamepads = () => {
      reads.count++;
      return [
        {
          index: 0,
          id: "fake",
          mapping: "standard",
          connected: true,
          buttons: pad.pressed.map((pressed) => ({ pressed, value: pressed ? 1 : 0 })),
          axes: [...pad.axes],
        },
      ];
    };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: getGamepads });
    return { pad, reads };
  }

  afterEach(() => {
    delete (navigator as { getGamepads?: unknown }).getGamepads;
    vi.restoreAllMocks();
  });

  /** The test game plus a pad stick axis, a pad button, pointer buttons and a touch button. */
  function deviceGame(time: TimeModel = { kind: "fixed" }) {
    const steps: string[][] = [];
    const mouse: { x: number; y: number }[] = [];
    const game: GameDefinition = {
      ...testGame,
      time,
      actions: [
        ...testGame.actions!,
        {
          action: "steer",
          kind: "axis",
          description: "Steer.",
          bindings: [{ device: "pad", axis: "left-x" }],
        },
        {
          action: "jump",
          description: "Jump.",
          bindings: [
            { device: "pad", button: "south" },
            { device: "key", code: "KeyJ" },
            { device: "touch", control: "jump" },
          ],
        },
        {
          action: "poke",
          description: "Poke.",
          bindings: [{ device: "pointer", button: "primary" }],
        },
      ],
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        return {
          ...base,
          // A still camera, so one screen point stays one world point.
          cameraTarget: () => null,
          beforeStep(dtMs, actions, commands) {
            steps.push(actions.map((a) => `${a.action}:${a.value ?? (a.pressed ? 1 : 0)}`));
            base.beforeStep?.(dtMs, actions, commands);
          },
        };
      },
      attach: () => ({ onTick: (_dt, at) => void mouse.push(at), destroy() {} }),
    };
    return { game, steps, mouse };
  }

  /** The `TickInput` of every step the shell takes. */
  function spySteps(game: GameInstance) {
    const inputs: { pointers: unknown[]; actions: string[] }[] = [];
    const runtime = game.runtime()!;
    const step = runtime.step;
    runtime.step = (dt, input, commands) => {
      if (!Array.isArray(input))
        inputs.push({ pointers: [...input.pointers], actions: input.actions.map((a) => a.action) });
      return step(dt, input, commands);
    };
    return inputs;
  }

  const pointer = (
    game: GameInstance,
    type: "down" | "move" | "up",
    x: number,
    y: number,
    extra: Partial<Extract<ToolEvent, { kind: "pointer" }>> = {},
  ) =>
    game.router.dispatch({
      kind: "pointer",
      type,
      screen: { x, y },
      button: type === "move" ? -1 : 0,
      deltaY: 0,
      native: new MouseEvent(`pointer${type}`),
      ...extra,
    });

  it("polls the pads once per simulated tick, and not while editing", async () => {
    const frames = manualFrames();
    const { reads } = fakePads();
    const { game: def, steps } = deviceGame({ kind: "fixed", rate: 30 });
    const game = await makeGame({ game: def });
    game.start();
    game.stop();
    frames.advance(0);
    for (let t = 0; t < 500; t += 1000 / 120) frames.advance(1000 / 120);
    expect(reads.count).toBe(0);

    expect(game.play(sceneB).ok).toBe(true);
    for (let t = 0; t < 1000; t += 1000 / 120) frames.advance(1000 / 120);
    expect(steps.length).toBeGreaterThan(25);
    expect(reads.count).toBe(steps.length);
  });

  it("turns pad changes into actions, combined with the keyboard's", async () => {
    const { pad } = fakePads();
    const { game: def, steps } = deviceGame();
    const game = await makeGame({ game: def });
    game.play(sceneB);
    pad.axes[0] = 0.6;
    pad.pressed[0] = true;
    game.step();
    game.router.dispatch({
      kind: "key",
      type: "down",
      key: "j",
      code: "KeyJ",
      native: new KeyboardEvent("keydown", { key: "j", code: "KeyJ" }),
    });
    pad.pressed[0] = false;
    game.step();
    game.step();
    expect(steps[0]).toEqual(expect.arrayContaining(["steer:0.529", "jump:1"]));
    // J still holds jump when the pad lets go, so nothing changes.
    expect(steps.slice(1)).toEqual([[], []]);
  });

  it("queues a pointer sample only on ticks where it changed, and hands the attachment its position", async () => {
    const { game: def, mouse } = deviceGame();
    const game = await makeGame({ game: def });
    game.play(sceneB);
    const inputs = spySteps(game);
    game.step();
    pointer(game, "move", 40, 10);
    game.step(3);
    pointer(game, "move", 40, 10);
    game.step();
    pointer(game, "down", 40, 10);
    game.step();
    pointer(game, "move", 60, 10);
    game.step();

    const at = game.screenToWorld({ x: 40, y: 10 });
    const sample = (x: number, buttons: number) => [
      { x: expect.closeTo(x, 4), y: expect.closeTo(at.y, 4), buttons, over: true },
    ];
    const moved = game.screenToWorld({ x: 60, y: 10 });
    expect(inputs.map((i) => i.pointers)).toEqual([
      [],
      sample(at.x, 0),
      [],
      [],
      [],
      sample(at.x, 1),
      sample(moved.x, 1),
    ]);
    expect(inputs[5]!.actions).toEqual(["poke"]);
    const last = inputs[6]!.pointers[0] as { x: number; y: number };
    // Quantised to 1/10,000 m, and what the attachment saw that tick.
    expect(last.x).toBe(Math.round(last.x * 10_000) / 10_000);
    expect(mouse.at(-1)).toEqual({ x: last.x, y: last.y });
  });

  it("wakes an event game on an analog change, and never a turns game", async () => {
    const frames = manualFrames();
    const { pad } = fakePads();
    const { game: def, steps } = deviceGame({ kind: "event", rate: 30 });
    const game = await makeGame({ game: def });
    game.play(sceneB);
    game.start();
    frames.advance(0);
    for (let t = 0; t < 300; t += 1000 / 120) frames.advance(1000 / 120);
    expect(steps).toHaveLength(0);
    pad.axes[0] = -1;
    frames.advance(1000 / 120);
    expect(steps).toEqual([["steer:-1"]]);
    for (let t = 0; t < 300; t += 1000 / 120) frames.advance(1000 / 120);
    expect(steps).toHaveLength(1);
    pointer(game, "move", 30, 30);
    frames.advance(1000 / 120);
    expect(steps).toHaveLength(1);
    pointer(game, "down", 30, 30);
    frames.advance(1000 / 120);
    expect(steps.at(-1)).toEqual(["poke:1"]);

    const turns = deviceGame({ kind: "turns", rate: 30 });
    const other = await makeGame({ game: turns.game });
    other.play(sceneB);
    other.start();
    pad.axes[0] = 0.8;
    for (let t = 0; t < 300; t += 1000 / 120) frames.advance(1000 / 120);
    expect(turns.steps).toHaveLength(0);
  });

  describe("touch controls", () => {
    const inputMap: ProjectRuntimeView["inputMap"] = {
      kind: INPUT_MAP_KIND,
      v: INPUT_MAP_VERSION,
      touch: [{ id: "jump", kind: "button", action: "jump", at: [0.1, 0.1], radius: 0.1 }],
    };
    const project: ProjectRuntimeView = {
      settings: {},
      engine: {},
      table: () => [],
      asset: () => undefined,
      inputMap,
    };
    const overlay = () => document.querySelector<HTMLElement>("[data-touch-controls]");
    const rect = { left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500 };

    beforeEach(() => {
      const box = () => ({ ...rect, x: 0, y: 0, toJSON() {} });
      document.body.getBoundingClientRect = box;
      canvas.getBoundingClientRect = box;
    });

    function coarse(matches: boolean) {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query === "(pointer: coarse)" && matches,
        addEventListener() {},
        removeEventListener() {},
      }));
    }

    it('mounts the overlay with touch: "always", shown in play only', async () => {
      const game = await makeGame({
        game: deviceGame().game,
        project,
        input: { touch: "always" },
      });
      expect(overlay()?.parentElement).toBe(canvas.parentElement);
      game.play(sceneB);
      expect(overlay()!.style.display).toBe("");
      game.stop();
      expect(overlay()!.style.display).toBe("none");
      game.destroy();
      expect(overlay()).toBeNull();
    });

    it('follows a coarse pointer with "auto", and mounts nothing with "never"', async () => {
      coarse(false);
      const fine = await makeGame({ game: deviceGame().game, project });
      fine.play(sceneB);
      expect(overlay()!.style.display).toBe("none");
      fine.destroy();

      coarse(true);
      const touchy = await makeGame({ game: deviceGame().game, project, input: { touch: "auto" } });
      touchy.play(sceneB);
      expect(overlay()!.style.display).toBe("");
      touchy.destroy();

      await makeGame({ game: deviceGame().game, project, input: { touch: "never" } });
      expect(overlay()).toBeNull();
    });

    it("drives the control under a touch, and makes a touch away from every control the pointer", async () => {
      const { game: def, steps } = deviceGame();
      const game = await makeGame({ game: def, project, input: { touch: "always" } });
      game.play(sceneB);
      const inputs = spySteps(game);
      const node = document.querySelector<HTMLElement>('[data-touch-control="jump"]')!;
      node.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 3,
          pointerType: "touch",
          clientX: 50,
          clientY: 50,
          bubbles: true,
          cancelable: true,
        }),
      );
      game.step();
      expect(steps.at(-1)).toEqual(["jump:1"]);

      const touch = { pointerType: "touch" as const };
      // On the control (its centre is 0.1 of the shorter side in): the control's, not the pointer's.
      pointer(game, "down", 50, 50, { ...touch, pointerId: 4 });
      game.step();
      expect(inputs.at(-1)!.pointers).toEqual([]);
      expect(steps.at(-1)).toEqual([]);

      pointer(game, "down", 800, 400, { ...touch, pointerId: 5 });
      game.step();
      expect(steps.at(-1)).toEqual(["poke:1"]);
      expect(inputs.at(-1)!.pointers).toEqual([expect.objectContaining({ buttons: 1 })]);
    });
  });
});

describe("seats", () => {
  /** Standard pads behind a fake `navigator.getGamepads`; a pad is listed while `connected`. */
  function fakePads(count: number) {
    const pads = Array.from({ length: count }, (_, index) => ({
      index,
      connected: true,
      pressed: Array.from({ length: 17 }, () => false),
    }));
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () =>
        pads.map((p) =>
          p.connected
            ? {
                index: p.index,
                id: `fake-${p.index}`,
                mapping: "standard",
                connected: true,
                buttons: p.pressed.map((pressed) => ({ pressed, value: pressed ? 1 : 0 })),
                axes: [0, 0, 0, 0],
              }
            : null,
        ),
    });
    return pads;
  }

  afterEach(() => {
    delete (navigator as { getGamepads?: unknown }).getGamepads;
  });

  /** Two seats: WASD's left and right for seat 0, the arrows' for seat 1, and a pad button for whichever seat holds the pad. */
  function twoSeatGame(join: "auto" | "press" | "host") {
    const steps: string[][] = [];
    const joins: string[][] = [];
    const game: GameDefinition = {
      ...testGame,
      input: { players: { max: 2, join } },
      actions: [
        {
          action: "left",
          description: "Walk left.",
          bindings: [
            { device: "key", code: "KeyA", player: 0 },
            { device: "key", code: "ArrowLeft", player: 1 },
          ],
        },
        {
          action: "right",
          description: "Walk right.",
          bindings: [
            { device: "key", code: "KeyD", player: 0 },
            { device: "key", code: "ArrowRight", player: 1 },
          ],
        },
        { action: "push", description: "Push.", bindings: [{ device: "key", code: "Space" }] },
        { action: "jump", description: "Jump.", bindings: [{ device: "pad", button: "south" }] },
      ],
      createRuntime(ctx) {
        const base = testGame.createRuntime(ctx);
        return {
          ...base,
          beforeStep(dtMs, actions, commands) {
            steps.push(actions.map((a) => `${a.action}@${a.player ?? 0}:${a.pressed ? 1 : 0}`));
            base.beforeStep?.(dtMs, actions, commands);
          },
        };
      },
    };
    return { game, steps, joins };
  }

  /** Each step's `TickInput.joins`, as `device>seat` or `device<seat`. */
  function spyJoins(game: GameInstance) {
    const joins: string[][] = [];
    const runtime = game.runtime()!;
    const step = runtime.step;
    runtime.step = (dt, input, commands) => {
      if (!Array.isArray(input))
        joins.push(input.joins.map((j) => `${j.device}${j.joined ? ">" : "<"}${j.player}`));
      return step(dt, input, commands);
    };
    return joins;
  }

  const key = (game: GameInstance, code: string, type: "down" | "up" = "down") =>
    game.router.dispatch({
      kind: "key",
      type,
      key: code,
      code,
      native: new KeyboardEvent(`key${type}`, { code }),
    });

  it("drives seat 0 from WASD and seat 1 from the arrows on one keyboard", async () => {
    const { game: def, steps } = twoSeatGame("auto");
    const game = await makeGame({ game: def });
    game.play(sceneB);
    key(game, "KeyA");
    key(game, "ArrowRight");
    game.step();
    key(game, "KeyA", "up");
    key(game, "ArrowLeft");
    key(game, "Space");
    game.step();
    expect(steps).toEqual([
      ["left@0:1", "right@1:1"],
      // A binding without a seat follows the keyboard's owner, seat 0; a
      // tick's actions reach the game seat by seat, as a replay decodes them.
      ["left@0:0", "push@0:1", "left@1:1"],
    ]);
  });

  it('seats a pad by its first press under "press", after the keyboard took seat 0', async () => {
    const pads = fakePads(1);
    const { game: def, steps } = twoSeatGame("press");
    const game = await makeGame({ game: def });
    game.play(sceneB);
    const joins = spyJoins(game);
    expect(game.input.players().map((p) => p.joined)).toEqual([false, false]);

    key(game, "KeyD");
    game.step();
    pads[0]!.pressed[0] = true;
    game.step();
    game.step();
    expect(joins).toEqual([["keyboard>0"], ["pad:0>1"], []]);
    // The press that seats the pad is already that seat's.
    expect(steps).toEqual([["right@0:1"], ["jump@1:1"], []]);
    expect(game.input.players()).toEqual([
      { index: 0, devices: ["keyboard"], joined: true },
      { index: 1, devices: ["pad:0"], joined: true },
    ]);
  });

  it('gives pads free seats in connection order under "auto", and frees a disconnected pad\'s seat', async () => {
    const pads = fakePads(2);
    const { game: def, steps } = twoSeatGame("auto");
    const game = await makeGame({ game: def });
    game.play(sceneB);
    const joins = spyJoins(game);
    pads[0]!.pressed[0] = true;
    game.step();
    expect(joins[0]).toEqual(["pad:0>1"]);
    expect(game.input.players()[1]!.devices).toEqual(["pad:0"]);
    // Pad 1 has no free seat: it drives nothing.
    pads[1]!.pressed[0] = true;
    expect(steps.at(-1)).toEqual(["jump@1:1"]);

    pads[0]!.connected = false;
    game.step();
    // The pad is released on its seat, then the seat goes to the waiting pad.
    expect(joins[1]).toEqual(["pad:0<1", "pad:1>1"]);
    expect(steps.at(-1)).toEqual(["jump@1:0"]);
    // Held from before it had the seat, its button counts once it is pressed again.
    pads[1]!.pressed[0] = false;
    game.step();
    pads[1]!.pressed[0] = true;
    game.step();
    expect(steps.slice(-2)).toEqual([[], ["jump@1:1"]]);
  });

  it("keeps a held key reading through another device taking a seat", async () => {
    const pads = fakePads(1);
    pads[0]!.connected = false;
    const { game: def, steps } = twoSeatGame("auto");
    const game = await makeGame({ game: def });
    game.play(sceneB);
    key(game, "KeyD");
    game.step();
    pads[0]!.connected = true;
    game.step();
    expect(game.input.players()[1]!.devices).toEqual(["pad:0"]);
    key(game, "KeyD", "up");
    game.step();
    expect(steps).toEqual([["right@0:1"], [], ["right@0:0"]]);
  });

  it('lets the host assign devices under "host", refusing a seat past max', async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fakePads(1)[0]!.pressed[0] = true;
    const { game: def, steps } = twoSeatGame("host");
    const game = await makeGame({ game: def, dev: true });
    game.play(sceneB);
    const joins = spyJoins(game);
    game.step();
    expect(steps.at(-1)).toEqual([]);

    game.input.assign("pad:0", 0);
    game.input.assign("keyboard", 5);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("player-unknown"));
    game.step();
    expect(joins.at(-1)).toEqual(["pad:0>0"]);
    expect(game.input.players()[0]!.devices).toEqual(["pad:0"]);
    warn.mockRestore();
  });

  it("starts a new world with the live seats as its first tick's joins", async () => {
    fakePads(1)[0]!.pressed[0] = true;
    const { game: def } = twoSeatGame("auto");
    const game = await makeGame({ game: def });
    game.play(sceneB);
    game.step();
    expect(game.input.players()[1]!.devices).toEqual(["pad:0"]);
    game.stop();
    game.play(sceneB);
    const joins = spyJoins(game);
    game.step();
    game.step();
    expect(joins).toEqual([["pad:0>1"], []]);
  });

  it("keeps one seat's behaviour with max 1: every pad drives seat 0", async () => {
    fakePads(2).forEach((p) => (p.pressed[0] = true));
    const { game: def, steps } = twoSeatGame("auto");
    const game = await makeGame({
      game: { ...def, input: {}, actions: [...testGame.actions!, def.actions.at(-1)!] },
    });
    game.play(sceneB);
    game.step();
    expect(steps).toEqual([["jump@0:1"]]);
    expect(game.input.players()).toEqual([
      { index: 0, devices: ["keyboard", "pointer", "touch", "pad:0", "pad:1"], joined: true },
    ]);
  });
});

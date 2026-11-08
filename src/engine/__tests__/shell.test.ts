// @vitest-environment jsdom
import { Assets, Container, type Texture } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { DebugOverlayFactory, DebugSceneSource } from "../debug";
import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import type { GameDefinition, GameShell } from "../game/types";
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
      update: () => void colliders.push(source?.physics.world.colliders.len() ?? null),
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
  it("requires the host to inject Rapier", () => {
    // @ts-expect-error -- the engine has no default loader, so `rapier` is required.
    const config: Parameters<typeof createGame>[1] = { game: testGame };
    expect(config).not.toHaveProperty("rapier");
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

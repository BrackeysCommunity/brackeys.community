// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { DebugOverlayFactory, DebugSceneSource } from "../debug";
import { createGame } from "../engine";
import { createRegistry } from "../game/define";
import type { GameDefinition, GameShell } from "../game/types";
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
vi.mock("../assets", () => ({ initAssets: async () => {} }));

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

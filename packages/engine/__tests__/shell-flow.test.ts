// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { LibraryScene } from "../game/flow";
import type { GameDefinition } from "../game/types";
import { createKindRegistry } from "../project/kinds";
import { projectView } from "../project/view";
import type { AssetLoader, LoadProgress } from "../render/asset-loader";
import type { SceneRuntimeHandle, StepResult } from "../runtime/types";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../scene/types";
import type { GameConfig, GameInstance, SceneSource, TransitionRunner } from "../types";
import { mountUi } from "../ui/layer";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

type Trip = { trips: number };

const world = (game: GameInstance) => game.runtime() as SceneRuntimeHandle | null;

/** A physics-free game whose `go` command requests a scene; loads and unloads are logged. */
function flowGame(log: string[]): GameDefinition<{ ticks: number }> {
  return defineGame<{ ticks: number }>({
    id: "flowy",
    types: [],
    actions: [{ action: "jump", keys: [" "], description: "Jump." }],
    world: { physics: "none" },
    persist: {
      initial: () => ({ trips: 0 }),
      schema: z.strictObject({ trips: z.number().int().min(0) }),
    },
    commands: {
      go: {
        description: "Requests a scene.",
        args: z.strictObject({
          to: z.string().describe("The scene."),
          fade: z.boolean().optional().describe("Fade there."),
        }),
      },
    },
    createRuntime(ctx) {
      let ticks = 0;
      return {
        onLoad(scene) {
          ticks = 0;
          log.push(`load ${scene.name} ${JSON.stringify(ctx.persist.value)}`);
        },
        onUnload() {
          log.push("unload");
        },
        beforeStep(_dt, _actions, commands) {
          for (const c of commands) {
            if (c.name !== "go") continue;
            const args = c.args as { to: string; fade?: boolean };
            ctx.flow.request({
              to: args.to,
              persist: { trips: (ctx.persist.value as Trip).trips + 1 },
              ...(args.fade ? { transition: { kind: "fade", ms: 400 } } : {}),
            });
          }
        },
        afterStep() {
          ticks++;
        },
        snapshot: () => ({ ticks }),
      };
    },
  });
}

const scene = (name: string): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name,
  game: "flowy",
  bounds: [0, 0, 10, 10],
  entities: [{ id: "start", type: "marker", at: [1, 1] }],
});

function source(): SceneSource {
  const scenes = new Map<string, LibraryScene>(
    ["menu", "level", "cellar"].map((id) => [id, { def: scene(id), prefabs: new Map() }]),
  );
  return {
    list: () => [{ scene: "menu" }, { scene: "level" }, { scene: "cellar", sublevel: true }],
    start: () => "menu",
    scene: (id) => scenes.get(id) ?? null,
  };
}

/** A loader that resolves a flow preload (the call with a progress callback) after `ms`. */
function slowLoader(log: string[], ms: () => number): AssetLoader {
  const loader = {
    async load(_bundle: unknown, onProgress?: (p: LoadProgress) => void) {
      if (onProgress) {
        log.push("preload");
        onProgress({ loaded: 0, total: 2, bytes: 0, totalBytes: 20 });
        await new Promise((done) => setTimeout(done, ms()));
        onProgress({ loaded: 2, total: 2, bytes: 20, totalBytes: 20 });
      }
      return { failed: [] };
    },
    retain() {},
    release() {},
    texture: () => null,
    destroy() {},
  };
  return loader as unknown as AssetLoader;
}

const games: GameInstance[] = [];
let canvas: HTMLCanvasElement;
let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reduced && query.includes("reduced-motion"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Setup = {
  log: string[];
  preloadMs?: number;
  flow?: Partial<NonNullable<GameConfig["flow"]>>;
};

async function makeGame({ log, preloadMs = 0, flow = {} }: Setup): Promise<GameInstance> {
  const game = flowGame(log);
  const kinds = createKindRegistry(game);
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
  const instance = await createGame(canvas, {
    game,
    dev: true,
    assets: { loader: slowLoader(log, () => preloadMs), view, kinds },
    flow: { source: source(), ...flow },
  });
  games.push(instance);
  instance.start();
  return instance;
}

/** Restarts into the start scene, letting the change run to its end. */
async function started(game: GameInstance): Promise<void> {
  const done = game.flow.restart();
  await vi.runAllTimersAsync();
  expect(await done).toMatchObject({ ok: true, scene: "menu" });
}

/** A transition that logs each half and takes `ms` to run it. */
const timedRunner =
  (log: string[], ms = 100): TransitionRunner =>
  async (phase) => {
    log.push(phase);
    await new Promise((done) => setTimeout(done, ms));
  };

describe("a scene change in the shell", () => {
  it("runs out, unload, preload, load, in, in that order, then announces it", async () => {
    const log: string[] = [];
    const game = await makeGame({ log, flow: { transition: timedRunner(log) } });
    await started(game);
    const changes: unknown[] = [];
    game.on("flow:change", (e) => {
      log.push("change");
      changes.push(e);
    });
    log.length = 0;

    const done = game.flow.go("level", { transition: { kind: "fade" }, entry: "start" });
    await vi.runAllTimersAsync();
    expect(await done).toMatchObject({ ok: true, scene: "level" });
    expect(log).toEqual(["out", "unload", "preload", 'load level {"trips":0}', "in", "change"]);
    expect(changes).toEqual([{ from: "menu", to: "level", entry: "start" }]);
    expect(game.flow.current()).toBe("level");
    expect(world(game)?.ctx.flow.entry).toBe("start");
  });

  it("applies a game's request after its tick, with its persist", async () => {
    const log: string[] = [];
    const game = await makeGame({ log });
    await started(game);
    log.length = 0;

    expect(game.send({ name: "go", args: { to: "level" } })).toBe(true);
    game.step();
    await vi.runAllTimersAsync();
    expect(log).toEqual(["unload", "preload", 'load level {"trips":1}']);
    expect(game.flow.current()).toBe("level");
  });

  it("runs no tick while a change runs, and ticks again after it", async () => {
    const log: string[] = [];
    const game = await makeGame({ log, flow: { transition: timedRunner(log) } });
    await started(game);
    const steps: StepResult[] = [];
    game.on("scene:step", (r) => steps.push(r));

    game.send({ name: "go", args: { to: "level", fade: true } });
    game.step();
    expect(steps).toHaveLength(1);
    // The request stopped ticking at once: the rest of this burst steps nothing.
    game.step(5);
    await vi.advanceTimersByTimeAsync(50);
    game.step(5);
    expect(steps).toHaveLength(1);

    await vi.runAllTimersAsync();
    expect(game.flow.current()).toBe("level");
    game.step(2);
    expect(steps.map((s) => s.tick)).toEqual([0, 0, 1]);
  });

  it("makes a go during a change wait for it", async () => {
    const log: string[] = [];
    const game = await makeGame({ log, flow: { transition: timedRunner(log) } });
    await started(game);
    log.length = 0;

    const first = game.flow.go("level", { transition: { kind: "fade" } });
    const second = game.flow.go("menu", { transition: { kind: "fade" } });
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({ ok: true, scene: "level" });
    expect(await second).toMatchObject({ ok: true, scene: "menu" });
    expect(log.filter((l) => l !== "preload")).toEqual([
      "out",
      "unload",
      'load level {"trips":0}',
      "in",
      "out",
      "unload",
      'load menu {"trips":0}',
      "in",
    ]);
  });

  it("refuses an unlisted scene and a sublevel as scene-unlisted, and keeps playing", async () => {
    const log: string[] = [];
    const game = await makeGame({ log });
    await started(game);
    log.length = 0;

    const unlisted = await game.flow.go("nowhere");
    expect(unlisted).toMatchObject({
      ok: false,
      issue: { code: "scene-unlisted", severity: "error" },
    });
    expect(await game.flow.go("cellar")).toMatchObject({
      ok: false,
      issue: { code: "scene-unlisted" },
    });
    expect(log).toEqual([]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const steps: StepResult[] = [];
    game.on("scene:step", (r) => steps.push(r));
    game.send({ name: "go", args: { to: "nowhere" } });
    game.step(2);
    await vi.runAllTimersAsync();
    expect(steps).toHaveLength(2);
    expect(game.flow.current()).toBe("menu");
    expect(warn.mock.calls.some(([m]) => String(m).includes("nowhere"))).toBe(true);
  });

  it("restart resets persist and loads the start scene", async () => {
    const log: string[] = [];
    const game = await makeGame({ log });
    await started(game);

    game.send({ name: "go", args: { to: "level" } });
    game.step();
    await vi.runAllTimersAsync();
    expect(world(game)?.ctx.persist.value).toEqual({ trips: 1 });
    log.length = 0;

    const done = game.flow.restart();
    await vi.runAllTimersAsync();
    expect(await done).toMatchObject({ ok: true, scene: "menu" });
    expect(log).toEqual(["unload", "preload", 'load menu {"trips":0}']);
    expect(world(game)?.ctx.persist.value).toEqual({ trips: 0 });
  });
});

describe("transitions and the loading view", () => {
  const veil = () => document.querySelector<HTMLElement>("[data-jams-fade]");
  const overlay = () => document.querySelector("[data-jams-loading]");

  it("fades in a layer above the UI layer, so the fade covers the HUD", async () => {
    const log: string[] = [];
    const game = await makeGame({ log });
    await started(game);
    const unmount = mountUi(game, canvas, ({ root }) => {
      const hud = document.createElement("div");
      hud.style.zIndex = "4";
      root.append(hud);
      return { destroy: () => hud.remove() };
    });

    const done = game.flow.go("level", { transition: { kind: "fade", ms: 400 } });
    await vi.advanceTimersByTimeAsync(0);
    const ui = document.querySelector<HTMLElement>("[data-jams-ui]")!;
    const layer = document.querySelector<HTMLElement>("[data-jams-transition]")!;
    expect(layer.contains(veil())).toBe(true);
    // The UI layer contains its children's z-indexes; the transition layer sits above it.
    expect(ui.style.isolation).toBe("isolate");
    expect(Number(layer.style.zIndex)).toBeGreaterThan(0);
    expect(veil()!.style.transition).toBe("opacity 200ms linear");
    expect(veil()!.style.opacity).toBe("1");
    expect(game.flow.current()).toBe("menu");

    await vi.advanceTimersByTimeAsync(201);
    expect(game.flow.current()).toBe("level");
    expect(veil()!.style.opacity).toBe("0");
    await vi.advanceTimersByTimeAsync(200);
    expect(await done).toMatchObject({ ok: true });
    expect(veil()).toBeNull();
    unmount();
  });

  it("cuts instead of fading under the reduced motion the page asked for at createGame", async () => {
    const log: string[] = [];
    reduced = true;
    const game = await makeGame({ log });
    await started(game);
    expect(game.reducedMotion).toBe(true);
    let seen: { opacity: string; transition: string } | null = null;
    game.on("flow:loading", () => {
      const v = veil();
      seen ??= v ? { opacity: v.style.opacity, transition: v.style.transition } : null;
    });

    const done = game.flow.go("level", { transition: { kind: "fade", ms: 400 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(await done).toMatchObject({ ok: true, scene: "level" });
    expect(seen).toEqual({ opacity: "1", transition: "" });
    expect(veil()).toBeNull();
  });

  it("shows the loading view only once a preload passes 150 ms, then hides it", async () => {
    const log: string[] = [];
    const game = await makeGame({ log, preloadMs: 500 });
    await started(game);
    const progress: LoadProgress[] = [];
    game.on("flow:loading", (p) => progress.push(p));

    const done = game.flow.go("level");
    await vi.advanceTimersByTimeAsync(149);
    expect(overlay()).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(overlay()).not.toBeNull();
    expect(overlay()!.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow")).toBe("0");
    await vi.advanceTimersByTimeAsync(400);
    expect(await done).toMatchObject({ ok: true });
    expect(overlay()).toBeNull();
    expect(progress.at(-1)).toMatchObject({ loaded: 2, total: 2 });
  });

  it("never shows the loading view for a quick preload, nor with loading off", async () => {
    const log: string[] = [];
    const quick = await makeGame({ log, preloadMs: 100 });
    await started(quick);
    const shown = vi.fn();
    const watch = new MutationObserver(() => overlay() && shown());
    watch.observe(document.body, { childList: true, subtree: true });
    const done = quick.flow.go("level");
    await vi.runAllTimersAsync();
    expect(await done).toMatchObject({ ok: true });
    quick.destroy();

    const off = await makeGame({ log, preloadMs: 500, flow: { loading: false } });
    await started(off);
    const slow = off.flow.go("level");
    await vi.runAllTimersAsync();
    expect(await slow).toMatchObject({ ok: true });
    await Promise.resolve();
    watch.disconnect();
    expect(shown).not.toHaveBeenCalled();
  });
});

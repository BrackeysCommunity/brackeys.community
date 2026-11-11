// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import type { GameDefinition } from "../game/types";
import { browserRemapStore, memoryRemapStore, type RemapStore } from "../input/remap";
import { INPUT_MAP_KIND, INPUT_MAP_VERSION } from "../project/kinds/input-map";
import type { ProjectRuntimeView } from "../project/runtime-view";
import type { SceneDefinition } from "../scene/types";
import type { GameInstance, RapierModule } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
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

const scene: SceneDefinition = {
  v: 1,
  name: "floor-only",
  bounds: [0, 0, 5, 5],
  solid: [["box", 2.5, 4.9, 2.5, 0.1]],
};

const STORAGE_KEY = `jams-engine:remap:${testGame.id}`;

let rapier: RapierModule;
let canvas: HTMLCanvasElement;
const games: GameInstance[] = [];

beforeAll(async () => {
  rapier = await loadCompatRapier();
});

beforeEach(() => {
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  localStorage.clear();
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  delete (navigator as { getGamepads?: unknown }).getGamepads;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** The test game plus a pad-bound action, recording each step's actions. */
function remapGame() {
  const steps: string[][] = [];
  const game: GameDefinition = {
    ...testGame,
    actions: [
      ...testGame.actions!,
      {
        action: "jump",
        description: "Jump.",
        bindings: [
          { device: "key", code: "KeyJ" },
          { device: "pad", button: "south" },
        ],
      },
    ],
    createRuntime(ctx) {
      const base = testGame.createRuntime(ctx);
      return {
        ...base,
        beforeStep(dtMs, actions, commands) {
          steps.push(actions.map((a) => `${a.action}:${a.pressed ? 1 : 0}`));
          base.beforeStep?.(dtMs, actions, commands);
        },
      };
    },
  };
  return { game, steps };
}

async function makeGame(
  config: Partial<Parameters<typeof createGame>[1]> & { game: GameDefinition },
): Promise<GameInstance> {
  const instance = await createGame(canvas, { rapier: async () => rapier, ...config });
  games.push(instance);
  return instance;
}

const press = (game: GameInstance, code: string, type: "down" | "up" = "down") =>
  game.router.dispatch({
    kind: "key",
    type,
    key: code,
    code,
    native: new KeyboardEvent(`key${type}`, { code }),
  });

/** A standard pad behind a fake `navigator.getGamepads`. */
function fakePad() {
  const pressed = Array.from({ length: 17 }, () => false);
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () => [
      {
        index: 0,
        id: "fake",
        mapping: "standard",
        connected: true,
        buttons: pressed.map((p) => ({ pressed: p, value: p ? 1 : 0 })),
        axes: [0, 0, 0, 0],
      },
    ],
  });
  return pressed;
}

describe("rebind", () => {
  it("replaces an action's bindings, saves them at once and applies them from the next tick", async () => {
    const { game: def, steps } = remapGame();
    const game = await makeGame({ game: def, input: { remaps: browserRemapStore() } });
    game.play(scene);

    expect(game.input.rebind("jump", [{ device: "key", code: "KeyK" }])).toEqual({ ok: true });
    expect(game.input.bindings().jump).toEqual([{ device: "key", code: "KeyK" }]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      v: 1,
      players: { 0: { jump: [{ device: "key", code: "KeyK" }] } },
    });

    press(game, "KeyJ");
    game.step();
    press(game, "KeyK");
    game.step();
    expect(steps).toEqual([[], ["jump:1"]]);
  });

  it("is restored by a new createGame from the same store", async () => {
    const first = await makeGame({
      game: remapGame().game,
      input: { remaps: browserRemapStore() },
    });
    first.input.rebind("left", [{ device: "key", code: "ArrowLeft" }]);
    first.destroy();

    const { game: def, steps } = remapGame();
    const game = await makeGame({ game: def, input: { remaps: browserRemapStore() } });
    expect(game.input.bindings().left).toEqual([{ device: "key", code: "ArrowLeft" }]);
    game.play(scene);
    press(game, "ArrowLeft");
    game.step();
    expect(steps).toEqual([["left:1"]]);

    // Without the store the game's own bindings stand.
    const plain = await makeGame({ game: remapGame().game });
    expect(plain.input.bindings().left).toEqual([{ device: "key", code: "KeyA" }]);
  });

  it("keeps a remap in memory when localStorage throws", async () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    vi.stubGlobal("localStorage", broken);
    const { game: def, steps } = remapGame();
    const game = await makeGame({ game: def, input: { remaps: browserRemapStore() } });
    expect(game.input.rebind("jump", [{ device: "key", code: "KeyK" }])).toEqual({ ok: true });
    expect(game.input.bindings().jump).toEqual([{ device: "key", code: "KeyK" }]);
    game.play(scene);
    press(game, "KeyK");
    game.step();
    expect(steps).toEqual([["jump:1"]]);
  });

  it("refuses an unknown code, action or seat by the binding check, changing nothing", async () => {
    const store = memoryRemapStore();
    const save = vi.spyOn(store, "save");
    const game = await makeGame({ game: remapGame().game, input: { remaps: store } });

    const code = game.input.rebind("jump", [{ device: "key", code: "KeyQQ" }]);
    expect(code).toMatchObject({
      ok: false,
      issue: { code: "binding-unknown", severity: "error", path: "/bindings/0/code" },
    });
    const action = game.input.rebind("jumpp", [{ device: "key", code: "KeyK" }]);
    expect(action).toMatchObject({ ok: false, issue: { code: "binding-unknown" } });
    expect(!action.ok && action.issue.message).toContain('did you mean "jump"');
    const seat = game.input.rebind("jump", [{ device: "key", code: "KeyK" }], { player: 1 });
    expect(seat).toMatchObject({ ok: false, issue: { code: "player-unknown", path: "/player" } });
    const kind = game.input.rebind("jump", [{ device: "pad", stick: "left" }]);
    expect(kind).toMatchObject({ ok: false, issue: { code: "binding-unknown" } });

    expect(save).not.toHaveBeenCalled();
    expect(game.input.bindings().jump).toEqual(remapGame().game.actions!.at(-1)!.bindings);
  });

  it("reset drops a remap, saving at once", async () => {
    const store = memoryRemapStore();
    const game = await makeGame({ game: remapGame().game, input: { remaps: store } });
    game.input.rebind("jump", [{ device: "key", code: "KeyK" }]);
    game.input.rebind("left", [{ device: "key", code: "KeyH" }]);
    game.input.reset("jump");
    expect(store.load(testGame.id)).toEqual({
      v: 1,
      players: { 0: { left: [{ device: "key", code: "KeyH" }] } },
    });
    expect(game.input.bindings().jump).toEqual(remapGame().game.actions!.at(-1)!.bindings);
    game.input.reset();
    expect(store.load(testGame.id)).toEqual({ v: 1, players: {} });
    expect(game.input.bindings().left).toEqual([{ device: "key", code: "KeyA" }]);
  });

  it("drops stored remaps the game no longer fits", async () => {
    const store: RemapStore = memoryRemapStore();
    store.save(testGame.id, {
      v: 1,
      players: {
        0: {
          gone: [{ device: "key", code: "KeyK" }],
          left: [{ device: "key", code: "NotAKey" }],
          right: [{ device: "key", code: "KeyL" }],
        },
        3: { left: [{ device: "key", code: "KeyH" }] },
      },
    });
    const game = await makeGame({ game: remapGame().game, input: { remaps: store } });
    expect(game.input.bindings().right).toEqual([{ device: "key", code: "KeyL" }]);
    expect(game.input.bindings().left).toEqual([{ device: "key", code: "KeyA" }]);
    expect(game.input.bindings().gone).toBeUndefined();
  });
});

describe("remaps stay the player's", () => {
  it("never reach the project doc or a recording", async () => {
    const inputMap: ProjectRuntimeView["inputMap"] = Object.freeze({
      kind: INPUT_MAP_KIND,
      v: INPUT_MAP_VERSION,
      actions: Object.freeze([
        Object.freeze({
          action: "jump",
          bindings: Object.freeze([Object.freeze({ device: "key", code: "KeyU" })]),
        }),
      ]),
    }) as ProjectRuntimeView["inputMap"];
    const project: ProjectRuntimeView = {
      settings: {},
      engine: {},
      table: () => [],
      asset: () => undefined,
      inputMap,
    };
    const before = JSON.stringify(project);
    const { game: def, steps } = remapGame();
    const game = await makeGame({ game: def, project, input: { remaps: memoryRemapStore() } });
    // The map's layer under the remap.
    expect(game.input.bindings().jump).toEqual([{ device: "key", code: "KeyU" }]);

    expect(game.input.rebind("jump", [{ device: "key", code: "KeyK" }]).ok).toBe(true);
    game.play(scene);
    press(game, "KeyK");
    game.step();
    expect(steps).toEqual([["jump:1"]]);
    game.stop();

    expect(JSON.stringify(project)).toBe(before);
    const recorded = JSON.stringify(game.recording());
    expect(recorded).toContain('"jump"');
    expect(recorded).not.toContain("KeyK");
    expect(recorded).not.toContain("bindings");
  });
});

describe("capture", () => {
  const keydown = (code: string, init: KeyboardEventInit = {}) =>
    new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true, ...init });

  it("resolves the next key press, which the game never sees", async () => {
    const { game: def, steps } = remapGame();
    const game = await makeGame({ game: def });
    vi.stubGlobal("requestAnimationFrame", () => 0);
    game.start();
    game.play(scene);
    const captured = game.input.capture();
    canvas.dispatchEvent(keydown("KeyJ", { repeat: true }));
    const press = keydown("KeyJ");
    canvas.dispatchEvent(press);
    await expect(captured).resolves.toEqual({ device: "key", code: "KeyJ" });
    expect(press.defaultPrevented).toBe(true);
    game.step();
    expect(steps).toEqual([[]]);
  });

  it("resolves null on Escape or a timeout, and a pointer press when asked for one", async () => {
    const game = await makeGame({ game: remapGame().game });
    const escaped = game.input.capture();
    window.dispatchEvent(keydown("Escape"));
    await expect(escaped).resolves.toBeNull();

    await expect(game.input.capture({ timeoutMs: 10 })).resolves.toBeNull();

    const pointer = game.input.capture({ devices: ["pointer"] });
    window.dispatchEvent(keydown("KeyJ"));
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 2, bubbles: true, cancelable: true }),
    );
    await expect(pointer).resolves.toEqual({ device: "pointer", button: "secondary" });

    // A new capture ends the last one; destroy ends a waiting one.
    const first = game.input.capture();
    const second = game.input.capture();
    await expect(first).resolves.toBeNull();
    game.destroy();
    await expect(second).resolves.toBeNull();
  });

  it("resolves a pad button press, read while nothing simulates", async () => {
    const pressed = fakePad();
    const game = await makeGame({ game: remapGame().game });
    const captured = game.input.capture({ devices: ["pad"], timeoutMs: 2000 });
    await new Promise((r) => setTimeout(r, 40));
    pressed[0] = true;
    await expect(captured).resolves.toEqual({ device: "pad", button: "south" });
  });

  it("takes a pad press in play from the tick's poll, keeping it from the game", async () => {
    const pressed = fakePad();
    const { game: def, steps } = remapGame();
    const game = await makeGame({ game: def });
    game.play(scene);
    game.step();
    const captured = game.input.capture({ devices: ["pad"] });
    pressed[0] = true;
    game.step();
    await expect(captured).resolves.toEqual({ device: "pad", button: "south" });
    expect(steps).toEqual([[], []]);
  });
});

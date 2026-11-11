// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import type { Binding, GameDefinition } from "../game/types";
import { memoryRemapStore } from "../input/remap";
import { createKindRegistry } from "../project/kinds";
import { INPUT_MAP_KIND, INPUT_MAP_VERSION } from "../project/kinds/input-map";
import type { ProjectRuntimeView } from "../project/runtime-view";
import { projectView } from "../project/view";
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

const view = projectView(
  {
    meta: { projectId: "p", layout: 1, name: "P" },
    assets: {},
    history: {},
    code: {},
    build: {},
  },
  createKindRegistry(testGame),
);

let rapier: RapierModule;
let canvas: HTMLCanvasElement;
const games: GameInstance[] = [];

beforeAll(async () => {
  rapier = await loadCompatRapier();
});

beforeEach(() => {
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const box = () => ({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 500,
    width: 1000,
    height: 500,
    x: 0,
    y: 0,
    toJSON() {},
  });
  document.body.getBoundingClientRect = box;
  canvas.getBoundingClientRect = box;
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** The test game plus a `jump` button bound to J, recording each step's actions. */
function jumpGame() {
  const steps: string[][] = [];
  const game: GameDefinition = {
    ...testGame,
    actions: [
      ...testGame.actions!,
      { action: "jump", description: "Jump.", bindings: [{ device: "key", code: "KeyJ" }] },
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

/** A project whose input map binds `jump` to `code` and to one on-screen button, `control`. */
function projectWith(code: string, control: string, at: [number, number]): ProjectRuntimeView {
  return {
    settings: {},
    engine: {},
    table: () => [],
    asset: () => undefined,
    inputMap: {
      kind: INPUT_MAP_KIND,
      v: INPUT_MAP_VERSION,
      actions: [
        {
          action: "jump",
          bindings: [
            { device: "key", code },
            { device: "touch", control },
          ],
        },
      ],
      touch: [{ id: control, kind: "button", action: "jump", at, radius: 0.1 }],
    },
  };
}

const onF = projectWith("KeyF", "hop", [0.1, 0.1]);
const onG = projectWith("KeyG", "leap", [0.5, 0.5]);

async function playing(
  project: ProjectRuntimeView,
  extra: Partial<Parameters<typeof createGame>[1]> = {},
) {
  const { game: def, steps } = jumpGame();
  const game = await createGame(canvas, {
    rapier: async () => rapier,
    game: def,
    project,
    input: { touch: "always" },
    ...extra,
  });
  games.push(game);
  expect(game.play(scene).ok).toBe(true);
  return { game, steps };
}

const key = (game: GameInstance, code: string, type: "down" | "up" = "down") =>
  game.router.dispatch({
    kind: "key",
    type,
    key: code,
    code,
    native: new KeyboardEvent(`key${type}`, { code }),
  });

const control = (id: string) => document.querySelector<HTMLElement>(`[data-touch-control="${id}"]`);

function touchDown(node: HTMLElement, pointerId: number): void {
  node.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId,
      pointerType: "touch",
      bubbles: true,
      cancelable: true,
    }),
  );
}

describe("reloadAssets with an edited input map", () => {
  it("releases what the old map holds, then drives the action from the new one", async () => {
    const { game, steps } = await playing(onF);
    key(game, "KeyF");
    game.step();
    expect(steps.at(-1)).toEqual(["jump:1"]);

    await game.reloadAssets({ project: onG, view, changed: [] });
    game.step();
    expect(steps.at(-1)).toEqual(["jump:0"]);
    expect(game.input.bindings().jump).toEqual([
      { device: "key", code: "KeyG" },
      { device: "touch", control: "leap" },
    ]);

    // F is still down on the keyboard, but no longer bound: its release raises nothing.
    key(game, "KeyF", "up");
    key(game, "KeyF");
    game.step();
    expect(steps.at(-1)).toEqual([]);

    key(game, "KeyG");
    game.step();
    key(game, "KeyG", "up");
    game.step();
    expect(steps.slice(-2)).toEqual([["jump:1"], ["jump:0"]]);
  });

  it("rebuilds the touch overlay, letting go of a control held across the reload", async () => {
    const { game, steps } = await playing(onF);
    touchDown(control("hop")!, 7);
    game.step();
    expect(steps.at(-1)).toEqual(["jump:1"]);

    await game.reloadAssets({ project: onG, view, changed: [] });
    game.step();
    expect(steps.at(-1)).toEqual(["jump:0"]);
    expect(control("hop")).toBeNull();
    expect(document.querySelectorAll("[data-touch-controls]")).toHaveLength(1);
    const leap = control("leap")!;
    expect(leap.closest<HTMLElement>("[data-touch-controls]")!.style.display).toBe("");

    touchDown(leap, 8);
    game.step();
    expect(steps.at(-1)).toEqual(["jump:1"]);

    game.stop();
    expect(leap.closest<HTMLElement>("[data-touch-controls]")!.style.display).toBe("none");
  });

  it("keeps the player's remaps, less those the new map no longer allows", async () => {
    const remaps = memoryRemapStore();
    const { game, steps } = await playing(onF, { input: { touch: "always", remaps } });
    const k: Binding = { device: "key", code: "KeyK" };
    expect(game.input.rebind("jump", [k])).toEqual({ ok: true });

    await game.reloadAssets({ project: onG, view, changed: [] });
    expect(game.input.bindings().jump).toEqual([k]);
    key(game, "KeyG");
    game.step();
    key(game, "KeyK");
    game.step();
    expect(steps.slice(-2)).toEqual([[], ["jump:1"]]);
    key(game, "KeyK", "up");

    expect(game.input.rebind("jump", [{ device: "touch", control: "leap" }])).toEqual({
      ok: true,
    });
    await game.reloadAssets({ project: onF, view, changed: [] });
    expect(game.input.bindings().jump).toEqual([
      { device: "key", code: "KeyF" },
      { device: "touch", control: "hop" },
    ]);
  });

  it("leaves held input alone when the map is unchanged", async () => {
    const { game, steps } = await playing(onF);
    key(game, "KeyF");
    game.step();
    const hop = control("hop");

    await game.reloadAssets({ project: projectWith("KeyF", "hop", [0.1, 0.1]), view, changed: [] });
    game.step();
    expect(steps.at(-1)).toEqual([]);
    expect(control("hop")).toBe(hop);
    key(game, "KeyF", "up");
    game.step();
    expect(steps.at(-1)).toEqual(["jump:0"]);
  });
});

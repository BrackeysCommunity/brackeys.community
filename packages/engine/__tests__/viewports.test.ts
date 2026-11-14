// @vitest-environment jsdom
import { Container, type Matrix, RenderTexture } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ViewportDef } from "../camera/viewports";
import { viewportIndexAt, viewportsProblem } from "../camera/viewports";
import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import type { GameInstance, Vec2 } from "../types";

/** The stubbed app: a real stage, and a renderer that records what it is asked to draw. */
const gpu = vi.hoisted(() => ({
  renders: [] as { container: unknown; target: unknown; transform: Matrix }[],
}));

vi.mock("../renderer", async () => {
  const { Container: PixiContainer } = await import("pixi.js");
  return {
    createRenderer: async () => {
      const stage = new PixiContainer();
      const worldContainer = new PixiContainer();
      worldContainer.label = "world";
      const uiContainer = new PixiContainer();
      uiContainer.label = "ui";
      stage.addChild(worldContainer, uiContainer);
      return {
        app: {
          stage,
          renderer: {
            resolution: 1,
            render(o: { container: unknown; target: unknown; transform: Matrix }) {
              gpu.renders.push({ ...o, transform: o.transform.clone() });
            },
          },
        },
        worldContainer,
        uiContainer,
        resize: () => {},
        destroy: () => {},
      };
    },
  };
});

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

/** Two seats and no camera target of its own: the shell follows the `camera-target` entities. */
const versus = defineGame({
  id: "split-arena",
  types: [],
  actions: [],
  input: { players: { max: 2, join: "auto" } },
  world: { physics: "none" },
  createRuntime: () => ({ snapshot: () => null }),
});

/**
 * The versus probe's arena (genres/versus-behaviors.probe.ts, which reads its
 * yard from disk and so can't load under jsdom): 16 × 9 m, a fighter at
 * either end, each fighter's camera target on its own seat.
 */
const fighter = (id: string, x: number, seat: number): EntityDef =>
  ({
    id,
    type: "marker",
    at: [x, 7.6],
    behaviors: { "camera-target": { seat } },
  }) as EntityDef;

const arena: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: "split-arena",
  name: "split-arena",
  bounds: [0, 0, 16, 9],
  settings: { physics: "none" },
  entities: [fighter("hero-0", 2, 0), fighter("hero-1", 14, 1)],
};

const SPLIT: ViewportDef[] = [
  { rect: [0, 0, 0.5, 1], frame: { player: 0 } },
  { rect: [0.5, 0, 0.5, 1], frame: { player: 1 }, border: { width: 4, color: 0x202020 } },
];

const games: GameInstance[] = [];
let canvas: HTMLCanvasElement;
let frames: ReturnType<typeof manualFrames>;

beforeEach(() => {
  gpu.renders.length = 0;
  frames = manualFrames();
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  canvas.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 1920, height: 1080, right: 1930, bottom: 1100 }) as DOMRect;
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** The versus game on the arena, in Play under `viewports`; `seen` gets each tick's pointer sample. */
async function playing(viewports: readonly ViewportDef[]) {
  const seen: Vec2[] = [];
  const game: GameDefinition = {
    ...(versus as GameDefinition),
    attach: () => ({ onTick: (_dt, at) => void seen.push({ ...at }), destroy() {} }),
  };
  const instance = await createGame(canvas, { game, viewports });
  games.push(instance);
  instance.start();
  expect(instance.play(arena)).toMatchObject({ ok: true });
  instance.pause();
  frames.advance(16);
  frames.advance(16);
  return { game: instance, seen };
}

/** Viewport `index`'s camera centre: the world point at the middle of its rect. */
function centreOf(g: GameInstance, def: ViewportDef, index: number): Vec2 {
  const [x, y, w, h] = def.rect;
  return g.clientToWorld(10 + (x + w / 2) * 1920, 20 + (y + h / 2) * 1080, index);
}

describe("viewports", () => {
  it("checks the set: one to four, each a non-empty part of the canvas", () => {
    expect(viewportsProblem(SPLIT)).toBeNull();
    expect(viewportsProblem([])).toMatch(/1–4/);
    expect(viewportsProblem([...SPLIT, ...SPLIT, ...SPLIT])).toMatch(/1–4/);
    expect(viewportsProblem([{ rect: [0.5, 0, 0.6, 1], frame: "main" }])).toMatch(/viewport 0/);
    expect(viewportsProblem([{ rect: [0, 0, 0, 1], frame: "main" }])).toMatch(/viewport 0/);
    // The topmost wins where they overlap.
    const minimap: ViewportDef[] = [
      { rect: [0, 0, 1, 1], frame: "main" },
      { rect: [0.75, 0, 0.25, 0.25], frame: "scene" },
    ];
    expect(viewportIndexAt(minimap, 1800, 100, 1920, 1080)).toBe(1);
    expect(viewportIndexAt(minimap, 1800, 600, 1920, 1080)).toBe(0);
    expect(viewportIndexAt(minimap, -1, 600, 1920, 1080)).toBeNull();
  });

  it("refuses a bad set at createGame and at setViewports", async () => {
    await expect(createGame(canvas, { game: null, viewports: [] })).rejects.toThrow(/viewports/);
    const { game } = await playing(SPLIT);
    expect(() => game.setViewports([{ rect: [0, 0, 2, 1], frame: "main" }])).toThrow(/viewports/);
  });

  it("render the world container twice: directly, and into viewport 1's texture with its own transform", async () => {
    await playing(SPLIT);
    const drawn = gpu.renders.at(-1)!;
    expect(drawn.container).toBeInstanceOf(Container);
    expect((drawn.container as Container).label).toBe("world");
    expect(drawn.target).toBeInstanceOf(RenderTexture);
    expect((drawn.target as RenderTexture).width).toBe(960);
    expect((drawn.target as RenderTexture).height).toBe(1080);
    const world = drawn.container as Container;
    world.updateLocalTransform();
    // The stage draws the world through viewport 0's camera; the texture through viewport 1's.
    expect(drawn.transform.tx).not.toBeCloseTo(world.localTransform.tx, 3);
    // Each frame draws viewport 1 once.
    const before = gpu.renders.length;
    frames.advance(16);
    expect(gpu.renders.length).toBe(before + 1);

    // The texture's sprite sits on the stage over the world, under the UI.
    const parent = world.parent!;
    const labels = parent.children.map((c) => c.label);
    expect(labels).toEqual(["world", "viewport-mask", "viewport", "ui"]);
    expect(world.mask).toBe(parent.children[1]);
  });

  it("follow each seat's camera-target entity: viewport 0 seat 0's fighter, viewport 1 seat 1's", async () => {
    const { game } = await playing(SPLIT);
    const left = centreOf(game, SPLIT[0]!, 0);
    const right = centreOf(game, SPLIT[1]!, 1);
    // hero-0 starts at x 2, hero-1 at x 14; each view is 9.6 m wide, kept inside the bounds plus 1 m.
    expect(left.x).toBeCloseTo(-1 + 4.8, 3);
    expect(right.x).toBeCloseTo(17 - 4.8, 3);
  });

  it("draws the first viewport at its own rect's corner when it doesn't sit at the canvas's", async () => {
    const swapped: ViewportDef[] = [
      { rect: [0.5, 0, 0.5, 1], frame: { player: 0 } },
      { rect: [0, 0, 0.5, 1], frame: { player: 1 } },
    ];
    const { game } = await playing(swapped);
    const world = gpu.renders.at(-1)!.container as Container;
    const centre = centreOf(game, swapped[0]!, 0);
    expect(centre.x).toBeCloseTo(-1 + 4.8, 3);
    world.updateLocalTransform();
    const drawn = world.localTransform.apply(centre);
    expect(drawn.x).toBeCloseTo(1440, 3);
    expect(drawn.y).toBeCloseTo(540, 3);
    expect(game.worldToClient(centre).x).toBeCloseTo(10 + 1440, 3);
  });

  it("viewportAt maps the right half to viewport 1, the left to 0, and off the canvas to null", async () => {
    const { game } = await playing(SPLIT);
    expect(game.viewportAt(10 + 1500, 20 + 500)).toBe(1);
    expect(game.viewportAt(10 + 200, 20 + 500)).toBe(0);
    expect(game.viewportAt(5, 20 + 500)).toBeNull();
    game.setMode("edit");
    // The editor shows one view.
    expect(game.viewportAt(10 + 1500, 20 + 500)).toBe(0);
  });

  it("samples a pointer over viewport 1 through viewport 1's camera", async () => {
    const { game, seen } = await playing(SPLIT);
    const screen = { x: 960 + 480 + 96, y: 540 - 50 };
    game.router.dispatch({
      kind: "pointer",
      type: "move",
      screen,
      button: -1,
      deltaY: 0,
      native: new MouseEvent("pointermove"),
    });
    game.step(1);
    const at = seen.at(-1)!;
    const right = centreOf(game, SPLIT[1]!, 1);
    expect(at.x).toBeCloseTo(right.x + 0.96, 3);
    expect(at.y).toBeCloseTo(right.y - 0.5, 3);
    // Through viewport 0's camera the same px would land far off to the right of its fighter.
    const through0 = game.clientToWorld(10 + screen.x, 20 + screen.y, 0);
    expect(Math.abs(through0.x - at.x)).toBeGreaterThan(1);
    // worldToClient inverts it through the same viewport.
    const back = game.worldToClient(at, 1);
    expect(back.x).toBeCloseTo(10 + screen.x, 1);
    expect(back.y).toBeCloseTo(20 + screen.y, 1);
  });

  it("fits a 'scene' viewport to the scene's bounds, and keeps its shake out", async () => {
    const minimap: ViewportDef[] = [
      { rect: [0, 0, 1, 1], frame: "main" },
      { rect: [0.75, 0, 0.25, 0.25], frame: "scene" },
    ];
    const { game } = await playing(minimap);
    const topLeft = game.clientToWorld(10 + 1440, 20, 1);
    const bottomRight = game.clientToWorld(10 + 1920, 20 + 270, 1);
    // A 480 × 270 px view of the 16 × 9 m arena: exactly its bounds.
    expect(topLeft.x).toBeCloseTo(0, 3);
    expect(topLeft.y).toBeCloseTo(0, 3);
    expect(bottomRight.x).toBeCloseTo(16, 3);
    expect(bottomRight.y).toBeCloseTo(9, 3);
    expect((gpu.renders.at(-1)!.target as RenderTexture).width).toBe(480);
  });

  it("draws one view in the editor, and drops the later viewports' surfaces there", async () => {
    const { game } = await playing(SPLIT);
    game.setMode("edit");
    const before = gpu.renders.length;
    frames.advance(16);
    expect(gpu.renders.length).toBe(before);
    const world = gpu.renders.at(-1)!.container as Container;
    expect(world.parent!.children.map((c) => c.label)).toEqual(["world", "ui"]);
    expect(world.mask ?? null).toBeNull();
    // Back to one viewport in Play: no texture is drawn.
    game.setViewports([{ rect: [0, 0, 1, 1], frame: "main" }]);
    game.setMode("play");
    const count = gpu.renders.length;
    frames.advance(16);
    expect(gpu.renders.length).toBe(count);
  });
});

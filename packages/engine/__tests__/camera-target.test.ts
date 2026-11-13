// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import type { GameInstance, RapierModule, Vec2 } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";

vi.mock("../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

/** The camera each frame hands the view, in the order the frames ran. */
const frames = vi.hoisted(() => [] as { x: number; y: number }[]);
vi.mock("../render/pixi-view", async (importOriginal) => {
  const real = await importOriginal<typeof import("../render/pixi-view")>();
  return {
    ...real,
    createPixiView: (...args: Parameters<typeof real.createPixiView>) => {
      const view = real.createPixiView(...args);
      const recording: typeof view = {
        ...view,
        frame(f) {
          frames.push({ x: f.camera.x, y: f.camera.y });
          view.frame!(f);
        },
      };
      return recording;
    },
  };
});

const TICK_MS = 1000 / 60;

let pending: FrameRequestCallback[] = [];
let now = 0;
/** Runs `n` frames a tick apart: each steps one tick, then renders. */
function advance(n: number): void {
  for (let i = 0; i < n; i++) {
    now += TICK_MS;
    const due = pending;
    pending = [];
    for (const cb of due) cb(now);
  }
}

const lastFrame = (): { x: number; y: number } => frames[frames.length - 1]!;

const target = (id: string, at: Vec2, extra: Partial<EntityDef> = {}, weight?: number) =>
  ({
    id,
    type: "marker",
    at: [at.x, at.y],
    behaviors: { "camera-target": weight === undefined ? {} : { weight } },
    ...extra,
  }) as EntityDef;

function sceneOf(entities: EntityDef[], game?: string): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "camera-targets",
    ...(game ? { game } : {}),
    bounds: [-1000, -1000, 1000, 1000],
    settings: { physics: "none" },
    entities,
  };
}

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await loadCompatRapier();
});

const games: GameInstance[] = [];
let canvas: HTMLCanvasElement;

async function playing(
  scene: SceneDefinition,
  game: GameDefinition | null = null,
): Promise<GameInstance> {
  const instance = await createGame(canvas, { game, rapier: async () => rapier, scene });
  games.push(instance);
  instance.start();
  // The loop's first frame only starts its clock; the second ticks and renders.
  advance(2);
  return instance;
}

beforeEach(() => {
  frames.length = 0;
  pending = [];
  now = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => pending.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** A physics-free game with the given `cameraTarget` hook (none when omitted). */
function gameWith(cameraTarget?: () => Vec2 | null): GameDefinition {
  return defineGame({
    id: "framer",
    types: [],
    actions: [],
    world: { physics: "none" },
    createRuntime: () => ({ snapshot: () => null, ...(cameraTarget ? { cameraTarget } : {}) }),
  });
}

describe("camera-target", () => {
  it("follows a single target, easing to where it moves", async () => {
    const game = await playing(sceneOf([target("hero", { x: 12, y: -4 })]));
    expect(lastFrame()).toEqual({ x: 12, y: -4 });

    expect(game.runtime()!.update([target("hero", { x: 40, y: -4 })])).toEqual({ ok: true });
    advance(3);
    const eased = lastFrame();
    expect(eased.x).toBeGreaterThan(12);
    expect(eased.x).toBeLessThan(40);
    advance(240);
    expect(lastFrame().x).toBeCloseTo(40, 3);
    expect(lastFrame().y).toBeCloseTo(-4, 3);
  });

  it("averages two targets by weight", async () => {
    await playing(
      sceneOf([target("a", { x: 0, y: 0 }, {}, 3), target("b", { x: 40, y: 20 }, {}, 1)]),
    );
    expect(lastFrame()).toEqual({ x: 10, y: 5 });
  });

  it("drops a destroyed target from the average", async () => {
    const spark = target(
      "spark",
      { x: 40, y: 0 },
      { behaviors: { "camera-target": {}, lifetime: { ticks: 2 } } },
    );
    await playing(sceneOf([target("stay", { x: 0, y: 0 }), spark]));
    expect(lastFrame()).toEqual({ x: 20, y: 0 });
    advance(300);
    expect(lastFrame().x).toBeCloseTo(0, 3);
  });

  it("lets a game's own target win, a null holding the camera", async () => {
    const scene = sceneOf([target("hero", { x: 30, y: 30 })], "framer");
    await playing(
      scene,
      gameWith(() => ({ x: -7, y: 3 })),
    );
    expect(lastFrame()).toEqual({ x: -7, y: 3 });
    advance(30);
    expect(lastFrame()).toEqual({ x: -7, y: 3 });

    frames.length = 0;
    await playing(
      scene,
      gameWith(() => null),
    );
    const held = lastFrame();
    advance(30);
    expect(lastFrame()).toEqual(held);
    expect(held).not.toEqual({ x: 30, y: 30 });
  });

  it("follows a carrier spawned at runtime, and lets go of it when it goes", async () => {
    let tick = 0;
    const spawning = defineGame({
      id: "framer",
      types: [],
      actions: [],
      world: { physics: "none" },
      createRuntime: (ctx) => ({
        snapshot: () => null,
        afterStep() {
          tick++;
          if (tick === 3) ctx.spawn({ ...target("marker#late", { x: 40, y: 0 }) });
          if (tick === 200) ctx.destroy("marker#late");
        },
      }),
    });
    await playing(sceneOf([target("stay", { x: 0, y: 0 })], "framer"), spawning);
    expect(lastFrame()).toEqual({ x: 0, y: 0 });
    advance(150);
    expect(lastFrame().x).toBeCloseTo(20, 3);
    advance(250);
    expect(lastFrame().x).toBeCloseTo(0, 3);
  });

  it("follows the targets when the game names none", async () => {
    await playing(sceneOf([target("hero", { x: 30, y: 30 })], "framer"), gameWith());
    expect(lastFrame()).toEqual({ x: 30, y: 30 });
  });

  it("keeps a gameless scene without targets on the bounds' centre, as before", async () => {
    const game = await playing({
      ...sceneOf([{ id: "post", type: "marker", at: [60, 60] } as EntityDef]),
      bounds: [0, 0, 100, 40],
    });
    expect(lastFrame()).toEqual({ x: 50, y: 20 });
    expect(game.play(sceneOf([{ id: "post", type: "marker", at: [60, 60] } as EntityDef])).ok).toBe(
      true,
    );
    advance(1);
    expect(lastFrame()).toEqual({ x: 0, y: 0 });
  });
});

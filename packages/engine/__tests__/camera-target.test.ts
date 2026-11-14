// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import type { GameInstance, RapierModule, Vec2 } from "../types";
import { loadCompatRapier } from "./fixtures/compat-rapier";
import { manualFrames, type FrameClock, type FrameRecord } from "./fixtures/frame-clock";

vi.mock("../renderer", async () => (await import("./fixtures/frame-clock")).stubRenderer());

/** The camera each frame hands the view, in the order the frames ran. */
const seen = vi.hoisted((): FrameRecord => ({ frames: [], views: [] }));
vi.mock("../render/pixi-view", async (importOriginal) =>
  (await import("./fixtures/frame-clock")).recordingPixiView(importOriginal, seen),
);

let clock: FrameClock;
/** Runs `n` frames a tick apart: each steps one tick, then renders. */
const advance = (n: number) => clock.ticks(n);

/** Where the last frame's camera stood. */
const lastFrame = (): Vec2 => {
  const { x, y } = seen.frames[seen.frames.length - 1]!;
  return { x, y };
};

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
  seen.frames.length = 0;
  seen.views.length = 0;
  clock = manualFrames();
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

    seen.frames.length = 0;
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

  it("starts Play on the targets wherever the editor camera was left", async () => {
    const scene = {
      ...sceneOf([target("hero", { x: 30, y: 30 })]),
      bounds: [0, 0, 100, 100] as [number, number, number, number],
    };
    const instance = await createGame(canvas, { game: null, rapier: async () => rapier });
    games.push(instance);
    instance.setMode("edit");
    instance.loadScene(scene);
    instance.start();
    advance(2);
    instance.zoomAt({ x: 0, y: 0 }, 0.2);
    instance.panBy({ x: 400, y: -300 });
    advance(1);
    expect(lastFrame()).not.toEqual({ x: 30, y: 30 });
    expect(instance.play(scene).ok).toBe(true);
    expect(instance.getStore().state.camera.zoom).toBe(1);
    advance(1);
    expect(lastFrame()).toEqual({ x: 30, y: 30 });
    instance.stop();
    expect(instance.getStore().state.camera.zoom).toBeCloseTo(0.2);
  });

  /** An edit-mode instance on `scene`, its editor camera zoomed out and panned away. */
  async function editing(scene: SceneDefinition, game: GameDefinition | null = null) {
    const instance = await createGame(canvas, { game, rapier: async () => rapier });
    games.push(instance);
    instance.setMode("edit");
    instance.loadScene(scene);
    instance.start();
    advance(2);
    instance.zoomAt({ x: 0, y: 0 }, 0.2);
    instance.panBy({ x: 400, y: -300 });
    advance(1);
    return { instance, editor: instance.getStore().state.camera };
  }

  const boxed = (entities: EntityDef[], game?: string): SceneDefinition => ({
    ...sceneOf(entities, game),
    bounds: [0, 0, 100, 100],
  });

  it("Stop puts the editor camera back exactly: position, zoom, bounds and mode", async () => {
    const scene = boxed([target("hero", { x: 30, y: 30 })]);
    const { instance, editor } = await editing(scene);
    expect(instance.play(scene).ok).toBe(true);
    advance(5);
    instance.stop();
    expect(instance.getStore().state.camera).toEqual(editor);
  });

  it("starts Play from here at zoom 1 on the start point", async () => {
    const scene = boxed([{ id: "post", type: "marker", at: [80, 80] } as EntityDef]);
    const { instance, editor } = await editing(scene);
    expect(instance.play(scene, { at: { x: 70, y: 40 } }).ok).toBe(true);
    expect(instance.getStore().state.camera.zoom).toBe(1);
    advance(1);
    expect(lastFrame()).toEqual({ x: 70, y: 40 });
    instance.stop();
    expect(instance.getStore().state.camera).toEqual(editor);
  });

  it("starts a replay as it starts Play: zoom 1 on the target, Stop restoring the editor", async () => {
    const scene = boxed([target("hero", { x: 30, y: 30 })]);
    const { instance, editor } = await editing(scene);
    expect(instance.play(scene).ok).toBe(true);
    advance(3);
    instance.stop();
    const recording = instance.recording();
    expect(recording).not.toBeNull();
    expect(instance.getStore().state.camera).toEqual(editor);
    expect(instance.replay(scene, recording!).ok).toBe(true);
    expect(instance.getStore().state.camera.zoom).toBe(1);
    advance(1);
    expect(lastFrame()).toEqual({ x: 30, y: 30 });
    instance.stop();
    expect(instance.getStore().state.camera).toEqual(editor);
  });

  it("keeps the playing camera's zoom on a restart, and Stop still restores the editor's", async () => {
    const scene = boxed([target("hero", { x: 30, y: 30 })]);
    const { instance, editor } = await editing(scene);
    expect(instance.play(scene).ok).toBe(true);
    instance.zoomAt({ x: 960, y: 540 }, 2);
    expect(instance.play(scene).ok).toBe(true);
    expect(instance.getStore().state.camera.zoom).toBe(2);
    advance(1);
    expect(lastFrame()).toEqual({ x: 30, y: 30 });
    instance.stop();
    expect(instance.getStore().state.camera).toEqual(editor);
  });

  it("starts Play at zoom 1 when the game holds the camera still", async () => {
    const scene = boxed([target("hero", { x: 30, y: 30 })], "framer");
    const { instance, editor } = await editing(
      scene,
      gameWith(() => null),
    );
    expect(instance.play(scene).ok).toBe(true);
    expect(instance.getStore().state.camera.zoom).toBe(1);
    advance(1);
    const held = lastFrame();
    advance(30);
    expect(lastFrame()).toEqual(held);
    expect(held).toEqual({ x: 50, y: 50 });
    instance.stop();
    expect(instance.getStore().state.camera).toEqual(editor);
  });

  it("leaves the editor camera alone when Play is refused", async () => {
    const scene = boxed([target("hero", { x: 30, y: 30 })]);
    const { instance, editor } = await editing(scene);
    const broken = { ...scene, entities: [{ id: "x", type: "no-such-type" } as EntityDef] };
    expect(instance.play(broken).ok).toBe(false);
    expect(instance.getStore().state.camera).toEqual(editor);
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

// @vitest-environment jsdom
import { Container, Graphics, Rectangle } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ViewportDef } from "../camera/viewports";
import { createGame } from "../engine";
import { DEFAULT_LENGTH_UNIT } from "../game/defaults";
import { defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import type { EmitterFile } from "../project/kinds/emitter";
import { createParticleLayer } from "../render/particles";
import type { PixiViewFrame } from "../render/pixi-view";
import {
  SCENE_FORMAT_VERSION,
  type Bounds,
  type EntityDef,
  type SceneDefinition,
} from "../scene/types";
import type { GameInstance } from "../types";
import { manualFrames, type FrameClock } from "./fixtures/frame-clock";

/** Each texture draw's culled flags for the two markers, and each frame's `views`. */
const seen = vi.hoisted(() => ({
  world: null as unknown,
  markers: [] as { culled: boolean }[],
  passes: [] as boolean[][],
  views: [] as (readonly (readonly number[])[] | undefined)[],
}));

vi.mock("../renderer", async () => {
  const stub = await (
    await import("./fixtures/frame-clock")
  ).stubRenderer({
    onRender: () => void seen.passes.push(seen.markers.map((m) => m.culled)),
  });
  return {
    createRenderer: async () => {
      const r = await stub.createRenderer();
      seen.world = r.worldContainer;
      return r;
    },
  };
});

vi.mock("../render/pixi-view", async (importOriginal) => {
  const real = await importOriginal<typeof import("../render/pixi-view")>();
  return {
    ...real,
    createPixiView: (...args: Parameters<typeof real.createPixiView>) => {
      const view = real.createPixiView(...args);
      return {
        ...view,
        frame(f: PixiViewFrame) {
          seen.views.push(f.views);
          view.frame(f);
        },
      };
    },
  };
});

const versus = defineGame({
  id: "cull-arena",
  types: [],
  actions: [],
  input: { players: { max: 2, join: "auto" } },
  world: { physics: "none" },
  createRuntime: () => ({ snapshot: () => null }),
});

const fighter = (id: string, x: number, seat: number): EntityDef =>
  ({ id, type: "marker", at: [x, 7.6], behaviors: { "camera-target": { seat } } }) as EntityDef;

/** 40 m wide, so each half's view sees one fighter and not the other. */
const arena: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: "cull-arena",
  name: "cull-arena",
  bounds: [0, 0, 40, 9],
  settings: { physics: "none" },
  entities: [fighter("hero-0", 2, 0), fighter("hero-1", 38, 1)],
};

const SPLIT: ViewportDef[] = [
  { rect: [0, 0, 0.5, 1], frame: { player: 0 } },
  { rect: [0.5, 0, 0.5, 1], frame: { player: 1 } },
];

const games: GameInstance[] = [];
let canvas: HTMLCanvasElement;
let frames: FrameClock;

beforeEach(() => {
  seen.world = null;
  seen.markers = [];
  seen.passes.length = 0;
  seen.views.length = 0;
  frames = manualFrames();
  canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080 }) as DOMRect;
});

afterEach(() => {
  for (const g of games.splice(0)) g.destroy();
  document.body.replaceChildren();
});

/**
 * A cullable half-metre square at (x, y) metres, in px under a container
 * scaled by 1/ppm: the scene view's own layout, since the world container's
 * units are metres.
 */
function marker(world: Container, x: number, y: number): Graphics {
  const ppm = DEFAULT_LENGTH_UNIT;
  const scene = new Container();
  scene.scale.set(1 / ppm);
  world.addChild(scene);
  const g = new Graphics().rect(-0.25 * ppm, -0.25 * ppm, 0.5 * ppm, 0.5 * ppm).fill(0xffffff);
  g.position.set(x * ppm, y * ppm);
  g.cullable = true;
  g.cullArea = new Rectangle(-0.25 * ppm, -0.25 * ppm, 0.5 * ppm, 0.5 * ppm);
  scene.addChild(g);
  return g;
}

async function playing(viewports: readonly ViewportDef[]) {
  const game: GameDefinition = versus as GameDefinition;
  const instance = await createGame(canvas, { game, viewports });
  games.push(instance);
  instance.start();
  expect(instance.play(arena)).toMatchObject({ ok: true });
  instance.pause();
  frames.advance(16);
  frames.advance(16);
  return instance;
}

describe("the shell's culling", () => {
  it("culls per viewport under split screen: each draw sees only its own fighter's marker", async () => {
    await playing(SPLIT);
    const world = seen.world as Container;
    expect(world.label).toBe("world");
    const left = marker(world, 2, 7.6);
    const right = marker(world, 38, 7.6);
    seen.markers = [left, right];
    seen.passes.length = 0;
    frames.advance(16);

    // Viewport 1's texture draw: the left marker is culled, the right one drawn.
    expect(seen.passes).toEqual([[true, false]]);
    // The stage's draw after it, through viewport 0: the other way round.
    expect([left.culled, right.culled]).toEqual([false, true]);
  });

  it("hands the view every viewport's world rect, in metres, as data", async () => {
    const game = await playing(SPLIT);
    const views = seen.views.at(-1)!;
    expect(views).toHaveLength(2);
    const [v0, v1] = views as [Bounds, Bounds];
    expect(v0[0]).toBeLessThan(2);
    expect(v0[2]).toBeGreaterThan(2);
    expect(v0[2]).toBeLessThan(38);
    expect(v1[0]).toBeGreaterThan(2);
    expect(v1[2]).toBeGreaterThan(38);
    for (const rect of views) for (const n of rect) expect(Number.isFinite(n)).toBe(true);
    // Each rect is the area its viewport's camera shows.
    const tl = game.clientToWorld(0, 0, 0);
    expect(v0[0]).toBeCloseTo(tl.x, 3);
    expect(v0[1]).toBeCloseTo(tl.y, 3);
  });

  it("culls against the one view in the editor", async () => {
    const instance = await createGame(canvas, { game: versus as GameDefinition, viewports: SPLIT });
    games.push(instance);
    instance.start();
    expect(instance.loadScene(arena)).toMatchObject({ ok: true });
    expect(instance.play(arena)).toMatchObject({ ok: true });
    frames.advance(16);
    instance.setMode("edit");
    frames.advance(16);
    expect(seen.views.at(-1)).toHaveLength(1);
    const world = seen.world as Container;
    const centre = instance.clientToWorld(960, 540, 0);
    const near = marker(world, centre.x, centre.y);
    const far = marker(world, 200, 200);
    frames.advance(16);
    expect(near.culled).toBe(false);
    expect(far.culled).toBe(true);
  });

  it("keeps what's in view drawn after the editor zooms in and pans, and in Play", async () => {
    const instance = await createGame(canvas, { game: versus as GameDefinition });
    games.push(instance);
    instance.start();
    expect(instance.loadScene(arena)).toMatchObject({ ok: true });
    frames.advance(16);
    const world = seen.world as Container;
    const onScreen = () => {
      const at = instance.clientToWorld(1500, 700, 0);
      return marker(world, at.x, at.y);
    };

    instance.zoomAt({ x: 960, y: 540 }, 4);
    instance.panBy({ x: -800, y: 0 });
    const edited = onScreen();
    frames.advance(16);
    expect(edited.culled).toBe(false);

    expect(instance.play(arena)).toMatchObject({ ok: true });
    frames.advance(16);
    const played = onScreen();
    frames.advance(16);
    expect(played.culled).toBe(false);
  });

  it("makes particles cullable: each bucket's cull area follows its particles", () => {
    const container = new Container();
    const layer = createParticleLayer(container, undefined, { seed: "cull", reducedMotion: false });
    const preset: EmitterFile = {
      kind: "emitter",
      v: 1,
      rate: 0,
      lifeMs: [5000, 5000],
      speed: [1, 1],
      angle: [0, 0],
    };
    layer.burst(preset, { x: 30, y: 4 }, { count: 3 });
    const bucket = container.children[0]!;
    expect(bucket.cullable).toBe(true);
    const ppm = DEFAULT_LENGTH_UNIT;
    expect(bucket.cullArea!.contains(30 * ppm, 4 * ppm)).toBe(true);
    // A second at 1 m/s heading +x: the area moves on with them.
    layer.update(1000);
    expect(bucket.cullArea!.contains(31 * ppm, 4 * ppm)).toBe(true);
    expect(bucket.cullArea!.contains(30 * ppm - 50, 4 * ppm)).toBe(false);
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vite-plus/test";

import type { EaseName } from "../anim/ease";
import { MAX_CAMERA_ZOOM, MIN_CAMERA_ZOOM } from "../camera";
import { cameraRegionsOf, regionFor, type CameraRegion } from "../camera/regions";
import {
  cameraRigProblem,
  centreOf,
  createCameraRig,
  type CameraFrame,
  type RigInput,
} from "../camera/rig";
import { createRegistry, defineEntityType, defineGame } from "../game/define";
import { primitiveFields, type CameraRigDef } from "../game/primitives";
import type { EngineContext, GameDefinition } from "../game/types";
import { createHeadlessRuntime } from "../headless/headless";
import type { PixiView } from "../render/pixi-view";
import { snapshotDigest } from "../runtime/recorder";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import type { Vec2 } from "../types";
import { playRig, type FrameRecord } from "./fixtures/frame-clock";

// ─── The rig, pure ────────────────────────────────────────

const FAR = 1000;

function input(over: Partial<RigInput> = {}): RigInput {
  return {
    dtMs: 1000 / 60,
    targets: [],
    regions: [],
    view: { width: 19.2, height: 10.8 },
    bounds: { min: { x: -FAR, y: -FAR }, max: { x: FAR, y: FAR } },
    pxPerMetre: 100,
    reducedMotion: false,
    ...over,
  };
}

const STILL: Vec2 = { x: 0, y: 0 };
const at = (x: number, y: number, velocity: Vec2 = { x: 0, y: 0 }, weight = 1) => ({
  at: { x, y },
  velocity,
  weight,
});

const region = (
  id: string,
  min: [number, number],
  max: [number, number],
  extra: Partial<CameraRegion> = {},
): CameraRegion => ({
  id,
  min: { x: min[0], y: min[1] },
  max: { x: max[0], y: max[1] },
  clamp: true,
  ease: 0.4,
  ...extra,
});

/** `frames` frames of `dtMs` toward the same input; the last frame. */
function run(
  rig: ReturnType<typeof createCameraRig>,
  frames: number,
  over: Partial<RigInput>,
): CameraFrame {
  let frame: CameraFrame | null = null;
  for (let i = 0; i < frames; i++) frame = rig.update(input(over));
  return frame!;
}

describe("createCameraRig", () => {
  it("doesn't move the camera while the target stays inside the deadzone", () => {
    const rig = createCameraRig({ deadzone: [2, 1], damping: 0 }, "s");
    expect(rig.update(input({ targets: [at(0, 0)] })).position).toEqual({ x: 0, y: 0 });
    for (const [x, y] of [
      [0.9, 0.4],
      [-1, -0.5],
      [0.5, 0],
    ] as const) {
      expect(run(rig, 10, { targets: [at(x, y)] }).position).toEqual({ x: 0, y: 0 });
    }
    // Past the edge it moves only far enough to bring the target back to it.
    expect(rig.update(input({ targets: [at(3, 0)] })).position).toEqual({ x: 2, y: 0 });
  });

  it("leads the target by its velocity, capped at maxLead", () => {
    const rig = createCameraRig({ lookAhead: 0.5, maxLead: 1, damping: 0 }, "s");
    expect(rig.update(input({ targets: [at(0, 0, { x: 1, y: 0 })] })).position.x).toBeCloseTo(
      0.5,
      12,
    );
    expect(rig.update(input({ targets: [at(0, 0, { x: 10, y: 0 })] })).position.x).toBeCloseTo(
      1,
      12,
    );
    const diagonal = rig.update(input({ targets: [at(0, 0, { x: 30, y: 40 })] })).position;
    expect(diagonal.x).toBeCloseTo(0.6, 12);
    expect(diagonal.y).toBeCloseTo(0.8, 12);
  });

  it("damps the same at 60 and 144 Hz: one second lands within 0.005 m", () => {
    const after = (hz: number) => {
      const rig = createCameraRig({ damping: 0.12 }, "s");
      rig.update(input({ targets: [at(0, 0)] }));
      return run(rig, hz, { dtMs: 1000 / hz, targets: [at(10, 0)] }).position.x;
    };
    const sixty = after(60);
    const fast = after(144);
    expect(Math.abs(sixty - fast)).toBeLessThan(0.005);
    expect(sixty).toBeCloseTo(10 * (1 - Math.pow(0.5, 1 / 0.12)), 6);
    expect(sixty).toBeLessThan(10);
  });

  it("fits two targets in view, zooming out no further than minZoom", () => {
    const def: CameraRigDef = { fit: { padding: 1, minZoom: 0.5, maxZoom: 2 }, damping: 0 };
    const far = createCameraRig(def, "s").update(input({ targets: [at(-50, 0), at(50, 0)] }));
    expect(far.zoom).toBe(0.5);
    const near = createCameraRig(def, "s").update(input({ targets: [at(-10, 0), at(10, 0)] }));
    expect(near.zoom).toBeCloseTo(19.2 / 22, 12);
    expect(near.position).toEqual({ x: 0, y: 0 });
    // Close together, the rig's own zoom stands.
    const close = createCameraRig(def, "s").update(input({ targets: [at(-1, 0), at(1, 0)] }));
    expect(close.zoom).toBe(1);
  });

  it("clamps the view inside a region, easing into its framing and back out", () => {
    const room = region("room", [0, 0], [30, 20], { ease: 0.5 });
    const rig = createCameraRig({ damping: 0 }, "s");
    expect(rig.update(input({ targets: [at(-50, 10)], regions: [room] })).position).toEqual({
      x: -50,
      y: 10,
    });
    const inside = { targets: [at(2, 10)], regions: [room] };
    const halfway = run(rig, 15, inside).position.x;
    expect(halfway).toBeGreaterThan(-50);
    expect(halfway).toBeLessThan(9.6);
    // 0.5 s in: the view's left edge on the region's.
    expect(run(rig, 20, inside).position).toEqual({ x: 9.6, y: 10 });
    expect(run(rig, 10, { ...inside, targets: [at(29, 1)] }).position).toEqual({
      x: 20.4,
      y: 5.4,
    });

    const out = { targets: [at(-50, 10)], regions: [room] };
    const leaving = run(rig, 5, out).position.x;
    expect(leaving).toBeLessThan(20.4);
    expect(leaving).toBeGreaterThan(-50);
    expect(run(rig, 40, out).position).toEqual({ x: -50, y: 10 });
  });

  it("takes a region's zoom while it frames the target", () => {
    const rig = createCameraRig({ damping: 0 }, "s");
    const room = region("room", [0, 0], [100, 100], { zoom: 2, ease: 0 });
    expect(rig.update(input({ targets: [at(50, 50)], regions: [room] })).zoom).toBe(2);
    expect(rig.update(input({ targets: [at(-50, 50)], regions: [room] })).zoom).toBe(1);
  });

  it("frames the smallest of overlapping regions, then the first in scene order", () => {
    const big = region("big", [0, 0], [100, 100], { zoom: 1 });
    const small = region("small", [40, 40], [60, 60], { zoom: 2 });
    const twin = region("twin", [40, 40], [60, 60], { zoom: 3 });
    expect(regionFor([{ at: { x: 50, y: 50 } }], [big, small, twin])?.id).toBe("small");
    expect(regionFor([{ at: { x: 50, y: 50 } }], [twin, small, big])?.id).toBe("twin");
    expect(regionFor([{ at: { x: 10, y: 10 } }], [big, small])?.id).toBe("big");
    expect(regionFor([{ at: { x: -10, y: 10 } }], [big, small])).toBeNull();
    expect(regionFor([], [big])).toBeNull();
    // The first target decides, not the others.
    expect(regionFor([{ at: { x: -10, y: 0 } }, { at: { x: 50, y: 50 } }], [big])).toBeNull();

    const rig = createCameraRig({ damping: 0 }, "s");
    expect(rig.update(input({ targets: [at(50, 50)], regions: [big, small] })).zoom).toBe(2);
  });

  it("shakes not at all under reduced motion", () => {
    const rig = createCameraRig(
      { damping: 0, shake: { maxOffset: 20, maxTurn: 0.1, decay: 1 } },
      "s",
    );
    rig.update(input({ targets: [at(3, 4)] }));
    rig.request({ op: "shake", trauma: 1 });
    const frame = rig.update(input({ targets: [at(3, 4)], reducedMotion: true }));
    expect(frame).toEqual({ position: { x: 3, y: 4 }, zoom: 1, rotation: 0 });
    expect(rig.trauma).toBe(0);
  });

  it("shakes the same from the same seed, by trauma² within maxOffset, decaying", () => {
    const shake = { maxOffset: 20, maxTurn: 0.1, decay: 1 };
    const frames = (seed: string) => {
      const rig = createCameraRig({ damping: 0, shake }, seed);
      rig.update(input({ targets: [at(0, 0)] }));
      rig.request({ op: "shake", trauma: 0.8 });
      return Array.from({ length: 30 }, () => rig.update(input({ targets: [at(0, 0)] })));
    };
    const a = frames("level-1");
    expect(frames("level-1")).toEqual(a);
    expect(frames("level-2")).not.toEqual(a);
    const limit = (0.8 * 0.8 * shake.maxOffset) / 100;
    expect(a.some((f) => f.position.x !== 0)).toBe(true);
    for (const f of a) {
      expect(Math.abs(f.position.x)).toBeLessThanOrEqual(limit);
      expect(Math.abs(f.rotation)).toBeLessThanOrEqual(0.8 * 0.8 * shake.maxTurn);
    }

    const rig = createCameraRig({ damping: 0, shake }, "level-1");
    rig.request({ op: "shake", trauma: 0.5 });
    rig.request({ op: "shake", trauma: 0.7 });
    expect(rig.trauma).toBe(1);
    run(rig, 30, { targets: [at(0, 0)] });
    expect(rig.trauma).toBeCloseTo(0.5, 6);
    run(rig, 60, { targets: [at(0, 0)] });
    expect(rig.trauma).toBe(0);
  });

  it("follows a requested target until follow(null), eases a zoom and jumps on a snap", () => {
    const rig = createCameraRig({ damping: 0 }, "s");
    rig.request({ op: "follow", target: { entity: "hero" } });
    expect(rig.following).toEqual({ entity: "hero" });
    rig.request({ op: "follow", target: null });
    expect(rig.following).toBeNull();

    rig.update(input({ targets: [at(0, 0)] }));
    rig.request({ op: "zoom", zoom: 2, ms: 100 });
    const mid = run(rig, 3, { targets: [at(0, 0)] }).zoom;
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(2);
    expect(run(rig, 10, { targets: [at(0, 0)] }).zoom).toBe(2);
    rig.request({ op: "zoom", zoom: 0.5 });
    expect(rig.update(input({ targets: [at(0, 0)] })).zoom).toBe(0.5);

    const slow = createCameraRig({ damping: 1 }, "s");
    slow.update(input({ targets: [at(0, 0)] }));
    slow.request({ op: "snap", at: { x: 7, y: -3 } });
    expect(slow.update(input({ targets: [at(0, 0)] })).position).toEqual({ x: 7, y: -3 });
    slow.request({ op: "snap" });
    expect(slow.update(input({ targets: [at(40, 0)] })).position).toEqual({ x: 40, y: 0 });
  });

  it("holds still with no targets, starting on the bounds' centre", () => {
    const rig = createCameraRig({}, "s");
    const bounds = { min: { x: 0, y: 0 }, max: { x: 100, y: 40 } };
    expect(rig.update(input({ bounds })).position).toEqual({ x: 50, y: 20 });
    expect(run(rig, 10, { bounds }).position).toEqual({ x: 50, y: 20 });
  });

  it("keeps every zoom within the camera's limits, and sizes its clamp from that zoom", () => {
    const tight: CameraRegion = {
      id: "tight",
      min: { x: 0, y: 0 },
      max: { x: 10, y: 10 },
      zoom: 50,
      clamp: true,
      ease: 0,
    };
    const rig = createCameraRig({ damping: 0 }, "s");
    const frame = rig.update(input({ targets: [at(9, 5)], regions: [tight] }));
    expect(frame.zoom).toBe(MAX_CAMERA_ZOOM);
    // At zoom 5 the view is 3.84 m wide, so the right edge holds it at 10 − 1.92.
    expect(frame.position.x).toBeCloseTo(8.08, 9);
    rig.request({ op: "zoom", zoom: 0.001 });
    expect(rig.update(input({ targets: [at(-50, 0)] })).zoom).toBe(MIN_CAMERA_ZOOM);
  });

  it("ignores a request whose numbers it can't show, and takes the next good one", () => {
    const rig = createCameraRig({ damping: 0 }, "s");
    rig.update(input({ targets: [at(3, 4)] }));
    for (const zoom of [NaN, Infinity, 0, -2]) rig.request({ op: "zoom", zoom });
    rig.request({ op: "zoom", zoom: 2, ms: NaN });
    rig.request({ op: "zoom", zoom: 2, ms: 100, ease: "smooth" as EaseName });
    rig.request({ op: "shake", trauma: NaN });
    rig.request({ op: "shake", trauma: Infinity });
    rig.request({ op: "snap", at: { x: NaN, y: 0 } });
    rig.request({ op: "follow", target: { point: { x: 0, y: Infinity } } });
    expect(rig.trauma).toBe(0);
    expect(rig.following).toBeNull();
    expect(rig.update(input({ targets: [at(3, 4)] }))).toEqual({
      position: { x: 3, y: 4 },
      zoom: 1,
      rotation: 0,
    });
    rig.request({ op: "shake", trauma: 0.5 });
    expect(rig.trauma).toBe(0.5);
    rig.request({ op: "zoom", zoom: 2 });
    expect(rig.update(input({ targets: [at(3, 4)] })).zoom).toBe(2);
  });
});

describe("centreOf", () => {
  it("weights the targets' positions and velocities, skipping any without a positive weight", () => {
    expect(
      centreOf([at(0, 0, { x: 2, y: 0 }, 1), at(10, 4, { x: 0, y: 0 }, 3), at(99, 99, STILL, 0)]),
    ).toEqual({ at: { x: 7.5, y: 3 }, velocity: { x: 0.5, y: 0 } });
    expect(centreOf([at(5, 5, STILL, 0), at(1, 1, STILL, -2)])).toBeNull();
    expect(centreOf([])).toBeNull();
  });
});

describe("cameraRigProblem", () => {
  it("says what's wrong with settings that aren't a rig", () => {
    expect(
      cameraRigProblem({ damping: 0.2, fit: { padding: 1, minZoom: 0.5, maxZoom: 2 } }),
    ).toBeNull();
    expect(cameraRigProblem({ fit: { padding: -1, minZoom: 0.5, maxZoom: 2 } })).toMatch(
      /^fit\.padding: /,
    );
    expect(cameraRigProblem({ deadzone: "wide" })).toMatch(/^deadzone: /);
    expect(cameraRigProblem({ deadzone: [-1, 0] })).toMatch(/^deadzone\.0: /);
    expect(cameraRigProblem({ deadzone: [0, 0] })).toBeNull();
    expect(cameraRigProblem({ fit: { padding: 1, minZoom: 2, maxZoom: 1 } })).toBe(
      "fit.maxZoom: minZoom is more than maxZoom",
    );
    expect(cameraRigProblem({ fit: { padding: 1, minZoom: 1, maxZoom: 1 } })).toBeNull();
    expect(cameraRigProblem({ follow: true })).not.toBeNull();
  });
});

describe("cameraRegionsOf", () => {
  it("reads camera-region entities and types based on it, defaults applied, in scene order", () => {
    const room = defineEntityType({
      type: "room",
      base: "camera-region",
      description: "A room the camera frames.",
      fields: (env) => primitiveFields("camera-region", env),
    });
    const registry = createRegistry(
      defineGame({
        id: "rooms",
        types: [room],
        actions: [],
        createRuntime: () => ({ snapshot: () => null }),
      }),
    );
    const regions = cameraRegionsOf(
      [
        {
          id: "a",
          type: "camera-region",
          shape: { type: "box", cx: 5, cy: 5, hw: 5, hh: 2, rotDeg: 0 },
        },
        { id: "m", type: "marker", at: [0, 0] },
        {
          id: "b",
          type: "room",
          shape: { type: "box", cx: 0, cy: 0, hw: 1, hh: 1, rotDeg: 0 },
          zoom: 2,
          clamp: false,
          ease: 0,
        },
      ],
      registry,
    );
    expect(regions).toEqual([
      { id: "a", min: { x: 0, y: 3 }, max: { x: 10, y: 7 }, clamp: true, ease: 0.4 },
      { id: "b", min: { x: -1, y: -1 }, max: { x: 1, y: 1 }, zoom: 2, clamp: false, ease: 0 },
    ]);
  });
});

// ─── The rig in the shell ─────────────────────────────────

vi.mock("../renderer", async () => (await import("./fixtures/frame-clock")).stubRenderer());

/** The camera each frame hands the view, and the views made, in order. */
const seen = vi.hoisted((): FrameRecord => ({ frames: [], views: [] }));
vi.mock("../render/pixi-view", async (importOriginal) =>
  (await import("./fixtures/frame-clock")).recordingPixiView(importOriginal, seen),
);

const { advance, lastFrame, create, playing, editing } = playRig(seen, { performance: true });

const followed = (id: string, x: number, y: number): EntityDef =>
  ({ id, type: "marker", at: [x, y], behaviors: { "camera-target": {} } }) as EntityDef;

function sceneOf(entities: EntityDef[], game: string): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "rigged",
    game,
    bounds: [-100, -100, 100, 100],
    settings: { physics: "none" },
    entities,
  };
}

describe("the rig in Play", () => {
  const framer = (camera: CameraRigDef) =>
    defineGame({
      id: "framer",
      types: [],
      actions: [],
      world: { physics: "none" },
      camera,
      createRuntime: () => ({ snapshot: () => null }),
    });

  it("follows the camera-target entities when the game names no target", async () => {
    const game = await playing(
      sceneOf([followed("hero", 12, -4)], "framer"),
      framer({ damping: 0.1 }),
    );
    expect(lastFrame()).toEqual({ x: 12, y: -4, zoom: 1 });
    expect(game.runtime()!.update([followed("hero", 40, -4)])).toEqual({ ok: true });
    advance(3);
    expect(lastFrame().x).toBeGreaterThan(12);
    expect(lastFrame().x).toBeLessThan(40);
    advance(120);
    expect(lastFrame().x).toBeCloseTo(40, 3);
  });

  it("frames the scene's regions, read again after an edit, and draws them only while editing", async () => {
    const room: EntityDef = {
      id: "room",
      type: "camera-region",
      shape: ["box", 10, -4, 12, 8],
      zoom: 1,
      ease: 0,
    } as EntityDef;
    const scene = sceneOf([followed("hero", 20, -4), room], "framer");
    const instance = await editing(scene, framer({ damping: 0 }));
    const outline = (view: PixiView) => view.container.getChildByLabel("room", true);
    expect(outline(seen.views.at(-1)!)?.visible).toBe(true);

    expect(instance.play(scene).ok).toBe(true);
    advance(1);
    expect(outline(seen.views.at(-1)!)?.visible).toBe(false);
    // The room's right edge holds the view: 22 − 19.2 / 2.
    expect(lastFrame().x).toBeCloseTo(12.4, 9);
    const zoomed = {
      id: "room",
      type: "camera-region",
      shape: { type: "box", cx: 10, cy: -4, hw: 12, hh: 8, rotDeg: 0 },
      zoom: 2,
      ease: 0,
    } as const;
    expect(instance.runtime()!.update([zoomed])).toEqual({ ok: true });
    advance(1);
    expect(lastFrame().zoom).toBe(2);
  });

  it("frames a region with no camera settings anywhere, and goes back to the plain follow without one", async () => {
    const plain = defineGame({
      id: "plain",
      types: [],
      actions: [],
      world: { physics: "none" },
      createRuntime: () => ({ snapshot: () => null }),
    });
    const room = {
      id: "room",
      type: "camera-region",
      shape: ["box", 10, -4, 12, 8],
      zoom: 2,
      ease: 0,
    } as EntityDef;
    const game = await playing(sceneOf([followed("hero", 20, -4), room], "plain"), plain);
    // The room's right edge holds the view at zoom 2: 22 − 19.2 / 4.
    expect(lastFrame()).toEqual({ x: 17.2, y: -4, zoom: 2 });

    game.runtime()!.remove(["room"]);
    const from = game.getStore().state.tick;
    advance(3);
    const ticks = game.getStore().state.tick - from;
    expect(ticks).toBeGreaterThan(0);
    // The plain follow: a tenth of the rest of the way to the hero per tick, at zoom 1.
    expect(lastFrame().x).toBeCloseTo(20 - (20 - 17.2) * 0.9 ** ticks, 9);
    expect(lastFrame().zoom).toBe(1);
    expect(game.getStore().state.camera.zoom).toBe(1);
  });

  /** A game with no camera settings that runs what `asks` holds after its next step. */
  const asking = (asks: ((ctx: EngineContext) => void)[]) =>
    defineGame({
      id: "asking",
      types: [],
      actions: [],
      world: { physics: "none" },
      createRuntime: (ctx) => ({
        afterStep() {
          for (const ask of asks.splice(0)) ask(ctx);
        },
        snapshot: () => null,
      }),
    });

  it("starts a rig a request makes where the plain follow left the camera", async () => {
    const asks: ((ctx: EngineContext) => void)[] = [];
    const game = await playing(sceneOf([followed("hero", 20, -4)], "asking"), asking(asks));
    expect(game.runtime()!.update([followed("hero", 40, -4)])).toEqual({ ok: true });
    advance(4);
    const lagging = lastFrame();
    expect(lagging.x).toBeGreaterThan(20);
    expect(lagging.x).toBeLessThan(39);

    asks.push((ctx) => ctx.present.camera.zoom(1));
    const from = game.getStore().state.tick;
    advance(1);
    expect(game.getStore().state.tick).toBe(from + 1);
    expect(lastFrame()).toEqual(lagging);
    advance(120);
    expect(lastFrame().x).toBeCloseTo(40, 3);
  });

  it("times a request's rig from its own first frame after the region rig went", async () => {
    const asks: ((ctx: EngineContext) => void)[] = [];
    const room = {
      id: "room",
      type: "camera-region",
      shape: ["box", 10, -4, 12, 8],
      ease: 0,
    } as EntityDef;
    const game = await playing(sceneOf([followed("hero", 20, -4), room], "asking"), asking(asks));
    game.runtime()!.remove(["room"]);
    advance(90);
    asks.push((ctx) => ctx.present.camera.zoom(2, { ms: 1000 }));
    advance(1);
    expect(lastFrame().zoom).toBe(1);
    advance(30);
    expect(lastFrame().zoom).toBeGreaterThan(1);
    expect(lastFrame().zoom).toBeLessThan(2);
  });

  it("refuses a game whose camera settings aren't a rig", async () => {
    const bad = defineGame({
      id: "bad-camera",
      types: [],
      actions: [],
      world: { physics: "none" },
      camera: { damping: -1 },
      createRuntime: () => ({ snapshot: () => null }),
    });
    await expect(create(bad)).rejects.toThrow(/camera: damping/);
  });

  it("ends a run with camera requests on the digest a headless run ends on", async () => {
    type State = { draws: number[] };
    const shaker: GameDefinition<State> = defineGame({
      id: "shaker",
      types: [],
      actions: [],
      world: { physics: "none" },
      camera: { damping: 0, shake: { maxOffset: 30, maxTurn: 0.05, decay: 0.5 } },
      createRuntime(ctx) {
        const state: State = { draws: [] };
        return {
          afterStep() {
            state.draws.push(ctx.random.below(1000));
            if (ctx.tick % 20 === 0) ctx.present.camera.shake(0.9);
            if (ctx.tick === 30) ctx.present.camera.zoom(1.5, { ms: 200, ease: "quadOut" });
            if (ctx.tick === 40) ctx.present.camera.follow({ point: { x: 8, y: 8 } });
            if (ctx.tick === 50) ctx.present.camera.snap();
          },
          snapshot: () => state,
        };
      },
    });
    const scene = { ...sceneOf([followed("hero", 3, 3)], "shaker"), name: "shaken" };
    const shell = await playing(scene, shaker as GameDefinition);
    advance(78);
    const runtime = shell.runtime()!;
    const ticks = shell.getStore().state.tick;
    expect(ticks).toBeGreaterThan(60);
    expect(seen.frames.some((f) => f.x !== 3 && f.x !== 8)).toBe(true);
    expect(lastFrame().zoom).toBe(1.5);

    const headless = createHeadlessRuntime({
      game: shaker as GameDefinition,
      scene: expandScene(scene, createRegistry(shaker as GameDefinition)),
    });
    try {
      for (let i = 0; i < ticks; i++) headless.step(headless.ctx.time.tickMs, []);
      expect(snapshotDigest(headless.snapshot())).toBe(snapshotDigest(runtime.snapshot()));
    } finally {
      headless.destroy();
    }
  });
});

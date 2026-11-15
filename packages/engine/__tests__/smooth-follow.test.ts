// @vitest-environment jsdom
import type { Container } from "pixi.js";
import { describe, expect, it, vi } from "vite-plus/test";

import type { CharacterSystem } from "../game/behaviors/character-top-down";
import { DEFAULT_LENGTH_UNIT } from "../game/defaults";
import { defineGame } from "../game/define";
import { spriteViewId } from "../runtime/behaviors/sprite";
import type { SceneRuntimeHandle } from "../runtime/types";
import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import type { GameInstance } from "../types";
import { playRig, TICK_MS, type FrameRecord } from "./fixtures/frame-clock";
import { oneSceneVersion } from "./fixtures/live-version";

vi.mock("../renderer", async () => (await import("./fixtures/frame-clock")).stubRenderer());

const seen = vi.hoisted((): FrameRecord => ({ frames: [], views: [] }));
vi.mock("../render/pixi-view", async (importOriginal) =>
  (await import("./fixtures/frame-clock")).recordingPixiView(importOriginal, seen),
);

const { frameIn, playing, editing, lastFrame } = playRig(seen, { performance: true });

const SPEED = 3;

const ctxOf = (game: GameInstance) => (game.runtime() as SceneRuntimeHandle).ctx;
const BOX = ["box", 0, 0, 0.3, 0.3] as const;
const PATH = {
  pts: [
    [0, 0],
    [400, 0],
  ],
  mode: "loop",
  speed: SPEED,
  pauseMs: 0,
};

type Physics = "none" | "rapier";

function sceneOf(
  entities: EntityDef[],
  physics: Physics,
  camera?: Record<string, number>,
): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "smooth-follow",
    bounds: [-500, -500, 500, 500],
    settings: { physics, gravity: [0, 0], ...(camera ? { camera } : {}) },
    entities,
  } as SceneDefinition;
}

const target = { "camera-target": {}, sprite: { size: [0.6, 0.6] } };

/** One way of moving the followed `hero` right at `SPEED` m/s. */
type Mover = {
  name: string;
  physics: Physics;
  entities: EntityDef[];
  /** The hero's display: its sprite's, unless the type draws the entity itself. */
  label?: string;
  /** Sets it going once Play has started. */
  go?: (game: GameInstance) => void;
  /** False where a snapped `setPose` doesn't hold: the type can't be posed, or what drives it pulls it back. */
  teleports?: false;
};

const movers: Mover[] = [
  {
    name: "a follower",
    physics: "none",
    entities: [{ id: "hero", type: "follower", shape: [...BOX], path: PATH, behaviors: target }],
    teleports: false,
  },
  {
    name: "a Rapier body",
    physics: "rapier",
    entities: [
      {
        id: "hero",
        type: "marker",
        at: [0, 0],
        behaviors: { collider: { shape: [...BOX] }, body: {}, ...target },
      },
    ],
    go: (game) => ctxOf(game).bodies.setVelocity("hero", { x: SPEED, y: 0 }),
  },
  {
    name: "a prop drawn by its body",
    physics: "rapier",
    label: "hero",
    entities: [
      {
        id: "hero",
        type: "prop",
        shape: [...BOX],
        density: 1,
        restitution: 0,
        behaviors: { "camera-target": {} },
      } as EntityDef,
    ],
    go: (game) => ctxOf(game).bodies.setVelocity("hero", { x: SPEED, y: 0 }),
  },
  {
    name: "a kinematic mover",
    physics: "rapier",
    entities: [
      {
        id: "hero",
        type: "marker",
        at: [0, 0],
        behaviors: {
          collider: { shape: [...BOX] },
          body: { kind: "kinematic" },
          "path-follow": { path: PATH },
          ...target,
        },
      },
    ],
    teleports: false,
  },
  {
    name: "a character controller",
    physics: "rapier",
    entities: [
      {
        id: "hero",
        type: "marker",
        at: [0, 0],
        behaviors: {
          collider: { shape: [...BOX] },
          "character-top-down": { maxSpeed: SPEED },
          ...target,
        },
      },
    ],
    go: (game) =>
      ctxOf(game)
        .behavior<CharacterSystem>("character-top-down")!
        .setIntent("hero", { move: { x: 1, y: 0 } }),
  },
  {
    name: "a body on a motored slider",
    physics: "rapier",
    entities: [
      {
        id: "rail",
        type: "marker",
        at: [0, 0],
        behaviors: { collider: { shape: [...BOX] }, body: { kind: "static" } },
      },
      {
        id: "hero",
        type: "marker",
        at: [0, 0],
        behaviors: {
          collider: { shape: [...BOX] },
          body: {},
          joint: {
            kind: "prismatic",
            to: "rail",
            axis: [1, 0],
            motor: { velocity: SPEED, maxForce: 1e4 },
          },
          ...target,
        },
      },
    ],
  },
  {
    name: "a body welded to a kinematic mover",
    physics: "rapier",
    entities: [
      {
        id: "cart",
        type: "marker",
        at: [0, 0],
        behaviors: {
          collider: { shape: [...BOX] },
          body: { kind: "kinematic" },
          "path-follow": { path: PATH },
        },
      },
      {
        id: "hero",
        type: "marker",
        at: [0, -1],
        behaviors: {
          collider: { shape: [...BOX] },
          body: {},
          joint: { kind: "weld", to: "cart" },
          ...target,
        },
      },
    ],
    teleports: false,
  },
  {
    name: "a child under a moving parent",
    physics: "none",
    entities: [
      { id: "cart", type: "follower", shape: [...BOX], path: PATH },
      {
        id: "hero",
        type: "marker",
        parent: "cart",
        at: [0, -1],
        behaviors: { collider: { shape: [...BOX] }, ...target },
      },
    ],
  },
];

/** A game that only snaps to whole pixels. */
const snapper = defineGame({
  id: "snapper",
  types: [],
  actions: [],
  resolution: { pixelSnap: true },
  createRuntime: () => ({ snapshot: () => null }),
});

const mover = (name: string): Mover => movers.find((m) => m.name === name)!;
const FOLLOWER = "a follower";
const BODY = "a Rapier body";

async function start(
  m: Mover,
  camera?: Record<string, number>,
  pixelSnap = false,
): Promise<GameInstance> {
  const scene = sceneOf(m.entities, m.physics, camera);
  const game = pixelSnap
    ? await playing({ ...scene, game: snapper.id }, snapper)
    : await playing(scene);
  m.go?.(game);
  labels = [m.label ?? spriteViewId("hero")];
  return game;
}

/** The hero's display labels, the first drawn being the hero's. */
let labels = [spriteViewId("hero")];

function hero(): Container {
  const view = seen.views.at(-1)!;
  for (const label of labels) {
    const found = view.container.getChildByLabel(label, true) as Container | null;
    if (found) return found;
  }
  throw new Error("the hero isn't drawn");
}

/** Where the hero is on the canvas and in the drawn world, px, after the last frame. */
const sample = () => {
  const h = hero();
  return { screen: h.getGlobalPosition().x, world: h.position.x };
};

/** A seeded stream of frame lengths `ms` apart, each ± up to `jitter` ms. */
function frameLengths(ms: number, jitter: number, seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return ms + (s / 0x1_0000_0000) * 2 * jitter - jitter;
  };
}

type Run = { screen: number[]; world: number[]; ms: number[] };

function drive(frames: number, next: () => number): Run {
  const run: Run = { screen: [], world: [], ms: [] };
  for (let i = 0; i < frames; i++) {
    const ms = next();
    frameIn(ms);
    const s = sample();
    run.screen.push(s.screen);
    run.world.push(s.world);
    run.ms.push(ms);
  }
  return run;
}

const steps = (xs: readonly number[]) => xs.slice(1).map((x, i) => x - xs[i]!);

/** The settled-follow bound: the hero holds still on screen and the world under it moves at constant speed. */
function expectSmooth(run: Run): void {
  for (const dx of steps(run.screen)) expect(Math.abs(dx)).toBeLessThan(0.5);
  const world = steps(run.world);
  const span = run.ms.slice(1).reduce((a, b) => a + b, 0);
  const pxPerMs = (run.world.at(-1)! - run.world[0]!) / span;
  expect(pxPerMs).toBeGreaterThan(0);
  world.forEach((dx, i) => {
    expect(dx).toBeGreaterThanOrEqual(0);
    expect(Math.abs(dx - pxPerMs * run.ms[i + 1]!)).toBeLessThan(0.5);
  });
}

/** The jump a teleport makes, in px: past this a step isn't the hero's own travel. */
const isJump = (dx: number, typical: number) => Math.abs(dx) > typical * 4 + 1;

/**
 * Across `before` and `after`, one frame carries the hero's whole jump (no
 * streak lerps across it), and the camera jumped with it, so the hero never
 * left its place on screen. `ticksHeld` is how many ticks of its travel a
 * jump that lands after a tick's move (a spawn, a swap) holds it back.
 */
function expectSnappedJump(before: Run, after: Run, ticksHeld = 0): void {
  const world = steps([...before.world, ...after.world]);
  const typical = Math.abs(steps(before.world).at(-1)!);
  const jumps = world.filter((dx) => isJump(dx, typical));
  expect(jumps).toHaveLength(1);
  expect(jumps[0]!).toBeGreaterThan(30);
  const settled = before.screen.at(-1)!;
  const held = (typical * ticksHeld * TICK_MS) / before.ms.at(-1)!;
  for (const x of after.screen) expect(Math.abs(x - settled)).toBeLessThan(held + 0.5);
}

describe("a followed body on screen", () => {
  // The 60 Hz sim against display rates that don't divide it, and one that does.
  const rates = [50, 75, 90, 120, 144, 165];

  for (const m of movers) {
    describe(m.name, () => {
      it.each(rates)("settles smooth at %i Hz", async (hz) => {
        await start(m);
        // The damped follow settles at the hero's speed, a few half-lives in.
        drive(hz * 3, () => 1000 / hz);
        expectSmooth(drive(hz, () => 1000 / hz));
      });

      it.each(rates)("settles smooth at %i Hz, frames jittered ±2 ms", async (hz) => {
        await start(m);
        const next = frameLengths(1000 / hz, 2, hz);
        drive(hz * 3, next);
        expectSmooth(drive(hz, next));
      });
    });
  }

  describe("with look-ahead on", () => {
    for (const m of movers) {
      it.each(rates)(`settles smooth at %i Hz, frames jittered ±2 ms (${m.name})`, async (hz) => {
        await start(m, { lookAhead: 0.4, damping: 0.15 });
        const next = frameLengths(1000 / hz, 2, hz + 7);
        drive(hz * 3, next);
        expectSmooth(drive(hz, next));
      });
    }
  });

  it("never reverses on screen while the camera catches up, frames jittered ±2 ms at 144 Hz", async () => {
    await start(mover(FOLLOWER));
    // From rest the camera lags, then gains: the hero's on-screen x only drifts one way.
    const run = drive(144, frameLengths(1000 / 144, 2, 3));
    const moving = steps(run.screen).filter((dx) => Math.abs(dx) > 1e-6);
    expect(moving.length).toBeGreaterThan(0);
    const sign = Math.sign(moving[0]!);
    for (const dx of moving) expect(Math.sign(dx)).toBe(sign);
  });

  it("frames the hero where it's drawn at every alpha, not where its last tick left it", async () => {
    await start(mover(FOLLOWER));
    drive(60 * 4, () => TICK_MS);
    const settled = sample().screen;
    // Half-tick frames: alpha alternates 0.5 and 0, yet the hero stays put on screen.
    const run = drive(40, () => TICK_MS / 2);
    for (const x of run.screen) expect(Math.abs(x - settled)).toBeLessThan(0.05);
  });

  it("stays monotonic through frames that run zero ticks and two", async () => {
    await start(mover(BODY));
    drive(60 * 3, () => TICK_MS);
    // A quarter-tick frame runs none; a near-double frame runs two.
    const pattern = [0.25, 0.25, 1.9, 0.3, 2.1, 1, 0.2, 1.8];
    let i = 0;
    const run = drive(64, () => pattern[i++ % pattern.length]! * TICK_MS);
    expectSmooth(run);
  });

  describe("snapped to whole pixels", () => {
    it.each(rates)("holds still on screen behind a locked camera at %i Hz", async (hz) => {
      await start(mover(BODY), { damping: 0 }, true);
      const next = frameLengths(1000 / hz, 2, hz + 11);
      drive(hz, next);
      const run = drive(hz, next);
      for (const x of run.screen) expect(x).toBe(run.screen[0]);
      for (const dx of steps(run.world)) expect(dx).toBeGreaterThanOrEqual(0);
    });

    it.each(rates)("keeps to one whole-pixel band behind a damped camera at %i Hz", async (hz) => {
      await start(mover(BODY), undefined, true);
      const next = frameLengths(1000 / hz, 2, hz + 13);
      drive(hz * 3, next);
      const run = drive(hz, next);
      for (const x of run.screen) expect(Number.isInteger(x)).toBe(true);
      expect(Math.max(...run.screen) - Math.min(...run.screen)).toBeLessThanOrEqual(1);
    });
  });

  describe("a teleport", () => {
    for (const m of movers.filter((m) => m.teleports !== false)) {
      it(`is one jump, with no streak and the camera snapped with it (${m.name})`, async () => {
        const game = await start(m);
        drive(60 * 3, () => 1000 / 144);
        const before = drive(30, () => 1000 / 144);
        const ctx = ctxOf(game);
        const at = ctx.poses.get("hero")!;
        ctx.setPose("hero", at.x + 40, at.y, undefined, { snap: true });
        expectSnappedJump(
          before,
          drive(60, () => 1000 / 144),
        );
      });
    }

    it("a respawn is one jump, with the camera snapped to the hero that spawned", async () => {
      let respawn = false;
      const respawner = defineGame({
        id: "respawner",
        types: [],
        actions: [],
        createRuntime: (ctx) => ({
          snapshot: () => null,
          afterStep() {
            if (!respawn) return;
            respawn = false;
            const at = ctx.poses.get("hero")!;
            ctx.destroy("hero");
            ctx.spawn({
              id: "marker#hero",
              type: "marker",
              at: [at.x + 40, at.y],
              behaviors: { collider: { shape: [...BOX] }, body: {}, ...target },
            });
            ctx.bodies.setVelocity("marker#hero", { x: SPEED, y: 0 });
          },
        }),
      });
      const m = mover(BODY);
      const game = await playing(
        { ...sceneOf(m.entities, m.physics), game: respawner.id },
        respawner,
      );
      m.go?.(game);
      labels = [spriteViewId("marker#hero"), spriteViewId("hero")];
      drive(60 * 3, () => 1000 / 144);
      const before = drive(30, () => 1000 / 144);
      respawn = true;
      expectSnappedJump(
        before,
        drive(60, () => 1000 / 144),
        1,
      );
    });

    it("a live swap that moves the hero is one jump, with the camera snapped with it", async () => {
      const swapper = defineGame({
        id: "swapper",
        types: [],
        actions: [],
        live: { timings: ["now"] },
        createRuntime: () => ({ snapshot: () => null }),
      });
      const m = mover(BODY);
      const scene = { ...sceneOf(m.entities, m.physics), game: swapper.id };
      const game = await playing(scene, swapper);
      m.go?.(game);
      labels = [spriteViewId("hero")];
      drive(60 * 3, () => 1000 / 144);
      const before = drive(30, () => 1000 / 144);
      const at = ctxOf(game).poses.get("hero")!;
      const [hero] = scene.entities as EntityDef[];
      const moved = {
        ...scene,
        entities: [{ ...hero!, at: [at.x + 40, at.y] }],
      } as SceneDefinition;
      const v = await oneSceneVersion(moved, swapper, { scene: scene.name, physics: "rapier" });
      expect(await game.live.stage(v)).toEqual({ ok: true });
      // A designer's move puts the hero where it's authored, at rest: set it going again.
      game.on("live:swapped", () => ctxOf(game).bodies.setVelocity("hero", { x: SPEED, y: 0 }));
      expect(game.live.activate(scene.name, v.id, "now").issue).toBeUndefined();
      expectSnappedJump(
        before,
        drive(60, () => 1000 / 144),
        1,
      );
    });

    it("a replay's seek back is one jump, with the camera snapped to where it lands", async () => {
      const m = mover(FOLLOWER);
      const scene = sceneOf(m.entities, m.physics);
      const game = await editing(scene);
      expect(game.play(scene).ok).toBe(true);
      drive(144 * 6, () => 1000 / 144);
      game.stop();
      expect(game.replay(scene, game.recording()!).ok).toBe(true);
      drive(144 * 2, () => 1000 / 144);
      const before = drive(30, () => 1000 / 144);
      const replay = game.replayHandle()!;
      await replay.seek(replay.tick - 90);
      frameIn(1000 / 144);
      const landed = sample();
      // The camera lands on the hero, its follow's lag dropped, rather than easing back across the seek.
      expect(Math.abs(landed.world - lastFrame().x * DEFAULT_LENGTH_UNIT)).toBeLessThan(1);
      const after = drive(60, () => 1000 / 144);

      const world = steps([...before.world, landed.world, ...after.world]);
      const typical = Math.abs(steps(before.world).at(-1)!);
      const jumps = world.filter((dx) => isJump(dx, typical));
      expect(jumps).toHaveLength(1);
      expect(jumps[0]!).toBeLessThan(-30);
      // From there it eases back to its lag, one way only.
      for (const dx of steps([landed.screen, ...after.screen])) {
        expect(dx).toBeGreaterThan(0);
        expect(dx).toBeLessThan(typical);
      }
    });
  });
});

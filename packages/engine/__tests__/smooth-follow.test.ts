// @vitest-environment jsdom
import type { Container } from "pixi.js";
import { describe, expect, it, vi } from "vite-plus/test";

import { SCENE_FORMAT_VERSION, type EntityDef, type SceneDefinition } from "../scene/types";
import { playRig, TICK_MS, type FrameRecord } from "./fixtures/frame-clock";

vi.mock("../renderer", async () => (await import("./fixtures/frame-clock")).stubRenderer());

const seen = vi.hoisted((): FrameRecord => ({ frames: [], views: [] }));
vi.mock("../render/pixi-view", async (importOriginal) =>
  (await import("./fixtures/frame-clock")).recordingPixiView(importOriginal, seen),
);

const { frameIn, playing } = playRig(seen, { performance: true });

/** A box running right at `speed` m/s, the camera's only target. */
function runner(physics: "none" | "rapier", speed: number): SceneDefinition {
  const hero = {
    id: "hero",
    type: "follower",
    shape: ["box", 0, 0, 0.3, 0.3],
    path: {
      pts: [
        [0, 0],
        [400, 0],
      ],
      mode: "loop",
      speed,
      pauseMs: 0,
    },
    behaviors: { "camera-target": {} },
  } as EntityDef;
  return {
    v: SCENE_FORMAT_VERSION,
    name: "smooth-follow",
    bounds: [-500, -500, 500, 500],
    settings: { physics },
    entities: [hero],
  };
}

/** The hero's drawn x on the canvas, px, after the last frame. */
function heroOnCanvas(): number {
  const view = seen.views.at(-1)!;
  const hero = view.container.getChildByLabel("hero", true) as Container | null;
  if (!hero) throw new Error("the hero isn't drawn");
  return hero.getGlobalPosition().x;
}

/** The on-canvas x after each of `frames` frames `ms` apart (± `jitter` ms, alternating). */
function drive(frames: number, ms: number, jitter = 0): number[] {
  const xs: number[] = [];
  for (let i = 0; i < frames; i++) {
    frameIn(ms + (i % 2 === 0 ? jitter : -jitter));
    xs.push(heroOnCanvas());
  }
  return xs;
}

const steps = (xs: readonly number[]) => xs.slice(1).map((x, i) => x - xs[i]!);

describe("a followed body on screen", () => {
  // The 60 Hz sim against display rates that don't divide it, and one that does.
  const rates = [50, 75, 90, 120, 144, 165];

  for (const physics of ["none", "rapier"] as const) {
    it.each(rates)(`settles still at %i Hz (${physics})`, async (hz) => {
      await playing(runner(physics, 3));
      // The damped follow settles at the hero's speed, a few half-lives in.
      drive(hz * 3, 1000 / hz);
      const xs = drive(hz, 1000 / hz);
      // A camera following a body at constant speed holds it in place on screen:
      // every frame's step is the same (zero), never a saw at the tick's beat.
      for (const dx of steps(xs)) expect(Math.abs(dx)).toBeLessThan(0.05);
    });
  }

  it("never reverses on screen while the camera catches up, frames jittered ±2 ms at 144 Hz", async () => {
    await playing(runner("none", 3));
    // From rest the camera lags, then gains: the hero's on-screen x only drifts one way.
    const xs = drive(144, 1000 / 144, 2);
    const moving = steps(xs).filter((dx) => Math.abs(dx) > 1e-6);
    expect(moving.length).toBeGreaterThan(0);
    const sign = Math.sign(moving[0]!);
    for (const dx of moving) expect(Math.sign(dx)).toBe(sign);
  });

  it("frames the hero where it's drawn at every alpha, not where its last tick left it", async () => {
    await playing(runner("none", 6));
    drive(60 * 4, TICK_MS);
    const settled = heroOnCanvas();
    // Half-tick frames: alpha alternates 0.5 and 0, yet the hero stays put on screen.
    const xs = drive(40, TICK_MS / 2);
    for (const x of xs) expect(Math.abs(x - settled)).toBeLessThan(0.05);
  });
});

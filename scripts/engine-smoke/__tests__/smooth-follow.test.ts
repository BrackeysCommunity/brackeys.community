// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveResolution, viewportFor } from "@jams/engine";
import { createRegistry } from "@jams/engine/game";
import { createHeadlessRuntime } from "@jams/engine/headless";
import { expandScene, parseSceneOrThrow, validateScene } from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { loadRapier } from "../browser/run";
import {
  FOLLOW_CANVAS,
  FOLLOW_HERO,
  FOLLOW_RESOLUTION,
  FOLLOW_SPEED,
  followGame,
  followScene,
  judgeSmoothFollow,
  judgeSmoothOutcome,
  litCentreX,
} from "../browser/smooth-follow";
import { REPO } from "../pack";
import { followProbe as probe } from "./media-probes";

/** A `width` × 1 RGBA frame lit by `cover` (0–1) per column. */
function row(cover: readonly number[]) {
  const data = new Uint8Array(cover.length * 4);
  cover.forEach((c, x) => {
    data[x * 4] = Math.round(c * 255);
    data[x * 4 + 3] = 255;
  });
  return { width: cover.length, height: 1, data };
}

describe("litCentreX", () => {
  it("finds a lit box's centre to a fraction of a pixel from its antialiased edges", () => {
    expect(litCentreX(row([0, 1, 1, 0]))).toBeCloseTo(2, 6);
    // The box shifted a quarter pixel right: its left edge a quarter dimmer, a quarter lit past its right.
    expect(litCentreX(row([0, 0.75, 1, 0.25]))).toBeCloseTo(2.25, 2);
    expect(litCentreX(row([0, 0, 0]))).toBeNull();
  });
});

describe("judgeSmoothFollow", () => {
  it.each([60, 75, 144])("passes a hero held still on screen at %i Hz", (hz) => {
    expect(judgeSmoothFollow(probe(hz))).toBeNull();
    expect(judgeSmoothFollow(probe(hz, (i) => 120 + (i % 2) * 0.3))).toBeNull();
  });

  it("fails a saw at the tick's beat, a missing draw, a short record and a still world", () => {
    expect(judgeSmoothFollow(probe(144, (i) => 120 + (i % 5 === 4 ? 1 : 0)))).toMatch(
      /moved 1\.00 px on screen between frames 3 and 4/,
    );
    expect(judgeSmoothFollow(probe(144, (i) => (i === 7 ? null : 120)))).toMatch(/frame 7/);
    expect(judgeSmoothFollow({ ...probe(144), screen: [120] })).toMatch(/recorded 1 frames/);
    expect(judgeSmoothFollow({ ...probe(144), origin: probe(144).origin.map(() => 0) })).toMatch(
      /isn't moving/,
    );
    expect(judgeSmoothFollow(undefined)).toMatch(/no smooth-follow run/);
  });

  it("fails a world that stutters or reverses under a hero held still", () => {
    const stutter = probe(144);
    // The camera stalls a frame then catches up: the travel overall still matches the speed.
    stutter.origin = stutter.origin.map((x, i, all) => (i === 40 ? all[39]! : x));
    expect(judgeSmoothFollow(stutter)).toMatch(
      /between frames 39 and 40, not the steady -2\.08 px/,
    );
    const back = probe(60);
    back.origin = back.origin.map((x, i) => (i === 10 ? x + 5.2 : x));
    expect(judgeSmoothFollow(back)).toMatch(/between frames 9 and 10/);
    const jitter = probe(90);
    jitter.at = jitter.at.map((ms, i) => ms + (i % 2) * 3);
    expect(judgeSmoothFollow(jitter)).toMatch(/carried the world .* between frames 0 and 1/);
    jitter.origin = jitter.at.map((ms) => 120 - (FOLLOW_SPEED * 100 * ms) / 1000);
    expect(judgeSmoothFollow(jitter)).toBeNull();
  });

  it("judges the world's speed by the recorded canvas's own scale", () => {
    // The default 1080 px view on a 135 px canvas: an eighth of the px per metre.
    const small = probe(60);
    small.origin = small.at.map((ms) => 120 - (FOLLOW_SPEED * 12.5 * ms) / 1000);
    expect(judgeSmoothFollow(small)).toMatch(/isn't moving/);
    expect(judgeSmoothFollow({ ...small, pxPerMetre: 12.5 })).toBeNull();
  });

  it("fails a passing outcome by its probe, and leaves a failed one's reason", () => {
    const bad = probe(144, (i) => 120 + i);
    expect(judgeSmoothOutcome({ status: "pass" as const }, bad)).toMatchObject({
      status: "fail",
      smoothFollow: bad,
    });
    expect(judgeSmoothOutcome({ status: "fail" as const, reason: "digest" }, bad).reason).toBe(
      "digest",
    );
    expect(judgeSmoothOutcome({ status: "pass" as const }, probe(90)).status).toBe("pass");
  });
});

describe("the smooth-follow scene", () => {
  it("shows a metre as the length unit's px on its canvas", () => {
    const vp = viewportFor(resolveResolution({ host: FOLLOW_RESOLUTION }), FOLLOW_CANVAS);
    expect(vp.scale).toBe(1);
    expect(vp.view).toEqual({ width: FOLLOW_CANVAS.width, height: FOLLOW_CANVAS.height });
  });

  it("is valid, and its game pushes the hero to the run's speed", async () => {
    const registry = createRegistry(followGame);
    expect(validateScene(followScene, registry).filter((i) => i.severity === "error")).toEqual([]);
    const rt = createHeadlessRuntime({
      rapier: await loadRapier(),
      registry,
      scene: expandScene(parseSceneOrThrow(followScene, registry), registry),
    });
    try {
      const from = rt.ctx.poses.get(FOLLOW_HERO)!.x;
      for (let i = 0; i < 60; i++) rt.step(rt.ctx.time.tickMs, []);
      expect(rt.ctx.poses.get(FOLLOW_HERO)!.x - from).toBeCloseTo(FOLLOW_SPEED, 2);
    } finally {
      rt.destroy();
    }
  });

  it("reaches the engine only through its public entries", () => {
    const source = readFileSync(
      join(REPO, "scripts/engine-smoke/browser/smooth-follow.ts"),
      "utf8",
    );
    const from = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(from.length).toBeGreaterThan(0);
    for (const specifier of from) expect(specifier).toMatch(/^@jams\/engine(\/|$)/);
  });
});

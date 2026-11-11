// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { DEFAULT_GRAVITY, SIDE_VIEW_CONTROLLER } from "../game/defaults";
import { createRegistry, defineGame } from "../game/define";
import type { GameDefinition } from "../game/types";
import { stuckDetector, STUCK_METRES, STUCK_TICKS } from "../headless/play-loop";
import { createPhysicsWorld } from "../physics";
import { createSceneRuntime } from "../runtime/runtime";
import type { StepEvent } from "../runtime/types";
import { hashText } from "../scene/hash";
import type { ExpandedScene, RuntimeEntity, ShapeObj } from "../scene/types";
import type { RapierModule } from "../types";

const DT = 1000 / 60;

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const box = (cx: number, cy: number, hw: number, hh: number, rotDeg = 0): ShapeObj => ({
  type: "box",
  cx,
  cy,
  hw,
  hh,
  rotDeg,
});

function gameAt(lengthUnit: number | undefined): GameDefinition {
  return defineGame({
    id: "units",
    types: [],
    actions: [],
    ...(lengthUnit === undefined ? {} : { world: { lengthUnit } }),
    createRuntime: () => ({ snapshot: () => null }),
  });
}

/** An 8 m bin: tumbling crates and balls, a lift, a one-way ledge and a sensor. */
function metricScene(): ExpandedScene {
  const entities: RuntimeEntity[] = [
    { id: "floor", type: "solid", shape: box(4, 6.1, 4, 0.1) },
    { id: "left", type: "solid", shape: box(-0.1, 3, 0.1, 3) },
    { id: "right", type: "solid", shape: box(8.1, 3, 0.1, 3) },
    { id: "ledge", type: "solid", shape: box(5.5, 3, 1, 0.05), oneWay: true },
    { id: "mist", type: "sensor", shape: box(2, 4, 1.5, 0.5) },
    {
      id: "lift",
      type: "follower",
      shape: box(1, 5, 0.5, 0.05),
      path: {
        pts: [
          [1, 5],
          [1, 3.5],
        ],
        mode: "ping_pong",
        speed: 1.5,
      },
    },
  ];
  for (let i = 0; i < 12; i++) {
    entities.push({
      id: `crate-${i}`,
      type: "prop",
      shape:
        i % 2 === 0
          ? box(
              0.6 + (i % 6) * 1.2,
              0.5 + Math.floor(i / 6) * 0.6,
              0.15 + (i % 3) * 0.05,
              0.12,
              i * 7,
            )
          : { type: "circle", cx: 0.6 + (i % 6) * 1.2, cy: 0.5 + Math.floor(i / 6) * 0.6, r: 0.14 },
      density: 1,
      restitution: 0.2,
    });
  }
  return {
    name: "units",
    bounds: [0, 0, 8, 6.2],
    settings: {
      gravity: DEFAULT_GRAVITY,
      physics: "rapier",
      grid: null,
      view: { projection: "orthogonal" },
    },
    entities,
  };
}

/** Every pose every ten ticks and every event over 600 ticks, hashed. */
function runDigest(game: GameDefinition): string {
  const rt = createSceneRuntime({ rapier, view: null, game });
  const report = rt.load(metricScene());
  if (!report.ok) throw new Error(report.error);
  const ids = metricScene().entities.map((e) => e.id);
  const poses: number[] = [];
  const events: StepEvent[] = [];
  for (let tick = 0; tick < 600; tick++) {
    events.push(...rt.step(DT, []).events);
    if (tick % 10 === 9) {
      for (const id of ids) {
        const p = rt.ctx.poses.get(id);
        if (p) poses.push(p.x, p.y, p.rot);
      }
    }
  }
  rt.destroy();
  expect(new Set(poses).size).toBeGreaterThan(ids.length * 3);
  return hashText(JSON.stringify([poses, events]));
}

describe("the simulation in metres", () => {
  it("gives one digest whatever px per metre the game draws at", () => {
    const at100 = runDigest(gameAt(100));
    expect(runDigest(gameAt(32))).toBe(at100);
    expect(runDigest(gameAt(48))).toBe(at100);
    expect(runDigest(gameAt(undefined))).toBe(at100);
  }, 30_000);

  it("refuses a px per metre that isn't a positive finite number", () => {
    for (const lengthUnit of [0, -100, Number.NaN, Infinity])
      expect(() => createRegistry(gameAt(lengthUnit)), String(lengthUnit)).toThrow(/lengthUnit/);
    expect(() => createRegistry(gameAt(32))).not.toThrow();
  });

  it("leaves Rapier at its default length unit", () => {
    const pw = createPhysicsWorld(rapier);
    const fresh = new rapier.World({ x: 0, y: 0 });
    expect(pw.world.lengthUnit).toBe(fresh.lengthUnit);
    fresh.free();
    pw.destroy();
  });

  it("rests a box on a floor at the px world's height ÷ 100", () => {
    /**
     * The same drop at `scale` world units per metre: the px world (100)
     * with Rapier's tolerances set to its scale, as a px simulation needs.
     */
    const restingY = (scale: number): number => {
      const pw = createPhysicsWorld(rapier, {
        gravity: { x: DEFAULT_GRAVITY[0] * scale, y: DEFAULT_GRAVITY[1] * scale },
      });
      if (scale !== 1) pw.world.lengthUnit = scale;
      const floor = pw.addRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, 2 * scale));
      pw.addCollider(rapier.ColliderDesc.cuboid(4 * scale, 0.1 * scale), floor);
      const crate = pw.addRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(0, 0));
      pw.addCollider(rapier.ColliderDesc.cuboid(0.2 * scale, 0.2 * scale).setRestitution(0), crate);
      for (let i = 0; i < 300; i++) pw.step();
      const y = crate.translation().y;
      expect(crate.linvel().y).toBeCloseTo(0, 3);
      pw.destroy();
      return y;
    };
    const metres = restingY(1);
    expect(metres).toBeGreaterThan(1.69);
    expect(metres).toBeLessThan(1.71);
    expect(Math.abs(metres - restingY(100) / 100)).toBeLessThan(1e-6);
  });

  it("converts the controller presets at 100 px per metre", () => {
    expect(DEFAULT_GRAVITY).toEqual([0, 12]);
    expect(SIDE_VIEW_CONTROLLER.autostep).toEqual({
      maxHeight: 0.04,
      minWidth: 0.02,
      dynamic: true,
    });
    expect(SIDE_VIEW_CONTROLLER.snapToGround).toBe(0.04);
  });
});

describe("the stuck detector in metres", () => {
  /** Whether holding movement while the focus creeps `perTick` metres a tick ever counts as stuck. */
  const stuckAt = (perTick: number, ticks = STUCK_TICKS * 2): boolean => {
    const stuck = stuckDetector();
    let hit = false;
    for (let t = 0; t < ticks; t++) hit = stuck(true, { x: 3 + perTick * t, y: 1 }) || hit;
    return hit;
  };

  it("is stuck when the focus moves under STUCK_METRES in STUCK_TICKS ticks", () => {
    expect(STUCK_METRES).toBe(0.04);
    expect(stuckAt(0)).toBe(true);
    expect(stuckAt(0.039 / STUCK_TICKS)).toBe(true);
  });

  it("isn't stuck when it moves further, or before the window fills", () => {
    expect(stuckAt(0.041 / STUCK_TICKS)).toBe(false);
    expect(stuckAt(0, STUCK_TICKS)).toBe(false);
  });

  it("measures the straight-line distance, diagonals included", () => {
    const diagonal = (step: number) => {
      const stuck = stuckDetector();
      let hit = false;
      for (let t = 0; t <= STUCK_TICKS; t++) hit = stuck(true, { x: step * t, y: step * t });
      return hit;
    };
    // 0.03 m along each axis is 0.0424 m along the diagonal: past the threshold.
    expect(diagonal(0.03 / STUCK_TICKS)).toBe(false);
    expect(diagonal(0.028 / STUCK_TICKS)).toBe(true);
  });

  it("starts over when movement is let go or the focus is lost", () => {
    const stuck = stuckDetector();
    for (let t = 0; t < STUCK_TICKS; t++) expect(stuck(true, { x: 0, y: 0 })).toBe(false);
    expect(stuck(false, { x: 0, y: 0 })).toBe(false);
    for (let t = 0; t < STUCK_TICKS; t++) expect(stuck(true, null)).toBe(false);
    for (let t = 0; t < STUCK_TICKS; t++) expect(stuck(true, { x: 0, y: 0 })).toBe(false);
    expect(stuck(true, { x: 0, y: 0 })).toBe(true);
  });
});

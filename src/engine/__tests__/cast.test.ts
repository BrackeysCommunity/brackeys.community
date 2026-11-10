// @vitest-environment node
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createRegistry } from "../game/define";
import type { SpawnShape } from "../game/types";
import { castSpawn } from "../runtime/cast";
import { createSceneRuntime } from "../runtime/runtime";
import { expandScene } from "../scene/expand";
import { SCENE_FORMAT_VERSION, type Pt, type SceneDefinition } from "../scene/types";
import type { RapierModule, Vec2 } from "../types";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const registry = createRegistry();
const BACKENDS = ["rapier", "none"] as const;
type Backend = (typeof BACKENDS)[number];

/** A box room: a floor, a left wall and a ceiling, with a sensor in the drop path. */
function room(physics: Backend, gravity: Pt): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "cast",
    bounds: [0, 0, 1000, 1000],
    settings: { physics, gravity },
    entities: [
      { id: "floor", type: "solid", shape: ["box", 500, 920, 500, 20] },
      { id: "wall", type: "solid", shape: ["box", 60, 500, 20, 500] },
      { id: "ceiling", type: "solid", shape: ["box", 500, 80, 500, 20] },
      { id: "mist", type: "sensor", shape: ["box", 600, 600, 100, 50] },
    ],
  };
}

function loaded(physics: Backend, gravity: Pt) {
  const rt = createSceneRuntime({ rapier, view: null, registry });
  const report = rt.load(expandScene(room(physics, gravity), registry));
  if (!report.ok) throw new Error(report.error);
  expect(rt.ctx.space.backend).toBe(physics === "rapier" ? "rapier" : "geometry");
  return rt;
}

const BOX: SpawnShape = { type: "box", hw: 20, hh: 20 };
const SHAPES: SpawnShape[] = [
  BOX,
  { type: "circle", r: 15 },
  { type: "capsule", halfLen: 10, r: 8 },
];

/** The cast's end, which must succeed. */
function castTo(physics: Backend, gravity: Pt, at: Vec2, shape: SpawnShape): Vec2 {
  const rt = loaded(physics, gravity);
  const cast = castSpawn(rt.ctx, at, shape);
  rt.destroy();
  if (!cast.ok) throw new Error(cast.error);
  return cast.at;
}

/** How far `shape` reaches from its centre along x and y. */
function extent(shape: SpawnShape): Vec2 {
  if (shape.type === "box") return { x: shape.hw, y: shape.hh };
  if (shape.type === "circle") return { x: shape.r, y: shape.r };
  return { x: shape.r, y: shape.halfLen + shape.r };
}

describe.each(BACKENDS)("castSpawn with physics %s", (physics) => {
  it('"gravity" (the default) drops a start onto the floor through a sensor', () => {
    for (const shape of SHAPES) {
      const at = castTo(physics, [0, 1200], { x: 600, y: 400 }, shape);
      expect(at.x).toBe(600);
      expect(at.y).toBeCloseTo(900 - extent(shape).y, 4);
      expect(at.y).toBeLessThanOrEqual(900 - extent(shape).y);
    }
    const explicit = castTo(physics, [0, 1200], { x: 600, y: 400 }, { ...BOX, cast: "gravity" });
    expect(explicit).toEqual(castTo(physics, [0, 1200], { x: 600, y: 400 }, BOX));
  });

  it('"none" leaves the start where it is', () => {
    const at = castTo(physics, [0, 1200], { x: 600, y: 400 }, { ...BOX, cast: "none" });
    expect(at).toEqual({ x: 600, y: 400 });
  });

  it("a direction casts along it, whatever gravity is", () => {
    const up = castTo(physics, [0, 1200], { x: 600, y: 400 }, { ...BOX, cast: [0, -3] });
    expect(up.x).toBe(600);
    expect(up.y).toBeCloseTo(120, 4);
    const left = castTo(physics, [0, 0], { x: 600, y: 400 }, { ...BOX, cast: [-1, 0] });
    expect(left.x).toBeCloseTo(100, 4);
    expect(left.y).toBe(400);
    const diagonal = castTo(physics, [0, 1200], { x: 600, y: 600 }, { ...BOX, cast: [-1, 1] });
    expect(diagonal.x + diagonal.y).toBeCloseTo(1200, 3);
    expect(diagonal.y).toBeCloseTo(880, 4);
    expect(castTo(physics, [0, 1200], { x: 600, y: 400 }, { ...BOX, cast: [0, 0] })).toEqual({
      x: 600,
      y: 400,
    });
  });

  it("a zero-gravity start isn't cast", () => {
    expect(castTo(physics, [0, 0], { x: 600, y: 400 }, BOX)).toEqual({ x: 600, y: 400 });
  });

  it("a sideways-gravity start casts sideways", () => {
    const left = castTo(physics, [-1200, 0], { x: 600, y: 400 }, BOX);
    expect(left.y).toBe(400);
    expect(left.x).toBeCloseTo(100, 4);
    const right = castTo(physics, [1200, 0], { x: 600, y: 400 }, BOX);
    expect(right, "nothing on the right: it stays").toEqual({ x: 600, y: 400 });
  });

  it("refuses a start inside a non-sensor collider, and not one inside a sensor", () => {
    const rt = loaded(physics, [0, 1200]);
    const cast = castSpawn(rt.ctx, { x: 500, y: 930 }, BOX);
    expect(cast).toEqual({ ok: false, error: "can't start inside a solid (floor) at 500, 930" });
    expect(castSpawn(rt.ctx, { x: 500, y: 930 }, { ...BOX, cast: "none" }).ok).toBe(false);
    expect(castSpawn(rt.ctx, { x: 600, y: 600 }, BOX).ok).toBe(true);
    rt.destroy();
  });

  it("stays put with nothing ahead, or outside the bounds", () => {
    expect(castTo(physics, [0, 1200], { x: 600, y: 1500 }, BOX)).toEqual({ x: 600, y: 1500 });
    expect(castTo(physics, [0, -1200], { x: 600, y: 500 }, { ...BOX, cast: [1, 0] })).toEqual({
      x: 600,
      y: 500,
    });
  });
});

describe("castSpawn on both backends", () => {
  it("lands each shape on the same spot along each direction", () => {
    const cases: { gravity: Pt; at: Vec2; cast?: Pt }[] = [
      { gravity: [0, 1200], at: { x: 600, y: 400 } },
      { gravity: [-500, 0], at: { x: 700, y: 300 } },
      { gravity: [0, -1], at: { x: 300, y: 500 } },
      { gravity: [0, 0], at: { x: 400, y: 450 }, cast: [-2, 3] },
    ];
    for (const { gravity, at, cast } of cases) {
      for (const base of SHAPES) {
        const shape = cast ? { ...base, cast } : base;
        const r = castTo("rapier", gravity, at, shape);
        const g = castTo("none", gravity, at, shape);
        // Rapier's capsule casts stop up to ~0.02px short of a face.
        const tol = base.type === "capsule" ? 0.05 : 1e-3;
        expect(
          Math.abs(r.x - g.x) + Math.abs(r.y - g.y),
          JSON.stringify({ gravity, shape }),
        ).toBeLessThan(tol);
      }
    }
  });

  it("casts straight down onto the floor top exactly", () => {
    expect(castTo("rapier", [0, 1200], { x: 300, y: 500 }, BOX)).toEqual({ x: 300, y: 880 });
    const g = castTo("none", [0, 1200], { x: 300, y: 500 }, BOX);
    expect(g.x).toBe(300);
    expect(880 - g.y).toBeGreaterThanOrEqual(0);
    expect(880 - g.y).toBeLessThan(1e-6);
  });
});

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

/** A 10 m box room: a floor, a left wall and a ceiling, with a sensor in the drop path. */
function room(physics: Backend, gravity: Pt): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "cast",
    bounds: [0, 0, 10, 10],
    settings: { physics, gravity },
    entities: [
      { id: "floor", type: "solid", shape: ["box", 5, 9.2, 5, 0.2] },
      { id: "wall", type: "solid", shape: ["box", 0.6, 5, 0.2, 5] },
      { id: "ceiling", type: "solid", shape: ["box", 5, 0.8, 5, 0.2] },
      { id: "mist", type: "sensor", shape: ["box", 6, 6, 1, 0.5] },
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

const BOX: SpawnShape = { type: "box", hw: 0.2, hh: 0.2 };
const SHAPES: SpawnShape[] = [
  BOX,
  { type: "circle", r: 0.15 },
  { type: "capsule", halfLen: 0.1, r: 0.08 },
];

/** Rapier holds positions as f32: a metric landing spot reads back within 1e-6 m of the exact one. */
const DIGITS = 5;
const G: Pt = [0, 12];

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
      const at = castTo(physics, G, { x: 6, y: 4 }, shape);
      expect(at.x).toBe(6);
      // Rapier's capsule cast stops up to ~0.0002 m short of the face, as in the cross-backend test.
      expect(at.y).toBeCloseTo(9 - extent(shape).y, shape.type === "capsule" ? 3 : DIGITS);
      expect(at.y).toBeLessThanOrEqual(9 - extent(shape).y + 1e-6);
    }
    const explicit = castTo(physics, G, { x: 6, y: 4 }, { ...BOX, cast: "gravity" });
    expect(explicit).toEqual(castTo(physics, G, { x: 6, y: 4 }, BOX));
  });

  it('"none" leaves the start where it is', () => {
    const at = castTo(physics, G, { x: 6, y: 4 }, { ...BOX, cast: "none" });
    expect(at).toEqual({ x: 6, y: 4 });
  });

  it("a direction casts along it, whatever gravity is", () => {
    const up = castTo(physics, G, { x: 6, y: 4 }, { ...BOX, cast: [0, -3] });
    expect(up.x).toBe(6);
    expect(up.y).toBeCloseTo(1.2, DIGITS);
    const left = castTo(physics, [0, 0], { x: 6, y: 4 }, { ...BOX, cast: [-1, 0] });
    expect(left.x).toBeCloseTo(1, DIGITS);
    expect(left.y).toBe(4);
    const diagonal = castTo(physics, G, { x: 6, y: 6 }, { ...BOX, cast: [-1, 1] });
    expect(diagonal.x + diagonal.y).toBeCloseTo(12, DIGITS);
    expect(diagonal.y).toBeCloseTo(8.8, DIGITS);
    expect(castTo(physics, G, { x: 6, y: 4 }, { ...BOX, cast: [0, 0] })).toEqual({
      x: 6,
      y: 4,
    });
  });

  it("a zero-gravity start isn't cast", () => {
    expect(castTo(physics, [0, 0], { x: 6, y: 4 }, BOX)).toEqual({ x: 6, y: 4 });
  });

  it("a sideways-gravity start casts sideways", () => {
    const left = castTo(physics, [-12, 0], { x: 6, y: 4 }, BOX);
    expect(left.y).toBe(4);
    expect(left.x).toBeCloseTo(1, DIGITS);
    const right = castTo(physics, [12, 0], { x: 6, y: 4 }, BOX);
    expect(right, "nothing on the right: it stays").toEqual({ x: 6, y: 4 });
  });

  it("refuses a start inside a non-sensor collider, and not one inside a sensor", () => {
    const rt = loaded(physics, G);
    const cast = castSpawn(rt.ctx, { x: 5, y: 9.3 }, BOX);
    expect(cast).toEqual({ ok: false, error: "can't start inside a solid (floor) at 5, 9.3 m" });
    expect(castSpawn(rt.ctx, { x: 5, y: 9.3 }, { ...BOX, cast: "none" }).ok).toBe(false);
    expect(castSpawn(rt.ctx, { x: 6, y: 6 }, BOX).ok).toBe(true);
    rt.destroy();
  });

  it("passes through the excluded entities, at the start and along the cast", () => {
    const rt = loaded(physics, G);
    expect(castSpawn(rt.ctx, { x: 5, y: 9.3 }, BOX, { exclude: ["floor"] })).toEqual({
      ok: true,
      at: { x: 5, y: 9.3 },
    });
    const through = castSpawn(
      rt.ctx,
      { x: 6, y: 1.5 },
      { ...BOX, cast: [0, -1] },
      {
        exclude: ["ceiling"],
      },
    );
    expect(through).toEqual({ ok: true, at: { x: 6, y: 1.5 } });
    const stopped = castSpawn(rt.ctx, { x: 6, y: 1.5 }, { ...BOX, cast: [0, -1] });
    expect(stopped.ok && stopped.at.y).toBeCloseTo(1.2, DIGITS);
    rt.destroy();
  });

  it("stays put with nothing ahead, or outside the bounds", () => {
    expect(castTo(physics, G, { x: 6, y: 15 }, BOX)).toEqual({ x: 6, y: 15 });
    expect(castTo(physics, [0, -12], { x: 6, y: 5 }, { ...BOX, cast: [1, 0] })).toEqual({
      x: 6,
      y: 5,
    });
  });
});

describe("castSpawn on both backends", () => {
  it("lands each shape on the same spot along each direction", () => {
    const cases: { gravity: Pt; at: Vec2; cast?: Pt }[] = [
      { gravity: G, at: { x: 6, y: 4 } },
      { gravity: [-5, 0], at: { x: 7, y: 3 } },
      { gravity: [0, -0.01], at: { x: 3, y: 5 } },
      { gravity: [0, 0], at: { x: 4, y: 4.5 }, cast: [-2, 3] },
    ];
    for (const { gravity, at, cast } of cases) {
      for (const base of SHAPES) {
        const shape = cast ? { ...base, cast } : base;
        const r = castTo("rapier", gravity, at, shape);
        const g = castTo("none", gravity, at, shape);
        // Rapier's capsule casts stop up to ~0.0002 m short of a face.
        const tol = base.type === "capsule" ? 5e-4 : 1e-5;
        expect(
          Math.abs(r.x - g.x) + Math.abs(r.y - g.y),
          JSON.stringify({ gravity, shape }),
        ).toBeLessThan(tol);
      }
    }
  });

  it("casts straight down onto the floor top", () => {
    const r = castTo("rapier", G, { x: 3, y: 5 }, BOX);
    expect(r.x).toBe(3);
    expect(r.y).toBeCloseTo(8.8, DIGITS);
    const g = castTo("none", G, { x: 3, y: 5 }, BOX);
    expect(g.x).toBe(3);
    expect(8.8 - g.y).toBeGreaterThanOrEqual(0);
    expect(8.8 - g.y).toBeLessThan(1e-8);
  });
});

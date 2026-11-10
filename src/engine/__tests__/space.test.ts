// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { createColliderTags } from "../collider-tags";
import { createRegistry } from "../game/define";
import { createGeometryWorld, type GeometryColliderDesc } from "../runtime/geometry-world";
import { createSceneRuntime } from "../runtime/runtime";
import {
  geometrySpace,
  rapierSpace,
  type SpaceCastHit,
  type SpaceFilter,
  type SpaceHit,
  type SpaceQuery,
} from "../runtime/space";
import { expandScene } from "../scene/expand";
import { parseSceneOrThrow } from "../scene/parse";
import { containsPoint, translateShape } from "../scene/shape-geometry";
import type { Pt, SceneDefinition, ShapeObj } from "../scene/types";
import type { RapierModule, Vec2 } from "../types";

let rapier: RapierModule;

beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

const engine = createRegistry();

/** A seeded generator, so a failure names the same queries every run. */
function random(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int };
}

/** A geometry collider for a scene shape: box, circle and capsule centred on their pose. */
function descOf(shape: ShapeObj, sensor: boolean): GeometryColliderDesc {
  const body = "static" as const;
  if (shape.type === "poly" || shape.type === "chain") return { shape, body, sensor };
  return {
    shape: { ...shape, cx: 0, cy: 0 },
    body,
    sensor,
    pose: { x: shape.cx, y: shape.cy, rot: 0 },
  };
}

/**
 * The scene loaded on Rapier, and the same scene's solid and sensor shapes
 * in a geometry world in spawn order, each tagged as Rapier's collider is.
 */
function bothBackends(def: SceneDefinition) {
  const runtime = createSceneRuntime({ rapier, view: null, registry: engine });
  const scene = expandScene(def, engine);
  const report = runtime.load(scene);
  if (!report.ok) throw new Error(report.error);
  const world = createGeometryWorld(engine);
  const tags = createColliderTags();
  const ids: string[] = [];
  const shapes = new Map<string, ShapeObj>();
  for (const e of scene.entities) {
    if (e.type !== "solid" && e.type !== "sensor") continue;
    const handle = world.add(descOf(e.shape as ShapeObj, e.type === "sensor"));
    const [rapierHandle] = runtime.ctx.tags.handlesOf(e.id);
    tags.set(handle, runtime.ctx.tags.get(rapierHandle!)!);
    ids.push(e.id);
    shapes.set(e.id, e.shape as ShapeObj);
  }
  const rapierOrder = [...ids].sort(
    (a, b) => runtime.ctx.tags.handlesOf(a)[0]! - runtime.ctx.tags.handlesOf(b)[0]!,
  );
  expect(rapierOrder, "both hand out handles in the same order").toEqual(ids);
  return {
    rapier: rapierSpace(runtime.ctx),
    geometry: geometrySpace(world, tags, engine),
    ids,
    shapes,
  };
}

const near = (a: Vec2, b: Vec2, tol: number) =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

function expectSameHits(r: SpaceHit[], g: SpaceHit[], where: string, tol = 0.01): void {
  expect(
    g.map((h) => h.tag.entityId),
    where,
  ).toEqual(r.map((h) => h.tag.entityId));
  r.forEach((h, i) =>
    expect(near(h.at, g[i]!.at, tol), `${where} at ${JSON.stringify([h.at, g[i]!.at])}`).toBe(true),
  );
}

function expectSameCast(
  r: SpaceCastHit | null,
  g: SpaceCastHit | null,
  where: string,
  toiTol: number,
): void {
  expect(g === null, `${where} hit on one backend only`).toBe(r === null);
  if (!r || !g) return;
  expect(Math.abs(r.toi - g.toi), `${where} toi`).toBeLessThanOrEqual(toiTol);
  expect(g.tag.entityId, `${where} first hit`).toBe(r.tag.entityId);
  // A sweep starting inside picks its own way out on each backend.
  if (r.toi === 0 && g.toi === 0 && Math.hypot(r.normal.x, r.normal.y) > 0) {
    expect(Math.hypot(g.normal.x, g.normal.y)).toBeCloseTo(1, 9);
    return;
  }
  expect(
    near(r.normal, g.normal, 0.02),
    `${where} normal ${JSON.stringify([r.normal, g.normal])}`,
  ).toBe(true);
}

/**
 * Sweeps agree as casts do, and each backend's contact point touches both
 * the collider hit and the swept shape where it stops. A face resting on a
 * face touches along a whole edge, so the two points needn't be the same.
 * Rapier 0.19's `castShape` misses some hits from far off (a ball cast at
 * an upright capsule finds it only once started nearer); a geometry hit
 * Rapier's cast missed must be one Rapier's own overlap test confirms.
 * True when Rapier's cast missed.
 */
function expectSameSweep(
  rapierQ: SpaceQuery,
  r: SpaceCastHit | null,
  g: SpaceCastHit | null,
  where: string,
  shape: ShapeObj,
  by: Vec2,
  shapes: ReadonlyMap<string, ShapeObj>,
): boolean {
  const toiTol = 1 / 1024 + 1e-4;
  let missed = false;
  if (g && g.toi > 0 && (!r || g.toi < r.toi - toiTol)) {
    const t = Math.min(1, g.toi + 2 / 1024);
    const past = translateShape(shape, [by.x * t, by.y * t]);
    const confirmed = rapierQ.overlaps(past).some((h) => h.tag.entityId === g.tag.entityId);
    expect(confirmed, `${where} the geometry's earlier hit is real`).toBe(true);
    missed = true;
  } else {
    expectSameCast(r, g, where, toiTol);
  }
  const tol = Math.hypot(by.x, by.y) * toiTol + 0.01;
  for (const hit of [r, g]) {
    if (!hit) continue;
    const at: Pt = [hit.at.x, hit.at.y];
    const moved = translateShape(shape, [by.x * hit.toi, by.y * hit.toi]);
    expect(containsPoint(shapes.get(hit.tag.entityId)!, at, tol), `${where} at on the hit`).toBe(
      true,
    );
    // A shape that starts inside a collider has no single contact point, and
    // Rapier's witness along a flat contact can sit past the swept shape's end.
    if (hit.toi === 0 || hit === r) continue;
    expect(containsPoint(moved, at, tol), `${where} at on the swept shape`).toBe(true);
  }
  return missed;
}

const SHAPES: SceneDefinition = {
  v: 1,
  name: "space",
  bounds: [0, 0, 1000, 1000],
  solid: [
    ["box", 100, 100, 60, 20],
    ["box", 150, 120, 20, 60, 90],
    ["box", 400, 100, 40, 40, 30],
    ["circle", 700, 120, 50],
    ["circle", 760, 160, 30],
    ["capsule", 100, 400, 60, 20],
    ["capsule", 400, 400, 60, 20],
    ["capsule", 700, 400, 40, 15],
    ["poly", 50, 650, 200, 620, 230, 760, 80, 790],
    ["poly", 400, 600, 480, 700, 330, 720],
    ["chain", 600, 600, 700, 700, 800, 620, 900, 760],
    ["chain", 100, 900, 900, 900],
    ["box", 500, 960, 500, 20],
  ],
  entities: [
    { id: "zone", type: "sensor", shape: ["box", 450, 120, 60, 60] },
    { id: "ring", type: "sensor", shape: ["circle", 700, 420, 70] },
    { id: "pad", type: "sensor", shape: ["box", 160, 700, 50, 50] },
  ],
};

/**
 * A query shape centred on a half pixel, so it never exactly touches the
 * whole-pixel scene. Rapier 0.19's capsules miss rays once turned and miss
 * one side of a chain when cast, so the scene's capsules stay upright and
 * sweeps cast no capsule; the geometry side of both is in shape-geometry.test.ts.
 */
function queryShape(rnd: ReturnType<typeof random>, capsules = true): ShapeObj {
  const cx = rnd.int(0, 999) + 0.5;
  const cy = rnd.int(0, 999) + 0.5;
  let kind = rnd.int(0, 3);
  if (kind === 2 && !capsules) kind = 0;
  switch (kind) {
    case 0:
      return {
        type: "box",
        cx,
        cy,
        hw: rnd.int(2, 60),
        hh: rnd.int(2, 60),
        rotDeg: rnd.int(0, 3) * 90,
      };
    case 1:
      return { type: "circle", cx, cy, r: rnd.int(2, 60) };
    case 2:
      return { type: "capsule", cx, cy, halfLen: rnd.int(2, 40), r: rnd.int(2, 20), rotDeg: 0 };
    default: {
      const s = rnd.int(5, 40);
      return {
        type: "poly",
        pts: [
          [cx - s, cy],
          [cx + s, cy - s],
          [cx + s, cy + s],
        ],
      };
    }
  }
}

const FILTERS: SpaceFilter[] = [
  {},
  { sensors: true },
  { sensors: true, types: ["sensor"] },
  { exclude: ["~solid:0", "~solid:12"] },
  { group: "dynamic", sensors: true },
  { group: "static" },
];

describe("space queries on both backends over one scene", () => {
  it("agree on point hits and their order", () => {
    const { rapier: r, geometry: g } = bothBackends(SHAPES);
    let hits = 0;
    for (let x = 0.5; x < 1000; x += 12.5) {
      for (let y = 0.5; y < 1000; y += 12.5) {
        for (const filter of FILTERS) {
          const p = { x, y };
          const rh = r.pointAt(p, filter);
          expectSameHits(rh, g.pointAt(p, filter), JSON.stringify({ p, filter }));
          hits += rh.length;
        }
      }
    }
    expect(hits).toBeGreaterThan(500);
  });

  it("agree on shape overlaps and their order", () => {
    const { rapier: r, geometry: g } = bothBackends(SHAPES);
    const rnd = random(3);
    let multi = 0;
    for (let i = 0; i < 400; i++) {
      const shape = queryShape(rnd);
      for (const filter of FILTERS) {
        const rh = r.overlaps(shape, filter);
        expectSameHits(rh, g.overlaps(shape, filter), JSON.stringify({ shape, filter }));
        if (rh.length > 1) multi++;
      }
    }
    expect(multi).toBeGreaterThan(10);
  });

  it("filter by collision group as Rapier does", () => {
    const { rapier: r, geometry: g } = bothBackends(SHAPES);
    const all: ShapeObj = { type: "box", cx: 500, cy: 500, hw: 600, hh: 600, rotDeg: 0 };
    for (const q of [r, g]) {
      expect(q.overlaps(all, { group: "static" })).toEqual([]);
      expect(q.overlaps(all, { group: "dynamic" })).toHaveLength(13);
      expect(q.overlaps(all, { group: "dynamic", sensors: true })).toHaveLength(13);
      expect(q.overlaps(all, { sensors: true })).toHaveLength(16);
    }
  });

  it("agree on the first ray hit", () => {
    const { rapier: r, geometry: g } = bothBackends(SHAPES);
    const rnd = random(5);
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      const from = { x: rnd.int(0, 999) + 0.5, y: rnd.int(0, 999) + 0.5 };
      const a = rnd.next() * 2 * Math.PI;
      const dir = { x: Math.cos(a), y: Math.sin(a) };
      const filter = FILTERS[i % FILTERS.length]!;
      const where = JSON.stringify({ from, dir, filter });
      const rh = r.raycast(from, dir, 600, filter);
      const gh = g.raycast(from, dir, 600, filter);
      expectSameCast(rh, gh, where, 1e-4);
      if (rh && gh) expect(near(rh.at, gh.at, 0.1), `${where} at`).toBe(true);
      if (rh) hits++;
    }
    expect(hits).toBeGreaterThan(100);
  });

  it("agree on the first sweep hit, to the geometry's 1/1024", () => {
    const { rapier: r, geometry: g, shapes } = bothBackends(SHAPES);
    const rnd = random(9);
    let hits = 0;
    let missed = 0;
    for (let i = 0; i < 400; i++) {
      const shape = queryShape(rnd, false);
      const by = { x: rnd.int(-300, 300), y: rnd.int(-300, 300) };
      const filter = FILTERS[i % FILTERS.length]!;
      const where = JSON.stringify({ shape, by, filter });
      const rh = r.sweep(shape, by, filter);
      const gh = g.sweep(shape, by, filter);
      if (expectSameSweep(r, rh, gh, where, shape, by, shapes)) missed++;
      else if (gh) expect(gh.toi, `${where} stops short`).toBeLessThanOrEqual(rh!.toi + 1e-4);
      if (gh) hits++;
    }
    expect(hits).toBeGreaterThan(50);
    expect(missed).toBeLessThanOrEqual(hits / 10);
  });

  it("break a tie between equal times of impact by handle", () => {
    const def: SceneDefinition = {
      v: 1,
      name: "tiles",
      bounds: [0, 0, 400, 400],
      solid: [
        ["box", 120, 300, 20, 20],
        ["box", 80, 300, 20, 20],
      ],
    };
    const { rapier: r, geometry: g } = bothBackends(def);
    const falling: ShapeObj = { type: "box", cx: 100, cy: 100, hw: 30, hh: 10, rotDeg: 0 };
    for (const q of [r, g]) {
      expect(q.sweep(falling, { x: 0, y: 300 })?.tag.entityId).toBe("~solid:0");
      expect(q.raycast({ x: 100, y: 0 }, { x: 0, y: 1 }, 400)?.tag.entityId).toBe("~solid:0");
    }
  });

  it("agree on the engine yard's solids and sensor", () => {
    const yard = parseSceneOrThrow(
      readFileSync(new URL("../scenes/engine-yard.json", import.meta.url), "utf8"),
      engine,
    );
    const { rapier: r, geometry: g, ids, shapes } = bothBackends(yard);
    expect(ids).toEqual(["~solid:0", "~solid:1", "~solid:2", "ledge", "zone"]);
    const filter: SpaceFilter = { sensors: true, types: ["solid", "sensor"] };
    const rnd = random(11);
    for (let i = 0; i < 200; i++) {
      const shape = queryShape(rnd, false);
      const where = JSON.stringify(shape);
      expectSameHits(r.overlaps(shape, filter), g.overlaps(shape, filter), where);
      const by = { x: rnd.int(-400, 400), y: rnd.int(-400, 400) };
      expectSameSweep(
        r,
        r.sweep(shape, by, filter),
        g.sweep(shape, by, filter),
        `${where} by ${JSON.stringify(by)}`,
        shape,
        by,
        shapes,
      );
    }
    const from = { x: 900.5, y: 0 };
    const down = r.raycast(from, { x: 0, y: 1 }, 1000, filter);
    expect(down?.tag.entityId).toBe("zone");
    expectSameCast(down, g.raycast(from, { x: 0, y: 1 }, 1000, filter), "yard ray", 1e-4);
  });
});

describe("the geometry world", () => {
  const square = (sensor = false): GeometryColliderDesc => ({
    shape: { type: "box", cx: 0, cy: 0, hw: 10, hh: 10, rotDeg: 0 },
    body: "kinematic",
    sensor,
  });

  function setup() {
    const world = createGeometryWorld(engine);
    const tags = createColliderTags();
    const space: SpaceQuery = geometrySpace(world, tags, engine);
    const add = (id: string, desc: GeometryColliderDesc) => {
      const h = world.add(desc);
      tags.set(h, { entityId: id, type: desc.sensor ? "sensor" : "follower" });
      return h;
    };
    return { world, space, add };
  }

  const at = (space: SpaceQuery, x: number, y: number) =>
    space.pointAt({ x, y }, { sensors: true }).map((h) => h.tag.entityId);

  it("hands out handles from its own counter, in insertion order, from 0 after a clear", () => {
    const { world, add } = setup();
    expect([add("a", square()), add("b", square()), add("c", square())]).toEqual([0, 1, 2]);
    world.remove(1);
    expect([...world.handles()]).toEqual([0, 2]);
    expect(world.size).toBe(2);
    world.clear();
    expect(world.size).toBe(0);
    expect(world.add(square())).toBe(0);
  });

  it("moves a collider to its pose, keeping its turn when none is given", () => {
    const { world, space, add } = setup();
    const h = add("a", {
      ...square(),
      shape: { type: "box", cx: 20, cy: 0, hw: 10, hh: 2, rotDeg: 0 },
    });
    world.setPose(h, 100, 100, Math.PI / 2);
    expect(world.shape(h)).toEqual({ type: "box", cx: 100, cy: 120, hw: 10, hh: 2, rotDeg: 90 });
    world.setPose(h, 0, 0);
    expect(world.shape(h)).toEqual({ type: "box", cx: 0, cy: 20, hw: 10, hh: 2, rotDeg: 90 });
    expect(at(space, 0, 20)).toEqual(["a"]);
    expect(at(space, 100, 120)).toEqual([]);
  });

  it("leaves disabled and removed colliders out of queries", () => {
    const { world, space, add } = setup();
    const a = add("a", square());
    add("b", square(true));
    expect(at(space, 0, 0)).toEqual(["a", "b"]);
    expect(space.pointAt({ x: 0, y: 0 }).map((h) => h.tag.entityId)).toEqual(["a"]);
    world.setEnabled(a, false);
    expect(at(space, 0, 0)).toEqual(["b"]);
    world.setEnabled(a, true);
    expect(at(space, 0, 0)).toEqual(["a", "b"]);
    world.remove(a);
    expect(at(space, 0, 0)).toEqual(["b"]);
    expect(world.shape(a)).toBeUndefined();
  });

  it("refuses an unknown collision group", () => {
    const world = createGeometryWorld(engine);
    expect(() => world.add({ ...square(), group: "nope" })).toThrow(/unknown collision group/);
  });

  it("keeps sensors out of sweeps, but not out of rays that ask for them", () => {
    const { space, add } = setup();
    add("zone", square(true));
    const probe: ShapeObj = { type: "circle", cx: -50, cy: 0, r: 2 };
    expect(space.sweep(probe, { x: 100, y: 0 }, { sensors: true })).toBeNull();
    expect(space.raycast({ x: -50, y: 0 }, { x: 1, y: 0 }, 100, { sensors: true })?.toi).toBe(0.4);
    add("wall", square());
    expect(space.sweep(probe, { x: 100, y: 0 })?.tag.entityId).toBe("wall");
  });
});

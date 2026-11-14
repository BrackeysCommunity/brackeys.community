// @vitest-environment node
import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { createColliderTags } from "../collider-tags";
import { createRegistry } from "../game/define";
import { shapeColliderDesc, shapePose } from "../physics";
import { createGeometryWorld, type GeometryColliderDesc } from "../runtime/geometry-world";
import { createSceneRuntime } from "../runtime/runtime";
import {
  colliderLive,
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
import { SCENE_FORMAT_VERSION, type Pt, type SceneDefinition, type ShapeObj } from "../scene/types";
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
    const from = { x: 9.005, y: 0 };
    const down = r.raycast(from, { x: 0, y: 1 }, 10, filter);
    expect(down?.tag.entityId).toBe("zone");
    expectSameCast(down, g.raycast(from, { x: 0, y: 1 }, 10, filter), "yard ray", 1e-4);
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

describe("space queries over disabled bodies", () => {
  /** A prop and a lift carrying a plank, apart from each other. */
  const DISABLED: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    name: "disabled",
    bounds: [0, 0, 40, 20],
    entities: [
      { id: "crate", type: "prop", shape: ["box", 5, 5, 1, 1], density: 1 },
      {
        id: "lift",
        type: "follower",
        shape: ["box", 0, 0, 2, 0.5],
        path: {
          pts: [
            [20, 5],
            [30, 5],
          ],
          mode: "loop",
          speed: 1,
        },
      },
      { id: "plank", type: "solid", parent: "lift", shape: ["box", 0, -1, 3, 0.25] },
    ],
  };

  function loaded() {
    const runtime = createSceneRuntime({ rapier, view: null, registry: engine });
    const report = runtime.load(expandScene(DISABLED, engine));
    if (!report.ok) throw new Error(report.error);
    const collider = (id: string) =>
      runtime.ctx.physics!.world.getCollider(runtime.ctx.tags.handlesOf(id)[0]!)!;
    return { runtime, space: rapierSpace(runtime.ctx), collider };
  }

  const everything: ShapeObj = { type: "box", cx: 20, cy: 10, hw: 30, hh: 30, rotDeg: 0 };

  /** The entity ids every query kind finds near the prop and the lift. */
  function found(space: SpaceQuery): Record<string, string[] | string | null> {
    const ids = (hits: SpaceHit[]) => hits.map((h) => h.tag.entityId);
    return {
      overlaps: ids(space.overlaps(everything)),
      crateAt: ids(space.pointAt({ x: 5, y: 5 })),
      plankAt: ids(space.pointAt({ x: 21, y: 4 })),
      rayToCrate: space.raycast({ x: 0, y: 5 }, { x: 1, y: 0 }, 10)?.tag.entityId ?? null,
      sweepToPlank:
        space.sweep({ type: "circle", cx: 22, cy: 1, r: 0.2 }, { x: 0, y: 3 })?.tag.entityId ??
        null,
    };
  }

  it("finds the prop, the lift and its plank while their bodies are on", () => {
    const { runtime, space } = loaded();
    expect(found(space)).toEqual({
      overlaps: ["crate", "lift", "plank"],
      crateAt: ["crate"],
      plankAt: ["plank"],
      rayToCrate: "crate",
      sweepToPlank: "plank",
    });
    runtime.destroy();
  });

  it("skips the colliders of a disabled prop's body, though the colliders stay on", () => {
    const { runtime, space, collider } = loaded();
    const crate = collider("crate");
    crate.parent()!.setEnabled(false);
    expect(crate.isEnabled()).toBe(true);
    expect(found(space)).toEqual({
      overlaps: ["lift", "plank"],
      crateAt: [],
      plankAt: ["plank"],
      rayToCrate: null,
      sweepToPlank: "plank",
    });
    crate.parent()!.setEnabled(true);
    expect(found(space).overlaps).toEqual(["crate", "lift", "plank"]);
    runtime.destroy();
  });

  it("skips every collider a disabled carrier's body holds, its riders' included", () => {
    const { runtime, space, collider } = loaded();
    const plank = collider("plank");
    collider("lift").parent()!.setEnabled(false);
    expect(plank.isEnabled()).toBe(true);
    expect(found(space)).toEqual({
      overlaps: ["crate"],
      crateAt: ["crate"],
      plankAt: [],
      rayToCrate: "crate",
      sweepToPlank: null,
    });
    runtime.destroy();
  });

  it("skips entities switched off through the context", () => {
    const { runtime, space } = loaded();
    runtime.ctx.setEnabled("crate", false);
    runtime.ctx.setEnabled("lift", false);
    expect(found(space)).toEqual({
      overlaps: [],
      crateAt: [],
      plankAt: [],
      rayToCrate: null,
      sweepToPlank: null,
    });
    runtime.ctx.setEnabled("lift", true);
    expect(found(space).overlaps).toEqual(["lift", "plank"]);
    runtime.destroy();
  });
});

describe("a Rapier sweep, against casting at every collider", () => {
  const interacts = (a: number, b: number) =>
    ((a >>> 16) & b & 0xffff) !== 0 && ((b >>> 16) & a & 0xffff) !== 0;

  /** The sweep as it was before it skipped colliders by bounds: a cast at every admitted collider. */
  function everyCollider(
    runtime: ReturnType<typeof createSceneRuntime>,
    shape: ShapeObj,
    by: Vec2,
    filter: SpaceFilter,
  ): SpaceCastHit | null {
    if (by.x === 0 && by.y === 0) return null;
    const { ctx } = runtime;
    const R = ctx.physics!.rapier;
    const group = filter.group === undefined ? null : ctx.registry.collisionGroups(filter.group);
    const desc = shapeColliderDesc(R, shape);
    const pose = shapePose(shape);
    const hits: SpaceCastHit[] = [];
    const all = [...ctx.physics!.world.colliders.getAll()].sort((a, b) => a.handle - b.handle);
    for (const c of all) {
      if (!colliderLive(c) || c.isSensor()) continue;
      const groups = c.collisionGroups();
      if (groups === 0 || (group !== null && !interacts(group, groups))) continue;
      if (filter.skip?.has(c.handle)) continue;
      const tag = ctx.tags.get(c.handle);
      if (!tag || filter.exclude?.includes(tag.entityId)) continue;
      if (filter.types && !filter.types.includes(tag.type)) continue;
      const hit = c.castShape(
        { x: 0, y: 0 },
        desc.shape,
        { x: pose.x, y: pose.y },
        pose.rotation,
        by,
        0,
        1,
        true,
      );
      if (!hit) continue;
      const r = c.rotation();
      const [cos, sin] = [Math.cos(r), Math.sin(r)];
      const t = c.translation();
      const w = hit.witness1;
      const n = hit.normal1;
      const nx = n.x * cos - n.y * sin;
      const ny = n.x * sin + n.y * cos;
      const len = Math.sqrt(nx * nx + ny * ny);
      hits.push({
        handle: c.handle,
        tag,
        at: { x: t.x + (w.x * cos - w.y * sin), y: t.y + (w.x * sin + w.y * cos) },
        toi: hit.time_of_impact,
        normal: len === 0 ? { x: 0, y: 0 } : { x: nx / len, y: ny / len },
      });
    }
    let best: SpaceCastHit | null = null;
    for (const h of hits) if (!best || h.toi < best.toi) best = h;
    if (!best) return null;
    const earliest = best.toi;
    let tie: SpaceCastHit | null = null;
    for (const h of hits) if (h.toi - earliest <= 1e-6 && (!tie || h.handle < tie.handle)) tie = h;
    return tie && { ...tie, toi: earliest };
  }

  function loaded(def: SceneDefinition) {
    const runtime = createSceneRuntime({ rapier, view: null, registry: engine });
    const report = runtime.load(expandScene(def, engine));
    if (!report.ok) throw new Error(report.error);
    return { runtime, space: rapierSpace(runtime.ctx) };
  }

  function expectParity(def: SceneDefinition, seed: number, n: number, reach: number) {
    const { runtime, space } = loaded(def);
    const handles = (id: string) => new Set(runtime.ctx.tags.handlesOf(id));
    const filters: SpaceFilter[] = [
      ...FILTERS,
      { skip: handles("~solid:3") },
      { skip: handles("~solid:11"), exclude: ["~solid:12"] },
    ];
    const rnd = random(seed);
    let hits = 0;
    for (let i = 0; i < n; i++) {
      const shape = queryShape(rnd, false);
      const by = { x: rnd.int(-reach, reach), y: rnd.int(-reach, reach) };
      const filter = filters[i % filters.length]!;
      const want = everyCollider(runtime, shape, by, filter);
      expect(space.sweep(shape, by, filter), JSON.stringify({ shape, by, filter })).toEqual(want);
      if (want) hits++;
    }
    runtime.destroy();
    return hits;
  }

  it("finds the same hit over the shapes scene, sensors left out and skipped handles too", () => {
    expect(expectParity(SHAPES, 9, 600, 300)).toBeGreaterThan(80);
  });

  it("finds the same hit with short sweeps that start next to what they hit", () => {
    expect(expectParity(SHAPES, 21, 600, 8)).toBeGreaterThan(20);
  });

  it("finds the same hit over the engine yard", () => {
    const yard = parseSceneOrThrow(
      readFileSync(new URL("../scenes/engine-yard.json", import.meta.url), "utf8"),
      engine,
    );
    const { runtime, space } = loaded(yard);
    const rnd = random(13);
    const filter: SpaceFilter = { types: ["solid", "sensor"] };
    for (let i = 0; i < 300; i++) {
      const shape = queryShape(rnd, false);
      const by = { x: rnd.int(-400, 400), y: rnd.int(-400, 400) };
      expect(space.sweep(shape, by, filter)).toEqual(everyCollider(runtime, shape, by, filter));
    }
    runtime.destroy();
  });

  it("finds the same hit exactly at contact, far from the origin", () => {
    const far: SceneDefinition = {
      v: 1,
      name: "far",
      bounds: [99000, 99000, 101000, 101000],
      solid: [["box", 100000, 100000, 10, 10]],
    };
    const { runtime, space } = loaded(far);
    for (const gap of [0, 1e-3, 0.01, 0.5]) {
      const shape: ShapeObj = {
        type: "box",
        cx: 99980 - gap,
        cy: 100000,
        hw: 10,
        hh: 10,
        rotDeg: 0,
      };
      for (const by of [
        { x: gap, y: 0 },
        { x: gap + 0.001, y: 0 },
        { x: 0, y: 5 },
      ]) {
        expect(space.sweep(shape, by, {}), JSON.stringify({ gap, by })).toEqual(
          everyCollider(runtime, shape, by, {}),
        );
      }
    }
    runtime.destroy();
  });

  it("tests only the colliders near a query, however many the world holds", () => {
    const solids = Array.from({ length: 400 }, (_, i) => ["box", i * 3, 50, 1, 1]);
    const { runtime, space } = loaded({
      v: 1,
      name: "row",
      bounds: [0, 0, 1200, 100],
      solid: solids,
    });
    const proto = Object.getPrototypeOf(runtime.ctx.physics!.world.colliders.getAll()[0]!) as {
      castShape: (...args: unknown[]) => unknown;
      intersectsShape: (...args: unknown[]) => unknown;
      containsPoint: (...args: unknown[]) => unknown;
      castRayAndGetNormal: (...args: unknown[]) => unknown;
    };
    const tested = Object.fromEntries(
      (["castShape", "intersectsShape", "containsPoint", "castRayAndGetNormal"] as const).map(
        (name) => [name, vi.spyOn(proto, name)],
      ),
    );
    const at: ShapeObj = { type: "circle", cx: 600, cy: 45, r: 1 };
    expect(space.sweep(at, { x: 0, y: 10 })?.tag.entityId).toBe("~solid:200");
    expect(space.overlaps({ ...at, cy: 50 }).map((h) => h.tag.entityId)).toEqual(["~solid:200"]);
    expect(space.pointAt({ x: 600, y: 50 }).map((h) => h.tag.entityId)).toEqual(["~solid:200"]);
    expect(space.raycast({ x: 600, y: 40 }, { x: 0, y: 1 }, 20)?.tag.entityId).toBe("~solid:200");
    for (const [name, spy] of Object.entries(tested)) {
      expect(spy.mock.calls.length, name).toBeGreaterThan(0);
      expect(spy.mock.calls.length, name).toBeLessThanOrEqual(3);
      spy.mockRestore();
    }
    runtime.destroy();
  });

  it("sees a collider moved (and reported) or added since the last step, as Rapier's query pipeline would not", () => {
    const { runtime, space } = loaded({
      v: 1,
      name: "moved",
      bounds: [0, 0, 100, 100],
      solid: [["box", 50, 10, 5, 5]],
    });
    const physics = runtime.ctx.physics!;
    const shape: ShapeObj = { type: "circle", cx: 10, cy: 50, r: 2 };
    const by = { x: 80, y: 0 };
    expect(space.sweep(shape, by)).toBeNull();
    const [handle] = runtime.ctx.tags.handlesOf("~solid:0");
    const solid = physics.world.getCollider(handle!)!;
    solid.setTranslation({ x: 50, y: 50 });
    physics.moved(solid);
    expect(space.sweep(shape, by)?.tag.entityId).toBe("~solid:0");
    const added = physics.addCollider(
      physics.rapier.ColliderDesc.cuboid(1, 1).setTranslation(30, 50),
    );
    runtime.ctx.tags.set(added.handle, { entityId: "late", type: "solid" });
    const hit = space.sweep(shape, by);
    expect(hit?.tag.entityId).toBe("late");
    expect(hit).toEqual(everyCollider(runtime, shape, by, {}));
    runtime.destroy();
  });
});

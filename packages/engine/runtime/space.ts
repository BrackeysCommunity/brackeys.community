import type { Collider, Shape } from "@dimforge/rapier2d";

import { physicsOf } from "../game/physics-of";
import type { ColliderTag, ColliderTags, EngineContext, Registry } from "../game/types";
import { shapeColliderDesc, shapePose } from "../physics";
import {
  aabb,
  aabbUnion,
  nearestPointOnShape,
  raycastShape,
  shapeCentre,
  shapesIntersect,
  sweepShape,
  translateShape,
} from "../scene/shape-geometry";
import type { Aabb, Pt, ShapeObj } from "../scene/types";
import type { RapierModule, Vec2 } from "../types";
import { geometryColliders, type GeometryWorld } from "./geometry-world";

export type SpaceFilter = {
  /** Include sensors (default false). */
  sensors?: boolean;
  /** Entity ids to skip. */
  exclude?: readonly string[];
  /** Only colliders a member of this collision group would interact with. */
  group?: string;
  /** Only colliders whose tag's type is one of these. */
  types?: readonly string[];
  /** Collider handles to skip: an actor's `oneWayPasses`. */
  skip?: ReadonlySet<number>;
};
export type SpaceHit = { handle: number; tag: ColliderTag; at: Vec2 };
export type SpaceCastHit = SpaceHit & { toi: number; normal: Vec2 };

/**
 * Point, shape, ray and sweep queries over whichever backend is loaded.
 * Overlap hits are ordered by handle; casts by time of impact, then handle.
 * Only tagged colliders are hits, and a collider gated off with collision
 * groups 0, disabled, or on a disabled body never is. Touching counts. `at` is `p` for `pointAt`, the point
 * of the collider nearest the query shape's centre for `overlaps`, and the
 * point of impact for casts. A cast's `toi` is a fraction (0–1) of
 * `maxDist` or `by`, and its `normal` is the hit surface's, facing the
 * query; a ray starting inside a collider hits it at 0 with normal (0, 0).
 */
export interface SpaceQuery {
  readonly backend: "rapier" | "geometry";
  /** Colliders containing `p`, by handle: runtime picking. */
  pointAt(p: Vec2, filter?: SpaceFilter): SpaceHit[];
  overlaps(shape: ShapeObj, filter?: SpaceFilter): SpaceHit[];
  raycast(from: Vec2, dir: Vec2, maxDist: number, filter?: SpaceFilter): SpaceCastHit | null;
  /** The first collider `shape` hits moved by `by`; sensors never count. */
  sweep(shape: ShapeObj, by: Vec2, filter?: SpaceFilter): SpaceCastHit | null;
}

const vec = ([x, y]: Pt): Vec2 => ({ x, y });
const pt = (v: Vec2): Pt => [v.x, v.y];

/** Rapier's test for two packed `InteractionGroups`: each is in a group the other's filter takes. */
const interacts = (a: number, b: number) =>
  ((a >>> 16) & b & 0xffff) !== 0 && ((b >>> 16) & a & 0xffff) !== 0;

type Candidate = { handle: number; sensor: boolean; groups: number };

/** The filter as one test, the same on both backends; the tag it admits, or undefined. */
function admitter(tags: ColliderTags, registry: Registry, filter: SpaceFilter, sweeping: boolean) {
  const group = filter.group === undefined ? null : registry.collisionGroups(filter.group);
  const sensors = !sweeping && filter.sensors === true;
  return (c: Candidate): ColliderTag | undefined => {
    if (c.sensor && !sensors) return undefined;
    if (c.groups === 0 || (group !== null && !interacts(group, c.groups))) return undefined;
    if (filter.skip?.has(c.handle)) return undefined;
    const tag = tags.get(c.handle);
    if (!tag) return undefined;
    if (filter.exclude?.includes(tag.entityId)) return undefined;
    if (filter.types && !filter.types.includes(tag.type)) return undefined;
    return tag;
  };
}

const byHandle = (a: { handle: number }, b: { handle: number }) => a.handle - b.handle;

/** The earliest cast hit, the lowest handle among equal times. */
function first<H extends { toi: number; handle: number }>(hits: readonly H[]): H | null {
  let best: H | null = null;
  for (const h of hits) {
    if (!best || h.toi < best.toi || (h.toi === best.toi && h.handle < best.handle)) best = h;
  }
  return best;
}

function unitOf(v: Vec2): Pt | null {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return len === 0 ? null : [v.x / len, v.y / len];
}

// ─── Rapier ──────────────────────────────────────────────

/**
 * Rapier's own time-of-impact noise: casts within this fraction of each
 * other count as simultaneous, so ties fall to the handle as they do on the
 * geometry backend.
 */
const RAPIER_TOI_TIE = 1e-6;

/** Ties within `RAPIER_TOI_TIE` of the earliest go to the lowest handle. */
function firstWithin<H extends { toi: number; handle: number }>(hits: readonly H[]): H | null {
  const earliest = first(hits);
  if (!earliest) return null;
  return first(
    hits
      .filter((h) => h.toi - earliest.toi <= RAPIER_TOI_TIE)
      .map((h) => ({ ...h, toi: earliest.toi })),
  );
}

/**
 * A Rapier collider that takes part in the world: enabled itself and, when it
 * has a parent, on an enabled body. Rapier keeps a collider's own flag apart
 * from its body's, so a body switched off with its colliders left on (a rider
 * on a disabled carrier, say) would otherwise still be found.
 */
export function colliderLive(collider: Collider): boolean {
  return collider.isEnabled() && collider.parent()?.isEnabled() !== false;
}

/** Turns a collider-local vector into world space. */
function toWorld(collider: Collider, v: Vec2, point: boolean): Vec2 {
  const r = collider.rotation();
  const c = Math.cos(r);
  const s = Math.sin(r);
  const x = v.x * c - v.y * s;
  const y = v.x * s + v.y * c;
  if (!point) return { x, y };
  const t = collider.translation();
  return { x: t.x + x, y: t.y + y };
}

/**
 * A Rapier collider's world bounds, or null for a shape kind with no cheap
 * box. Read from the collider each time: Rapier's in-place size setters
 * change it without replacing `Collider.shape`.
 */
export function rapierColliderBounds(
  c: Collider,
  ShapeType: RapierModule["ShapeType"],
): Aabb | null {
  const { x, y } = c.translation();
  const rot = c.rotation();
  const cos = Math.abs(Math.cos(rot));
  const sin = Math.abs(Math.sin(rot));
  const around = (ex: number, ey: number): Aabb => ({
    minX: x - ex,
    minY: y - ey,
    maxX: x + ex,
    maxY: y + ey,
  });
  switch (c.shapeType()) {
    case ShapeType.Ball:
      return around(c.radius(), c.radius());
    case ShapeType.Cuboid:
    case ShapeType.RoundCuboid: {
      const { x: hw, y: hh } = c.halfExtents();
      const r = c.shapeType() === ShapeType.RoundCuboid ? c.roundRadius() : 0;
      return around(cos * hw + sin * hh + r, sin * hw + cos * hh + r);
    }
    case ShapeType.Capsule: {
      const h = c.halfHeight();
      const r = c.radius();
      return around(sin * h + r, cos * h + r);
    }
    case ShapeType.ConvexPolygon:
    case ShapeType.RoundConvexPolygon:
    case ShapeType.Polyline:
    case ShapeType.TriMesh: {
      const v = c.vertices();
      if (v.length < 2) return null;
      const r = c.shapeType() === ShapeType.RoundConvexPolygon ? c.roundRadius() : 0;
      const ca = Math.cos(rot);
      const sa = Math.sin(rot);
      const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (let i = 0; i + 1 < v.length; i += 2) {
        const lx = v[i]!;
        const ly = v[i + 1]!;
        const wx = x + lx * ca - ly * sa;
        const wy = y + lx * sa + ly * ca;
        box.minX = Math.min(box.minX, wx - r);
        box.minY = Math.min(box.minY, wy - r);
        box.maxX = Math.max(box.maxX, wx + r);
        box.maxY = Math.max(box.maxY, wy + r);
      }
      return box;
    }
    default:
      return null;
  }
}

const apart = (a: Aabb, b: Aabb) =>
  a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY;

/**
 * The box a sweep of `shape` by `by` covers, padded past Rapier's contact
 * tolerance and its single-precision poses, so a collider outside it can't
 * be hit.
 */
function sweptBox(shape: ShapeObj, by: Vec2): Aabb {
  const box = aabbUnion(aabb(shape), aabb(translateShape(shape, pt(by))));
  const far = Math.max(-box.minX, -box.minY, box.maxX, box.maxY);
  const pad = 1e-4 + 1e-3 * Math.max(box.maxX - box.minX, box.maxY - box.minY) + 1e-6 * far;
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
}

/**
 * Queries over the Rapier world, collider by collider (`intersectsShape`,
 * `castShape`, `castRayAndGetNormal`): Rapier's callback-taking world queries
 * call back into JS from wasm, which some loaders (Node's under Vitest)
 * can't do (a `castShape` filter predicate is never called there), and its
 * query pipeline misses colliders added or moved since the last step.
 * Queries see colliders as they stand, with no query refresh. A sweep casts
 * only at the colliders whose bounds meet the box it covers.
 */
export function rapierSpace(ctx: EngineContext): SpaceQuery {
  const world = () => physicsOf(ctx, "space queries");

  /** The colliders the filter admits, by handle; with `within`, only those whose bounds meet it. */
  function tagged(
    filter: SpaceFilter,
    sweeping: boolean,
    within?: Aabb,
  ): { collider: Collider; tag: ColliderTag }[] {
    const { physics, rapier } = world();
    const admit = admitter(ctx.tags, ctx.registry, filter, sweeping);
    const out: { collider: Collider; tag: ColliderTag; handle: number }[] = [];
    for (const collider of physics.world.colliders.getAll()) {
      if (within) {
        const bounds = rapierColliderBounds(collider, rapier.ShapeType);
        if (bounds && apart(bounds, within)) continue;
      }
      if (!colliderLive(collider)) continue;
      const tag = admit({
        handle: collider.handle,
        sensor: collider.isSensor(),
        groups: collider.collisionGroups(),
      });
      if (tag) out.push({ collider, tag, handle: collider.handle });
    }
    return out.sort(byHandle);
  }

  function queryShape(shape: ShapeObj) {
    const { rapier } = world();
    const pose = shapePose(shape);
    return {
      shape: shapeColliderDesc(rapier, shape).shape as Shape,
      pos: { x: pose.x, y: pose.y },
      rot: pose.rotation,
    };
  }

  return {
    backend: "rapier",
    pointAt(p, filter = {}) {
      return tagged(filter, false)
        .filter(({ collider }) => collider.containsPoint(p))
        .map(({ collider, tag }) => ({ handle: collider.handle, tag, at: { x: p.x, y: p.y } }));
    },
    overlaps(shape, filter = {}) {
      const q = queryShape(shape);
      const centre = vec(shapeCentre(shape).at);
      return tagged(filter, false)
        .filter(({ collider }) => collider.intersectsShape(q.shape, q.pos, q.rot))
        .map(({ collider, tag }) => {
          const at = collider.projectPoint(centre, true)?.point ?? centre;
          return { handle: collider.handle, tag, at: { x: at.x, y: at.y } };
        });
    },
    raycast(from, dir, maxDist, filter = {}) {
      const d = unitOf(dir);
      if (!d || !(maxDist >= 0)) return null;
      const { rapier } = world();
      const ray = new rapier.Ray(from, vec(d));
      const hits: SpaceCastHit[] = [];
      for (const { collider, tag } of tagged(filter, false)) {
        const hit = collider.castRayAndGetNormal(ray, maxDist, true);
        if (!hit) continue;
        const t = hit.timeOfImpact;
        let n = { x: hit.normal.x, y: hit.normal.y };
        if (t === 0 && collider.containsPoint(from)) n = { x: 0, y: 0 };
        else if (n.x * d[0] + n.y * d[1] > 0) n = { x: 0 - n.x, y: 0 - n.y };
        hits.push({
          handle: collider.handle,
          tag,
          at: { x: from.x + d[0] * t, y: from.y + d[1] * t },
          toi: maxDist === 0 ? 0 : t / maxDist,
          normal: n,
        });
      }
      return firstWithin(hits);
    },
    sweep(shape, by, filter = {}) {
      if (by.x === 0 && by.y === 0) return null;
      const q = queryShape(shape);
      const still = { x: 0, y: 0 };
      const hits: SpaceCastHit[] = [];
      for (const { collider, tag } of tagged(filter, true, sweptBox(shape, by))) {
        const hit = collider.castShape(still, q.shape, q.pos, q.rot, by, 0, 1, true);
        if (!hit) continue;
        const at = toWorld(collider, hit.witness1, true);
        const n = unitOf(toWorld(collider, hit.normal1, false));
        const normal = n ? vec(n) : { x: 0, y: 0 };
        hits.push({ handle: collider.handle, tag, at, toi: hit.time_of_impact, normal });
      }
      return firstWithin(hits);
    },
  };
}

// ─── Geometry ────────────────────────────────────────────

const pointBox = ({ x, y }: Vec2): Aabb => ({ minX: x, minY: y, maxX: x, maxY: y });

/** Queries over the geometry world, filtering by collision group as Rapier does. */
export function geometrySpace(
  world: GeometryWorld,
  tags: ColliderTags,
  registry: Registry,
): SpaceQuery {
  const colliders = geometryColliders(world);

  function near(box: Aabb | null, filter: SpaceFilter, sweeping: boolean) {
    const admit = admitter(tags, registry, filter, sweeping);
    return colliders
      .near(box)
      .flatMap((c) => {
        const tag = admit(c);
        return tag ? [{ handle: c.handle, shape: c.shape, tag }] : [];
      })
      .sort(byHandle);
  }

  return {
    backend: "geometry",
    pointAt(p, filter = {}) {
      const probe: ShapeObj = { type: "circle", cx: p.x, cy: p.y, r: 0 };
      return near(pointBox(p), filter, false)
        .filter((c) => shapesIntersect(c.shape, probe))
        .map(({ handle, tag }) => ({ handle, tag, at: { x: p.x, y: p.y } }));
    },
    overlaps(shape, filter = {}) {
      const centre = shapeCentre(shape).at;
      return near(aabb(shape), filter, false)
        .filter((c) => shapesIntersect(c.shape, shape))
        .map(({ handle, tag, shape: hit }) => ({
          handle,
          tag,
          at: vec(nearestPointOnShape(hit, centre)),
        }));
    },
    raycast(from, dir, maxDist, filter = {}) {
      const d = unitOf(dir);
      if (!d || !(maxDist >= 0)) return null;
      const to: Vec2 = { x: from.x + d[0] * maxDist, y: from.y + d[1] * maxDist };
      const box = aabbUnion(pointBox(from), pointBox(to));
      const hits: SpaceCastHit[] = [];
      for (const { handle, tag, shape } of near(box, filter, false)) {
        const hit = raycastShape(shape, pt(from), d, maxDist);
        if (!hit) continue;
        const t = hit.toi * maxDist;
        hits.push({
          handle,
          tag,
          at: { x: from.x + d[0] * t, y: from.y + d[1] * t },
          toi: hit.toi,
          normal: vec(hit.normal),
        });
      }
      return first(hits);
    },
    sweep(shape, by, filter = {}) {
      if (by.x === 0 && by.y === 0) return null;
      const box = aabbUnion(aabb(shape), aabb(translateShape(shape, pt(by))));
      const hits: SpaceCastHit[] = [];
      for (const { handle, tag, shape: target } of near(box, filter, true)) {
        const hit = sweepShape(shape, pt(by), target);
        if (hit) hits.push({ handle, tag, at: vec(hit.at), toi: hit.toi, normal: vec(hit.normal) });
      }
      return first(hits);
    },
  };
}

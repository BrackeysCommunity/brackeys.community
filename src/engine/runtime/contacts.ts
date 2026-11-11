import type { Collider } from "@dimforge/rapier2d";

import type { ContactSelector, Contacts, EngineContext } from "../game/types";
import { aabb, shapesIntersect } from "../scene/shape-geometry";
import { createSpatialHash } from "../scene/spatial-hash";
import type { Aabb } from "../scene/types";
import type { RapierModule, Vec2 } from "../types";
import { geometryColliders } from "./geometry-world";
import { CONTACT_END, CONTACT_START } from "./types";

/** A runtime's contact reader: `EngineContext.contacts` plus what the tick and the lifecycle call. */
export type RuntimeContacts = Contacts & {
  /** After the sensors' `afterStep`: raises the watched pairs' starts and ends. */
  read(): void;
  /** `id` was destroyed or disabled: its contacts end without an event. */
  forget(id: string): void;
  /** Ends every watch; at unload. */
  clear(): void;
};

type Touch = { entityId: string; other: string; at: Vec2 };

type Watch = {
  a: ContactSelector;
  b: ContactSelector | undefined;
  /** Pairs touching at the last read, by `pairKey`, in the order they started. */
  touching: Map<string, Touch>;
};

/** Touch-testing two colliders of the loaded backend: the contact point, or null when apart. */
type Narrow = (a: number, b: number) => Vec2 | null;

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

const overlapCentre = (a: Aabb, b: Aabb): Vec2 => ({
  x: (Math.max(a.minX, b.minX) + Math.min(a.maxX, b.maxX)) / 2,
  y: (Math.max(a.minY, b.minY) + Math.min(a.maxY, b.maxY)) / 2,
});

/** A Rapier collider's world bounds, or null for a shape kind with no cheap box (it is a candidate of every query). */
function rapierBounds(c: Collider, ShapeType: RapierModule["ShapeType"]): Aabb | null {
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

/**
 * Contact starts and ends between watched entities, read after the
 * sensors each tick without a callback from the physics step. Candidates
 * come from a hash of every enabled entity's non-sensor colliders by world
 * bounds, refreshed each tick for the colliders that moved, so an entity
 * whose system builds its colliders in code is found by what it collides
 * with, not by its scene shape. Each candidate pair is then tested
 * collider by collider: `Collider.contactCollider(other, 0)` on Rapier
 * (touching at distance <= 0, `at` its `point1`), `shapesIntersect` on the
 * geometry world (`at` the centre of the boxes' overlap). Sensors and
 * colliders gated off with collision groups 0 never touch.
 */
export function createContacts(ctx: EngineContext): RuntimeContacts {
  const watches: Watch[] = [];
  const hash = createSpatialHash<number>();
  /** Each hashed collider: its entity, its bounds (null when unbounded) and the pose they were computed at. */
  const placed = new Map<number, { entityId: string; box: Aabb | null; at: unknown[] }>();
  /** Hashed colliders without bounds, a candidate of every query. */
  const unbounded = new Set<number>();
  /** Whether each collider handle is a solid's rather than a sensor's; a handle is never reused for another collider. */
  const solid = new Map<number, boolean>();

  function rapierCollider(handle: number): Collider | null {
    return ctx.physics?.world.getCollider(handle) ?? null;
  }

  function isSolid(handle: number): boolean {
    let ok = solid.get(handle);
    if (ok === undefined) {
      if (ctx.physics) {
        const c = rapierCollider(handle);
        ok = c !== null && !c.isSensor();
      } else if (ctx.geometry) {
        const c = geometryColliders(ctx.geometry).get(handle);
        ok = c !== undefined && !c.sensor;
      } else {
        ok = false;
      }
      solid.set(handle, ok);
    }
    return ok;
  }

  /** The entity's colliders that aren't sensors, by handle. */
  const collidersOf = (id: string): number[] =>
    ctx.tags
      .handlesOf(id)
      .filter(isSolid)
      .sort((x, y) => x - y);

  const rapierTouches = (c: Collider) => c.isEnabled() && c.collisionGroups() !== 0;

  /** A collider's pose key (unchanged means its bounds are) and its world bounds, or undefined once it is gone. */
  type Locate = (handle: number) => { at: unknown[]; box: () => Aabb | null } | undefined;

  function backend(): { narrow: Narrow; locate: Locate } | null {
    const physics = ctx.physics;
    if (physics) {
      const { ShapeType } = physics.rapier;
      return {
        narrow(a, b) {
          const ca = physics.world.getCollider(a);
          const cb = physics.world.getCollider(b);
          if (!ca || !cb || !rapierTouches(ca) || !rapierTouches(cb)) return null;
          const hit = ca.contactCollider(cb, 0);
          return hit && hit.distance <= 0 ? { x: hit.point1.x, y: hit.point1.y } : null;
        },
        locate(handle) {
          const c = physics.world.getCollider(handle);
          if (!c) return undefined;
          const { x, y } = c.translation();
          return { at: [x, y, c.rotation(), c.shape], box: () => rapierBounds(c, ShapeType) };
        },
      };
    }
    const geometry = ctx.geometry;
    if (!geometry) return null;
    const colliders = geometryColliders(geometry);
    return {
      narrow(a, b) {
        const ca = colliders.get(a);
        const cb = colliders.get(b);
        if (!ca?.enabled || !cb?.enabled || ca.groups === 0 || cb.groups === 0) return null;
        if (!shapesIntersect(ca.shape, cb.shape)) return null;
        return overlapCentre(aabb(ca.shape), aabb(cb.shape));
      },
      locate(handle) {
        const c = colliders.get(handle);
        if (!c) return undefined;
        return { at: [c.shape], box: () => aabb(c.shape) };
      },
    };
  }

  /** The enabled entities `sel` names, in spawn order. */
  function selected(sel: ContactSelector): readonly string[] {
    if (typeof sel === "string") return ctx.enabled(sel) ? [sel] : [];
    const out: { type?: string; tag?: string } = {};
    if (sel.type !== undefined) out.type = sel.type;
    if (sel.tag !== undefined) out.tag = sel.tag;
    return ctx.query.select(out);
  }

  const samePose = (a: readonly unknown[], b: readonly unknown[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  function unplace(handle: number): void {
    if (!placed.delete(handle)) return;
    hash.remove(handle);
    unbounded.delete(handle);
  }

  /**
   * Brings the broad phase up to date: every non-sensor collider of every
   * enabled entity, at its world bounds. Returns the entities with one, in
   * spawn order, and each one's colliders.
   */
  function refreshHash(locate: Locate): {
    order: Map<string, number>;
    own: Map<string, number[]>;
  } {
    const order = new Map<string, number>();
    const own = new Map<string, number[]>();
    const seen = new Set<number>();
    for (const id of ctx.query.select()) {
      const handles: number[] = [];
      for (const handle of collidersOf(id)) {
        const where = locate(handle);
        if (!where) continue;
        handles.push(handle);
        seen.add(handle);
        const was = placed.get(handle);
        if (was && was.entityId === id && samePose(was.at, where.at)) continue;
        const box = where.box();
        placed.set(handle, { entityId: id, box, at: where.at });
        if (box) {
          unbounded.delete(handle);
          hash.update(handle, box);
        } else {
          hash.remove(handle);
          unbounded.add(handle);
        }
      }
      if (handles.length === 0) continue;
      order.set(id, order.size);
      own.set(id, handles);
    }
    for (const handle of [...placed.keys()]) if (!seen.has(handle)) unplace(handle);
    return { order, own };
  }

  function touchesOf(
    watch: Watch,
    order: ReadonlyMap<string, number>,
    own: ReadonlyMap<string, number[]>,
    narrow: Narrow,
  ): Map<string, Touch> {
    const now = new Map<string, Touch>();
    const others = watch.b === undefined ? null : new Set(selected(watch.b));
    const entityOf = (handle: number) => placed.get(handle)?.entityId;
    for (const id of selected(watch.a)) {
      const mine = own.get(id);
      if (!mine) continue;
      const near = new Set<string>();
      for (const handle of mine) {
        const box = placed.get(handle)?.box;
        const hits = box ? hash.query(box) : [...placed.keys()];
        for (const h of [...hits, ...unbounded]) {
          const o = entityOf(h);
          if (o !== undefined && o !== id && (others === null || others.has(o))) near.add(o);
        }
      }
      const sorted = [...near].sort((x, y) => order.get(x)! - order.get(y)!);
      for (const other of sorted) {
        const key = pairKey(id, other);
        if (now.has(key)) continue;
        const theirs = own.get(other) ?? [];
        let at: Vec2 | null = null;
        for (const m of mine) {
          for (const t of theirs) {
            at = narrow(m, t);
            if (at) break;
          }
          if (at) break;
        }
        if (at) now.set(key, { entityId: id, other, at });
      }
    }
    return now;
  }

  /** Whether a pair that stopped touching ends with an event: both sides still live and enabled. */
  const endsAloud = (t: Touch) => ctx.enabled(t.entityId) && ctx.enabled(t.other);

  return {
    watch(a, b) {
      const watch: Watch = { a, b, touching: new Map() };
      watches.push(watch);
      return () => {
        const i = watches.indexOf(watch);
        if (i >= 0) watches.splice(i, 1);
      };
    },
    read() {
      if (watches.length === 0) return;
      const phase = backend();
      if (!phase) return;
      const { order, own } = refreshHash(phase.locate);
      const started = new Set<string>();
      const ended = new Set<string>();
      for (const watch of [...watches]) {
        const now = touchesOf(watch, order, own, phase.narrow);
        for (const [key, t] of now) {
          if (watch.touching.has(key) || started.has(key)) continue;
          started.add(key);
          ctx.emit({ type: CONTACT_START, entityId: t.entityId, other: t.other, at: t.at });
        }
        for (const [key, t] of watch.touching) {
          if (now.has(key) || ended.has(key) || !endsAloud(t)) continue;
          ended.add(key);
          ctx.emit({ type: CONTACT_END, entityId: t.entityId, other: t.other, at: t.at });
        }
        watch.touching = now;
      }
    },
    forget(id) {
      for (const watch of watches) {
        for (const [key, t] of watch.touching) {
          if (t.entityId === id || t.other === id) watch.touching.delete(key);
        }
      }
      for (const [handle, p] of [...placed]) if (p.entityId === id) unplace(handle);
    },
    clear() {
      watches.length = 0;
      hash.clear();
      placed.clear();
      unbounded.clear();
      solid.clear();
    },
  };
}

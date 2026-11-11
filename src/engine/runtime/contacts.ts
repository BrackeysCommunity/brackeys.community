import type { Collider } from "@dimforge/rapier2d";

import type { ContactSelector, Contacts, EngineContext } from "../game/types";
import { aabb, shapesIntersect } from "../scene/shape-geometry";
import { createSpatialHash } from "../scene/spatial-hash";
import type { Aabb } from "../scene/types";
import type { Vec2 } from "../types";
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

/**
 * Contact starts and ends between watched entities, read after the
 * sensors each tick without a callback from the physics step. Candidates
 * come from a hash of every enabled entity's extent (`ctx.query`), so the
 * broad phase is the same on both backends; each candidate pair is then
 * tested collider by collider: `Collider.contactCollider(other, 0)` on
 * Rapier (touching at distance <= 0, `at` its `point1`), `shapesIntersect`
 * on the geometry world (`at` the centre of the boxes' overlap). Sensors
 * and colliders gated off with collision groups 0 never touch.
 */
export function createContacts(ctx: EngineContext): RuntimeContacts {
  const watches: Watch[] = [];
  const hash = createSpatialHash<string>();
  /** The extent each hashed entity was placed at; a new object means it moved. */
  const placed = new Map<string, unknown>();
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

  function narrowPhase(): Narrow | null {
    const physics = ctx.physics;
    if (physics) {
      return (a, b) => {
        const ca = physics.world.getCollider(a);
        const cb = physics.world.getCollider(b);
        if (!ca || !cb || !rapierTouches(ca) || !rapierTouches(cb)) return null;
        const hit = ca.contactCollider(cb, 0);
        return hit && hit.distance <= 0 ? { x: hit.point1.x, y: hit.point1.y } : null;
      };
    }
    const geometry = ctx.geometry;
    if (!geometry) return null;
    const colliders = geometryColliders(geometry);
    return (a, b) => {
      const ca = colliders.get(a);
      const cb = colliders.get(b);
      if (!ca?.enabled || !cb?.enabled || ca.groups === 0 || cb.groups === 0) return null;
      if (!shapesIntersect(ca.shape, cb.shape)) return null;
      return overlapCentre(aabb(ca.shape), aabb(cb.shape));
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

  /** Brings the broad phase up to date: every enabled entity with a collider that can touch, at its extent. */
  function refreshHash(): Map<string, number> {
    const order = new Map<string, number>();
    for (const id of ctx.query.select()) {
      if (collidersOf(id).length === 0) continue;
      const extent = ctx.query.extent(id);
      if (!extent) continue;
      order.set(id, order.size);
      if (placed.get(id) !== extent) {
        placed.set(id, extent);
        hash.update(id, aabb(extent));
      }
    }
    for (const id of [...placed.keys()]) {
      if (!order.has(id)) {
        placed.delete(id);
        hash.remove(id);
      }
    }
    return order;
  }

  function touchesOf(
    watch: Watch,
    order: ReadonlyMap<string, number>,
    narrow: Narrow,
  ): Map<string, Touch> {
    const now = new Map<string, Touch>();
    const others = watch.b === undefined ? null : new Set(selected(watch.b));
    for (const id of selected(watch.a)) {
      if (!order.has(id)) continue;
      const own = collidersOf(id);
      const extent = ctx.query.extent(id);
      if (!extent) continue;
      const near = hash
        .query(aabb(extent))
        .filter((o) => o !== id && (others === null || others.has(o)))
        .sort((x, y) => order.get(x)! - order.get(y)!);
      for (const other of near) {
        const key = pairKey(id, other);
        if (now.has(key)) continue;
        const theirs = collidersOf(other);
        let at: Vec2 | null = null;
        for (const mine of own) {
          for (const their of theirs) {
            at = narrow(mine, their);
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
      const narrow = narrowPhase();
      if (!narrow) return;
      const order = refreshHash();
      const started = new Set<string>();
      const ended = new Set<string>();
      for (const watch of [...watches]) {
        const now = touchesOf(watch, order, narrow);
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
      if (placed.delete(id)) hash.remove(id);
    },
    clear() {
      watches.length = 0;
      hash.clear();
      placed.clear();
      solid.clear();
    },
  };
}

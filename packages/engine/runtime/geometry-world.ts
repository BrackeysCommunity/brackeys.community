import type { Registry } from "../game/types";
import { aabb, shapeAtPose } from "../scene/shape-geometry";
import { createSpatialHash } from "../scene/spatial-hash";
import type { Aabb, ShapeObj } from "../scene/types";

export type GeometryColliderDesc = {
  /** Local to the pose for box, circle and capsule (centred on 0, 0); world for poly and chain at pose (0, 0). */
  shape: ShapeObj;
  body: "static" | "kinematic";
  sensor?: boolean;
  /** A registered collision group name; default "static", or "sensor" for sensors. */
  group?: string;
  pose?: { x: number; y: number; rot: number };
};

/** The engine's own colliders, for a scene loaded without physics. */
export interface GeometryWorld {
  /** A handle from the world's own counter; `ctx.tags` maps it like a Rapier handle. */
  add(desc: GeometryColliderDesc): number;
  setPose(handle: number, x: number, y: number, rot?: number): void;
  setEnabled(handle: number, enabled: boolean): void;
  remove(handle: number): void;
  /** The world-space shape now. */
  shape(handle: number): ShapeObj | undefined;
  /**
   * Packed like Rapier's `InteractionGroups`: membership in the high 16 bits,
   * filter in the low. 0 while the collider is disabled or gone.
   */
  groups(handle: number): number;
  /** In insertion order. */
  handles(): IterableIterator<number>;
  clear(): void;
  readonly size: number;
}

/** One collider as queries see it. */
export type GeometryCollider = {
  readonly handle: number;
  readonly body: "static" | "kinematic";
  readonly sensor: boolean;
  /** Packed like Rapier's `InteractionGroups`: membership in the high 16 bits, filter in the low. */
  readonly groups: number;
  readonly enabled: boolean;
  /** World space. */
  readonly shape: ShapeObj;
};

type Entry = {
  handle: number;
  local: ShapeObj;
  body: "static" | "kinematic";
  sensor: boolean;
  groups: number;
  pose: { x: number; y: number; rot: number };
  enabled: boolean;
  shape: ShapeObj;
};

const COLLIDERS = Symbol("geometry-world.colliders");

type GeometryColliders = {
  /** Enabled colliders whose bounds meet `box` (every enabled one for null), in no set order. */
  near(box: Aabb | null): GeometryCollider[];
  get(handle: number): GeometryCollider | undefined;
};

type WithColliders = GeometryWorld & { readonly [COLLIDERS]: GeometryColliders };

/** The colliders of a world made by `createGeometryWorld`, for queries over it. */
export function geometryColliders(world: GeometryWorld): GeometryColliders {
  const view = (world as Partial<WithColliders>)[COLLIDERS];
  if (!view) throw new Error("not a world from createGeometryWorld");
  return view;
}

const finite = (b: Aabb) =>
  Number.isFinite(b.minX) &&
  Number.isFinite(b.minY) &&
  Number.isFinite(b.maxX) &&
  Number.isFinite(b.maxY);

/**
 * Static and kinematic colliders with no dynamics, on a cell hash. Handles
 * count up from 0 and start again after `clear`, as a new Rapier world's do.
 */
export function createGeometryWorld(registry: Registry): GeometryWorld {
  const entries = new Map<number, Entry>();
  const hash = createSpatialHash<number>();
  let next = 0;

  function place(e: Entry): void {
    e.shape = shapeAtPose(e.local, e.pose);
    if (e.enabled) hash.update(e.handle, aabb(e.shape));
  }

  const colliders: GeometryColliders = {
    near(box) {
      if (box === null || !finite(box)) {
        return [...entries.values()].filter((e) => e.enabled);
      }
      return hash.query(box).flatMap((h) => {
        const e = entries.get(h);
        return e ? [e] : [];
      });
    },
    get: (handle) => entries.get(handle),
  };

  const world: WithColliders = {
    [COLLIDERS]: colliders,
    add(desc) {
      const sensor = desc.sensor === true;
      const groups = registry.collisionGroups(desc.group ?? (sensor ? "sensor" : "static"));
      const handle = next++;
      const pose = desc.pose ? { ...desc.pose } : { x: 0, y: 0, rot: 0 };
      const shape = shapeAtPose(desc.shape, pose);
      entries.set(handle, {
        handle,
        local: desc.shape,
        body: desc.body,
        sensor,
        groups,
        pose,
        enabled: true,
        shape,
      });
      hash.insert(handle, aabb(shape));
      return handle;
    },
    setPose(handle, x, y, rot) {
      const e = entries.get(handle);
      if (!e) return;
      e.pose = { x, y, rot: rot ?? e.pose.rot };
      place(e);
    },
    setEnabled(handle, enabled) {
      const e = entries.get(handle);
      if (!e || e.enabled === enabled) return;
      e.enabled = enabled;
      if (enabled) hash.insert(handle, aabb(e.shape));
      else hash.remove(handle);
    },
    remove(handle) {
      const e = entries.get(handle);
      if (!e) return;
      if (e.enabled) hash.remove(handle);
      entries.delete(handle);
    },
    shape: (handle) => entries.get(handle)?.shape,
    groups(handle) {
      const e = entries.get(handle);
      return e?.enabled ? e.groups : 0;
    },
    handles: () => entries.keys(),
    clear() {
      entries.clear();
      hash.clear();
      next = 0;
    },
    get size() {
      return entries.size;
    },
  };
  return world;
}

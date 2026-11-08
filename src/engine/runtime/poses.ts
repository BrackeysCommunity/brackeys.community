import type { Registry } from "../game/types";
import { degToRad } from "../physics";
import { geometryFields } from "../scene/schema";
import { geometryPose, shapeCentre, type GeometryPose } from "../scene/shape-geometry";
import type { PathDef, Pt, RuntimeEntity, ShapeObj } from "../scene/types";

export type Pose = {
  x: number;
  y: number;
  /** Radians. */
  rot: number;
};

/**
 * Every loaded entity's pose, simulation-side: set at spawn and by the
 * system that moves it. Deterministic and headless; never in a digest.
 */
export interface PoseIndex {
  /** The pose after the last simulated tick (or at spawn). */
  get(id: string): Readonly<Pose> | undefined;
  /** The pose one tick earlier; equals `get` for an entity not moved in the last tick. */
  prev(id: string): Readonly<Pose> | undefined;
  /**
   * Written only by the system that owns `id`; `snap` makes `prev` equal the new pose (spawn, teleport).
   * Without `rot` the entity keeps its current angle (0 for a new entry).
   */
  set(id: string, x: number, y: number, rot?: number, opts?: { snap?: boolean }): void;
  remove(id: string): void;
  has(id: string): boolean;
  ids(): IterableIterator<string>;
  readonly size: number;
}

type Entry = { cur: Readonly<Pose>; prev: Readonly<Pose>; at: number };

/**
 * A pose index whose ticks are read from `tick`. Entries are lazy: the
 * first `set` in a tick moves the current pose to `prev`, and an entry not
 * written since before the previous tick reads its current pose as `prev`.
 */
export function createPoseIndex(tick: () => number): PoseIndex {
  const entries = new Map<string, Entry>();
  return {
    get: (id) => entries.get(id)?.cur,
    prev(id) {
      const entry = entries.get(id);
      if (!entry) return undefined;
      return entry.at >= tick() - 1 ? entry.prev : entry.cur;
    },
    set(id, x, y, rot, opts) {
      const t = tick();
      const entry = entries.get(id);
      const pose = Object.freeze({ x, y, rot: rot ?? entry?.cur.rot ?? 0 });
      if (!entry || opts?.snap) {
        entries.set(id, { cur: pose, prev: pose, at: t });
        return;
      }
      if (entry.at !== t) entry.prev = entry.cur;
      entry.cur = pose;
      entry.at = t;
    },
    remove(id) {
      entries.delete(id);
    },
    has: (id) => entries.has(id),
    ids: () => entries.keys(),
    get size() {
      return entries.size;
    },
  };
}

/** Radians for an entity's quarter turns. */
const turnRad = (transform: RuntimeEntity["transform"]) => ((transform?.turn ?? 0) * Math.PI) / 2;

const poseOf = ({ at, rotDeg }: GeometryPose, transform: RuntimeEntity["transform"]): Pose => ({
  x: at[0],
  y: at[1],
  rot: rotDeg === undefined ? turnRad(transform) : degToRad(rotDeg),
});

/**
 * A shape's pose in its own coordinates: its centre, and its angle from
 * `rotDeg`, else from the entity's quarter turns (circles, polygons, chains).
 */
export function shapeSpawnPose(shape: ShapeObj, transform?: RuntimeEntity["transform"]): Pose {
  return poseOf(shapeCentre(shape), transform);
}

/** `pose` in the frame `frame` is posed at: what a body-local offset is for a body placed at `frame`. */
export function relativePose(pose: Pose, frame: Pose): Pose {
  const dx = pose.x - frame.x;
  const dy = pose.y - frame.y;
  if (frame.rot === 0) return { x: dx, y: dy, rot: pose.rot };
  const c = Math.cos(frame.rot);
  const s = Math.sin(frame.rot);
  return { x: dx * c + dy * s, y: dy * c - dx * s, rot: pose.rot - frame.rot };
}

/** A body-local `offset` placed on a body at `x, y` turned `rot` radians: the world pose it rides to. */
export function composePose(x: number, y: number, rot: number, offset: Pose): Pose {
  if (rot === 0) return { x: x + offset.x, y: y + offset.y, rot: offset.rot };
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return {
    x: x + offset.x * c - offset.y * s,
    y: y + offset.x * s + offset.y * c,
    rot: rot + offset.rot,
  };
}

/** Where a type's geometry puts an entity: its first shape, point and path fields. */
export type GeometryFields = ReturnType<typeof geometryFields>;

/** `spawnPose` over a type's geometry fields, for callers that look them up once per type. */
export function spawnPoseOf(e: RuntimeEntity, fields: GeometryFields): Pose {
  let shape: ShapeObj | undefined;
  let at: Pt | undefined;
  let path: PathDef | undefined;
  for (const { field, kind } of fields) {
    const value = e[field];
    if (value === undefined || value === null) continue;
    if (kind === "shape") shape ??= value as ShapeObj;
    else if (kind === "point") at ??= value as Pt;
    else if (kind === "path") path ??= value as PathDef;
  }
  const pose = geometryPose({ shape, at, path });
  return pose ? poseOf(pose, e.transform) : { x: 0, y: 0, rot: turnRad(e.transform) };
}

/**
 * Where an entity starts, from its type's geometry: a shape's centre (a
 * path rider's shape placed at the path's first point), else its point
 * field, else its path's first point. The angle is the shape's `rotDeg`,
 * else `RuntimeEntity.transform`'s quarter turns.
 */
export function spawnPose(e: RuntimeEntity, registry: Registry): Pose {
  const type = registry.types.get(e.type);
  return spawnPoseOf(e, type ? geometryFields(type) : []);
}

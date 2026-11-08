export { shapeSpawnPose } from "./spawn-pose";

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

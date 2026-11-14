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

/**
 * A pose index that tells its watchers each id it writes or removes, so an
 * index over it refreshes only what moved; `snap` is the write's own flag
 * (false for a removal).
 */
export type WatchedPoseIndex = PoseIndex & {
  watch(fn: (id: string, snap: boolean) => void): void;
};

export const isWatched = (poses: PoseIndex): poses is WatchedPoseIndex =>
  typeof (poses as Partial<WatchedPoseIndex>).watch === "function";

type Entry = { cur: Readonly<Pose>; prev: Readonly<Pose>; at: number };

/**
 * A pose index whose ticks are read from `tick`. Entries are lazy: the
 * first `set` in a tick moves the current pose to `prev`, and an entry not
 * written since before the previous tick reads its current pose as `prev`.
 */
export function createPoseIndex(tick: () => number): WatchedPoseIndex {
  const entries = new Map<string, Entry>();
  const watchers: ((id: string, snap: boolean) => void)[] = [];
  const wrote = (id: string, snap: boolean) => {
    for (const fn of watchers) fn(id, snap);
  };
  const index: Omit<WatchedPoseIndex, "size"> = {
    watch(fn) {
      watchers.push(fn);
    },
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
      } else {
        if (entry.at !== t) entry.prev = entry.cur;
        entry.cur = pose;
        entry.at = t;
      }
      wrote(id, opts?.snap === true);
    },
    remove(id) {
      if (entries.delete(id)) wrote(id, false);
    },
    has: (id) => entries.has(id),
    ids: () => entries.keys(),
  };
  // An accessor in the literal would put the index, read on every pose write, in V8's slow dictionary mode.
  return Object.defineProperty(index, "size", {
    get: () => entries.size,
    enumerable: true,
  }) as WatchedPoseIndex;
}

const TAU = Math.PI * 2;

/** From angle `a` toward `b` (radians) by `t`, turning the shorter way round. Defined here because the pose index takes no value imports. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
  return a + d * t;
}

/** `prev` toward `cur` by `alpha`: what a rendered frame between two ticks draws, turning the shorter way. */
export function lerpPose(prev: Readonly<Pose>, cur: Readonly<Pose>, alpha: number): Pose {
  return {
    x: prev.x + (cur.x - prev.x) * alpha,
    y: prev.y + (cur.y - prev.y) * alpha,
    rot: lerpAngle(prev.rot, cur.rot, alpha),
  };
}

/** Whether two poses are exactly equal. */
export const samePose = (a: Readonly<Pose>, b: Readonly<Pose>): boolean =>
  a.x === b.x && a.y === b.y && a.rot === b.rot;

/** `pose` in the frame `frame` is posed at: what a body-local offset is for a body placed at `frame`. */
export function relativePose(pose: Pose, frame: Pose): Pose {
  const dx = pose.x - frame.x;
  const dy = pose.y - frame.y;
  if (frame.rot === 0) return { x: dx, y: dy, rot: pose.rot };
  const c = Math.cos(frame.rot);
  const s = Math.sin(frame.rot);
  return { x: dx * c + dy * s, y: dy * c - dx * s, rot: pose.rot - frame.rot };
}

/** The pose of a body whose entity, at `offset` in the body's frame, is at `pose`: `composePose`'s inverse. */
export function framePose(pose: Readonly<Pose>, offset: Pose): Pose {
  const rot = pose.rot - offset.rot;
  if (rot === 0) return { x: pose.x - offset.x, y: pose.y - offset.y, rot };
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return {
    x: pose.x - (offset.x * c - offset.y * s),
    y: pose.y - (offset.x * s + offset.y * c),
    rot,
  };
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

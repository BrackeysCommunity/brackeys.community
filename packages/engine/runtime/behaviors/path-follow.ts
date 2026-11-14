import type { BehaviorSystem, BehaviorSystemFactory } from "../../game/behaviors";
import { COLLIDER, type ColliderSystem } from "../../game/behaviors/collider";
import type { PathFollowBlock, PathFollowSystem } from "../../game/behaviors/path-follow";
import type { EngineContext, JsonValue } from "../../game/types";
import type { PathDef } from "../../scene/types";
import {
  advanceAlongPath,
  initialWaypointState,
  pathPosition,
  pathWaypoints,
  readPathPlace,
  savePathPlace,
  seekAlongPath,
  type PathPlace,
} from "../../systems/path-follower";
import { composePose, relativePose, type Pose } from "../poses";

type Vec2 = { x: number; y: number };

type Rider = PathPlace & {
  path: PathDef;
  waypoints: Vec2[];
  disabled: boolean;
  /** Whether the last advance moved a body by its velocity, rather than writing the pose. */
  driving: boolean;
  /** False until its parent is known: the tree links after attach. */
  linked: boolean;
  /** The parent its path is expressed in; null for a root. */
  parent: string | null;
  /** The parent's pose when the path was expressed in its frame; null for a root. */
  frame: Pose | null;
};

const ZERO: Vec2 = { x: 0, y: 0 };

const samePose = (a: Readonly<Pose>, b: Readonly<Pose>) =>
  a.x === b.x && a.y === b.y && a.rot === b.rot;

/** Reads the parent and frame a save kept beside the path place; a root's save has neither. */
function savedFrame(state: JsonValue): { parent: string; frame: Pose } | null {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return null;
  const { parent, frame } = state;
  if (typeof parent !== "string" || !Array.isArray(frame)) return null;
  const [x, y, rot] = frame;
  const finite = (v: JsonValue | undefined): v is number =>
    typeof v === "number" && Number.isFinite(v);
  return finite(x) && finite(y) && finite(rot) ? { parent, frame: { x, y, rot } } : null;
}

/**
 * The `path-follow` behavior's system: moves each entity along its `path`
 * with the follower type's waypoint rules, its rotation kept.
 *
 * An entity whose `collider` carries a kinematic (or dynamic) `body` is
 * moved by that body's velocity, set each `beforeStep` to reach this tick's
 * point in the physics step, so what stands on it is carried and
 * `carrierDelta` answers for its collider. Any other entity has its pose
 * written; a collider without such a body stays where it was built.
 * Resets, seeks, restores and enables jump there instead, rebuilding the
 * body at the new pose.
 *
 * For an entity with a parent, the path's points are re-expressed in the
 * parent's frame when it is linked: each step puts it at the parent's pose
 * composed with its point, so it traces its path wherever the parent goes.
 * One that moves a body by its velocity is self-moving: the parent's
 * movement reaches it through that velocity, so what stands on it is
 * carried, rather than through the tree.
 *
 * A disabled entity's path clock keeps running; enabling it puts it where
 * its path is now.
 */
export const createPathFollowSystem: BehaviorSystemFactory = (ctx: EngineContext) => {
  const riders = new Map<string, Rider>();
  const colliders = () => ctx.behavior<ColliderSystem>(COLLIDER.name);

  /** The body its velocity moves, when it has one the collider system built. */
  function drives(id: string): boolean {
    if (!colliders()?.has(id) || !ctx.bodies.has(id)) return false;
    const kind = ctx.bodies.kind(id);
    return kind === "kinematic" || kind === "dynamic";
  }

  /** `at`, a point of the path as written, where the parent's pose puts it now. */
  function inFrame(r: Rider, at: Vec2): Vec2 {
    if (r.parent === null || r.frame === null) return at;
    const now = ctx.poses.get(r.parent);
    if (!now || samePose(now, r.frame)) return at;
    const p = composePose(now.x, now.y, now.rot, relativePose({ ...at, rot: 0 }, r.frame));
    return { x: p.x, y: p.y };
  }

  /** Where its path puts it now; a path of one point holds it there, and one of none where it is. */
  function placeOf(id: string, r: Rider): Vec2 {
    if (r.waypoints.length >= 2) return inFrame(r, pathPosition(r.waypoints, r.state));
    const first = r.waypoints[0];
    if (first) return inFrame(r, first);
    const at = ctx.poses.get(id) ?? ZERO;
    return { x: at.x, y: at.y };
  }

  /** Expresses its path in the frame of the parent it has now. */
  function link(id: string, r: Rider): void {
    const parent = ctx.tree.parent(id);
    const pose = parent === null ? undefined : ctx.poses.get(parent);
    r.linked = true;
    r.parent = parent;
    r.frame = pose ? { x: pose.x, y: pose.y, rot: pose.rot } : null;
  }

  /** Re-expresses its path when it moved under another parent since, and puts it there. */
  function relink(id: string, r: Rider): void {
    if (!r.linked) return link(id, r);
    if (ctx.tree.parent(id) === r.parent) return;
    link(id, r);
    jump(id, r, placeOf(id, r));
  }

  /** Puts the entity at `at` now: its pose snapped, and its collider rebuilt there. */
  function jump(id: string, r: Rider, at: Vec2): void {
    r.prevPos = { ...at };
    r.frameDelta = { ...ZERO };
    if (r.disabled) return;
    const rot = ctx.poses.get(id)?.rot ?? 0;
    ctx.poses.set(id, at.x, at.y, rot, { snap: true });
    const collider = colliders();
    if (collider?.has(id)) collider.rebuild(id);
    if (drives(id) && ctx.bodies.kind(id) === "kinematic") ctx.bodies.setVelocity(id, ZERO);
  }

  function start(id: string, r: Rider): void {
    r.state = initialWaypointState();
    jump(id, r, placeOf(id, r));
  }

  function riderOf(block: PathFollowBlock): Rider {
    const path = block.path as PathDef;
    const waypoints = pathWaypoints(path);
    return {
      path,
      waypoints,
      state: initialWaypointState(),
      prevPos: { ...(waypoints[0] ?? ZERO) },
      frameDelta: { ...ZERO },
      disabled: false,
      driving: false,
      linked: false,
      parent: null,
      frame: null,
    };
  }

  /** A kinematic body this system moved stops when it lets go of it. */
  function release(id: string, r: Rider): void {
    if (r.driving && ctx.bodies.has(id) && ctx.bodies.kind(id) === "kinematic")
      ctx.bodies.setVelocity(id, ZERO);
  }

  function advance(id: string, r: Rider, dtMs: number): void {
    relink(id, r);
    r.state = advanceAlongPath(r.state, r.waypoints, r.path, dtMs);
    const to = placeOf(id, r);
    if (r.disabled) {
      r.prevPos = to;
      r.frameDelta = { ...ZERO };
      r.driving = false;
      return;
    }
    const pose = ctx.poses.get(id);
    r.driving = drives(id);
    if (r.driving) {
      // From where the body is, so float error in its moves never builds up.
      const from = pose ?? r.prevPos;
      r.frameDelta = { x: to.x - from.x, y: to.y - from.y };
      const { rate } = ctx.time;
      ctx.bodies.setVelocity(id, { x: r.frameDelta.x * rate, y: r.frameDelta.y * rate });
    } else {
      r.frameDelta = { x: to.x - r.prevPos.x, y: to.y - r.prevPos.y };
      ctx.poses.set(id, to.x, to.y, pose?.rot ?? 0);
    }
    r.prevPos = to;
  }

  const system: PathFollowSystem = {
    attach(id, block) {
      const r = riderOf(block);
      riders.set(id, r);
      start(id, r);
    },
    /** Its place is kept while the points stay the same, and it is put there again; new points start it over. */
    update(id, block, prev) {
      const was = riders.get(id);
      const r = riderOf(block);
      if (was) Object.assign(r, { linked: was.linked, parent: was.parent, frame: was.frame });
      riders.set(id, r);
      if (!was || JSON.stringify(block.path.pts) !== JSON.stringify(prev.path.pts)) {
        if (was) r.disabled = was.disabled;
        return start(id, r);
      }
      r.state = was.state;
      r.disabled = was.disabled;
      jump(id, r, placeOf(id, r));
    },
    detach(id) {
      const r = riders.get(id);
      if (!r) return;
      riders.delete(id);
      release(id, r);
    },
    disable(id) {
      const r = riders.get(id);
      if (!r || r.disabled) return;
      release(id, r);
      r.disabled = true;
      r.frameDelta = { ...ZERO };
      r.driving = false;
    },
    enable(id) {
      const r = riders.get(id);
      if (!r || !r.disabled) return;
      r.disabled = false;
      relink(id, r);
      jump(id, r, placeOf(id, r));
    },
    ready(ids) {
      for (const id of ids) {
        const r = riders.get(id);
        if (r) link(id, r);
      }
    },
    beforeStep(dtMs) {
      for (const [id, r] of riders) advance(id, r, dtMs);
    },
    reset() {
      for (const [id, r] of riders) {
        relink(id, r);
        start(id, r);
      }
    },
    seek(ms) {
      for (const [id, r] of riders) {
        relink(id, r);
        r.state = seekAlongPath(r.state, r.waypoints, r.path, ms, ctx.time);
        jump(id, r, placeOf(id, r));
      }
    },
    clear() {
      riders.clear();
    },
    size: () => riders.size,
    /** Its place on the path, so a restored entity resumes its phase; a child's parent and frame beside it. */
    save(id): JsonValue | undefined {
      const r = riders.get(id);
      if (!r) return undefined;
      const place = savePathPlace(r) as Record<string, JsonValue>;
      if (r.parent === null || r.frame === null) return place;
      return { ...place, parent: r.parent, frame: [r.frame.x, r.frame.y, r.frame.rot] };
    },
    /** The world save put the pose and the body back; this puts back the path clock and the frame. */
    restore(id, state) {
      const r = riders.get(id);
      const read = r ? readPathPlace(state, r.waypoints) : null;
      if (!r || !read) return;
      Object.assign(r, read);
      const framed = savedFrame(state);
      r.linked = true;
      r.parent = framed?.parent ?? null;
      r.frame = framed?.frame ?? null;
      r.driving = !r.disabled && drives(id);
    },
    selfMoving(id) {
      const r = riders.get(id);
      return r !== undefined && !r.disabled && drives(id);
    },
    position(id) {
      const r = riders.get(id);
      return r ? { ...r.prevPos } : null;
    },
    handle: (id) => ({
      position: () => system.position(id),
      frameDelta: () => system.frameDelta(id),
    }),
    /** Its last position becomes the pose, so the jump isn't read as this tick's travel. */
    posed(id, pose) {
      const r = riders.get(id);
      if (!r) return;
      r.prevPos = { x: pose.x, y: pose.y };
      r.frameDelta = { ...ZERO };
    },
    frameDelta(id) {
      const r = riders.get(id);
      return r?.driving ? { ...r.frameDelta } : null;
    },
  };
  return system as BehaviorSystem;
};

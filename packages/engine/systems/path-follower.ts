import { physicsOf } from "../game/physics-of";
import { wholeTicksIn } from "../game/time";
import type { EngineContext, JsonValue, RegisteredType, SceneSystem } from "../game/types";
import { shapeColliderDesc } from "../physics";
import { composePose, type Pose } from "../runtime/poses";
import { colliderLive } from "../runtime/space";
import { shapeSpawnPose } from "../runtime/spawn-pose";
import type { PathDef, RuntimeEntity, ShapeObj } from "../scene/types";
import type { Vec2 } from "../types";
import {
  addGeometryCollider,
  applySurface,
  createBodyTable,
  drawEntity,
  entityDrawLayer,
  removeGeometryCollider,
  surfaceOf,
  surfaceTag,
  type OwnedBody,
  type SurfaceDefaults,
  type VisualOptions,
} from "./bodies";

// ─── Types ──────────────────────────────────────────────

/** Ping-pong reverses at the ends; loop runs the closing segment from last back to first. */
export type WaypointMode = "ping_pong" | "loop";

// ─── Waypoint interpolation (pure, testable) ────────────

/** A segment shorter than this, m, is skipped. */
const MIN_SEGMENT_METRES = 0.0001;

export type WaypointState = {
  currentIndex: number;
  nextIndex: number;
  t: number; // 0–1 progress between current and next waypoint
  direction: 1 | -1; // +1 = forward, -1 = backward (ping-pong)
  pauseRemainingMs: number;
};

function waypointAt(waypoints: readonly Vec2[], i: number): Vec2 {
  const w = waypoints[i];
  if (!w) throw new RangeError(`waypoint ${i} out of range (${waypoints.length} points)`);
  return w;
}

/** Advance waypoint state by dt. Returns new state (immutable). */
export function advanceWaypoint(
  state: WaypointState,
  waypoints: Vec2[],
  speed: number,
  dtMs: number,
  pauseMs: number,
  mode: WaypointMode,
): WaypointState {
  if (waypoints.length < 2) return state;

  let { currentIndex, nextIndex, t, direction, pauseRemainingMs } = state;

  // If paused at a waypoint, count down
  if (pauseRemainingMs > 0) {
    pauseRemainingMs -= dtMs;
    if (pauseRemainingMs > 0) {
      return { currentIndex, nextIndex, t, direction, pauseRemainingMs };
    }
    pauseRemainingMs = 0;
  }

  // Compute distance between current and next waypoint
  const a = waypointAt(waypoints, currentIndex);
  const b = waypointAt(waypoints, nextIndex);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const segmentLength = Math.sqrt(dx * dx + dy * dy);

  if (segmentLength < MIN_SEGMENT_METRES) {
    // Degenerate segment — skip to next
    return advanceToNextSegment(currentIndex, nextIndex, direction, waypoints, pauseMs, mode);
  }

  // Advance t based on speed and segment length
  const dtSec = dtMs / 1000;
  const tAdvance = (speed * dtSec) / segmentLength;
  t += tAdvance;

  if (t >= 1) {
    t = 0;
    return advanceToNextSegment(currentIndex, nextIndex, direction, waypoints, pauseMs, mode);
  }

  return { currentIndex, nextIndex, t, direction, pauseRemainingMs };
}

function advanceToNextSegment(
  _currentIndex: number,
  nextIndex: number,
  direction: 1 | -1,
  waypoints: Vec2[],
  pauseMs: number,
  mode: WaypointMode,
): WaypointState {
  const len = waypoints.length;

  if (mode === "loop") {
    const newCurrent = nextIndex;
    const newNext = (nextIndex + 1) % len;
    return {
      currentIndex: newCurrent,
      nextIndex: newNext,
      t: 0,
      direction: 1,
      pauseRemainingMs: pauseMs,
    };
  }

  // Ping-pong
  let newCurrent = nextIndex;
  let newNext = nextIndex + direction;
  let newDir = direction;

  if (newNext >= len) {
    // Hit end — reverse
    newDir = -1;
    newNext = nextIndex - 1;
    newCurrent = nextIndex;
  } else if (newNext < 0) {
    // Hit start — reverse
    newDir = 1;
    newNext = nextIndex + 1;
    newCurrent = nextIndex;
  }

  return {
    currentIndex: newCurrent,
    nextIndex: newNext,
    t: 0,
    direction: newDir,
    pauseRemainingMs: pauseMs,
  };
}

/** Interpolate position between two waypoints at progress t */
export function interpolatePosition(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/** At the first waypoint, heading for the second, not paused. */
export function initialWaypointState(): WaypointState {
  return { currentIndex: 0, nextIndex: 1, t: 0, direction: 1, pauseRemainingMs: 0 };
}

/** A follower's place on its path as plain JSON, for a world save. */
function saveMotion(m: Motion): JsonValue {
  const { currentIndex, nextIndex, t, direction, pauseRemainingMs } = m.state;
  return {
    state: [currentIndex, nextIndex, t, direction, pauseRemainingMs],
    prev: [m.prevPos.x, m.prevPos.y],
    delta: [m.frameDelta.x, m.frameDelta.y],
  };
}

const finite = (v: JsonValue | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Reads `saveMotion`'s output back; null when it doesn't fit `waypoints`. */
function readMotion(
  state: JsonValue,
  waypoints: readonly Vec2[],
): Pick<Motion, "state" | "prevPos" | "frameDelta"> | null {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return null;
  const { state: s, prev, delta } = state;
  if (!Array.isArray(s) || !Array.isArray(prev) || !Array.isArray(delta)) return null;
  const [currentIndex, nextIndex, t, direction, pauseRemainingMs] = s;
  const index = (i: JsonValue | undefined): i is number =>
    Number.isInteger(i) && (i as number) >= 0 && (i as number) < waypoints.length;
  if (!index(currentIndex) || !index(nextIndex) || !finite(t) || !finite(pauseRemainingMs))
    return null;
  if (direction !== 1 && direction !== -1) return null;
  const [px, py] = prev;
  const [dx, dy] = delta;
  if (!finite(px) || !finite(py) || !finite(dx) || !finite(dy)) return null;
  return {
    state: { currentIndex, nextIndex, t, direction, pauseRemainingMs },
    prevPos: { x: px, y: py },
    frameDelta: { x: dx, y: dy },
  };
}

// ─── Follower system ────────────────────────────────────

export type FollowerEntity = RuntimeEntity<{ shape: ShapeObj; path: PathDef; material?: string }>;

/** Visuals default to the `body` layer. */
export type FollowerOptions = SurfaceDefaults & VisualOptions;

export type FollowerSystem = SceneSystem<FollowerEntity> & {
  /**
   * How far the follower moved in the last `beforeStep`, for carrying
   * riders. It holds for every collider on its body, attached ones too.
   */
  frameDelta(id: string): Vec2 | null;
  position(id: string): Vec2 | null;
};

const isFollowerSystem = (system: SceneSystem | undefined): system is FollowerSystem =>
  typeof (system as Partial<FollowerSystem> | undefined)?.frameDelta === "function";

/**
 * How far the body carrying a collider moved in the last step: its
 * follower's `frameDelta` (an attached collider's carrier, else its own
 * entity's), or null when the body isn't a follower's.
 */
export function carrierDelta(ctx: EngineContext, handle: number): Vec2 | null {
  const tag = ctx.tags.get(handle);
  if (!tag) return null;
  const carrier = tag.carrier ?? tag;
  const system = ctx.system(carrier.type);
  return isFollowerSystem(system) ? system.frameDelta(carrier.entityId) : null;
}

/** Where a follower is on its path. */
type Motion = {
  entity: FollowerEntity;
  waypoints: Vec2[];
  state: WaypointState;
  prevPos: Vec2;
  frameDelta: Vec2;
  /** The entity's pose in the path point's frame. */
  offset: Pose;
};

type Follower = OwnedBody & Motion;

/**
 * A follower in a scene without physics: no body, and its kinematic
 * collider in the geometry world when the runtime has one.
 */
type BodilessFollower = Motion & { handle: number | null };

/**
 * Kinematic bodies that follow their `path`, advanced in `beforeStep`;
 * poses and visuals follow in `afterStep`, and so do the entities attached
 * to them. In a scene without physics a follower has no body: its pose,
 * and its geometry collider, follow the path all the same.
 *
 * A disabled follower's path clock keeps running, but it has no collider
 * (its body's riders lose theirs with it), no visual and posts no poses;
 * enabling it snaps it to where its path is now.
 */
export function createFollowerSystem(
  ctx: EngineContext,
  type: RegisteredType,
  opts: FollowerOptions = {},
): FollowerSystem {
  const drawn = opts.draw !== false;
  const table = createBodyTable<Follower>(ctx, { view: drawn });
  const groups = ctx.registry.collisionGroups("static");
  const bodiless = new Map<string, BodilessFollower>();
  const disabled = new Set<string>();
  /** Riders' colliders a disabled follower switched off with its body, by follower id. */
  const parked = new Map<string, number[]>();
  const motions = (): (Follower | BodilessFollower)[] => [
    ...table.owned.values(),
    ...bodiless.values(),
  ];

  /**
   * Writes a bodiless follower's pose, and moves its geometry collider
   * with it: as a kinematic Rapier body's next translation, the move lands
   * after the step's overlaps were taken.
   */
  function poseBodiless(f: BodilessFollower, snap: boolean): void {
    const at = poseOf(f);
    if (f.handle !== null) ctx.geometry?.setPose(f.handle, at.x, at.y, 0);
    const p = composePose(at.x, at.y, 0, f.offset);
    ctx.poses.set(f.entity.id, p.x, p.y, p.rot, snap ? { snap } : undefined);
    if (drawn) ctx.view?.pose(f.entity.id, at.x, at.y, 0);
  }

  /**
   * Writes a follower's pose from its body, to the pose index and its
   * visual, then re-poses what rides it from the same read.
   */
  function poseBody(f: Follower, snap: boolean): void {
    const t = f.body.translation();
    const at = { x: t.x, y: t.y, rot: f.body.rotation() };
    const p = composePose(at.x, at.y, at.rot, f.offset);
    ctx.poses.set(f.entity.id, p.x, p.y, p.rot, snap ? { snap } : undefined);
    table.poseAt(f.entity.id, at);
    ctx.attachments.moved(f.entity.id, snap, at);
  }

  /** Poses every enabled follower and what rides it; `snap` after a jump (reset, seek). */
  const follow = (snap = false) => {
    for (const f of table.owned.values()) if (!disabled.has(f.entity.id)) poseBody(f, snap);
    for (const f of bodiless.values()) if (!disabled.has(f.entity.id)) poseBodiless(f, snap);
  };

  function advance(f: Motion, dtMs: number): void {
    const { path } = f.entity;
    f.state = advanceWaypoint(f.state, f.waypoints, path.speed, dtMs, path.pauseMs ?? 0, path.mode);
  }

  function poseOf(f: Motion): Vec2 {
    return interpolatePosition(
      waypointAt(f.waypoints, f.state.currentIndex),
      waypointAt(f.waypoints, f.state.nextIndex),
      f.state.t,
    );
  }

  /** Switches back on the riders' colliders its disable switched off, for riders still enabled. */
  function unpark(id: string): void {
    const handles = parked.get(id);
    parked.delete(id);
    if (!handles || !ctx.physics) return;
    for (const handle of handles) {
      const tag = ctx.tags.get(handle);
      if (tag && ctx.enabled(tag.entityId)) ctx.physics.world.getCollider(handle)?.setEnabled(true);
    }
  }

  function despawn(id: string): void {
    if (disabled.delete(id)) unpark(id);
    const f = bodiless.get(id);
    if (f) {
      removeGeometryCollider(ctx, f.handle);
      bodiless.delete(id);
      if (drawn) ctx.view?.remove(id);
      return;
    }
    ctx.attachments.unhost(id);
    table.despawn(id);
  }

  function place(f: Follower | BodilessFollower, pos: Vec2, teleport: boolean): void {
    if (!("body" in f) || disabled.has(f.entity.id)) return;
    const { rapier } = physicsOf(ctx, type.type, f.entity.id);
    const v = new rapier.Vector2(pos.x, pos.y);
    if (teleport) f.body.setTranslation(v, true);
    else f.body.setNextKinematicTranslation(v);
  }

  return {
    spawn(e) {
      despawn(e.id);
      const waypoints = e.path.pts.map(([x, y]) => ({ x, y }));
      const start = waypoints[0];
      if (!start || waypoints.length < 2)
        throw new Error(`${type.type} ${e.id} needs at least 2 path points`);

      if (!ctx.physics) {
        const f: BodilessFollower = {
          entity: e,
          waypoints,
          state: initialWaypointState(),
          prevPos: { ...start },
          frameDelta: { x: 0, y: 0 },
          offset: shapeSpawnPose(e.shape, e.transform),
          handle: addGeometryCollider(
            ctx,
            e.shape,
            { body: "kinematic", group: "static" },
            surfaceTag(e.id, type, e.material),
            { x: start.x, y: start.y, rot: 0 },
          ),
        };
        bodiless.set(e.id, f);
        if (drawn) drawEntity(ctx, type, e, opts.layer ?? entityDrawLayer(ctx, e, "body"));
        poseBodiless(f, true);
        return;
      }
      const { rapier, physics } = physicsOf(ctx, type.type, e.id);
      const surface = surfaceOf(ctx, e.material, opts);
      const desc = applySurface(
        shapeColliderDesc(rapier, e.shape, true).setCollisionGroups(groups),
        surface,
      );
      const body = physics.addRigidBody(
        rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y),
      );
      const collider = physics.addCollider(desc, body);
      const follower: Follower = {
        body,
        collider,
        entity: e,
        waypoints,
        state: initialWaypointState(),
        prevPos: { ...start },
        frameDelta: { x: 0, y: 0 },
        offset: shapeSpawnPose(e.shape, e.transform),
      };
      table.add(e, follower, surfaceTag(e.id, type, e.material), true);
      place(follower, start, true);
      ctx.attachments.host(e.id, type.type, body, start);
      if (drawn) {
        drawEntity(ctx, type, e, opts.layer ?? entityDrawLayer(ctx, e, "body"));
        table.pose(e.id);
      }
    },
    despawn,
    disable(id) {
      const m = bodiless.get(id) ?? table.owned.get(id);
      if (!m || disabled.has(id)) return;
      disabled.add(id);
      if ("body" in m) {
        const riders: number[] = [];
        for (let i = 0; i < m.body.numColliders(); i++) {
          const c = m.body.collider(i);
          if (c.handle === m.collider.handle || !colliderLive(c)) continue;
          c.setEnabled(false);
          riders.push(c.handle);
        }
        parked.set(id, riders);
        m.collider.setEnabled(false);
        m.body.setEnabled(false);
      } else if (m.handle !== null) ctx.geometry?.setEnabled(m.handle, false);
      m.frameDelta = { x: 0, y: 0 };
      if (drawn) ctx.view?.remove(id);
    },
    enable(id) {
      const m = bodiless.get(id) ?? table.owned.get(id);
      if (!m || !disabled.delete(id)) return;
      m.prevPos = poseOf(m);
      m.frameDelta = { x: 0, y: 0 };
      if ("body" in m) {
        m.body.setEnabled(true);
        m.collider.setEnabled(true);
        unpark(id);
        place(m, m.prevPos, true);
        // Queries read colliders as they stand, so they move with the body now, not at the next step.
        physicsOf(ctx, type.type, id).physics.world.propagateModifiedBodyPositionsToColliders();
      } else if (m.handle !== null) ctx.geometry?.setEnabled(m.handle, true);
      if (drawn)
        drawEntity(ctx, type, m.entity, opts.layer ?? entityDrawLayer(ctx, m.entity, "body"));
      if ("body" in m) poseBody(m, true);
      else poseBodiless(m, true);
    },
    clear() {
      for (const id of [...bodiless.keys()]) despawn(id);
      for (const id of [...table.owned.keys()]) despawn(id);
    },
    reset() {
      for (const f of motions()) {
        const start = waypointAt(f.waypoints, 0);
        f.state = initialWaypointState();
        f.prevPos = { ...start };
        f.frameDelta = { x: 0, y: 0 };
        place(f, start, true);
      }
      follow(true);
    },
    size: () => table.size() + bodiless.size,
    /** Its path clock, so a restored follower resumes its phase. */
    save(id) {
      const m = bodiless.get(id) ?? table.owned.get(id);
      return m ? saveMotion(m) : undefined;
    },
    restore(id, state) {
      const m = bodiless.get(id) ?? table.owned.get(id);
      const read = m ? readMotion(state, m.waypoints) : null;
      if (!m || !read) return;
      Object.assign(m, read);
      if (disabled.has(id)) return;
      if ("body" in m) {
        place(m, m.prevPos, true);
        physicsOf(ctx, type.type, id).physics.world.propagateModifiedBodyPositionsToColliders();
        poseBody(m, true);
      } else poseBodiless(m, true);
    },
    seek(ms) {
      const { tickMs } = ctx.time;
      const { ticks, restMs } = wholeTicksIn(ms, ctx.time);
      for (const f of motions()) {
        for (let i = 0; i < ticks; i++) advance(f, tickMs);
        if (restMs > 0) advance(f, restMs);
        const pos = poseOf(f);
        f.prevPos = pos;
        f.frameDelta = { x: 0, y: 0 };
        place(f, pos, true);
      }
      follow(true);
    },
    beforeStep(dtMs) {
      for (const f of motions()) {
        advance(f, dtMs);
        const pos = poseOf(f);
        f.frameDelta = disabled.has(f.entity.id)
          ? { x: 0, y: 0 }
          : { x: pos.x - f.prevPos.x, y: pos.y - f.prevPos.y };
        f.prevPos = pos;
        place(f, pos, false);
      }
    },
    afterStep: () => follow(),
    frameDelta(id) {
      const f = table.owned.get(id) ?? bodiless.get(id);
      return f ? { ...f.frameDelta } : null;
    },
    position(id) {
      const f = bodiless.get(id);
      return f ? { ...f.prevPos } : table.position(id);
    },
  };
}

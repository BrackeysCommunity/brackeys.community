import type { EngineContext, RegisteredType, SceneSystem } from "../game/types";
import { shapeColliderDesc, TICK_RATE } from "../physics";
import type { PathDef, RuntimeEntity, ShapeObj } from "../scene/types";
import type { Vec2 } from "../types";
import {
  applySurface,
  createBodyTable,
  drawEntity,
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

  if (segmentLength < 0.01) {
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

type Follower = OwnedBody & {
  entity: FollowerEntity;
  waypoints: Vec2[];
  state: WaypointState;
  prevPos: Vec2;
  frameDelta: Vec2;
};

/** Kinematic bodies that follow their `path`, advanced in `beforeStep`; visuals follow in `afterStep`. */
export function createFollowerSystem(
  ctx: EngineContext,
  type: RegisteredType,
  opts: FollowerOptions = {},
): FollowerSystem {
  const table = createBodyTable<Follower>(ctx);
  const { rapier, physics } = ctx;
  const groups = ctx.registry.collisionGroups("static");
  const drawn = opts.draw !== false;
  const follow = () => {
    if (drawn) table.poseAll();
  };

  function advance(f: Follower, dtMs: number): void {
    const { path } = f.entity;
    f.state = advanceWaypoint(f.state, f.waypoints, path.speed, dtMs, path.pauseMs ?? 0, path.mode);
  }

  function poseOf(f: Follower): Vec2 {
    return interpolatePosition(
      waypointAt(f.waypoints, f.state.currentIndex),
      waypointAt(f.waypoints, f.state.nextIndex),
      f.state.t,
    );
  }

  function despawn(id: string): void {
    ctx.attachments.unhost(id);
    table.despawn(id);
  }

  function place(f: Follower, pos: Vec2, teleport: boolean): void {
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
      };
      table.add(e.id, follower, surfaceTag(e.id, type, e.material));
      place(follower, start, true);
      ctx.attachments.host(e.id, type.type, body, start);
      if (drawn) {
        drawEntity(ctx, type, e, opts.layer ?? "body");
        table.pose(e.id);
      }
    },
    despawn,
    clear() {
      for (const id of [...table.owned.keys()]) despawn(id);
    },
    reset() {
      for (const f of table.owned.values()) {
        const start = waypointAt(f.waypoints, 0);
        f.state = initialWaypointState();
        f.prevPos = { ...start };
        f.frameDelta = { x: 0, y: 0 };
        place(f, start, true);
      }
      follow();
    },
    size: table.size,
    seek(ms) {
      const tickMs = 1000 / TICK_RATE;
      const whole = Math.floor(ms / tickMs);
      const rest = ms - whole * tickMs;
      for (const f of table.owned.values()) {
        for (let i = 0; i < whole; i++) advance(f, tickMs);
        if (rest > 0) advance(f, rest);
        const pos = poseOf(f);
        f.prevPos = pos;
        f.frameDelta = { x: 0, y: 0 };
        place(f, pos, true);
      }
      follow();
    },
    beforeStep(dtMs) {
      for (const f of table.owned.values()) {
        advance(f, dtMs);
        const pos = poseOf(f);
        f.frameDelta = { x: pos.x - f.prevPos.x, y: pos.y - f.prevPos.y };
        f.prevPos = pos;
        place(f, pos, false);
      }
    },
    afterStep: follow,
    frameDelta(id) {
      const f = table.owned.get(id);
      return f ? { ...f.frameDelta } : null;
    },
    position: table.position,
  };
}

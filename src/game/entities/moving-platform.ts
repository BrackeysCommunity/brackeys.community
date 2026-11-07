import type { Collider, RigidBody } from "@dimforge/rapier2d";
import { Graphics } from "pixi.js";

import { GROUND_COLLISION_GROUP } from "../collisions";
import { addToLayer, type EngineContext } from "../context";
import { shapeColliderDesc } from "../physics";
import { SURFACE_MATERIALS } from "../surfaces";
import { traceShape } from "../systems/draw-shape";
import type { EntityOf, SceneSystem } from "../systems/scene-system";
import type { Vec2 } from "../types";

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
  const a = waypoints[currentIndex];
  const b = waypoints[nextIndex];
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

// ─── Mover system ───────────────────────────────────────

const SURFACE_COLORS: Record<string, number> = {
  normal: 0xffa500,
  ice: 0x88ddff,
  chocolate: 0x8b4513,
  trampoline: 0xff00ff,
};

const DEFAULT_FRICTION = 0.8;

export type MovingPlatformSystem = SceneSystem<EntityOf<"mover">> & {
  /** Advance every mover. Call before player.update(). */
  tick: (dtMs: number) => void;
  /** Position delta the mover travelled this frame, for rider sync. */
  frameDelta: (id: string) => Vec2 | null;
  position: (id: string) => Vec2 | null;
};

type Mover = {
  entity: EntityOf<"mover">;
  waypoints: Vec2[];
  body: RigidBody;
  collider: Collider;
  graphics: Graphics | null;
  state: WaypointState;
  prevPos: Vec2;
  frameDelta: Vec2;
};

function initialState(): WaypointState {
  return { currentIndex: 0, nextIndex: 1, t: 0, direction: 1, pauseRemainingMs: 0 };
}

export function createMovingPlatformSystem(ctx: EngineContext): MovingPlatformSystem {
  const { rapier, physics, view } = ctx;
  const movers = new Map<string, Mover>();

  function place(mover: Mover, pos: Vec2, teleport: boolean): void {
    const v = new rapier.Vector2(pos.x, pos.y);
    if (teleport) mover.body.setTranslation(v, true);
    else mover.body.setNextKinematicTranslation(v);
    mover.graphics?.position.set(pos.x, pos.y);
  }

  function spawn(e: EntityOf<"mover">): void {
    despawn(e.id);
    const waypoints = e.path.pts.map(([x, y]) => ({ x, y }));
    if (waypoints.length < 2) throw new Error(`mover ${e.id} needs at least 2 path points`);
    const start = waypoints[0];

    const body = physics.addRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y),
    );
    const mat = e.material ? SURFACE_MATERIALS[e.material] : null;
    const collider = physics.addCollider(
      shapeColliderDesc(rapier, e.shape, true)
        .setCollisionGroups(GROUND_COLLISION_GROUP)
        .setFriction(mat?.friction ?? DEFAULT_FRICTION)
        .setRestitution(mat?.restitution ?? 0),
      body,
    );
    ctx.tags.set(collider.handle, { entityId: e.id, behavior: "mover", material: e.material });

    let graphics: Graphics | null = null;
    if (view) {
      graphics = new Graphics();
      traceShape(graphics, e.shape);
      graphics.fill({ color: SURFACE_COLORS[e.material ?? "normal"], alpha: 0.8 });
      traceShape(graphics, e.shape);
      graphics.stroke({ width: 2, color: 0xffffff, alpha: 0.4 });
      addToLayer(view.world, graphics, "mover");
    }

    const mover: Mover = {
      entity: e,
      waypoints,
      body,
      collider,
      graphics,
      state: initialState(),
      prevPos: { ...start },
      frameDelta: { x: 0, y: 0 },
    };
    place(mover, start, true);
    movers.set(e.id, mover);
  }

  function despawn(id: string): void {
    const mover = movers.get(id);
    if (!mover) return;
    ctx.tags.delete(mover.collider.handle);
    physics.removeRigidBody(mover.body);
    mover.graphics?.destroy();
    movers.delete(id);
  }

  function tick(dtMs: number): void {
    for (const mover of movers.values()) {
      const { path } = mover.entity;
      mover.state = advanceWaypoint(
        mover.state,
        mover.waypoints,
        path.speed,
        dtMs,
        path.pauseMs ?? 0,
        path.mode,
      );
      const a = mover.waypoints[mover.state.currentIndex];
      const b = mover.waypoints[mover.state.nextIndex];
      const pos = interpolatePosition(a, b, mover.state.t);
      mover.frameDelta = { x: pos.x - mover.prevPos.x, y: pos.y - mover.prevPos.y };
      mover.prevPos = pos;
      place(mover, pos, false);
    }
  }

  return {
    behaviors: ["mover"],
    spawn,
    despawn,
    clear() {
      for (const id of [...movers.keys()]) despawn(id);
    },
    reset() {
      for (const mover of movers.values()) {
        mover.state = initialState();
        mover.prevPos = { ...mover.waypoints[0] };
        mover.frameDelta = { x: 0, y: 0 };
        place(mover, mover.waypoints[0], true);
      }
    },
    size: () => movers.size,
    tick,
    frameDelta(id) {
      const mover = movers.get(id);
      return mover ? { ...mover.frameDelta } : null;
    },
    position(id) {
      const mover = movers.get(id);
      if (!mover) return null;
      const t = mover.body.translation();
      return { x: t.x, y: t.y };
    },
  };
}

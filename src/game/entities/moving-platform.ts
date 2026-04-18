import { Graphics, type Container } from "pixi.js";

import { GROUND_COLLISION_GROUP } from "../collisions";
import { getRapier } from "../physics";
import type { PhysicsWorld } from "../physics";
import { registerSurface, type SurfaceType } from "../surfaces";
import type { Vec2 } from "../types";

// ─── Types ──────────────────────────────────────────────

export type WaypointMode = "ping_pong" | "loop";

export type MovingPlatformConfig = {
  /** Waypoints the platform travels between (world coordinates) */
  waypoints: Vec2[];
  /** Travel speed in game units/sec */
  speed: number;
  /** Pause at each waypoint in ms (0 = no pause) */
  pauseMs: number;
  /** Platform width (full, not half) */
  width: number;
  /** Platform height (full, not half) */
  height: number;
  /** Ping-pong reverses at endpoints, loop teleports to start */
  mode: WaypointMode;
  /** Optional surface type (ice, chocolate, etc.) */
  surfaceType?: SurfaceType;
  /** Visual color override (defaults to surface color or white) */
  color?: number;
};

export type MovingPlatform = {
  update: (dtMs: number) => void;
  /** Get the position delta this platform moved THIS frame (for rider sync) */
  getFrameDelta: () => Vec2;
  /** Get the collider handle for rider detection */
  getColliderHandle: () => number;
  destroy: () => void;
};

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

// ─── Entity factory ────────────────────────────────────

const SURFACE_COLORS: Record<string, number> = {
  normal: 0xffa500,
  ice: 0x88ddff,
  chocolate: 0x8b4513,
  trampoline: 0xff00ff,
  cloud: 0xffffff,
};

export function createMovingPlatform(
  config: MovingPlatformConfig,
  physics: PhysicsWorld,
  worldContainer: Container,
): MovingPlatform {
  const RAPIER = getRapier();
  const { waypoints, speed, pauseMs, width, height, mode, surfaceType, color } = config;

  if (waypoints.length < 2) {
    throw new Error("Moving platform requires at least 2 waypoints");
  }

  // ─── Visual ──────────────────────────────────────
  const fillColor = color ?? SURFACE_COLORS[surfaceType ?? "normal"] ?? 0xffa500;
  const graphics = new Graphics();
  graphics.rect(-width / 2, -height / 2, width, height);
  graphics.fill({ color: fillColor, alpha: 0.8 });
  graphics.stroke({ width: 2, color: 0xffffff, alpha: 0.4 });
  worldContainer.addChild(graphics);

  // ─── Physics body (kinematic) ────────────────────
  const startPos = waypoints[0];
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    startPos.x,
    startPos.y,
  );
  const body = physics.addRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2)
    .setCollisionGroups(GROUND_COLLISION_GROUP)
    .setFriction(0.8);
  const collider = physics.addCollider(colliderDesc, body);

  // Register surface type if specified
  if (surfaceType) {
    registerSurface(collider.handle, surfaceType);
  }

  // ─── State ───────────────────────────────────────
  let waypointState: WaypointState = {
    currentIndex: 0,
    nextIndex: 1,
    t: 0,
    direction: 1,
    pauseRemainingMs: 0,
  };

  let prevPos: Vec2 = { x: startPos.x, y: startPos.y };
  let frameDelta: Vec2 = { x: 0, y: 0 };

  function update(dtMs: number): void {
    // Advance waypoint state
    waypointState = advanceWaypoint(waypointState, waypoints, speed, dtMs, pauseMs, mode);

    // Compute new position
    const a = waypoints[waypointState.currentIndex];
    const b = waypoints[waypointState.nextIndex];
    const newPos = interpolatePosition(a, b, waypointState.t);

    // Track frame delta for rider sync
    frameDelta = {
      x: newPos.x - prevPos.x,
      y: newPos.y - prevPos.y,
    };
    prevPos = { x: newPos.x, y: newPos.y };

    // Move kinematic body
    body.setNextKinematicTranslation(new RAPIER.Vector2(newPos.x, newPos.y));

    // Sync visual
    graphics.position.set(newPos.x, newPos.y);
  }

  function getFrameDelta(): Vec2 {
    return { ...frameDelta };
  }

  function getColliderHandle(): number {
    return collider.handle;
  }

  function destroy(): void {
    worldContainer.removeChild(graphics);
    graphics.destroy();
    physics.removeRigidBody(body);
  }

  // Initial visual sync
  graphics.position.set(startPos.x, startPos.y);

  return { update, getFrameDelta, getColliderHandle, destroy };
}

// ─── Moving platform system ─────────────────────────────

export type MovingPlatformSystem = {
  /** Add a new moving platform */
  add: (config: MovingPlatformConfig) => MovingPlatform;
  /** Update all platforms. Call before player.update(). */
  update: (dtMs: number) => void;
  /** Get frame delta for a specific collider handle (for rider sync). Returns null if not a moving platform. */
  getFrameDeltaForCollider: (handle: number) => Vec2 | null;
  destroy: () => void;
};

export function createMovingPlatformSystem(
  physics: PhysicsWorld,
  worldContainer: Container,
): MovingPlatformSystem {
  const platforms: MovingPlatform[] = [];
  const handleMap = new Map<number, MovingPlatform>();

  function add(config: MovingPlatformConfig): MovingPlatform {
    const platform = createMovingPlatform(config, physics, worldContainer);
    platforms.push(platform);
    handleMap.set(platform.getColliderHandle(), platform);
    return platform;
  }

  function update(dtMs: number): void {
    for (const platform of platforms) {
      platform.update(dtMs);
    }
  }

  function getFrameDeltaForCollider(handle: number): Vec2 | null {
    const platform = handleMap.get(handle);
    return platform ? platform.getFrameDelta() : null;
  }

  function destroy(): void {
    for (const platform of platforms) {
      platform.destroy();
    }
    platforms.length = 0;
    handleMap.clear();
  }

  return { add, update, getFrameDeltaForCollider, destroy };
}

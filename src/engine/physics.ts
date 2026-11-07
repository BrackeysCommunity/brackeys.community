import type {
  Collider,
  ColliderDesc,
  KinematicCharacterController,
  RigidBody,
  RigidBodyDesc,
  World,
} from "@dimforge/rapier2d";

import { DEFAULT_GRAVITY } from "./game/primitives";
import { signedArea } from "./scene/shape-geometry";
import type { ShapeObj } from "./scene/types";
import type { RapierModule, Vec2 } from "./types";

// ─── Physics World ──────────────────────────────────────

export type PhysicsWorld = {
  rapier: RapierModule;
  /** The raw Rapier world — escape hatch for advanced usage */
  world: World;
  /** Advance simulation by one fixed timestep */
  step: () => void;
  /** World gravity from the next step on, px/s²; y is down. */
  setGravity: (gravity: Vec2) => void;
  /** Make newly added colliders visible to scene queries without advancing time. */
  refreshQueries: () => void;
  addRigidBody: (desc: RigidBodyDesc) => RigidBody;
  /** Create a collider, optionally attached to a rigid body */
  addCollider: (desc: ColliderDesc, body?: RigidBody) => Collider;
  createCharacterController: (offset?: number) => KinematicCharacterController;
  /** Remove a rigid body (and its attached colliders) */
  removeRigidBody: (body: RigidBody) => void;
  removeCollider: (collider: Collider) => void;
  /** Get debug render data (line segments + colors) for wireframe overlay */
  debugRender: () => { vertices: Float32Array; colors: Float32Array };
  /** Tear down the world and free all resources */
  destroy: () => void;
};

export type PhysicsConfig = {
  gravity: Vec2;
  timestep: number;
};

/** Fixed simulation ticks per second; one physics step per tick. */
export const TICK_RATE = 60;

const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  gravity: { x: DEFAULT_GRAVITY[0], y: DEFAULT_GRAVITY[1] },
  timestep: 1 / TICK_RATE,
};

/** Create an empty Rapier world; scene systems add every body. */
export function createPhysicsWorld(
  rapier: RapierModule,
  config: Partial<PhysicsConfig> = {},
): PhysicsWorld {
  const cfg = { ...DEFAULT_PHYSICS_CONFIG, ...config };

  const world = new rapier.World(new rapier.Vector2(cfg.gravity.x, cfg.gravity.y));
  world.timestep = cfg.timestep;

  // Sensor overlaps are read back with world.intersectionPair rather than an
  // EventQueue, so stepping never calls back into JS.
  function step(): void {
    world.step();
  }

  function setGravity(gravity: Vec2): void {
    world.gravity = new rapier.Vector2(gravity.x, gravity.y);
  }

  function refreshQueries(): void {
    const dt = world.timestep;
    world.timestep = 0;
    world.step();
    world.timestep = dt;
  }

  function addRigidBody(desc: RigidBodyDesc): RigidBody {
    return world.createRigidBody(desc);
  }

  function addCollider(desc: ColliderDesc, body?: RigidBody): Collider {
    return world.createCollider(desc, body);
  }

  function createCharacterController(offset = 0.01): KinematicCharacterController {
    const controller = world.createCharacterController(offset);
    // Our coordinate system: +Y is down (screen space), so "up" is -Y
    controller.setUp(new rapier.Vector2(0, -1));
    // Slopes: climb up to 50°, slide on slopes > 30°
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((30 * Math.PI) / 180);
    // Auto-step: max 4 game units high, min 2 wide, include dynamic bodies
    controller.enableAutostep(4, 2, true);
    // Snap to ground when walking down slopes (up to 4 units)
    controller.enableSnapToGround(4);
    // Push dynamic bodies when walking into them
    controller.setApplyImpulsesToDynamicBodies(true);
    return controller;
  }

  function removeRigidBody(body: RigidBody): void {
    world.removeRigidBody(body);
  }

  function removeCollider(collider: Collider): void {
    world.removeCollider(collider, true);
  }

  function debugRender(): { vertices: Float32Array; colors: Float32Array } {
    const buffers = world.debugRender();
    return { vertices: buffers.vertices, colors: buffers.colors };
  }

  function destroy(): void {
    try {
      world.free();
    } catch {
      // WASM pointer may already be freed — safe to ignore
    }
  }

  return {
    rapier,
    world,
    step,
    setGravity,
    refreshQueries,
    addRigidBody,
    addCollider,
    createCharacterController,
    removeRigidBody,
    removeCollider,
    debugRender,
    destroy,
  };
}

// ─── Shapes → colliders ─────────────────────────────────

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Where a body carrying `shape` sits: the centre of a box, circle or capsule,
 * the origin for poly and chain (whose points are absolute).
 */
export function shapePose(shape: ShapeObj): { x: number; y: number; rotation: number } {
  switch (shape.type) {
    case "box":
    case "capsule":
      return { x: shape.cx, y: shape.cy, rotation: degToRad(shape.rotDeg) };
    case "circle":
      return { x: shape.cx, y: shape.cy, rotation: 0 };
    case "poly":
    case "chain":
      return { x: 0, y: 0, rotation: 0 };
  }
}

/**
 * Collider descriptor for `shape`. With `local` false the collider is centred
 * on a body placed at `shapePose(shape)`; with `local` true the shape's own
 * offset and rotation are applied relative to the body (path followers).
 */
export function shapeColliderDesc(
  rapier: RapierModule,
  shape: ShapeObj,
  local = false,
): ColliderDesc {
  const { ColliderDesc } = rapier;
  let desc: ColliderDesc | null;
  switch (shape.type) {
    case "box":
      desc = ColliderDesc.cuboid(shape.hw, shape.hh);
      break;
    case "circle":
      desc = ColliderDesc.ball(shape.r);
      break;
    case "capsule":
      desc = ColliderDesc.capsule(shape.halfLen, shape.r);
      break;
    case "poly": {
      // Rapier wants counter-clockwise points; the document allows either winding.
      const pts = signedArea(shape.pts) < 0 ? [...shape.pts].reverse() : shape.pts;
      const flat = new Float32Array(pts.flat());
      desc = ColliderDesc.convexPolyline(flat) ?? ColliderDesc.convexHull(flat);
      if (!desc) throw new Error("poly shape is not a valid convex polygon");
      break;
    }
    case "chain":
      desc = ColliderDesc.polyline(new Float32Array(shape.pts.flat()));
      break;
  }
  if (local && shape.type !== "poly" && shape.type !== "chain") {
    const pose = shapePose(shape);
    desc.setTranslation(pose.x, pose.y).setRotation(pose.rotation);
  }
  return desc;
}

/** A body descriptor posed for `shape` (see `shapePose`). */
export function posedBodyDesc(desc: RigidBodyDesc, shape: ShapeObj): RigidBodyDesc {
  const pose = shapePose(shape);
  return desc.setTranslation(pose.x, pose.y).setRotation(pose.rotation);
}

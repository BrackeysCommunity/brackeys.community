import type {
  Collider,
  ColliderDesc,
  KinematicCharacterController,
  RigidBody,
  RigidBodyDesc,
  World,
} from "@dimforge/rapier2d";

import { DEFAULT_GRAVITY, DEFAULT_TICK_RATE } from "./game/defaults";
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
  /** A character controller set up exactly as `opts` says; `SIDE_VIEW_CONTROLLER` and `TOP_DOWN_CONTROLLER` are presets. */
  createCharacterController: (opts: CharacterControllerOptions) => KinematicCharacterController;
  /** Remove a rigid body (and its attached colliders) */
  removeRigidBody: (body: RigidBody) => void;
  removeCollider: (collider: Collider) => void;
  /** Get debug render data (line segments + colors) for wireframe overlay */
  debugRender: () => { vertices: Float32Array; colors: Float32Array };
  /** Tear down the world and free all resources */
  destroy: () => void;
};

/** How a Rapier character controller moves; each null turns that behaviour off. */
export type CharacterControllerOptions = {
  /** The gap kept from what it touches; default 0.01. */
  offset?: number;
  /** Unit vector pointing up. */
  up: Vec2;
  /** null: no climbing limit. */
  maxSlopeClimbDeg: number | null;
  /** null: never slides. */
  minSlopeSlideDeg: number | null;
  autostep: { maxHeight: number; minWidth: number; dynamic: boolean } | null;
  snapToGround: number | null;
  pushDynamic: boolean;
};

export type PhysicsConfig = {
  gravity: Vec2;
  /** Seconds per step: one step per tick, so `1 / time.rate`. */
  timestep: number;
};

const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  gravity: { x: DEFAULT_GRAVITY[0], y: DEFAULT_GRAVITY[1] },
  timestep: 1 / DEFAULT_TICK_RATE,
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

  function createCharacterController(
    opts: CharacterControllerOptions,
  ): KinematicCharacterController {
    const controller = world.createCharacterController(opts.offset ?? 0.01);
    controller.setUp(new rapier.Vector2(opts.up.x, opts.up.y));
    // A right angle from `up` is any slope: no climbing limit, and nothing slides.
    controller.setMaxSlopeClimbAngle(
      opts.maxSlopeClimbDeg === null ? Math.PI / 2 : (opts.maxSlopeClimbDeg * Math.PI) / 180,
    );
    controller.setMinSlopeSlideAngle(
      opts.minSlopeSlideDeg === null ? Math.PI / 2 : (opts.minSlopeSlideDeg * Math.PI) / 180,
    );
    if (opts.autostep) {
      const { maxHeight, minWidth, dynamic } = opts.autostep;
      controller.enableAutostep(maxHeight, minWidth, dynamic);
    } else controller.disableAutostep();
    if (opts.snapToGround === null) controller.disableSnapToGround();
    else controller.enableSnapToGround(opts.snapToGround);
    controller.setApplyImpulsesToDynamicBodies(opts.pushDynamic);
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

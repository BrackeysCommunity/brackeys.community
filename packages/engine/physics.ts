import type {
  Collider,
  ColliderDesc,
  KinematicCharacterController,
  RigidBody,
  RigidBodyDesc,
  Vector,
  World,
} from "@dimforge/rapier2d";

import { DEFAULT_GRAVITY, DEFAULT_TICK_RATE } from "./game/defaults";
import { signedArea } from "./scene/shape-geometry";
import { createSpatialHash, type SpatialHash } from "./scene/spatial-hash";
import type { Aabb, Pt, ShapeObj } from "./scene/types";
import type { RapierModule, Vec2 } from "./types";

// ─── Physics World ──────────────────────────────────────

export type PhysicsWorld = {
  rapier: RapierModule;
  /** The raw Rapier world — escape hatch for advanced usage */
  world: World;
  /** Advance simulation by one fixed timestep */
  step: () => void;
  /** World gravity from the next step on, m/s²; y is down. */
  setGravity: (gravity: Vec2) => void;
  /**
   * Make colliders added or moved since the last step visible to queries and
   * character controllers without advancing time: Rapier's broad phase
   * updates and the engine's collider index is rebuilt, and every body keeps
   * the velocity it had. Call it after moving a fixed body outside the
   * engine's systems.
   */
  refreshQueries: () => void;
  /**
   * Colliders whose bounds may meet `box` (every collider for null), in no
   * set order: the broad phase the engine's space queries use. Colliders on
   * moving bodies are read as they stand; fixed ones as of their last add,
   * `moved`, step or `refreshQueries`.
   */
  collidersNear: (box: Aabb | null) => Collider[];
  /** Tell the collider index that a fixed body or collider was moved or resized by code. */
  moved: (target: RigidBody | Collider) => void;
  addRigidBody: (desc: RigidBodyDesc) => RigidBody;
  /** Create a collider, optionally attached to a rigid body */
  addCollider: (desc: ColliderDesc, body?: RigidBody) => Collider;
  /** A character controller set up exactly as `opts` says; `SIDE_VIEW_CONTROLLER` and `TOP_DOWN_CONTROLLER` are presets. */
  createCharacterController: (opts: CharacterControllerOptions) => KinematicCharacterController;
  /**
   * Whether `controller`'s last `computeColliderMovement` ended on the ground.
   * Rapier's `computedGrounded()` alone also counts ground within its
   * prediction distance (about 5 cm at the metre unit) before contact; this
   * also asks for a collision whose normal faces the controller's `up`.
   */
  isGrounded: (controller: KinematicCharacterController) => boolean;
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
  /** The gap kept from what it touches, m; default 0.0001. */
  offset?: number;
  /** Unit vector pointing up. */
  up: Pt;
  /** null: no climbing limit. */
  maxSlopeClimbDeg: number | null;
  /** null: never slides. */
  minSlopeSlideDeg: number | null;
  /** Step height and width, m. */
  autostep: { maxHeight: number; minWidth: number; dynamic: boolean } | null;
  /** How far down it snaps to the ground, m. */
  snapToGround: number | null;
  pushDynamic: boolean;
};

export type PhysicsConfig = {
  gravity: Vec2;
  /** Seconds per step: one step per tick, so `1 / time.rate`. */
  timestep: number;
};

/** A controller's gap from what it touches when its options set none, m. */
const DEFAULT_CONTROLLER_OFFSET = 0.0001;

const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  gravity: { x: DEFAULT_GRAVITY[0], y: DEFAULT_GRAVITY[1] },
  timestep: 1 / DEFAULT_TICK_RATE,
};

/**
 * Create an empty Rapier world; scene systems add every body. The world
 * holds metres at Rapier's default length unit, so its tolerances fit
 * whatever px per metre the game draws at.
 */
export function createPhysicsWorld(
  rapier: RapierModule,
  config: Partial<PhysicsConfig> = {},
): PhysicsWorld {
  const cfg = { ...DEFAULT_PHYSICS_CONFIG, ...config };

  const world = new rapier.World(new rapier.Vector2(cfg.gravity.x, cfg.gravity.y));
  world.timestep = cfg.timestep;

  const index = createColliderIndex(world, rapier);

  // Sensor overlaps are read back with world.intersectionPair rather than an
  // EventQueue, so stepping never calls back into JS.
  function step(): void {
    world.step();
    index.stepped();
  }

  function setGravity(gravity: Vec2): void {
    world.gravity = new rapier.Vector2(gravity.x, gravity.y);
  }

  // Rapier 0.19 updates its broad phase only inside a step and exposes no
  // other way to update it, so this steps by zero. A zero step still runs the
  // solver, which throws jointed bodies' velocities off (a chain's links reach
  // about 1000 m/s): each dynamic body gets its own back. It also moves a
  // kinematic body to its pending target, which would leave the next real step
  // with nothing to move and the body with no velocity: each such body goes
  // back to its pose with the target still pending. Its colliders stay where
  // the target puts them until that step, as queries saw them before. A
  // restored rotation round-trips through an angle, so it may differ in the
  // last bit.
  function refreshQueries(): void {
    const kept: { body: RigidBody; v: Vector; w: number }[] = [];
    const pending: { body: RigidBody; t: Vector; r: number; nt: Vector; nr: number }[] = [];
    world.bodies.forEach((body) => {
      if (body.isDynamic()) kept.push({ body, v: body.linvel(), w: body.angvel() });
      else if (body.bodyType() === rapier.RigidBodyType.KinematicPositionBased) {
        const t = body.translation();
        const nt = body.nextTranslation();
        const r = body.rotation();
        const nr = body.nextRotation();
        if (t.x !== nt.x || t.y !== nt.y || r !== nr) pending.push({ body, t, r, nt, nr });
      }
    });
    const dt = world.timestep;
    world.timestep = 0;
    world.step();
    world.timestep = dt;
    for (const { body, v, w } of kept) {
      const now = body.linvel();
      if (now.x !== v.x || now.y !== v.y) body.setLinvel(v, false);
      if (body.angvel() !== w) body.setAngvel(w, false);
    }
    for (const { body, t, r, nt, nr } of pending) {
      const turned = body.rotation() !== r;
      body.setTranslation(t, false);
      if (turned) body.setRotation(r, false);
      body.setNextKinematicTranslation(nt);
      if (turned) body.setNextKinematicRotation(nr);
    }
    index.rebuild();
  }

  function addRigidBody(desc: RigidBodyDesc): RigidBody {
    return world.createRigidBody(desc);
  }

  function addCollider(desc: ColliderDesc, body?: RigidBody): Collider {
    const collider = world.createCollider(desc, body);
    index.place(collider);
    return collider;
  }

  function createCharacterController(
    opts: CharacterControllerOptions,
  ): KinematicCharacterController {
    const controller = world.createCharacterController(opts.offset ?? DEFAULT_CONTROLLER_OFFSET);
    controller.setUp(new rapier.Vector2(opts.up[0], opts.up[1]));
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

  function isGrounded(controller: KinematicCharacterController): boolean {
    if (!controller.computedGrounded()) return false;
    const up = controller.up();
    const count = controller.numComputedCollisions();
    for (let i = 0; i < count; i++) {
      const normal = controller.computedCollision(i)?.normal1;
      if (normal && normal.x * up.x + normal.y * up.y > 0) return true;
    }
    return false;
  }

  function removeRigidBody(body: RigidBody): void {
    for (let i = 0; i < body.numColliders(); i++) index.forget(body.collider(i).handle);
    world.removeRigidBody(body);
  }

  function removeCollider(collider: Collider): void {
    index.forget(collider.handle);
    world.removeCollider(collider, true);
  }

  function moved(target: RigidBody | Collider): void {
    if ("numColliders" in target) {
      for (let i = 0; i < target.numColliders(); i++) index.moved(target.collider(i).handle);
    } else index.moved(target.handle);
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
    collidersNear: (box) => index.near(box),
    moved,
    addRigidBody,
    addCollider,
    createCharacterController,
    isGrounded,
    removeRigidBody,
    removeCollider,
    debugRender,
    destroy,
  };
}

// ─── Collider index ─────────────────────────────────────

/**
 * A Rapier collider's world bounds, or null for a shape kind with no cheap
 * box. Read from the collider each time: Rapier's in-place size setters
 * change it without replacing `Collider.shape`.
 */
export function rapierColliderBounds(
  c: Collider,
  ShapeType: RapierModule["ShapeType"],
): Aabb | null {
  const { x, y } = c.translation();
  const rot = c.rotation();
  const cos = Math.abs(Math.cos(rot));
  const sin = Math.abs(Math.sin(rot));
  const around = (ex: number, ey: number): Aabb => ({
    minX: x - ex,
    minY: y - ey,
    maxX: x + ex,
    maxY: y + ey,
  });
  switch (c.shapeType()) {
    case ShapeType.Ball:
      return around(c.radius(), c.radius());
    case ShapeType.Cuboid:
    case ShapeType.RoundCuboid: {
      const { x: hw, y: hh } = c.halfExtents();
      const r = c.shapeType() === ShapeType.RoundCuboid ? c.roundRadius() : 0;
      return around(cos * hw + sin * hh + r, sin * hw + cos * hh + r);
    }
    case ShapeType.Capsule: {
      const h = c.halfHeight();
      const r = c.radius();
      return around(sin * h + r, cos * h + r);
    }
    case ShapeType.ConvexPolygon:
    case ShapeType.RoundConvexPolygon:
    case ShapeType.Polyline:
    case ShapeType.TriMesh: {
      const v = c.vertices();
      if (v.length < 2) return null;
      const r = c.shapeType() === ShapeType.RoundConvexPolygon ? c.roundRadius() : 0;
      const ca = Math.cos(rot);
      const sa = Math.sin(rot);
      const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (let i = 0; i + 1 < v.length; i += 2) {
        const lx = v[i]!;
        const ly = v[i + 1]!;
        const wx = x + lx * ca - ly * sa;
        const wy = y + lx * sa + ly * ca;
        box.minX = Math.min(box.minX, wx - r);
        box.minY = Math.min(box.minY, wy - r);
        box.maxX = Math.max(box.maxX, wx + r);
        box.maxY = Math.max(box.maxY, wy + r);
      }
      return box;
    }
    default:
      return null;
  }
}

const apart = (a: Aabb, b: Aabb) =>
  a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY;

/** The collider index's cell side: the median fixed collider's longer side, within these, m. */
const MIN_INDEX_CELL = 0.5;
const MAX_INDEX_CELL = 64;

/**
 * Colliders by bounds, built at the first query after a load or a
 * `rebuild`, so loading pays nothing for it. Fixed colliders (no body, or a
 * fixed one) sit in a spatial hash whose cell fits their median size,
 * re-read when added, marked `moved`, and after a step that follows a
 * `moved`; colliders on bodies that move are read as they stand at each
 * query, so no system has to report them. A collider added or removed
 * straight through the Rapier world shows as a count that no longer
 * matches, and the index builds again.
 */
function createColliderIndex(world: World, rapier: RapierModule) {
  let settled: SpatialHash<number> | null = null;
  const moving = new Set<number>();
  /** Shapes with no cheap bounds: every query looks at them. */
  const loose = new Set<number>();
  /** Fixed colliders moved by code: re-read at each query until a step has carried the move. */
  const stale = new Set<number>();
  const bounds = (c: Collider) => rapierColliderBounds(c, rapier.ShapeType);
  const fixed = (c: Collider) => {
    const parent = c.parent();
    return !parent || parent.isFixed();
  };

  function forget(handle: number): void {
    settled?.remove(handle);
    moving.delete(handle);
    loose.delete(handle);
    stale.delete(handle);
  }

  function place(c: Collider): void {
    if (!settled) return;
    if (!fixed(c)) {
      settled.remove(c.handle);
      loose.delete(c.handle);
      moving.add(c.handle);
      return;
    }
    moving.delete(c.handle);
    const box = bounds(c);
    if (box) {
      loose.delete(c.handle);
      settled.update(c.handle, box);
    } else {
      settled.remove(c.handle);
      loose.add(c.handle);
    }
  }

  function rebuild(): void {
    settled = null;
    moving.clear();
    loose.clear();
    stale.clear();
  }

  function build(): SpatialHash<number> {
    moving.clear();
    loose.clear();
    const boxes: [number, Aabb][] = [];
    world.colliders.forEach((c) => {
      if (!fixed(c)) moving.add(c.handle);
      else {
        const box = bounds(c);
        if (box) boxes.push([c.handle, box]);
        else loose.add(c.handle);
      }
    });
    const sides = boxes
      .map(([, b]) => Math.max(b.maxX - b.minX, b.maxY - b.minY))
      .sort((a, b) => a - b);
    const median = sides[sides.length >> 1] ?? MIN_INDEX_CELL;
    const hash = createSpatialHash<number>(
      Math.min(MAX_INDEX_CELL, Math.max(MIN_INDEX_CELL, median)),
    );
    for (const [handle, box] of boxes) hash.insert(handle, box);
    settled = hash;
    return hash;
  }

  function restale(): void {
    for (const handle of stale) {
      const c = world.getCollider(handle);
      if (c) place(c);
      else forget(handle);
    }
  }

  return {
    place,
    forget,
    rebuild,
    moved(handle: number): void {
      stale.add(handle);
    },
    stepped(): void {
      restale();
      stale.clear();
    },
    near(box: Aabb | null): Collider[] {
      const out: Collider[] = [];
      if (!box) {
        world.colliders.forEach((c) => out.push(c));
        return out;
      }
      let hash = settled;
      if (!hash || hash.size + moving.size + loose.size !== world.colliders.len()) hash = build();
      else restale();
      const take = (handle: number) => {
        const c = world.getCollider(handle);
        if (c) out.push(c);
      };
      for (const handle of hash.query(box)) take(handle);
      for (const handle of loose) take(handle);
      for (const handle of moving) {
        const c = world.getCollider(handle);
        if (!c) continue;
        const b = bounds(c);
        if (!b || !apart(b, box)) out.push(c);
      }
      return out;
    },
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

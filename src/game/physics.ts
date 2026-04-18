import type RAPIER from "@dimforge/rapier2d";

import {
  GROUND_COLLISION_GROUP,
  CLOUD_COLLISION_GROUP,
  SHAMAN_OBJ_COLLISION_GROUP,
  createEventQueue,
  drainCollisionEvents,
  clearSensors,
  createSensorCollider,
  type CollisionEvent,
} from "./collisions";
import {
  clearSurfaces,
  clearCloudPlatforms,
  registerSurface,
  registerCloudPlatform,
  SURFACE_MATERIALS,
} from "./surfaces";

// ─── Rapier WASM singleton ──────────────────────────────

let rapier: typeof RAPIER | null = null;

/**
 * Load and initialize the Rapier WASM module.
 * Call once before createPhysicsWorld(). Safe to call multiple times
 * (returns cached module after first init).
 */
export async function initRapier(): Promise<typeof RAPIER> {
  if (rapier) return rapier;
  rapier = await import("@dimforge/rapier2d");
  return rapier;
}

/** Get the cached Rapier module (throws if initRapier() hasn't been called) */
export function getRapier(): typeof RAPIER {
  if (!rapier) throw new Error("Rapier not initialized — call initRapier() first");
  return rapier;
}

// ─── Physics World ──────────────────────────────────────

export type PhysicsWorld = {
  /** The raw Rapier world — escape hatch for advanced usage */
  world: RAPIER.World;
  /** Advance simulation by one fixed timestep, collecting collision events */
  step: () => void;
  /** Drain collision events from the last step. Call after step(). */
  drainEvents: () => CollisionEvent[];
  /** Create a rigid body from a descriptor */
  addRigidBody: (desc: RAPIER.RigidBodyDesc) => RAPIER.RigidBody;
  /** Create a collider, optionally attached to a rigid body */
  addCollider: (desc: RAPIER.ColliderDesc, body?: RAPIER.RigidBody) => RAPIER.Collider;
  /** Create a KinematicCharacterController for player movement */
  createCharacterController: (offset?: number) => RAPIER.KinematicCharacterController;
  /** Remove a rigid body (and its attached colliders) */
  removeRigidBody: (body: RAPIER.RigidBody) => void;
  /** Remove a standalone collider */
  removeCollider: (collider: RAPIER.Collider) => void;
  /** Get debug render data (line segments + colors) for wireframe overlay */
  debugRender: () => { vertices: Float32Array; colors: Float32Array };
  /** Tear down the world and free all resources */
  destroy: () => void;
};

export type PhysicsConfig = {
  gravity: { x: number; y: number };
  timestep: number;
};

const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  gravity: { x: 0, y: 1200 }, // matches player.ts GRAVITY constant (game units/sec²)
  timestep: 1 / 60, // matches game loop tick rate
};

/**
 * Create a Rapier physics world with a ground collider.
 * initRapier() MUST be called before this.
 */
export function createPhysicsWorld(config: Partial<PhysicsConfig> = {}): PhysicsWorld {
  const RAPIER = getRapier();
  const cfg = { ...DEFAULT_PHYSICS_CONFIG, ...config };

  const gravity = new RAPIER.Vector2(cfg.gravity.x, cfg.gravity.y);
  const world = new RAPIER.World(gravity);
  world.timestep = cfg.timestep;

  // ─── Event queue for collision events ────────────────
  const eventQueue = createEventQueue();

  // Cloud platform one-way pass-through is handled in the player entity's
  // computeColliderMovement filterPredicate, not via PhysicsHooks (which
  // don't apply to kinematic character controllers).

  // ─── Ground colliders (static floor with pit gap) ────
  // Floor at y=1020 (top edge), split into two segments with a gap at x=1490–1710.
  // Left segment: x=-2000 to x=1490 → center at x=-255, half-width=1745
  const groundLeftDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(-255, 1040);
  const groundLeftBody = world.createRigidBody(groundLeftDesc);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(1745, 20).setCollisionGroups(GROUND_COLLISION_GROUP),
    groundLeftBody,
  );
  // Right segment: x=1710 to x=4000 → center at x=2855, half-width=1145
  const groundRightDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(2855, 1040);
  const groundRightBody = world.createRigidBody(groundRightDesc);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(1145, 20).setCollisionGroups(GROUND_COLLISION_GROUP),
    groundRightBody,
  );

  // ─── Test scene geometry ─────────────────────────────
  // Player spawns at x=960, floor at y=1020.
  // All static bodies use GROUND_COLLISION_GROUP.
  const addStaticBox = (x: number, y: number, hw: number, hh: number) => {
    const bd = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y);
    const rb = world.createRigidBody(bd);
    const cd = RAPIER.ColliderDesc.cuboid(hw, hh).setCollisionGroups(GROUND_COLLISION_GROUP);
    world.createCollider(cd, rb);
  };

  // -- Wall-jump corridor (two tall walls with a gap) --
  // Left wall at x=1200, right wall at x=1400, both 500 tall
  addStaticBox(1200, 770, 10, 250); // left wall
  addStaticBox(1400, 770, 10, 250); // right wall

  // -- Floating platforms at various heights --
  // Low platform (small hop from ground)
  addStaticBox(700, 940, 80, 8);
  // Mid platform (reachable from low platform)
  addStaticBox(500, 840, 80, 8);
  // High platform (needs wall-jump or chain from mid)
  addStaticBox(350, 720, 80, 8);
  // (removed ceiling platform — open space for elevator testing)

  // -- Staircase to the left of spawn --
  addStaticBox(820, 970, 40, 8);
  addStaticBox(740, 920, 40, 8);
  addStaticBox(660, 870, 40, 8);

  // -- Pit (below ground level, gap at x=1490–1710) --
  // Pit floor (deeper)
  addStaticBox(1600, 1160, 120, 10);
  // Pit left wall
  addStaticBox(1490, 1100, 10, 80);
  // Pit right wall
  addStaticBox(1710, 1100, 10, 80);

  // -- Small wall to the left (short wall-slide) --
  addStaticBox(200, 920, 10, 100);

  // ─── Shaman objects (dynamic, different collision group) ─
  // These collide with player + ground + each other but NOT sensors.
  const addDynamicBox = (x: number, y: number, hw: number, hh: number) => {
    const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y);
    const rb = world.createRigidBody(bd);
    const cd = RAPIER.ColliderDesc.cuboid(hw, hh)
      .setCollisionGroups(SHAMAN_OBJ_COLLISION_GROUP)
      .setRestitution(0.2)
      .setDensity(2.0);
    world.createCollider(cd, rb);
  };

  // Plank sitting on the high platform
  addDynamicBox(350, 700, 50, 6);
  // Ball near the staircase
  const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(780, 900));
  world.createCollider(
    RAPIER.ColliderDesc.ball(15)
      .setCollisionGroups(SHAMAN_OBJ_COLLISION_GROUP)
      .setRestitution(0.6)
      .setDensity(1.5),
    ballBody,
  );

  // ─── Sensors (cheese, hole, lava) ───────────────────
  // Cheese sensor — floating above the mid platform
  const cheeseBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(500, 800));
  createSensorCollider(world, cheeseBody, RAPIER.ColliderDesc.ball(12), "cheese");

  // Hole sensor — at the right end of the ground
  const holeBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(1850, 1010));
  createSensorCollider(world, holeBody, RAPIER.ColliderDesc.ball(20), "hole");

  // Lava sensor — at the bottom of the pit
  const lavaBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(1600, 1160));
  createSensorCollider(world, lavaBody, RAPIER.ColliderDesc.cuboid(100, 8), "lava");

  // ─── Surface-typed platforms ─────────────────────────
  const addSurfacePlatform = (
    x: number,
    y: number,
    hw: number,
    hh: number,
    surfaceType: keyof typeof SURFACE_MATERIALS,
  ) => {
    const mat = SURFACE_MATERIALS[surfaceType];
    const bd = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y);
    const rb = world.createRigidBody(bd);
    const group = surfaceType === "cloud" ? CLOUD_COLLISION_GROUP : GROUND_COLLISION_GROUP;
    const cd = RAPIER.ColliderDesc.cuboid(hw, hh)
      .setCollisionGroups(group)
      .setFriction(mat.friction)
      .setRestitution(mat.restitution);
    const collider = world.createCollider(cd, rb);
    registerSurface(collider.handle, surfaceType);
    if (surfaceType === "cloud") {
      registerCloudPlatform(collider.handle);
    }
  };

  // Ice platform — to the left, slide across it
  addSurfacePlatform(100, 1000, 100, 8, "ice");

  // Chocolate platform — slow movement, right of staircase
  addSurfacePlatform(550, 970, 60, 8, "chocolate");

  // Trampoline — at bottom of pit, bounces player out
  addSurfacePlatform(1600, 1120, 40, 8, "trampoline");

  // Cloud platform — above spawn, can jump through from below
  addSurfacePlatform(960, 900, 60, 6, "cloud");
  // Second cloud higher up
  addSurfacePlatform(960, 780, 60, 6, "cloud");
  // Third cloud — over by the staircase area
  addSurfacePlatform(680, 850, 50, 6, "cloud");

  // ─── API ─────────────────────────────────────────────

  function step(): void {
    world.step(eventQueue);
  }

  function drainEvents(): CollisionEvent[] {
    return drainCollisionEvents(eventQueue);
  }

  function addRigidBody(desc: RAPIER.RigidBodyDesc): RAPIER.RigidBody {
    return world.createRigidBody(desc);
  }

  function addCollider(desc: RAPIER.ColliderDesc, body?: RAPIER.RigidBody): RAPIER.Collider {
    return world.createCollider(desc, body);
  }

  function createCharacterController(offset = 0.01): RAPIER.KinematicCharacterController {
    const controller = world.createCharacterController(offset);
    // Our coordinate system: +Y is down (screen space), so "up" is -Y
    controller.setUp(new RAPIER.Vector2(0, -1));
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

  function removeRigidBody(body: RAPIER.RigidBody): void {
    world.removeRigidBody(body);
  }

  function removeCollider(collider: RAPIER.Collider): void {
    world.removeCollider(collider, true);
  }

  function debugRender(): { vertices: Float32Array; colors: Float32Array } {
    const buffers = world.debugRender();
    return { vertices: buffers.vertices, colors: buffers.colors };
  }

  function destroy(): void {
    clearSensors();
    clearSurfaces();
    clearCloudPlatforms();
    try {
      eventQueue.free();
    } catch {
      // WASM pointer cleanup — safe to ignore
    }
    try {
      world.free();
    } catch {
      // WASM pointer may already be freed — safe to ignore
    }
  }

  return {
    world,
    step,
    drainEvents,
    addRigidBody,
    addCollider,
    createCharacterController,
    removeRigidBody,
    removeCollider,
    debugRender,
    destroy,
  };
}

/**
 * Shaper construct factory — creates the physics bodies and visuals
 * for all objects the Shaper can place into the level.
 *
 * Each construct type has:
 *   - A Rapier rigid body (fixed or dynamic)
 *   - A collider with appropriate shape, mass, friction, restitution
 *   - A PixiJS Graphics placeholder visual
 *   - A collision group (SHAMAN_OBJ for physical, SENSOR for effect-only)
 *
 * The player entity detects interactions via collision normals and sensor events.
 */

import { Graphics, type Container } from "pixi.js";

import { SHAMAN_OBJ_COLLISION_GROUP } from "../collisions";
import { createSensorCollider } from "../collisions";
import { getRapier } from "../physics";
import type { PhysicsWorld } from "../physics";
import type { Vec2 } from "../types";

// ─── Construct type definitions ──────────────────────────

export type ConstructType =
  | "bridge"
  | "bounce_pad"
  | "wind_zone"
  | "grapple_anchor"
  | "light_orb"
  | "shield_barrier";

export type ConstructConfig = {
  label: string;
  /** Hotkey number (1-6) for toolbar selection */
  hotkey: number;
  /** Max instances per round */
  maxPerRound: number;
  /** Whether this creates a physics body (vs sensor/visual-only) */
  isPhysical: boolean;
  /** Whether placement can be rotated */
  rotatable: boolean;
  /** Visual color (placeholder rendering) */
  color: number;
  /** Half-width of collider */
  hw: number;
  /** Half-height of collider */
  hh: number;
};

export const CONSTRUCT_CONFIGS: Record<ConstructType, ConstructConfig> = {
  bridge: {
    label: "Bridge",
    hotkey: 1,
    maxPerRound: 12,
    isPhysical: true,
    rotatable: true,
    color: 0xdeb887, // burlywood
    hw: 60,
    hh: 6,
  },
  bounce_pad: {
    label: "Bounce Pad",
    hotkey: 2,
    maxPerRound: 4,
    isPhysical: true,
    rotatable: false,
    color: 0xff1493, // deep pink
    hw: 40,
    hh: 5,
  },
  wind_zone: {
    label: "Wind Zone",
    hotkey: 3,
    maxPerRound: 4,
    isPhysical: false, // sensor — applies force, no collision
    rotatable: true,
    color: 0x87ceeb, // sky blue
    hw: 50,
    hh: 80,
  },
  grapple_anchor: {
    label: "Grapple Anchor",
    hotkey: 4,
    maxPerRound: 6,
    isPhysical: false, // no physics body — managed by GrappleAnchorSystem
    rotatable: false,
    color: 0x00ffff, // cyan
    hw: 8,
    hh: 8,
  },
  light_orb: {
    label: "Light Orb",
    hotkey: 5,
    maxPerRound: 5,
    isPhysical: false, // visual only
    rotatable: false,
    color: 0xffd700, // gold
    hw: 12,
    hh: 12,
  },
  shield_barrier: {
    label: "Shield Barrier",
    hotkey: 6,
    maxPerRound: 3,
    isPhysical: true,
    rotatable: true,
    color: 0x9370db, // medium purple
    hw: 8,
    hh: 50,
  },
};

// ─── Construct entity ────────────────────────────────────

export type ShaperConstruct = {
  type: ConstructType;
  position: Vec2;
  rotation: number;
  destroy: () => void;
};

// ─── Wind zone registry ──────────────────────────────────
// Player queries this each frame to check if they're inside a wind zone.

export type WindZoneEntry = {
  position: Vec2;
  hw: number;
  hh: number;
  rotation: number;
  /** Wind direction in game units/sec² (force applied to player) */
  force: Vec2;
};

const activeWindZones: WindZoneEntry[] = [];

export function getActiveWindZones(): readonly WindZoneEntry[] {
  return activeWindZones;
}

export function clearWindZones(): void {
  activeWindZones.length = 0;
}

// ─── Bounce pad registry ─────────────────────────────────

export type BouncePadEntry = {
  colliderHandle: number;
  bounceVelocity: number;
};

const activeBouncePads = new Map<number, BouncePadEntry>();

export function getBouncePad(handle: number): BouncePadEntry | undefined {
  return activeBouncePads.get(handle);
}

export function clearBouncePads(): void {
  activeBouncePads.clear();
}

// ─── Factory ─────────────────────────────────────────────

const BOUNCE_PAD_VELOCITY = -650; // upward launch velocity
const WIND_FORCE_STRENGTH = 800; // game units/sec² applied to player

export function createShaperConstruct(
  type: ConstructType,
  position: Vec2,
  rotation: number,
  worldContainer: Container,
  physics: PhysicsWorld,
): ShaperConstruct {
  const config = CONSTRUCT_CONFIGS[type];
  const RAPIER = getRapier();

  // ─── Visual (placeholder) ────────────────────────
  const gfx = new Graphics();

  if (type === "grapple_anchor" || type === "light_orb") {
    // Circle
    gfx.circle(0, 0, config.hw);
    gfx.fill({ color: config.color, alpha: type === "light_orb" ? 0.4 : 0.8 });
    gfx.stroke({ width: 2, color: config.color, alpha: 1.0 });
  } else if (type === "wind_zone") {
    // Semi-transparent rectangle with directional arrows
    gfx.rect(-config.hw, -config.hh, config.hw * 2, config.hh * 2);
    gfx.fill({ color: config.color, alpha: 0.15 });
    gfx.stroke({ width: 1, color: config.color, alpha: 0.5 });
    // Arrow indicators (upward by default, rotation changes direction)
    for (let i = -1; i <= 1; i++) {
      const ax = i * config.hw * 0.5;
      gfx.moveTo(ax, config.hh * 0.3);
      gfx.lineTo(ax, -config.hh * 0.3);
      gfx.lineTo(ax - 5, -config.hh * 0.15);
      gfx.moveTo(ax, -config.hh * 0.3);
      gfx.lineTo(ax + 5, -config.hh * 0.15);
      gfx.stroke({ width: 1, color: config.color, alpha: 0.6 });
    }
  } else {
    // Rectangle (bridge, bounce pad, shield barrier)
    gfx.rect(-config.hw, -config.hh, config.hw * 2, config.hh * 2);
    gfx.fill({ color: config.color, alpha: 0.7 });
    gfx.stroke({ width: 1, color: config.color, alpha: 1.0 });
  }

  gfx.position.set(position.x, position.y);
  gfx.rotation = rotation;
  worldContainer.addChild(gfx);

  // ─── Physics body + collider ─────────────────────
  let body: import("@dimforge/rapier2d").RigidBody | null = null;
  let collider: import("@dimforge/rapier2d").Collider | null = null;

  if (type === "bridge") {
    const bd = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y)
      .setRotation(rotation);
    body = physics.addRigidBody(bd);
    const cd = RAPIER.ColliderDesc.cuboid(config.hw, config.hh)
      .setCollisionGroups(SHAMAN_OBJ_COLLISION_GROUP)
      .setFriction(0.8);
    collider = physics.addCollider(cd, body);
  } else if (type === "bounce_pad") {
    const bd = RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y);
    body = physics.addRigidBody(bd);
    const cd = RAPIER.ColliderDesc.cuboid(config.hw, config.hh)
      .setCollisionGroups(SHAMAN_OBJ_COLLISION_GROUP)
      .setFriction(0.3)
      .setRestitution(1.2);
    collider = physics.addCollider(cd, body);
    // Register for player bounce detection
    activeBouncePads.set(collider.handle, {
      colliderHandle: collider.handle,
      bounceVelocity: BOUNCE_PAD_VELOCITY,
    });
  } else if (type === "wind_zone") {
    // Sensor — no physics collision, just area detection
    const bd = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y)
      .setRotation(rotation);
    body = physics.addRigidBody(bd);
    const cd = RAPIER.ColliderDesc.cuboid(config.hw, config.hh);
    collider = createSensorCollider(physics.world, body, cd, "wind_zone");
    // Register wind zone for player force application
    // Wind direction: "up" in local space, rotated by the placement angle
    const dirX = -Math.sin(rotation) * WIND_FORCE_STRENGTH;
    const dirY = -Math.cos(rotation) * WIND_FORCE_STRENGTH;
    activeWindZones.push({
      position: { ...position },
      hw: config.hw,
      hh: config.hh,
      rotation,
      force: { x: dirX, y: dirY },
    });
  } else if (type === "shield_barrier") {
    const bd = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y)
      .setRotation(rotation);
    body = physics.addRigidBody(bd);
    const cd = RAPIER.ColliderDesc.cuboid(config.hw, config.hh)
      .setCollisionGroups(SHAMAN_OBJ_COLLISION_GROUP)
      .setFriction(0.2);
    collider = physics.addCollider(cd, body);
  }
  // grapple_anchor and light_orb: no physics body (visual only, grapple managed separately)

  function destroy(): void {
    worldContainer.removeChild(gfx);
    gfx.destroy();
    if (collider) {
      if (type === "bounce_pad") {
        activeBouncePads.delete(collider.handle);
      }
      physics.removeCollider(collider);
    }
    if (body) {
      physics.removeRigidBody(body);
    }
    // Wind zones: remove from active list
    if (type === "wind_zone") {
      const idx = activeWindZones.findIndex(
        (wz) => wz.position.x === position.x && wz.position.y === position.y,
      );
      if (idx !== -1) activeWindZones.splice(idx, 1);
    }
  }

  return { type, position: { ...position }, rotation, destroy };
}

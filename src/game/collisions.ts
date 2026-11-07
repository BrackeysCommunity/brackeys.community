/**
 * Collision groups, filters and sensor helpers for Rapier physics.
 *
 * Rapier InteractionGroups are 32-bit values:
 *   - Upper 16 bits: membership (which groups this collider belongs to)
 *   - Lower 16 bits: filter (which groups this collider interacts with)
 *
 * Two colliders A and B interact iff:
 *   (A.membership & B.filter) !== 0 AND (B.membership & A.filter) !== 0
 */

import type { Collider, ColliderDesc, RigidBody, World } from "@dimforge/rapier2d";

import type { SensorKind } from "./scene/types";
import type { RapierModule } from "./types";

// ─── Group bits (membership) ─────────────────────────────
// Each group occupies one bit in the 16-bit membership/filter space.

export const GROUP_PLAYER = 0x0001; // Players (mice)
export const GROUP_GROUND = 0x0002; // Static ground, walls, map geometry
export const GROUP_SHAMAN_OBJ = 0x0004; // Shaman-placed objects (planks, balls, etc.)
export const GROUP_SENSOR = 0x0008; // Sensors (cheese, hole, lava) — no physics response
export const GROUP_CLOUD = 0x0010; // Cloud platforms — one-way pass-through

// ─── Interaction rules ───────────────────────────────────
// Defines what each group's filter mask allows.

/** Player collides with: ground + shaman objects + sensors + cloud (NOT other players).
 *  Sensors overlap without a physics response (they use setSensor(true)). */
const PLAYER_FILTER = GROUP_GROUND | GROUP_SHAMAN_OBJ | GROUP_SENSOR | GROUP_CLOUD;

/** Ground collides with: players + shaman objects */
const GROUND_FILTER = GROUP_PLAYER | GROUP_SHAMAN_OBJ;

/** Shaman objects collide with: players + ground + other shaman objects */
const SHAMAN_OBJ_FILTER = GROUP_PLAYER | GROUP_GROUND | GROUP_SHAMAN_OBJ;

/** Sensors intersect with: players only (no physics response) */
const SENSOR_FILTER = GROUP_PLAYER;

// ─── Packed InteractionGroups ────────────────────────────
// Format: (membership << 16) | filter

/** Pack membership and filter into a Rapier InteractionGroups value */
export function packGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** Player collision group — collides with ground and shaman objects */
export const PLAYER_COLLISION_GROUP = packGroups(GROUP_PLAYER, PLAYER_FILTER);

/** Ground collision group — collides with players and shaman objects */
export const GROUND_COLLISION_GROUP = packGroups(GROUP_GROUND, GROUND_FILTER);

/** Shaman object collision group — collides with everything except sensors */
export const SHAMAN_OBJ_COLLISION_GROUP = packGroups(GROUP_SHAMAN_OBJ, SHAMAN_OBJ_FILTER);

/** Sensor collision group — intersects with players only */
export const SENSOR_COLLISION_GROUP = packGroups(GROUP_SENSOR, SENSOR_FILTER);

/** Cloud platform collision group — collides with players and shaman objects. */
export const CLOUD_COLLISION_GROUP = packGroups(GROUP_CLOUD, GROUP_PLAYER | GROUP_SHAMAN_OBJ);

// ─── Sensors ─────────────────────────────────────────────

/** The step event each sensor kind raises when the player enters it. */
export const SENSOR_EVENTS: Record<SensorKind, string> = {
  goal: "cheese",
  exit: "hole",
  hazard: "lava",
};

/** Configure a collider descriptor as a player-only sensor and create it. */
export function createSensorCollider(
  rapier: RapierModule,
  world: World,
  body: RigidBody,
  desc: ColliderDesc,
): Collider {
  desc
    .setSensor(true)
    .setCollisionGroups(SENSOR_COLLISION_GROUP)
    // The player is kinematic and sensors are fixed, which Rapier skips by default
    .setActiveCollisionTypes(
      rapier.ActiveCollisionTypes.DEFAULT |
        rapier.ActiveCollisionTypes.KINEMATIC_FIXED |
        rapier.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
    );
  return world.createCollider(desc, body);
}

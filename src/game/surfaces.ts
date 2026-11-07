/**
 * Surface types and collision materials for Transformice-style ground segments.
 *
 * Each surface type defines Rapier collider properties (friction, restitution)
 * and gameplay modifiers that the player movement system reads each tick.
 */

import type { ColliderTag } from "./collider-tags";

// ─── Surface types ───────────────────────────────────────

export type SurfaceType = "normal" | "ice" | "trampoline" | "lava" | "chocolate" | "cloud";

export type SurfaceMaterial = {
  /** Rapier collider friction coefficient */
  friction: number;
  /** Rapier collider restitution (bounciness) */
  restitution: number;
  /** Multiplier on player ground deceleration (1 = normal, 0.05 = ice) */
  decelMultiplier: number;
  /** Multiplier on player move speed (1 = normal, 0.5 = chocolate) */
  speedMultiplier: number;
  /** If > 0, player bounces upward with this velocity on contact */
  bounceVelocity: number;
  /** If true, contact triggers player death */
  lethal: boolean;
  /** If true, platform is one-way (pass through from below) */
  oneWay: boolean;
};

export const SURFACE_MATERIALS: Record<SurfaceType, SurfaceMaterial> = {
  normal: {
    friction: 0.7,
    restitution: 0.0,
    decelMultiplier: 1.0,
    speedMultiplier: 1.0,
    bounceVelocity: 0,
    lethal: false,
    oneWay: false,
  },
  ice: {
    friction: 0.02,
    restitution: 0.0,
    decelMultiplier: 0.05, // almost no deceleration — player slides
    speedMultiplier: 1.0,
    bounceVelocity: 0,
    lethal: false,
    oneWay: false,
  },
  trampoline: {
    friction: 0.5,
    restitution: 1.2,
    decelMultiplier: 1.0,
    speedMultiplier: 1.0,
    bounceVelocity: -700, // strong upward bounce
    lethal: false,
    oneWay: false,
  },
  lava: {
    friction: 0.7,
    restitution: 0.0,
    decelMultiplier: 1.0,
    speedMultiplier: 1.0,
    bounceVelocity: 0,
    lethal: true,
    oneWay: false,
  },
  chocolate: {
    friction: 1.5,
    restitution: 0.0,
    decelMultiplier: 2.0, // decelerates faster
    speedMultiplier: 0.5, // half speed
    bounceVelocity: 0,
    lethal: false,
    oneWay: false,
  },
  cloud: {
    friction: 0.7,
    restitution: 0.0,
    decelMultiplier: 1.0,
    speedMultiplier: 1.0,
    bounceVelocity: 0,
    lethal: false,
    oneWay: true,
  },
};

// ─── Lookup by tag ───────────────────────────────────────

export function surfaceTypeOf(tag: ColliderTag | undefined): SurfaceType {
  if (!tag) return "normal";
  if (tag.material) return tag.material;
  if (tag.behavior === "cloud") return "cloud";
  if (tag.sensor === "hazard") return "lava";
  return "normal";
}

export function surfaceMaterialOf(tag: ColliderTag | undefined): SurfaceMaterial {
  return SURFACE_MATERIALS[surfaceTypeOf(tag)];
}

/**
 * Surface types and collision materials for Transformice-style ground segments.
 *
 * Each surface type defines Rapier collider properties (friction, restitution)
 * and gameplay modifiers that the player movement system reads each tick.
 */

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

// ─── Surface registry ────────────────────────────────────
// Maps collider handles → surface type so the player movement system
// can query what surface it's standing on.

const surfaceRegistry = new Map<number, SurfaceType>();

/** Register a collider handle as a particular surface type */
export function registerSurface(handle: number, surfaceType: SurfaceType): void {
  surfaceRegistry.set(handle, surfaceType);
}

/** Unregister a surface (e.g. when a ground segment is removed) */
export function unregisterSurface(handle: number): void {
  surfaceRegistry.delete(handle);
}

/** Look up the surface type for a collider handle. Returns "normal" if unregistered. */
export function getSurfaceType(handle: number): SurfaceType {
  return surfaceRegistry.get(handle) ?? "normal";
}

/** Get the full material properties for a collider handle */
export function getSurfaceMaterial(handle: number): SurfaceMaterial {
  return SURFACE_MATERIALS[getSurfaceType(handle)];
}

/** Clear all registered surfaces (e.g. on map change) */
export function clearSurfaces(): void {
  surfaceRegistry.clear();
}

// ─── Cloud platform set ──────────────────────────────────
// Separate set for fast lookup in the physics hooks filter.

const cloudPlatforms = new Set<number>();

export function registerCloudPlatform(handle: number): void {
  cloudPlatforms.add(handle);
}

export function unregisterCloudPlatform(handle: number): void {
  cloudPlatforms.delete(handle);
}

export function isCloudPlatform(handle: number): boolean {
  return cloudPlatforms.has(handle);
}

export function clearCloudPlatforms(): void {
  cloudPlatforms.clear();
}

/** Get all registered cloud platform collider handles */
export function getCloudPlatformHandles(): ReadonlySet<number> {
  return cloudPlatforms;
}

/**
 * How the ground and walls change the player's movement. Friction and
 * restitution live in `materials.ts`; these are the gameplay modifiers the
 * player reads each tick from the collider it touches.
 */

import type { ColliderTag, MaterialDef } from "@jams/engine/game";

import { PLATFORMER_MATERIALS, type PlatformerMaterial } from "./materials";

export type Surface = {
  /** Multiplier on ground deceleration (1 = normal, 0.05 = ice). */
  decelMultiplier: number;
  /** Multiplier on move speed (1 = normal, 0.5 = chocolate). */
  speedMultiplier: number;
  /** Vertical launch velocity when standing on it, m/s; 0 for none, negative is up. */
  bounceVelocity: number;
  /** Fallback fill for bodies drawn in this surface: the material's style, else orange. */
  color: number;
};

export type SurfaceName = "normal" | PlatformerMaterial;

type Modifiers = Pick<Surface, "decelMultiplier" | "speedMultiplier">;

const MODIFIERS: Record<SurfaceName, Modifiers> = {
  normal: { decelMultiplier: 1, speedMultiplier: 1 },
  ice: { decelMultiplier: 0.05, speedMultiplier: 1 },
  chocolate: { decelMultiplier: 2, speedMultiplier: 0.5 },
  trampoline: { decelMultiplier: 1, speedMultiplier: 1 },
};

const NORMAL_COLOR = 0xffa500;

function surface(name: SurfaceName): Surface {
  const material: MaterialDef | undefined =
    name === "normal" ? undefined : PLATFORMER_MATERIALS[name];
  return {
    ...MODIFIERS[name],
    bounceVelocity: material?.impulse?.y ?? 0,
    color: material?.style?.fill ?? NORMAL_COLOR,
  };
}

export const SURFACES = Object.fromEntries(
  (Object.keys(MODIFIERS) as SurfaceName[]).map((name) => [name, surface(name)]),
) as Record<SurfaceName, Surface>;

/** The surface of a material by name; no material, or one without modifiers, is `normal`. */
export function surfaceNamed(material: string | undefined): Surface {
  return material !== undefined && material in SURFACES
    ? SURFACES[material as SurfaceName]
    : SURFACES.normal;
}

/** The surface of the collider a tag describes. */
export function surfaceOf(tag: ColliderTag | undefined): Surface {
  return surfaceNamed(tag?.material);
}

import type { BasePrimitive, RegisteredType, SystemFactory } from "../game/types";
import { createPropSystem, createSensorSystem, createSolidSystem } from "../systems/bodies";
import { createCameraRegionSystem } from "../systems/camera-region";
import { createDecorSystem } from "../systems/decor";
import { createMarkerSystem } from "../systems/marker";
import { createNavSystem } from "../systems/nav";
import { createFollowerSystem } from "../systems/path-follower";

/** The engine's system factory for each primitive that loads. */
export const PRIMITIVE_SYSTEMS: Readonly<Record<BasePrimitive, SystemFactory>> = {
  solid: createSolidSystem,
  sensor: createSensorSystem,
  marker: createMarkerSystem,
  prop: createPropSystem,
  follower: createFollowerSystem,
  decor: createDecorSystem,
  nav: createNavSystem,
  "camera-region": createCameraRegionSystem,
};

/** The factory that spawns `type`: its own system, else its base primitive's (a primitive is its own base). */
export function systemFactoryOf(type: RegisteredType): SystemFactory {
  if (type.system) return type.system;
  const base = type.base ?? type.type;
  if (!Object.hasOwn(PRIMITIVE_SYSTEMS, base)) throw new Error(`type "${type.type}" has no system`);
  return PRIMITIVE_SYSTEMS[base as BasePrimitive];
}

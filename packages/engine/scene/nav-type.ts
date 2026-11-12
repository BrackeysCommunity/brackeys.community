import type { RegisteredType, SystemFactory } from "../game/types";

/** Registry-wide, so a second copy of this module (a bundle beside the source) reads the same mark. */
const NAV_SYSTEM = Symbol.for("@jams/engine/nav-system");

/**
 * Marks `factory` as the engine's nav system, so `isNavType` can tell a type
 * whose own system it is without importing `systems/` (the sync service runs
 * `scene/` without it).
 */
export function markNavSystem<F extends SystemFactory>(factory: F): F {
  Object.defineProperty(factory, NAV_SYSTEM, { value: true });
  return factory;
}

/**
 * Whether entities of `type` are nav polygons: the type loads and spawns into
 * the engine's nav system, either because its own system is the nav system
 * or because it has none and is the `nav` primitive or based on it. The
 * validator and the runtime both judge by this.
 */
export function isNavType(type: RegisteredType | undefined): type is RegisteredType {
  if (type === undefined || type.loads === false) return false;
  return type.system
    ? (type.system as { [NAV_SYSTEM]?: true })[NAV_SYSTEM] === true
    : (type.base ?? type.type) === "nav";
}

import type { RegisteredType, SystemFactory } from "../game/types";

/**
 * Whether entities of `type` are nav polygons: the type loads and spawns into
 * the engine's nav system, either because its own system is `navSystem` or
 * because it has none and is the `nav` primitive or based on it.
 *
 * `navSystem` is the engine's nav system factory. This module takes it as an
 * argument so it holds no value import from `systems/` (the sync service runs
 * `scene/` without it); a caller that leaves it out treats every type with
 * its own system as not nav.
 */
export function isNavType(
  type: RegisteredType | undefined,
  navSystem?: SystemFactory,
): type is RegisteredType {
  if (type === undefined || type.loads === false) return false;
  return type.system ? type.system === navSystem : (type.base ?? type.type) === "nav";
}

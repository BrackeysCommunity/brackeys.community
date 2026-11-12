import type { EngineContext, RegisteredType, Style } from "./types";

/**
 * The look of an entity of `type`: the type's style, else its base
 * primitive's, with the material's style winning field by field. Pure, so
 * the scene renderers share it with the runtime's systems.
 */
export function styleOf(
  ctx: Pick<EngineContext, "registry">,
  type: RegisteredType,
  material: string | undefined,
): Style | undefined {
  const own = type.style ?? (type.base ? ctx.registry.types.get(type.base)?.style : undefined);
  const mat = material === undefined ? undefined : ctx.registry.materials.get(material)?.style;
  return own || mat ? { ...own, ...mat } : undefined;
}

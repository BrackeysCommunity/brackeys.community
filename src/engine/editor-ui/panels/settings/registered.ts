import { ENGINE_COLLISION_GROUPS } from "../../../game/types";
import type { Registry } from "../../../game/types";
import type { CodeModuleInfo } from "../../../project/index";

/** What code registers, as the Layers tab lists it: read-only, with where it comes from. */
export type RegisteredRow = {
  name: string;
  description: string;
  /** The code module that registers it; null when the game's module isn't in the project's code map. */
  module: string | null;
  /** The engine's own (its default layers, its built-in collision groups) rather than the game's. */
  engine: boolean;
};

type Registers = CodeModuleInfo["registers"] & { layers?: string[]; collisionGroups?: string[] };
type Code = Readonly<Record<string, CodeModuleInfo>>;

/** The module that names `name` under `field`, else the game's module: the one registering its types. */
function moduleOf(
  code: Code,
  registry: Registry,
  field: "layers" | "collisionGroups",
  name: string,
): string | null {
  const paths = Object.keys(code).sort();
  const named = paths.find((p) => (code[p]!.registers as Registers)[field]?.includes(name));
  if (named) return named;
  const types = new Set(registry.game?.types.map((t) => t.type) ?? []);
  return paths.find((p) => code[p]!.registers.types?.some((t) => types.has(t))) ?? null;
}

/** The registry's scene layers, bottom to top: the game's, or the engine's defaults. */
export function layerRows(registry: Registry, code: Code): RegisteredRow[] {
  const own = registry.game?.layers !== undefined;
  return registry.layers.map((layer) => ({
    name: layer.name,
    description: [
      layer.description,
      `draw ${layer.draw}`,
      ...(layer.sort === "y" ? ["sorted by y"] : []),
      ...(layer.editorOnly ? ["editor only"] : []),
    ].join(" · "),
    module: own ? moduleOf(code, registry, "layers", layer.name) : null,
    engine: !own,
  }));
}

/** The registry's collision groups, the engine's first, each with the groups it collides with. */
export function collisionGroupRows(registry: Registry, code: Code): RegisteredRow[] {
  const groups = registry.game?.collisionGroups ?? {};
  return registry.collisionGroupNames.map((name) => {
    const engine = (ENGINE_COLLISION_GROUPS as readonly string[]).includes(name);
    const collides = groups[name]?.collidesWith ?? [];
    return {
      name,
      description: engine
        ? "Built in."
        : collides.length > 0
          ? `Collides with ${collides.join(", ")}.`
          : "Collides with nothing it names.",
      module: engine ? null : moduleOf(code, registry, "collisionGroups", name),
      engine,
    };
  });
}

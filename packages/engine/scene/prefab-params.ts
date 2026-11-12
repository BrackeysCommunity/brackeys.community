import type { OverridePath, PrefabParam } from "./types";

/**
 * The overrides a param's `value` makes: each target with the value, or,
 * for a target the param maps, the mapped value; a mapped target the map
 * has no entry for (or a value that isn't a string) is left out.
 */
export function paramTargetValues(param: PrefabParam, value: unknown): [OverridePath, unknown][] {
  const out: [OverridePath, unknown][] = [];
  for (const target of param.targets) {
    const map = param.map?.[target];
    if (map === undefined) out.push([target, value]);
    else if (typeof value === "string" && Object.hasOwn(map, value)) out.push([target, map[value]]);
  }
  return out;
}

/**
 * What's wrong with a param's value map, with the path inside the param
 * (`["map", target]`): a map for a path that isn't one of its targets, an
 * empty map, or a `default` that no map can read because it isn't a string.
 */
export function paramMapProblem(
  param: PrefabParam,
): { message: string; path: (string | number)[] } | null {
  if (param.map === undefined) return null;
  for (const [target, map] of Object.entries(param.map)) {
    if (!param.targets.includes(target))
      return {
        message: `maps "${target}", which isn't one of its targets (${param.targets.join(", ")})`,
        path: ["map", target],
      };
    if (Object.keys(map).length === 0)
      return { message: `maps "${target}" to nothing; drop the empty map`, path: ["map", target] };
  }
  if (param.default !== undefined && typeof param.default !== "string")
    return {
      message: `has a value map, so its default must be a string, not ${JSON.stringify(param.default)}`,
      path: ["default"],
    };
  return null;
}

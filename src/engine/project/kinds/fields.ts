import { BEHAVIORS_FIELD } from "../../game/behaviors";
import type { Registry } from "../../game/types";
import { jsonPointer } from "../../scene/issues";
import { splitOverridePath } from "../../scene/resolve";
import { unwrapSchema } from "../../scene/schema";
import type { EntityTypeName, InstanceDef } from "../../scene/types";
import { schemaAtPath, schemaRefSites, type RefSite } from "../refs";
import { isPlainObject } from "./define";
import { MATERIAL_KIND } from "./material";

/**
 * A type's material fields: those whose schema is the registry's material
 * enum, as `materialField` builds it. Their values name a material, which
 * is a reference when a material asset has that id.
 */
export function materialFieldsOf(registry: Registry, type: EntityTypeName): string[] {
  const t = registry.types.get(type);
  if (!t || registry.materialNames.length === 0) return [];
  const names = new Set(registry.materialNames);
  return Object.entries(t.shape)
    .filter(([, schema]) => {
      const def = unwrapSchema(schema)._zod.def as {
        type: string;
        entries?: Record<string, unknown>;
      };
      if (def.type !== "enum" || !def.entries) return false;
      const values = Object.values(def.entries);
      return values.length === names.size && values.every((v) => names.has(v as string));
    })
    .map(([field]) => field);
}

type EntityLike = { id?: unknown; type?: unknown; [field: string]: unknown };

/** The material references of a list of entities, by `@<id>` pointer under `at`. */
export function entityMaterialRefs(
  registry: Registry,
  entities: readonly EntityLike[] | undefined,
  at: string,
): RefSite[] {
  const out: RefSite[] = [];
  const fieldsOf = new Map<string, string[]>();
  for (const e of entities ?? []) {
    if (typeof e.id !== "string" || typeof e.type !== "string") continue;
    let fields = fieldsOf.get(e.type);
    if (!fields) fieldsOf.set(e.type, (fields = materialFieldsOf(registry, e.type)));
    for (const field of fields) {
      const value = e[field];
      if (typeof value === "string")
        out.push({ pointer: `${at}/@${e.id}/${field}`, id: value, kinds: [MATERIAL_KIND] });
    }
  }
  return out;
}

/**
 * The materials bulk keys name (`solid:ice`): every own key of `holder`
 * whose type before the colon takes materials in bulk and that holds
 * entries, as a key site under `at`. Keys the registry has no material for
 * count too, so a trashed material's bulk still reads as a reference.
 */
export function bulkMaterialRefs(
  registry: Registry,
  holder: Readonly<Record<string, unknown>> | undefined,
  at: readonly string[],
): RefSite[] {
  const out: RefSite[] = [];
  for (const [key, value] of Object.entries(holder ?? {})) {
    const colon = key.indexOf(":");
    if (colon <= 0 || !Array.isArray(value) || value.length === 0) continue;
    if (!registry.types.get(key.slice(0, colon))?.bulk?.materials) continue;
    out.push({
      pointer: jsonPointer([...at, key]),
      id: key.slice(colon + 1),
      kinds: [MATERIAL_KIND],
      in: "key",
    });
  }
  return out;
}

/**
 * Instance overrides that set a material: those whose field is a material
 * field of some registered type. The prefab, which knows each child's
 * type, isn't at hand, so the field's name decides.
 */
export function overrideMaterialRefs(
  registry: Registry,
  instances: readonly InstanceDef[] | undefined,
): RefSite[] {
  if (!instances?.some((inst) => inst.overrides)) return [];
  const fields = new Set(registry.typeNames.flatMap((t) => materialFieldsOf(registry, t)));
  const out: RefSite[] = [];
  for (const inst of instances) {
    for (const [path, value] of Object.entries(inst.overrides ?? {})) {
      const split = splitOverridePath(path);
      if (!split || !fields.has(split.field) || typeof value !== "string") continue;
      out.push({
        pointer: jsonPointer(["instances", `@${inst.id}`, "overrides", path]),
        id: value,
        kinds: [MATERIAL_KIND],
      });
    }
  }
  return out;
}

/**
 * The asset fields' references of a list of entities: each one's type
 * fields and each behavior block it carries, by `@<id>` pointer under `at`.
 */
export function entityAssetRefs(
  registry: Registry,
  entities: readonly EntityLike[] | undefined,
  at: string,
): RefSite[] {
  const out: RefSite[] = [];
  for (const e of entities ?? []) {
    if (typeof e.id !== "string" || typeof e.type !== "string") continue;
    const base = `${at}/@${e.id}`;
    const type = registry.types.get(e.type);
    if (type) out.push(...schemaRefSites(type.shape, e, base));
    const blocks = e[BEHAVIORS_FIELD];
    if (!isPlainObject(blocks)) continue;
    for (const [name, block] of Object.entries(blocks)) {
      const behavior = registry.behaviors.get(name);
      if (behavior)
        out.push(
          ...schemaRefSites(
            behavior.shape,
            block,
            `${base}${jsonPointer([BEHAVIORS_FIELD, name])}`,
          ),
        );
    }
  }
  return out;
}

/** The asset fields some registered type (or behavior) has at an override's field path. */
function overrideSites(
  registry: Registry,
  path: string,
  field: string,
  value: unknown,
  at: string,
) {
  const segments = field.split(".");
  const shapes =
    segments[0] === BEHAVIORS_FIELD && segments.length > 2
      ? [registry.behaviors.get(segments[1]!)?.shape].filter((s) => s !== undefined)
      : registry.typeNames.map((t) => registry.types.get(t)!.shape);
  const rest = segments[0] === BEHAVIORS_FIELD ? segments.slice(2) : segments;
  for (const shape of shapes) {
    const schema = schemaAtPath(shape, rest);
    if (!schema) continue;
    const sites = schemaRefSites({ [path]: schema }, { [path]: value }, at);
    if (sites.length > 0) return sites;
  }
  return [];
}

/**
 * Instance overrides that set an asset field: those whose field path
 * reaches an `assetField` in some registered type or behavior. As with
 * materials, the prefab that knows each child's type isn't at hand.
 */
export function overrideAssetRefs(
  registry: Registry,
  instances: readonly InstanceDef[] | undefined,
): RefSite[] {
  const out: RefSite[] = [];
  for (const inst of instances ?? []) {
    const at = jsonPointer(["instances", `@${inst.id}`, "overrides"]);
    for (const [path, value] of Object.entries(inst.overrides ?? {})) {
      const split = splitOverridePath(path);
      if (split) out.push(...overrideSites(registry, path, split.field, value, at));
    }
  }
  return out;
}

/** Each instance's prefab. */
export function instancePrefabRefs(instances: readonly InstanceDef[] | undefined): RefSite[] {
  return (instances ?? []).map((inst) => ({
    pointer: `/instances/@${inst.id}/prefab`,
    id: inst.prefab,
    kinds: ["prefab"],
  }));
}

/** The `assets` header: each id, of any kind. */
export function headerAssetRefs(assets: readonly unknown[] | undefined): RefSite[] {
  const out: RefSite[] = [];
  (assets ?? []).forEach((id, i) => {
    if (typeof id === "string") out.push({ pointer: `/assets/${i}`, id, kinds: [] });
  });
  return out;
}

type BodyLike = {
  entities?: readonly EntityLike[];
  instances?: readonly InstanceDef[];
  assets?: readonly unknown[];
};

/**
 * What a scene's or prefab's content names: the header, each instance's
 * prefab and overrides, and its entities' material and asset fields. Bulk
 * keys are the caller's, which knows where they sit. Without a registry
 * (a scene for another game) only the header and prefabs are known.
 */
export function bodyRefs(registry: Registry | null, body: BodyLike): RefSite[] {
  const shared = [...headerAssetRefs(body.assets), ...instancePrefabRefs(body.instances)];
  if (!registry) return shared;
  return [
    ...shared,
    ...overrideMaterialRefs(registry, body.instances),
    ...overrideAssetRefs(registry, body.instances),
    ...entityMaterialRefs(registry, body.entities, "/entities"),
    ...entityAssetRefs(registry, body.entities, "/entities"),
  ];
}

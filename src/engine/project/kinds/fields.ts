import type { Registry } from "../../game/types";
import { jsonPointer } from "../../scene/issues";
import { splitOverridePath } from "../../scene/resolve";
import { unwrapSchema } from "../../scene/schema";
import type { EntityTypeName, InstanceDef } from "../../scene/types";
import type { RefSite } from "../refs";

const MATERIAL_KIND = "material";

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

import {
  BULK_KEYS,
  type BulkKey,
  type EntityDef,
  type Pt,
  type Ref,
  type SceneDefinition,
  type ShapeTuple,
} from "../scene/types";

export type RefTarget =
  | { kind: "entity"; ref: Ref; index: number; entity: EntityDef }
  | { kind: "bulk"; ref: Ref; key: BulkKey; index: number; value: ShapeTuple | Pt };

function bucket(def: SceneDefinition, key: BulkKey): (ShapeTuple | Pt)[] {
  return ((def as Record<string, unknown>)[key] as (ShapeTuple | Pt)[] | undefined) ?? [];
}

export function bulkRef(key: BulkKey, index: number): Ref {
  return `~${key}:${index}`;
}

/** Every reference the document holds, in file order: bulk entries, then entities. */
export function docRefs(def: SceneDefinition): Ref[] {
  const out: Ref[] = [];
  for (const key of BULK_KEYS) bucket(def, key).forEach((_, i) => out.push(bulkRef(key, i)));
  for (const e of def.entities ?? []) out.push(e.id);
  return out;
}

export function lookupRef(def: SceneDefinition, ref: Ref): RefTarget | null {
  if (ref.startsWith("~")) {
    const cut = ref.lastIndexOf(":");
    const key = ref.slice(1, cut) as BulkKey;
    const index = Number(ref.slice(cut + 1));
    if (cut < 0 || !BULK_KEYS.includes(key) || !Number.isInteger(index)) return null;
    const value = bucket(def, key)[index];
    return value ? { kind: "bulk", ref, key, index, value } : null;
  }
  const index = (def.entities ?? []).findIndex((e) => e.id === ref);
  return index < 0 ? null : { kind: "entity", ref, index, entity: def.entities![index]! };
}

export function isBulkRef(ref: Ref): boolean {
  return ref.startsWith("~");
}

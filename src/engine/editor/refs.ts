import type { Registry } from "../game/types";
import { bulkEntries, bulkId, bulkKeysOf, parseBulkId } from "../scene/expand";
import { resolveScene } from "../scene/resolve";
import type {
  BulkEntry,
  BulkKey,
  EntityDef,
  PrefabLibrary,
  Ref,
  SceneDefinition,
} from "../scene/types";

export type RefTarget =
  | { kind: "entity"; ref: Ref; index: number; entity: EntityDef }
  | { kind: "bulk"; ref: Ref; key: BulkKey; index: number; value: BulkEntry };

/** Every reference the document holds, in file order: bulk entries, then entities. */
export function docRefs(def: SceneDefinition): Ref[] {
  const out: Ref[] = [];
  for (const key of bulkKeysOf(def))
    bulkEntries(def, key).forEach((_, i) => out.push(bulkId(key, i)));
  for (const e of def.entities ?? []) out.push(e.id);
  return out;
}

/**
 * The entities a reference field may name: the document's own and, with
 * `prefabs`, every instance's children by their resolved refs
 * (`gate-2/door`, `room-1/door-1/panel`).
 */
export function referableEntities(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): EntityDef[] {
  if (!prefabs || (def.instances ?? []).length === 0) return def.entities ?? [];
  return resolveScene(def, registry, prefabs).entities ?? [];
}

export function lookupRef(def: SceneDefinition, ref: Ref): RefTarget | null {
  if (isBulkRef(ref)) {
    const p = parseBulkId(ref);
    const value = p ? bulkEntries(def, p.key)[p.index] : undefined;
    return p && value ? { kind: "bulk", ref, key: p.key, index: p.index, value } : null;
  }
  const index = (def.entities ?? []).findIndex((e) => e.id === ref);
  return index < 0 ? null : { kind: "entity", ref, index, entity: def.entities![index]! };
}

export function isBulkRef(ref: Ref): boolean {
  return ref.startsWith("~");
}

import { isAttachField } from "../game/fields";
import type { Registry } from "../game/types";
import type { EntityTypeName, OpBatch, PrefabLibrary, Ref, SceneDefinition } from "../scene/types";
import { lookupRef, referableEntities } from "./refs";

/** A type's `attachField` and the types it may ride, or null when it has none. */
export function attachFieldOf(
  registry: Registry,
  type: EntityTypeName,
): { field: string; targets: readonly EntityTypeName[] } | null {
  const t = registry.types.get(type);
  if (!t) return null;
  for (const [field, schema] of Object.entries(t.shape)) {
    if (!isAttachField(schema)) continue;
    const targets = t.refs?.find((r) => r.field === field)?.targets ?? ["follower"];
    return { field, targets };
  }
  return null;
}

/** Whether entities of `type` can be named by some type's `attachField`. */
export function isFollowerType(registry: Registry, type: EntityTypeName): boolean {
  const base = registry.types.get(type)?.base;
  return registry.typeNames.some((name) => {
    const targets = attachFieldOf(registry, name)?.targets ?? [];
    return targets.includes(type) || (base !== undefined && targets.includes(base));
  });
}

/**
 * One `update` pointing `ref`'s `attachField` at `follower`, or clearing it
 * when `follower` is null. A follower may be an instance's child by its
 * resolved ref (`gate-2/lift`), found through `prefabs`. Null when `ref`
 * isn't one of the document's entities, its type has no `attachField`, the
 * follower isn't a type that field may name, or nothing would change.
 */
export function attachBatch(
  def: SceneDefinition,
  ref: Ref,
  follower: Ref | null,
  registry: Registry,
  prefabs?: PrefabLibrary,
): OpBatch | null {
  const hit = lookupRef(def, ref);
  if (hit?.kind !== "entity") return null;
  const attach = attachFieldOf(registry, hit.entity.type);
  if (!attach) return null;
  const current = hit.entity[attach.field];

  if (follower === null) {
    if (current === undefined) return null;
    return { label: `Detach ${ref}`, ops: [{ op: "update", ref, unset: [attach.field] }] };
  }
  if (follower === ref || current === follower) return null;
  const target = referableEntities(def, registry, prefabs).find((e) => e.id === follower);
  if (!target) return null;
  const base = registry.types.get(target.type)?.base;
  const allowed =
    attach.targets.includes(target.type) || (base !== undefined && attach.targets.includes(base));
  if (!allowed) return null;
  return {
    label: `Attach ${ref} to ${follower}`,
    ops: [{ op: "update", ref, set: { [attach.field]: follower } }],
  };
}

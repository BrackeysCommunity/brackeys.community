import type { ProjectOpBatch } from "../project/ops";
import type { AssetId } from "../project/types";
import { nextFreeId } from "../scene/fragment";
import { sceneHash } from "../scene/hash";
import { parseChildRef } from "../scene/resolve";
import type { InstanceDef, OpBatch, PrefabLibrary, Ref, SceneDefinition } from "../scene/types";

/**
 * The editor's prefab commands as op batches against the document (not
 * the resolved view): what the inspector's buttons and the outliner's
 * menu dispatch. Apply to prefab, Create prefab and Unpack read or write
 * prefab docs as well as the scene's, so a session dispatches them through
 * its prefab source's writer: one transaction per doc, one undo step.
 */

/** A scene batch as one `editScene` of a project batch, for `applyProjectBatch` (agents, the CLI). */
export function asProjectBatch(scene: AssetId, batch: OpBatch): ProjectOpBatch {
  return {
    v: 1,
    ...(batch.label ? { label: batch.label } : {}),
    ops: [{ op: "editScene", id: scene, ops: batch.ops }],
  };
}

/** The instance an instance's ref or one of its children's refs names. */
export function instanceOfRef(def: SceneDefinition, ref: Ref): InstanceDef | undefined {
  const id = parseChildRef(ref)?.instance ?? ref;
  return def.instances?.find((i) => i.id === id);
}

/** How many instances place `prefab`; what Apply to prefab's confirmation counts. */
export function instancesOf(def: SceneDefinition, prefab: string): number {
  return (def.instances ?? []).filter((i) => i.prefab === prefab).length;
}

/**
 * For an instance child's ref: its instance, its id in the prefab, and each
 * top-level field it overrides with the override keys behind it. Null for
 * anything else.
 */
export function childOverrides(
  def: SceneDefinition,
  ref: Ref,
): { instance: string; child: string; fields: Map<string, string[]> } | null {
  const split = parseChildRef(ref);
  const inst = split && instanceOfRef(def, ref);
  if (!split || !inst) return null;
  const fields = new Map<string, string[]>();
  for (const key of Object.keys(inst.overrides ?? {})) {
    if (!key.startsWith(`${split.child}.`)) continue;
    const field = key.slice(split.child.length + 1).split(".")[0]!;
    fields.set(field, [...(fields.get(field) ?? []), key]);
  }
  return { instance: inst.id, child: split.child, fields };
}

/** Drops the overrides behind one field of an instance child, back to the prefab's value. */
export function revertFieldBatch(def: SceneDefinition, ref: Ref, field: string): OpBatch | null {
  const o = childOverrides(def, ref);
  const paths = o?.fields.get(field);
  if (!o || !paths) return null;
  return {
    label: `Revert ${ref}'s ${field}`,
    ops: [{ op: "revertOverride", ref: o.instance, paths }],
  };
}

export function revertAllBatch(def: SceneDefinition, ref: Ref): OpBatch | null {
  const inst = instanceOfRef(def, ref);
  if (!inst || Object.keys(inst.overrides ?? {}).length === 0) return null;
  return { label: `Revert all of ${inst.id}`, ops: [{ op: "revertOverride", ref: inst.id }] };
}

export function applyToPrefabBatch(def: SceneDefinition, ref: Ref): OpBatch | null {
  const inst = instanceOfRef(def, ref);
  if (!inst || Object.keys(inst.overrides ?? {}).length === 0) return null;
  return {
    label: `Apply ${inst.id} to ${inst.prefab}`,
    ops: [{ op: "applyToPrefab", ref: inst.id }],
  };
}

export function unpackBatch(def: SceneDefinition, ref: Ref): OpBatch | null {
  const inst = instanceOfRef(def, ref);
  return inst ? { label: `Unpack ${inst.id}`, ops: [{ op: "unpack", ref: inst.id }] } : null;
}

/**
 * Create prefab from selection: the selected entities and bulk entries
 * become a new prefab, named after the first one, with one instance where
 * they stood. `taken` adds ids the new prefab can't have besides the
 * library's (every asset id in the project). Null when the selection holds
 * instances or their children, which a prefab can't hold.
 */
export function createPrefabBatch(
  def: SceneDefinition,
  refs: readonly Ref[],
  prefabs: PrefabLibrary,
  taken: Iterable<string> = [],
): OpBatch | null {
  if (refs.length === 0) return null;
  if (refs.some((r) => parseChildRef(r) || def.instances?.some((i) => i.id === r))) return null;
  const first = refs[0]!;
  const stem = first.startsWith("~")
    ? first.slice(1, first.lastIndexOf(":")).split(":")[0]!
    : first.replace(/-\d+$/, "");
  const id = nextFreeId(stem, new Set([...prefabs.keys(), ...taken]));
  const bulk = refs.some((r) => r.startsWith("~"));
  return {
    label: `Create prefab ${id}`,
    ...(bulk ? { base: sceneHash(def) } : {}),
    ops: [{ op: "createPrefab", refs: [...refs], id }],
  };
}

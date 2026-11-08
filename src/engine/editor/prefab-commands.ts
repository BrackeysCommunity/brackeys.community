import type { ProjectOpBatch } from "../project/ops";
import type { AssetId } from "../project/types";
import { nextFreeId } from "../scene/fragment";
import { sceneHash } from "../scene/hash";
import { CHILD_SEPARATOR, parseChildRef, splitOverridePath } from "../scene/resolve";
import {
  PREFAB_MAX_DEPTH,
  SCENE_FORMAT_VERSION,
  type InstanceDef,
  type OpBatch,
  type OverridePath,
  type Prefab,
  type PrefabLibrary,
  type Ref,
  type SceneDefinition,
} from "../scene/types";

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

/** The instances a prefab holds: its own, then its variant base's, outermost first. */
export function prefabInstances(prefab: Prefab, prefabs: PrefabLibrary): InstanceDef[] {
  const out: InstanceDef[] = [];
  const seen = new Set<string>();
  let cur: Prefab | undefined = prefab;
  for (let depth = 0; cur && depth <= PREFAB_MAX_DEPTH && !seen.has(cur.id); depth++) {
    seen.add(cur.id);
    out.push(...(cur.instances ?? []));
    cur = cur.base === undefined ? undefined : prefabs.get(cur.base);
  }
  return out;
}

/** Whether `id` is `prefab` or a variant of it (`prefab` sits in its base chain). */
function derivesFrom(id: string, prefab: string, prefabs: PrefabLibrary): boolean {
  let cur: string | undefined = id;
  for (let depth = 0; cur !== undefined && depth <= PREFAB_MAX_DEPTH; depth++) {
    if (cur === prefab) return true;
    cur = prefabs.get(cur)?.base;
  }
  return false;
}

/**
 * How many placements Apply to `prefab` changes, what its confirmation
 * counts. With `prefabs`, that takes in placements of its variants and
 * those nested in other prefabs; without, only the scene's own placements
 * of `prefab` itself.
 */
export function instancesOf(def: SceneDefinition, prefab: string, prefabs?: PrefabLibrary): number {
  if (!prefabs) return (def.instances ?? []).filter((i) => i.prefab === prefab).length;
  const own = (i: InstanceDef): number => (derivesFrom(i.prefab, prefab, prefabs) ? 1 : 0);
  const within = (id: string, depth: number): number => {
    const p = depth < PREFAB_MAX_DEPTH ? prefabs.get(id) : undefined;
    if (!p) return 0;
    return prefabInstances(p, prefabs).reduce(
      (n, i) => n + own(i) + within(i.prefab, depth + 1),
      0,
    );
  };
  return (def.instances ?? []).reduce((n, i) => n + own(i) + within(i.prefab, 1), 0);
}

/**
 * A nested instance a resolved ref names (`room-1/door-1`): the instance
 * inside its prefab, the prefab that holds it, and its path below the
 * scene's instance (`door-1`). Null for a scene instance, an entity child
 * or an unknown ref.
 */
export function nestedInstanceOf(
  def: SceneDefinition,
  ref: Ref,
  prefabs: PrefabLibrary,
): { instance: InstanceDef; holder: string; path: string; top: InstanceDef } | null {
  const split = parseChildRef(ref);
  const top = split && instanceOfRef(def, ref);
  if (!split || !top) return null;
  let holder = top.prefab;
  let found: InstanceDef | undefined;
  for (const seg of split.child.split(CHILD_SEPARATOR)) {
    if (found) holder = found.prefab;
    const p = prefabs.get(holder);
    found = p ? prefabInstances(p, prefabs).find((i) => i.id === seg) : undefined;
    if (!found) return null;
  }
  return found ? { instance: found, holder, path: split.child, top } : null;
}

/**
 * The override keys a ref covers on its scene instance: every one for the
 * instance itself; for a child (`room-1/door-1/panel` or a nested instance
 * `room-1/door-1`), those naming it and, for a nested instance, its children.
 */
export function overridePathsOf(def: SceneDefinition, ref: Ref): OverridePath[] {
  const inst = instanceOfRef(def, ref);
  if (!inst) return [];
  const keys = Object.keys(inst.overrides ?? {});
  const split = parseChildRef(ref);
  if (!split) return keys;
  return keys.filter(
    (k) => k.startsWith(`${split.child}.`) || k.startsWith(`${split.child}${CHILD_SEPARATOR}`),
  );
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

/** Drops every override a ref covers (`overridePathsOf`): all of an instance's, or a nested child's. */
export function revertAllBatch(def: SceneDefinition, ref: Ref): OpBatch | null {
  const inst = instanceOfRef(def, ref);
  const paths = overridePathsOf(def, ref);
  if (!inst || paths.length === 0) return null;
  if (!parseChildRef(ref))
    return { label: `Revert all of ${inst.id}`, ops: [{ op: "revertOverride", ref: inst.id }] };
  return { label: `Revert all of ${ref}`, ops: [{ op: "revertOverride", ref: inst.id, paths }] };
}

/**
 * The prefabs one override key can be applied to, outermost first: the
 * instance's own prefab, then the prefab of each nested instance its child
 * part passes through (`door-1/panel.path.speed` on a `room` reaches `room`
 * and `door`).
 */
function keyLevels(inst: InstanceDef, key: OverridePath, prefabs: PrefabLibrary): string[] {
  const levels = [inst.prefab];
  const split = splitOverridePath(key);
  if (!split || split.child.startsWith("~")) return levels;
  const segs = split.child.split(CHILD_SEPARATOR);
  let holder = prefabs.get(inst.prefab);
  for (const seg of segs.slice(0, -1)) {
    const nested = holder ? prefabInstances(holder, prefabs).find((i) => i.id === seg) : undefined;
    if (!nested) break;
    levels.push(nested.prefab);
    holder = prefabs.get(nested.prefab);
  }
  return levels;
}

/**
 * The prefabs Apply to prefab can write a ref's overrides to, outermost
 * first: the levels every one of its keys reaches (`applyToPrefab`'s `to`).
 * Empty when the ref has no overrides.
 */
export function applyLevels(def: SceneDefinition, ref: Ref, prefabs: PrefabLibrary): string[] {
  const inst = instanceOfRef(def, ref);
  const paths = overridePathsOf(def, ref);
  if (!inst || paths.length === 0) return [];
  return paths
    .map((k) => keyLevels(inst, k, prefabs))
    .reduce((common, levels) => common.filter((p, i) => levels[i] === p));
}

/**
 * Folds the overrides a ref covers into a prefab: the instance's own, or
 * with `to` a deeper one from `applyLevels` (which needs `prefabs`). Null
 * when there's nothing to apply or `to` isn't a level the keys reach.
 */
export function applyToPrefabBatch(
  def: SceneDefinition,
  ref: Ref,
  opts: { to?: string; prefabs?: PrefabLibrary } = {},
): OpBatch | null {
  const inst = instanceOfRef(def, ref);
  const paths = overridePathsOf(def, ref);
  if (!inst || paths.length === 0) return null;
  const to = opts.to === inst.prefab ? undefined : opts.to;
  if (to !== undefined && !(opts.prefabs && applyLevels(def, ref, opts.prefabs).includes(to)))
    return null;
  const nested = parseChildRef(ref) !== null;
  return {
    label: `Apply ${nested ? ref : inst.id} to ${to ?? inst.prefab}`,
    ops: [
      {
        op: "applyToPrefab",
        ref: inst.id,
        ...(nested ? { paths } : {}),
        ...(to !== undefined ? { to } : {}),
      },
    ],
  };
}

export function unpackBatch(def: SceneDefinition, ref: Ref): OpBatch | null {
  const inst = instanceOfRef(def, ref);
  return inst ? { label: `Unpack ${inst.id}`, ops: [{ op: "unpack", ref: inst.id }] } : null;
}

/**
 * Create prefab from selection: the selected entities, bulk entries and
 * instances (which nest in it) become a new prefab, named after the first
 * one, with one instance where they stood. `taken` adds ids the new prefab
 * can't have besides the library's (every asset id in the project). Null
 * when the selection holds instance children, which live in their prefab.
 */
export function createPrefabBatch(
  def: SceneDefinition,
  refs: readonly Ref[],
  prefabs: PrefabLibrary,
  taken: Iterable<string> = [],
): OpBatch | null {
  if (refs.length === 0) return null;
  if (refs.some((r) => parseChildRef(r))) return null;
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

/** A new variant's batches; `id` is the variant's. */
export type CreateVariant = {
  id: AssetId;
  /** One `createAsset`, for `applyProject` (agents, the CLI, the dev file adapter). */
  project: ProjectOpBatch;
  /** The same prefab as a `definePrefab`, for a session that writes prefab docs through its prefab source. */
  scene: OpBatch;
};

/**
 * Create variant: a new prefab whose base is `base` and which adds nothing
 * yet, named `<base>-variant` (numbered when taken). `taken` adds ids it
 * can't have besides the library's (every asset id in the project);
 * `folder` is where `createAsset` puts it, default the prefab kind's
 * folder. Null when the library holds no `base`.
 */
export function createVariantBatch(
  base: string,
  prefabs: PrefabLibrary,
  opts: { taken?: Iterable<string>; folder?: string } = {},
): CreateVariant | null {
  if (!prefabs.has(base)) return null;
  const stem = `${base.slice(0, 40).replace(/-+$/, "")}-variant`;
  const id = nextFreeId(stem, new Set([...prefabs.keys(), ...(opts.taken ?? [])]));
  const label = `Create variant ${id} of ${base}`;
  const folder = opts.folder ?? "";
  return {
    id,
    project: {
      v: 1,
      label,
      ops: [
        {
          op: "createAsset",
          kind: "prefab",
          path: folder === "" || folder.endsWith("/") ? folder : `${folder}/`,
          id,
          content: { kind: "prefab", v: SCENE_FORMAT_VERSION, base, entities: [] },
        },
      ],
    },
    scene: { label, ops: [{ op: "definePrefab", id, prefab: { base, entities: [] } }] },
  };
}

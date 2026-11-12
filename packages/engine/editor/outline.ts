import { placeableTypes } from "../game/define";
import type { Registry } from "../game/types";
import { bulkEntries, bulkId, bulkKeysOf, bulkKeyType } from "../scene/expand";
import { CHILD_SEPARATOR, childRef, localChildren, type LocalChild } from "../scene/resolve";
import {
  PREFAB_MAX_DEPTH,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type EntityTypeName,
  type InstanceDef,
  type Prefab,
  type PrefabLibrary,
  type Ref,
  type SceneDefinition,
} from "../scene/types";
import { prefabInstances } from "./prefab-commands";

export type OutlineRow = {
  /** Unique within one outline; stable across edits that keep the row. */
  key: string;
  depth: number;
  kind: "type" | "bucket" | "entity";
  label: string;
  /** Secondary text, such as `box · ice`. */
  detail?: string;
  ref?: Ref;
  type?: EntityTypeName;
  count?: number;
  /** On an instance's row, a nested one's too: the prefab it places. */
  prefab?: string;
  /** On an instance's row, how many overrides it holds (a nested one's: the scene's keys on it and below); on a child's, whether any of its fields is overridden. */
  overrides?: number;
};

/** The type row instances sit under. */
export const INSTANCES_ROW = "instances";

const describeEntry = (v: unknown): string | undefined =>
  Array.isArray(v) ? (typeof v[0] === "string" ? v[0] : `${v[0]}, ${v[1]}`) : undefined;

function entityRow(e: EntityDef): OutlineRow {
  const detail = [describeEntry(e.shape ?? e.at), e.material, e.off ? "off" : undefined]
    .filter((s) => typeof s === "string")
    .join(" · ");
  return {
    key: `ref:${e.id}`,
    depth: 1,
    kind: "entity",
    label: e.name ?? e.id,
    ...(detail ? { detail } : {}),
    ref: e.id,
    type: e.type,
  };
}

function bucketRows(key: BulkKey, values: BulkEntry[]): OutlineRow[] {
  const type = bulkKeyType(key);
  return [
    { key: `bucket:${key}`, depth: 1, kind: "bucket", label: key, type, count: values.length },
    ...values.map((v, i): OutlineRow => {
      const ref = bulkId(key, i);
      return {
        key: `ref:${ref}`,
        depth: 2,
        kind: "entity",
        label: ref,
        detail: describeEntry(v),
        ref,
        type,
      };
    }),
  ];
}

const parentOf = (rel: Ref): string => {
  const i = rel.lastIndexOf(CHILD_SEPARATOR);
  return i < 0 ? "" : rel.slice(0, i);
};

/**
 * An instance's row and, under it, a row per child of its prefab with its
 * resolved ref and whether it is overridden, then a row per instance nested
 * in that prefab (`room-1/door-1`) holding its own children
 * (`room-1/door-1/panel`) the same way, at every level.
 */
function instanceRows(
  inst: InstanceDef,
  prefabs: PrefabLibrary | undefined,
  registry: Registry,
): OutlineRow[] {
  const keys = Object.keys(inst.overrides ?? {});
  const covering = (rel: string) =>
    keys.filter((k) => k.startsWith(`${rel}.`) || k.startsWith(`${rel}${CHILD_SEPARATOR}`)).length;
  const prefab = prefabs?.get(inst.prefab);
  const head: OutlineRow = {
    key: `ref:${inst.id}`,
    depth: 1,
    kind: "entity",
    label: inst.name ?? inst.id,
    detail: [prefab ? inst.prefab : `${inst.prefab} (missing)`, inst.off ? "off" : undefined]
      .filter((s) => s !== undefined)
      .join(" · "),
    ref: inst.id,
    prefab: inst.prefab,
    overrides: keys.length,
  };
  if (!prefab || !prefabs) return [head];

  const byParent = new Map<string, LocalChild[]>();
  for (const c of localChildren(prefab, inst, registry, prefabs)) {
    const parent = parentOf(c.child);
    byParent.set(parent, [...(byParent.get(parent) ?? []), c]);
  }
  const rows: OutlineRow[] = [head];
  const walk = (holder: Prefab, path: string, depth: number, stack: ReadonlySet<string>) => {
    for (const c of byParent.get(path) ?? []) {
      const ref = childRef(inst.id, c.child);
      const type = c.kind === "entity" ? c.def.type : bulkKeyType(c.key);
      const own = c.child.slice(path ? path.length + 1 : 0);
      rows.push({
        key: `ref:${ref}`,
        depth,
        kind: "entity",
        label: c.kind === "entity" ? (c.def.name ?? own) : own,
        detail: describeEntry(c.kind === "entity" ? (c.def.shape ?? c.def.at) : c.value) ?? type,
        ref,
        type,
        overrides: keys.filter((k) => k.startsWith(`${c.child}.`)).length,
      });
    }
    for (const n of prefabInstances(holder, prefabs)) {
      const rel = path ? `${path}${CHILD_SEPARATOR}${n.id}` : n.id;
      const ref = childRef(inst.id, rel);
      const nested = prefabs.get(n.prefab);
      const loops = stack.has(n.prefab) || stack.size >= PREFAB_MAX_DEPTH;
      rows.push({
        key: `ref:${ref}`,
        depth,
        kind: "entity",
        label: n.name ?? n.id,
        detail: [nested ? n.prefab : `${n.prefab} (missing)`, n.off ? "off" : undefined]
          .filter((s) => s !== undefined)
          .join(" · "),
        ref,
        prefab: n.prefab,
        overrides: covering(rel),
      });
      if (nested && !loops) walk(nested, rel, depth + 1, new Set([...stack, n.prefab]));
    }
  };
  walk(prefab, "", 2, new Set([prefab.id]));
  return rows;
}

/**
 * The outliner's rows, flattened depth-first: one row per registered type the
 * scene uses, in registration order, holding its bulk keys (each with a child
 * row per entry) and then its entities in file order. Types the scene can't
 * place (unknown or spawn-only) come last, under their own names. Instances follow under one
 * `instances` row, each with a row per child of its prefab and per
 * instance nested in it, a level deeper each time.
 */
export function buildOutline(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): OutlineRow[] {
  const groups = new Map<EntityTypeName, OutlineRow[]>(
    placeableTypes(registry).map((t) => [t, []]),
  );
  const counts = new Map<EntityTypeName, number>();
  const add = (type: EntityTypeName, rows: OutlineRow[], n: number) => {
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(...rows);
    counts.set(type, (counts.get(type) ?? 0) + n);
  };

  for (const key of bulkKeysOf(def)) {
    const values = bulkEntries(def, key);
    if (values.length > 0) add(bulkKeyType(key), bucketRows(key, values), values.length);
  }
  for (const e of def.entities ?? []) add(e.type, [entityRow(e)], 1);

  const rows: OutlineRow[] = [];
  for (const [type, children] of groups) {
    const count = counts.get(type);
    if (!count) continue;
    const label = registry.types.get(type)?.inspector?.label ?? type;
    rows.push({ key: `type:${type}`, depth: 0, kind: "type", label, type, count }, ...children);
  }
  const instances = def.instances ?? [];
  if (instances.length > 0) {
    rows.push({
      key: `type:${INSTANCES_ROW}`,
      depth: 0,
      kind: "type",
      label: "Prefab instances",
      count: instances.length,
    });
    for (const inst of instances) rows.push(...instanceRows(inst, prefabs, registry));
  }
  return rows;
}

/** The selectable refs in outline order, for range selection. */
export function outlineOrder(rows: readonly OutlineRow[]): Ref[] {
  return rows.flatMap((r) => (r.ref ? [r.ref] : []));
}

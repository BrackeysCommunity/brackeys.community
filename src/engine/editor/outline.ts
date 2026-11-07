import type { Registry } from "../game/types";
import { bulkEntries, bulkId, bulkKeysOf, bulkKeyType } from "../scene/expand";
import { childRef, localChildren } from "../scene/resolve";
import type {
  BulkEntry,
  BulkKey,
  EntityDef,
  EntityTypeName,
  InstanceDef,
  Prefab,
  PrefabLibrary,
  Ref,
  SceneDefinition,
} from "../scene/types";

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
  /** On an instance's row: the prefab it places. */
  prefab?: string;
  /** On an instance's row, how many overrides it holds; on a child's, whether any of its fields is overridden. */
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

/** An instance's row and one row per child, its resolved ref and whether it is overridden. */
function instanceRows(
  inst: InstanceDef,
  prefab: Prefab | undefined,
  registry: Registry,
): OutlineRow[] {
  const keys = Object.keys(inst.overrides ?? {});
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
  if (!prefab) return [head];
  return [
    head,
    ...localChildren(prefab, inst, registry).map((c): OutlineRow => {
      const ref = childRef(inst.id, c.child);
      const type = c.kind === "entity" ? c.def.type : bulkKeyType(c.key);
      const overridden = keys.filter((k) => k.startsWith(`${c.child}.`)).length;
      return {
        key: `ref:${ref}`,
        depth: 2,
        kind: "entity",
        label: c.kind === "entity" ? (c.def.name ?? c.child) : c.child,
        detail: describeEntry(c.kind === "entity" ? (c.def.shape ?? c.def.at) : c.value) ?? type,
        ref,
        type,
        overrides: overridden,
      };
    }),
  ];
}

/**
 * The outliner's rows, flattened depth-first: one row per registered type the
 * scene uses, in registration order, holding its bulk keys (each with a child
 * row per entry) and then its entities in file order. Types the registry
 * doesn't know come last, under their own names. Instances follow under one
 * `instances` row, each with a row per child of its prefab.
 */
export function buildOutline(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): OutlineRow[] {
  const groups = new Map<EntityTypeName, OutlineRow[]>(registry.typeNames.map((t) => [t, []]));
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
    for (const inst of instances)
      rows.push(...instanceRows(inst, prefabs?.get(inst.prefab), registry));
  }
  return rows;
}

/** The selectable refs in outline order, for range selection. */
export function outlineOrder(rows: readonly OutlineRow[]): Ref[] {
  return rows.flatMap((r) => (r.ref ? [r.ref] : []));
}

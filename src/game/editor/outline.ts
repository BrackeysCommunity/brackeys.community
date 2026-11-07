import {
  LAYERS,
  SHAPE_BULK_KEYS,
  type Behavior,
  type BulkKey,
  type EntityDef,
  type Layer,
  type Pt,
  type Ref,
  type SceneDefinition,
  type ShapeTuple,
} from "../scene/types";
import { bulkRef } from "./refs";

export type OutlineRow = {
  /** Unique within one outline; stable across edits that keep the row. */
  key: string;
  depth: number;
  kind: "layer" | "bucket" | "entity" | "spawn";
  label: string;
  /** Secondary text, such as `mover · box`. */
  detail?: string;
  ref?: Ref;
  behavior?: Behavior;
  count?: number;
};

const LAYER_LABELS: Record<Layer, string> = {
  terrain: "Terrain",
  gameplay: "Gameplay",
  decor: "Decor",
  editor: "Editor",
};

/** Row order inside a layer. */
const BEHAVIOR_ORDER: readonly Behavior[] = [
  "solid",
  "cloud",
  "mover",
  "anchor",
  "sensor",
  "prop",
  "construct",
  "note",
];

function defaultLayer(b: Behavior): Layer {
  if (b === "solid" || b === "cloud") return "terrain";
  if (b === "note") return "editor";
  return "gameplay";
}

function shapeTag(e: EntityDef): string | undefined {
  return "shape" in e ? String((e.shape as ShapeTuple)[0]) : undefined;
}

function entityRow(e: EntityDef): OutlineRow {
  const detail = [
    e.b === "construct" ? e.type : e.b === "sensor" ? `${e.b} · ${e.kind}` : e.b,
    shapeTag(e),
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    key: `ref:${e.id}`,
    depth: 1,
    kind: "entity",
    label: e.name ?? e.id,
    detail,
    ref: e.id,
    behavior: e.b,
  };
}

function bucketRows(key: BulkKey, values: (ShapeTuple | Pt)[]): OutlineRow[] {
  const behavior = key.split(":")[0] as Behavior;
  const rows: OutlineRow[] = [
    { key: `bucket:${key}`, depth: 1, kind: "bucket", label: key, behavior, count: values.length },
  ];
  values.forEach((v, i) => {
    const ref = bulkRef(key, i);
    rows.push({
      key: `ref:${ref}`,
      depth: 2,
      kind: "entity",
      label: ref,
      detail: key === "anchor" ? `${v[0]}, ${v[1]}` : String(v[0]),
      ref,
      behavior,
    });
  });
  return rows;
}

/**
 * The outliner's rows, flattened depth-first: one row per layer, bulk
 * buckets under Terrain (anchors under Gameplay) with a child row per
 * entry, spawns first in Gameplay, entities grouped by behavior in file
 * order. An entity's `layer` overrides where its behavior puts it.
 */
export function buildOutline(def: SceneDefinition): OutlineRow[] {
  const byLayer = new Map<Layer, OutlineRow[]>(LAYERS.map((l) => [l, []]));
  const counts = new Map<Layer, number>(LAYERS.map((l) => [l, 0]));
  const bump = (l: Layer, n: number) => counts.set(l, counts.get(l)! + n);

  for (const key of SHAPE_BULK_KEYS) {
    const values = (def[key] ?? []) as ShapeTuple[];
    if (values.length === 0) continue;
    byLayer.get("terrain")!.push(...bucketRows(key, values));
    bump("terrain", values.length);
  }

  const gameplay = byLayer.get("gameplay")!;
  def.spawn.forEach((at, i) => {
    gameplay.push({
      key: `spawn:${i}`,
      depth: 1,
      kind: "spawn",
      label: def.spawn.length > 1 ? `spawn ${i + 1}` : "spawn",
      detail: `${at[0]}, ${at[1]}`,
    });
  });
  bump("gameplay", def.spawn.length);

  const entities = def.entities ?? [];
  for (const b of BEHAVIOR_ORDER) {
    if (b === "anchor" && def.anchor?.length) {
      gameplay.push(...bucketRows("anchor", def.anchor));
      bump("gameplay", def.anchor.length);
    }
    for (const e of entities) {
      if (e.b !== b) continue;
      const layer = e.layer ?? defaultLayer(e.b);
      byLayer.get(layer)!.push(entityRow(e));
      bump(layer, 1);
    }
  }

  const rows: OutlineRow[] = [];
  for (const layer of LAYERS) {
    rows.push({
      key: `layer:${layer}`,
      depth: 0,
      kind: "layer",
      label: LAYER_LABELS[layer],
      count: counts.get(layer)!,
    });
    rows.push(...byLayer.get(layer)!);
  }
  return rows;
}

/** The selectable refs in outline order, for range selection. */
export function outlineOrder(rows: readonly OutlineRow[]): Ref[] {
  return rows.flatMap((r) => (r.ref ? [r.ref] : []));
}

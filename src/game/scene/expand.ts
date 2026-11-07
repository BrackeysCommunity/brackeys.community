import { parseShape } from "./shapes";
import {
  BULK_KEYS,
  SHAPE_BULK_KEYS,
  SPAWN_ORDER,
  type BulkKey,
  type EntityDef,
  type ExpandedScene,
  type Material,
  type Pt,
  type Ref,
  type RuntimeBehavior,
  type RuntimeEntity,
  type SceneDefinition,
  type ShapeBulkKey,
  type ShapeObj,
  type ShapeTuple,
} from "./types";

export function bulkId(key: BulkKey, index: number): Ref {
  return `~${key}:${index}`;
}

/** Splits `~solid:ice:3` on its last colon; `null` for anything that isn't a bulk reference. */
export function parseBulkId(ref: Ref): { key: BulkKey; index: number } | null {
  if (!ref.startsWith("~")) return null;
  const colon = ref.lastIndexOf(":");
  if (colon < 0) return null;
  const key = ref.slice(1, colon);
  const digits = ref.slice(colon + 1);
  if (!/^(0|[1-9]\d*)$/.test(digits) || !(BULK_KEYS as readonly string[]).includes(key))
    return null;
  return { key: key as BulkKey, index: Number(digits) };
}

export function bulkBehavior(key: ShapeBulkKey): { b: "solid" | "cloud"; material?: Material } {
  if (key === "cloud") return { b: "cloud" };
  const [, material] = key.split(":") as [string, Material | undefined];
  return material ? { b: "solid", material } : { b: "solid" };
}

function toShape(tuple: ShapeTuple, where: string): ShapeObj {
  const result = parseShape(tuple);
  if (!result.ok) throw new Error(`expandScene: ${where}: ${result.issue.message}`);
  return result.shape;
}

const pt = ([x, y]: Pt): Pt => [x, y];

function runtimeEntity(e: EntityDef): RuntimeEntity | null {
  if (e.off) return null;
  const where = e.id;
  switch (e.b) {
    case "solid":
      return e.material
        ? { id: e.id, b: "solid", shape: toShape(e.shape, where), material: e.material }
        : { id: e.id, b: "solid", shape: toShape(e.shape, where) };
    case "cloud":
      return { id: e.id, b: "cloud", shape: toShape(e.shape, where) };
    case "mover": {
      const path = { ...e.path, pts: e.path.pts.map(pt) };
      return e.material
        ? { id: e.id, b: "mover", shape: toShape(e.shape, where), path, material: e.material }
        : { id: e.id, b: "mover", shape: toShape(e.shape, where), path };
    }
    case "anchor":
      return { id: e.id, b: "anchor", at: pt(e.at) };
    case "sensor":
      return { id: e.id, b: "sensor", kind: e.kind, shape: toShape(e.shape, where) };
    case "prop":
      return {
        id: e.id,
        b: "prop",
        shape: toShape(e.shape, where),
        density: e.density,
        restitution: e.restitution,
        ...(e.friction !== undefined ? { friction: e.friction } : {}),
      };
    case "construct":
      return { id: e.id, b: "construct", type: e.type, at: pt(e.at), rot: e.rot ?? 0 };
    case "note":
      return null;
  }
}

/**
 * What the runtime loads: bulk entries become `~key:index` entities, `off`
 * entities and notes are dropped, shapes become objects, and everything is
 * in `SPAWN_ORDER` (bulk first, then file order, within each behavior).
 */
export function expandScene(def: SceneDefinition): ExpandedScene {
  const groups = new Map<RuntimeBehavior, RuntimeEntity[]>(SPAWN_ORDER.map((b) => [b, []]));
  for (const key of SHAPE_BULK_KEYS) {
    const { b, material } = bulkBehavior(key);
    (def[key] ?? []).forEach((tuple, index) => {
      const id = bulkId(key, index);
      const shape = toShape(tuple, id);
      groups
        .get(b)!
        .push(b === "solid" && material ? { id, b, shape, material } : { id, b, shape });
    });
  }
  (def.anchor ?? []).forEach((p, index) => {
    groups.get("anchor")!.push({ id: bulkId("anchor", index), b: "anchor", at: pt(p) });
  });
  for (const e of def.entities ?? []) {
    const r = runtimeEntity(e);
    if (r) groups.get(r.b)!.push(r);
  }
  return {
    name: def.name,
    bounds: [def.bounds[0], def.bounds[1], def.bounds[2], def.bounds[3]],
    spawn: def.spawn.map(pt),
    entities: SPAWN_ORDER.flatMap((b) => groups.get(b)!),
  };
}

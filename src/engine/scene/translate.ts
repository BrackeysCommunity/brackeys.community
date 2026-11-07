import type { Registry } from "../game/types";
import { geometryFields, type FieldKind } from "./schema";
import type { BulkEntry, EntityDef, PathDef, Pt, ShapeTuple } from "./types";

export type GeometryKind = Exclude<FieldKind, "value">;

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export const addPt = (p: Pt, [dx, dy]: Pt): Pt => [p[0] + dx, p[1] + dy];
export const subPt = (p: Pt, [dx, dy]: Pt): Pt => [p[0] - dx, p[1] - dy];
export const isZeroPt = ([x, y]: Pt) => x === 0 && y === 0;

export function translateTuple(t: ShapeTuple, [dx, dy]: Pt): ShapeTuple {
  const out = [...t] as (string | number)[];
  if (t[0] === "poly" || t[0] === "chain") {
    for (let i = 1; i + 1 < out.length; i += 2) {
      out[i] = (out[i] as number) + dx;
      out[i + 1] = (out[i + 1] as number) + dy;
    }
  } else {
    out[1] = (out[1] as number) + dx;
    out[2] = (out[2] as number) + dy;
  }
  return out as ShapeTuple;
}

/** A bulk entry moved by `by`: a shape tuple or a point. */
export function translateBulkEntry(value: BulkEntry, by: Pt): BulkEntry {
  return typeof value[0] === "string"
    ? translateTuple(value as ShapeTuple, by)
    : addPt(value as Pt, by);
}

/** The shape, point and path fields of an entity's type that the entity sets. */
export function presentGeometry(
  registry: Registry,
  def: EntityDef,
): { field: string; kind: GeometryKind }[] {
  const t = registry.types.get(def.type);
  return t ? geometryFields(t).filter((f) => def[f.field] !== undefined) : [];
}

/**
 * What a translation shifts: a type with a path has its shapes local to the
 * path, so only the path (and any points) move.
 */
export function movableGeometry(
  registry: Registry,
  def: EntityDef,
): { field: string; kind: GeometryKind }[] {
  const fields = presentGeometry(registry, def);
  return fields.some((f) => f.kind === "path") ? fields.filter((f) => f.kind !== "shape") : fields;
}

/** `def` moved by `by`; `null` when it has no position to move. */
export function translateEntityDef(registry: Registry, def: EntityDef, by: Pt): EntityDef | null {
  const geometry = movableGeometry(registry, def);
  if (geometry.length === 0) return null;
  const next = clone(def);
  for (const { field, kind } of geometry) {
    const v = next[field];
    if (kind === "path") (v as PathDef).pts = (v as PathDef).pts.map((p) => addPt(p, by));
    else next[field] = kind === "point" ? addPt(v as Pt, by) : translateTuple(v as ShapeTuple, by);
  }
  return next;
}

/**
 * The value an update sets at `path` on `def`, moved by `by` when the path
 * lands on movable geometry: a whole shape, point or path, a path's `pts`,
 * or one of its points. Anything else comes back as given.
 */
export function translateFieldValue(
  registry: Registry,
  def: EntityDef,
  path: string,
  value: unknown,
  by: Pt,
): unknown {
  if (isZeroPt(by)) return value;
  const segs = path.split(".");
  const t = registry.types.get(def.type);
  const kind = t && geometryFields(t).find((f) => f.field === segs[0])?.kind;
  if (!kind) return value;
  const hasPath =
    t !== undefined &&
    geometryFields(t).some((f) => f.kind === "path" && def[f.field] !== undefined);
  const isPt = (v: unknown): v is Pt =>
    Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");
  if (kind === "shape") {
    if (segs.length !== 1 || hasPath || !Array.isArray(value) || typeof value[0] !== "string")
      return value;
    return translateTuple(value as ShapeTuple, by);
  }
  if (kind === "point") return segs.length === 1 && isPt(value) ? addPt(value, by) : value;
  if (segs.length === 1 && value !== null && typeof value === "object" && "pts" in value) {
    const p = value as PathDef;
    return Array.isArray(p.pts) ? { ...p, pts: p.pts.map((q) => (isPt(q) ? addPt(q, by) : q)) } : p;
  }
  if (segs[1] !== "pts") return value;
  if (segs.length === 2 && Array.isArray(value))
    return value.map((q) => (isPt(q) ? addPt(q, by) : q));
  if (segs.length === 3 && isPt(value)) return addPt(value, by);
  return value;
}

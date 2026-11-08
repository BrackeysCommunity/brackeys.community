import type { z } from "zod";

import type { Registry } from "../game/types";
import { transformGrid, type GridCells } from "./grid";
import { fieldKind, geometryFields } from "./schema";
import {
  applyPt,
  applyVec,
  dihedralOf,
  isIdentityTurn,
  translation,
  type Dihedral,
  type Transform2D,
} from "./transform";
import type { BulkEntry, EntityDef, PathDef, Pt, ShapeTuple } from "./types";

/** The kinds that carry a position: what a translation moves. */
export type GeometryKind = "shape" | "point" | "path";

/** Every kind a transform acts on; anything else is a plain value it leaves alone. */
type TransformKind = GeometryKind | "vector" | "angle" | "mirror" | "grid";

const TRANSFORM_KINDS: readonly string[] = [
  "shape",
  "point",
  "path",
  "vector",
  "angle",
  "mirror",
  "grid",
] satisfies TransformKind[];

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export const addPt = (p: Pt, [dx, dy]: Pt): Pt => [p[0] + dx, p[1] + dy];
export const subPt = (p: Pt, [dx, dy]: Pt): Pt => [p[0] - dx, p[1] - dy];
export const isZeroPt = ([x, y]: Pt) => x === 0 && y === 0;

const linearPart = (t: Transform2D): Transform2D => ({ ...t, tx: 0, ty: 0 });

const isPt = (v: unknown): v is Pt =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");

const isShapeTuple = (v: unknown): v is ShapeTuple => Array.isArray(v) && typeof v[0] === "string";

function quarterTurns(t: Transform2D): Dihedral {
  const d = dihedralOf(t);
  if (!d) throw new Error("a scene transform must be quarter turns and flips");
  return d;
}

/** An angle in degrees after `d`: negated by a flip, then plus 90° per turn. */
const turnAngle = (deg: number, d: Dihedral) => (d.flip ? 0 - deg : deg) + 90 * d.rot;

/** A shape's `rotDeg` after `d`, kept in [0, 360). */
const turnRotDeg = (deg: number, d: Dihedral) => {
  const r = turnAngle(deg, d) % 360;
  return r < 0 ? r + 360 : r + 0;
};

/**
 * A shape tuple under `t`. Boxes and capsules keep their extents and turn
 * by `rotDeg` (so a sprite on them turns with them); a flip reverses a
 * polygon's or chain's point order to keep its winding.
 */
export function transformTuple(tuple: ShapeTuple, t: Transform2D): ShapeTuple {
  const out = [...tuple] as (string | number)[];
  if (tuple[0] === "poly" || tuple[0] === "chain") {
    const pts: Pt[] = [];
    for (let i = 1; i + 1 < out.length; i += 2) {
      pts.push(applyPt(t, [out[i] as number, out[i + 1] as number]));
    }
    if (t.a * t.d - t.b * t.c < 0) pts.reverse();
    return [tuple[0], ...pts.flat()] as ShapeTuple;
  }
  const [cx, cy] = applyPt(t, [out[1] as number, out[2] as number]);
  out[1] = cx;
  out[2] = cy;
  if (tuple[0] === "box" || tuple[0] === "capsule") {
    const d = quarterTurns(t);
    if (!isIdentityTurn(d)) {
      const had = out.length > 5;
      const rotDeg = turnRotDeg(had ? (out[5] as number) : 0, d);
      if (had) out[5] = rotDeg;
      else if (rotDeg !== 0) out.push(rotDeg);
    }
  }
  return out as ShapeTuple;
}

export function translateTuple(t: ShapeTuple, by: Pt): ShapeTuple {
  return transformTuple(t, translation(by));
}

/** A bulk entry under `t`: a shape tuple or a point. */
export function transformBulkEntry(value: BulkEntry, t: Transform2D): BulkEntry {
  return isShapeTuple(value) ? transformTuple(value, t) : applyPt(t, value as Pt);
}

/** A bulk entry moved by `by`: a shape tuple or a point. */
export function translateBulkEntry(value: BulkEntry, by: Pt): BulkEntry {
  return transformBulkEntry(value, translation(by));
}

function transformPath(p: PathDef, t: Transform2D): PathDef {
  return Array.isArray(p.pts) ? { ...p, pts: p.pts.map((q) => (isPt(q) ? applyPt(t, q) : q)) } : p;
}

function transformByKind(kind: string, value: unknown, t: Transform2D): unknown {
  switch (kind) {
    case "shape":
      return isShapeTuple(value) ? transformTuple(value, t) : value;
    case "point":
      return isPt(value) ? applyPt(t, value) : value;
    case "path":
      return value !== null && typeof value === "object" && "pts" in value
        ? transformPath(value as PathDef, t)
        : value;
    case "vector":
      return isPt(value) ? applyVec(t, value) : value;
    case "angle":
      return typeof value === "number" ? turnAngle(value, quarterTurns(t)) : value;
    case "mirror":
      return typeof value === "boolean" && quarterTurns(t).flip ? !value : value;
    case "grid": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      const d = quarterTurns(t);
      return isIdentityTurn(d) ? value : transformGrid(value as GridCells, d);
    }
    default:
      return value;
  }
}

/**
 * One whole field value under `t`, by what its schema says it holds:
 * shapes, points and paths move; vectors turn and flip but never move;
 * angles gain 90° per turn and negate under a flip; mirror booleans toggle
 * under a flip; grids remap their cells. Anything else, and any value not
 * shaped like its kind, comes back as given.
 */
export function transformFieldValue(
  schema: z.core.$ZodType,
  value: unknown,
  t: Transform2D,
): unknown {
  return transformByKind(fieldKind(schema), value, t);
}

/** The fields of an entity's type that a transform acts on, with their kinds. */
function transformableFields(
  registry: Registry,
  def: EntityDef,
): { field: string; kind: TransformKind }[] {
  const t = registry.types.get(def.type);
  if (!t) return [];
  const out: { field: string; kind: TransformKind }[] = [];
  for (const [field, schema] of Object.entries(t.shape)) {
    const kind: string = fieldKind(schema);
    if (TRANSFORM_KINDS.includes(kind) && def[field] !== undefined) {
      out.push({ field, kind: kind as TransformKind });
    }
  }
  return out;
}

const isGeometryKind = (kind: string): kind is GeometryKind =>
  kind === "shape" || kind === "point" || kind === "path";

/** The shape, point and path fields of an entity's type that the entity sets. */
export function presentGeometry(
  registry: Registry,
  def: EntityDef,
): { field: string; kind: GeometryKind }[] {
  const t = registry.types.get(def.type);
  if (!t) return [];
  const out: { field: string; kind: GeometryKind }[] = [];
  for (const f of geometryFields(t)) {
    if (isGeometryKind(f.kind) && def[f.field] !== undefined)
      out.push({ field: f.field, kind: f.kind });
  }
  return out;
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

/**
 * `def` under `t`, field by field per `transformFieldValue`. A type with a
 * path has its shapes local to the path, so they only turn and flip.
 * `null` when the entity sets no field a transform acts on.
 */
export function transformEntityDef(
  registry: Registry,
  def: EntityDef,
  t: Transform2D,
): EntityDef | null {
  const fields = transformableFields(registry, def);
  if (fields.length === 0) return null;
  const local = fields.some((f) => f.kind === "path") ? linearPart(t) : t;
  const next = clone(def);
  for (const { field, kind } of fields) {
    next[field] = transformByKind(kind, next[field], kind === "shape" ? local : t);
  }
  return next;
}

/** `def` moved by `by`; `null` when it has no position to move. */
export function translateEntityDef(registry: Registry, def: EntityDef, by: Pt): EntityDef | null {
  if (movableGeometry(registry, def).length === 0) return null;
  return transformEntityDef(registry, def, translation(by));
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
  const type = registry.types.get(def.type);
  const field = segs[0] ?? "";
  const schema = type && Object.hasOwn(type.shape, field) ? type.shape[field] : undefined;
  if (!schema) return value;
  const kind: string = fieldKind(schema);
  if (!isGeometryKind(kind)) return value;
  const t = translation(by);
  if (segs.length === 1) {
    if (kind === "shape" && presentGeometry(registry, def).some((f) => f.kind === "path")) {
      return value;
    }
    return transformByKind(kind, value, t);
  }
  if (kind !== "path" || segs[1] !== "pts") return value;
  if (segs.length === 2 && Array.isArray(value)) {
    return value.map((q) => (isPt(q) ? applyPt(t, q) : q));
  }
  if (segs.length === 3 && isPt(value)) return applyPt(t, value);
  return value;
}

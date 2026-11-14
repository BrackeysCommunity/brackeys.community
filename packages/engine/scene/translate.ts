import { z } from "zod";

import { BEHAVIORS_FIELD } from "../game/behaviors";
import { CHILD_REF_PATTERN, SIDES } from "../game/fields";
import { scopedRef, type Registry, type Side } from "../game/types";
import { isPlainObject } from "../project/kinds/define";
import { transformGrid, type GridCells } from "./grid";
import { fieldKind, geometryFields, unwrapSchema } from "./schema";
import { mirrorDeg, normDeg } from "./shape-geometry";
import {
  applyPt,
  applyVec,
  dihedralOf,
  frameOf,
  translation,
  type Orientation,
  type Transform2D,
} from "./transform";
import type { BulkEntry, EntityDef, PathDef, Pt, ShapeTuple } from "./types";
import { roundLength } from "./units";

export const isPt = (v: unknown): v is Pt =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");

/** `t` without its translation. */
export const linearPart = (t: Transform2D): Transform2D => ({ ...t, tx: 0, ty: 0 });

/** The kinds that carry a position: what a translation moves. */
export type GeometryKind = "shape" | "point" | "path";

/** Every kind a transform acts on; anything else is a plain value it leaves alone. */
type TransformKind = GeometryKind | "vector" | "angle" | "mirror" | "side" | "grid";

const TRANSFORM_KINDS: readonly string[] = [
  "shape",
  "point",
  "path",
  "vector",
  "angle",
  "mirror",
  "side",
  "grid",
] satisfies TransformKind[];

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export const addPt = (p: Pt, [dx, dy]: Pt): Pt => [roundLength(p[0] + dx), roundLength(p[1] + dy)];
export const subPt = (p: Pt, [dx, dy]: Pt): Pt => [roundLength(p[0] - dx), roundLength(p[1] - dy)];

/** `p` under `t`, kept to the file's length precision so a move and its inverse round-trip. */
const placePt = (t: Transform2D, p: Pt): Pt => {
  const [x, y] = applyPt(t, p);
  return [roundLength(x), roundLength(y)];
};
export const isZeroPt = ([x, y]: Pt) => x === 0 && y === 0;

const isShapeTuple = (v: unknown): v is ShapeTuple => Array.isArray(v) && typeof v[0] === "string";

const isIdentityTurn = (o: Orientation) => o.rot === 0 && !o.flip;

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9;

/** `t`'s angle and flip; a transform that scales or shears has none, and is refused. */
function orientationOf(t: Transform2D): Orientation {
  const rigid =
    near(t.a * t.a + t.b * t.b, 1) &&
    near(t.c * t.c + t.d * t.d, 1) &&
    near(t.a * t.c + t.b * t.d, 0);
  if (!rigid)
    throw new Error("a scene transform must be turns and flips: quarter turns or any angle");
  return frameOf(t);
}

/** Whether `t`'s linear part is quarter turns and flips, which keep whole numbers whole. */
const isQuarter = (t: Transform2D) => dihedralOf(t) !== null;

/** Off the quarter turns, an angle is kept to the micro-degree, as lengths are to the micrometre. */
const roundOff = (deg: number, t: Transform2D) => (isQuarter(t) ? deg : roundLength(deg));

/** An angle in degrees after `o`: negated by a flip, then plus the turn (not wrapped). */
const turnAngle = (deg: number, o: Orientation) => (o.flip ? mirrorDeg(deg) : deg) + o.rot;

/** A shape's `rotDeg` after `t`, kept in [0, 360). */
const turnRotDeg = (deg: number, t: Transform2D) => {
  const r = roundOff(normDeg(turnAngle(deg, orientationOf(t))), t);
  return r === 360 ? 0 : r;
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
      pts.push(placePt(t, [out[i] as number, out[i + 1] as number]));
    }
    // A flip reverses the points to keep the winding, as `flipShapeX` does.
    if (t.a * t.d - t.b * t.c < 0) pts.reverse();
    return [tuple[0], ...pts.flat()] as ShapeTuple;
  }
  const [cx, cy] = placePt(t, [out[1] as number, out[2] as number]);
  out[1] = cx;
  out[2] = cy;
  if (tuple[0] === "box" || tuple[0] === "capsule") {
    if (!isIdentityTurn(orientationOf(t))) {
      const rotDeg = turnRotDeg(out.length > 5 ? (out[5] as number) : 0, t);
      if (rotDeg === 0) out.length = 5;
      else out[5] = rotDeg;
    }
  }
  return out as ShapeTuple;
}

export function translateTuple(t: ShapeTuple, by: Pt): ShapeTuple {
  return transformTuple(t, translation(by));
}

/** A bulk entry under `t`: a shape tuple or a point. */
export function transformBulkEntry(value: BulkEntry, t: Transform2D): BulkEntry {
  return isShapeTuple(value) ? transformTuple(value, t) : placePt(t, value as Pt);
}

/** A bulk entry moved by `by`: a shape tuple or a point. */
export function translateBulkEntry(value: BulkEntry, by: Pt): BulkEntry {
  return transformBulkEntry(value, translation(by));
}

const SIDE_VECTORS: Record<Side, Pt> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };

const isSide = (v: unknown): v is Side => SIDES.includes(v as Side);

/**
 * A side under `t`; `true` (`"up"`) stays `true` while it still faces up.
 * A side turns only by quarter turns: under any other angle it is left as
 * it is (validation reports it).
 */
function transformSide(value: Side | true, t: Transform2D): Side | true {
  if (!isQuarter(t) || isIdentityTurn(orientationOf(t))) return value;
  const [x, y] = applyVec(t, SIDE_VECTORS[value === true ? "up" : value]);
  const side = SIDES.find((s) => SIDE_VECTORS[s][0] === x && SIDE_VECTORS[s][1] === y) ?? "up";
  return value === true && side === "up" ? true : side;
}

function transformPath(p: PathDef, t: Transform2D): PathDef {
  return Array.isArray(p.pts) ? { ...p, pts: p.pts.map((q) => (isPt(q) ? placePt(t, q) : q)) } : p;
}

function transformByKind(kind: string, value: unknown, t: Transform2D): unknown {
  switch (kind) {
    case "shape":
      return isShapeTuple(value) ? transformTuple(value, t) : value;
    case "point":
      return isPt(value) ? placePt(t, value) : value;
    case "path":
      return value !== null && typeof value === "object" && "pts" in value
        ? transformPath(value as PathDef, t)
        : value;
    case "vector": {
      if (!isPt(value)) return value;
      const v = applyVec(t, value);
      return isQuarter(t) ? v : [roundLength(v[0]), roundLength(v[1])];
    }
    case "angle":
      return typeof value === "number" ? roundOff(turnAngle(value, orientationOf(t)), t) : value;
    case "mirror":
      return typeof value === "boolean" && orientationOf(t).flip ? !value : value;
    case "side":
      return value === true || isSide(value) ? transformSide(value, t) : value;
    case "grid": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
      // Cells turn only by quarter turns; under any other angle they stay (validation reports it).
      const d = dihedralOf(t);
      return !d || (d.rot === 0 && !d.flip) ? value : transformGrid(value as GridCells, d);
    }
    default:
      return value;
  }
}

/**
 * One whole field value under `t`, a rigid transform at any angle, by what
 * its schema says it holds: shapes, points and paths move; vectors turn and
 * flip but never move; angles gain the turn and negate under a flip; mirror
 * booleans toggle under a flip; sides and grids turn and flip only by
 * quarter turns and stay as they are under any other angle. Off the quarter
 * turns, lengths and angles are rounded to the file's precision. Anything
 * else, and any value not shaped like its kind, comes back as given.
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

/** A behavior field holding a world position, which moves, turns and flips with its entity. */
export type BehaviorGeometry = { behavior: string; field: string; kind: "point" | "path" };

/**
 * The points and paths of the behavior blocks `def` writes. A behavior's
 * vectors, angles and shapes are local to the entity's pose, which carries
 * its turn and flip, so only these are world positions.
 */
export function behaviorGeometry(registry: Registry, def: EntityDef): BehaviorGeometry[] {
  const blocks = def[BEHAVIORS_FIELD];
  if (!isPlainObject(blocks)) return [];
  const out: BehaviorGeometry[] = [];
  for (const [behavior, block] of Object.entries(blocks)) {
    const shape = registry.behaviors.get(behavior)?.shape;
    if (!shape || !isPlainObject(block)) continue;
    for (const [field, schema] of Object.entries(shape)) {
      const kind = placedKind(schema, block[field]);
      if (kind) out.push({ behavior, field, kind });
    }
  }
  return out;
}

/**
 * Whether `value` is a point or a path a behavior field places with its
 * entity: the field's own kind, or, for a union (`nav-agent.to`, a point or
 * an entity), the kind of the point or path arm `value` is.
 */
function placedKind(schema: z.core.$ZodType, value: unknown): "point" | "path" | undefined {
  if (value === undefined) return undefined;
  const kind = fieldKind(schema);
  if (kind === "point" || kind === "path") return kind;
  const inner = unwrapSchema(schema);
  if (kind !== "value" || !(inner instanceof z.ZodUnion)) return undefined;
  for (const arm of inner.options) {
    const k = fieldKind(arm);
    if ((k === "point" || k === "path") && z.safeParse(arm, value).success) return k;
  }
  return undefined;
}

/** `def`'s behavior points and paths under `t`, in place. */
function transformBehaviorGeometry(registry: Registry, def: EntityDef, t: Transform2D): boolean {
  const sites = behaviorGeometry(registry, def);
  for (const { behavior, field, kind } of sites) {
    const block = (def[BEHAVIORS_FIELD] as Record<string, Record<string, unknown>>)[behavior]!;
    block[field] = transformByKind(kind, block[field], t);
  }
  return sites.length > 0;
}

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
  const behaviors = behaviorGeometry(registry, def).length > 0;
  if (fields.length === 0 && !behaviors) return null;
  const local = fields.some((f) => f.kind === "path") ? linearPart(t) : t;
  const next = clone(def);
  for (const { field, kind } of fields) {
    next[field] = transformByKind(kind, next[field], kind === "shape" ? local : t);
  }
  if (behaviors) transformBehaviorGeometry(registry, next, t);
  return next;
}

/**
 * `def` moved by `by`, a copy: its type's shapes, points and paths (a path
 * rider's shapes stay local to its path) and its behavior blocks' points
 * and paths, each rounded to the file's length precision. `null` when it
 * has no position to move. Places a template def, written around the
 * origin, at a point.
 */
export function translateEntityDef(registry: Registry, def: EntityDef, by: Pt): EntityDef | null {
  if (movableGeometry(registry, def).length === 0 && behaviorGeometry(registry, def).length === 0)
    return null;
  return transformEntityDef(registry, def, translation(by));
}

/**
 * The value an update sets at `path` on `def`, moved by `by` when the path
 * lands on movable geometry: a whole shape, point or path of its type or of
 * a behavior block (`behaviors.<name>.<field>`), a path's `pts`, or one of
 * its points. Anything else comes back as given.
 */
export function translateFieldValue(
  registry: Registry,
  def: EntityDef,
  path: string,
  value: unknown,
  by: Pt,
): unknown {
  if (isZeroPt(by)) return value;
  const all = path.split(".");
  const inBehavior = all[0] === BEHAVIORS_FIELD;
  const shape = inBehavior
    ? registry.behaviors.get(all[1] ?? "")?.shape
    : registry.types.get(def.type)?.shape;
  const segs = inBehavior ? all.slice(2) : all;
  const field = segs[0] ?? "";
  const schema = shape && Object.hasOwn(shape, field) ? shape[field] : undefined;
  if (!schema) return value;
  const kind: string = inBehavior ? (placedKind(schema, value) ?? "value") : fieldKind(schema);
  if (!isGeometryKind(kind) || (inBehavior && kind === "shape")) return value;
  const t = translation(by);
  if (segs.length === 1) {
    if (kind === "shape" && presentGeometry(registry, def).some((f) => f.kind === "path")) {
      return value;
    }
    return transformByKind(kind, value, t);
  }
  if (kind !== "path" || segs[1] !== "pts") return value;
  if (segs.length === 2 && Array.isArray(value)) {
    return value.map((q) => (isPt(q) ? placePt(t, q) : q));
  }
  if (segs.length === 3 && isPt(value)) return placePt(t, value);
  return value;
}

/** Whether `schema` holds an entity's id or an instance child's ref (`refField`), alone or as one arm of a union. */
export function holdsEntityRef(schema: z.core.$ZodType): boolean {
  const inner = unwrapSchema(schema);
  if (inner instanceof z.ZodUnion) return inner.options.some((o) => holdsEntityRef(o));
  if (!(inner instanceof z.ZodString)) return false;
  const patterns = (inner._zod.bag as { patterns?: Set<RegExp> }).patterns;
  return [...(patterns ?? [])].some((p) => p.source === CHILD_REF_PATTERN.source);
}

/**
 * `def` with each entity reference in its behavior blocks rewritten by
 * `scopedRef` against `has`, so an instance child names its siblings by
 * their ids; `def` itself when none changes.
 */
export function scopeBehaviorRefs(
  registry: Registry,
  def: EntityDef,
  has: (id: string) => boolean,
): EntityDef {
  const blocks = def[BEHAVIORS_FIELD];
  if (!isPlainObject(blocks) || !def.id.includes("/")) return def;
  let out: Record<string, unknown> | null = null;
  for (const [behavior, block] of Object.entries(blocks)) {
    const shape = registry.behaviors.get(behavior)?.shape;
    if (!shape || !isPlainObject(block)) continue;
    for (const [field, schema] of Object.entries(shape)) {
      const value = block[field];
      if (value === undefined || !holdsEntityRef(schema)) continue;
      const scope = (v: unknown) => (typeof v === "string" ? scopedRef(def.id, v, has) : v);
      const next = Array.isArray(value) ? value.map(scope) : scope(value);
      if (JSON.stringify(next) === JSON.stringify(value)) continue;
      out ??= clone(blocks);
      (out[behavior] as Record<string, unknown>)[field] = next;
    }
  }
  return out ? { ...def, [BEHAVIORS_FIELD]: out } : def;
}

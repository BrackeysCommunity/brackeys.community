import type { z } from "zod";

import { BEHAVIORS_FIELD } from "../game/behaviors";
import { DEFAULT_LENGTH_UNIT } from "../game/defaults";
import { isPolygonField } from "../game/fields";
import { NODE_TYPE } from "../game/primitives";
import type { Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { takenIds } from "./fragment";
import { jsonPointer, makeIssue } from "./issues";
import { canBeInTree } from "./nav-type";
import { fieldKind, geometryFields } from "./schema";
import { cross3, earClip, isConvex, isSimplePolygon, signedArea2 } from "./shape-geometry";
import { parseShape } from "./shapes";
import { holdsEntityRef } from "./translate";
import type {
  EntityDef,
  EntityInput,
  OpBatch,
  Pt,
  SceneDefinition,
  SceneIssue,
  SceneOp,
  ShapeTuple,
} from "./types";
import { roundLength } from "./units";

export type DecomposeResult =
  | {
      ok: true;
      pieces: readonly Pt[][];
      /** Twice the area, in world px²: an integer for whole-px input. */
      area2: number;
      /** Each piece's twice-area, in the same px²; they sum to `area2`. */
      pieceArea2: readonly number[];
    }
  | { ok: false; issue: SceneIssue };

type DecomposeOptions = {
  /** The most vertices a piece may have; default 8. */
  maxVertices?: number;
  /** The game's px per metre the points are snapped to; default the engine's. */
  pxPerMetre?: number;
};

const DEFAULT_MAX_VERTICES = 8;

const toPx = (pts: readonly Pt[], ppm: number): Pt[] =>
  pts.map(([x, y]): Pt => [Math.round(x * ppm) + 0, Math.round(y * ppm) + 0]);

const finitePts = (pts: readonly Pt[]) =>
  pts.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));

/** Whether `points` (metres) is a simple polygon with area that isn't already convex, judged on whole world px. */
export function canDecompose(points: readonly Pt[], opts?: { pxPerMetre?: number }): boolean {
  if (!finitePts(points)) return false;
  const px = toPx(points, opts?.pxPerMetre ?? DEFAULT_LENGTH_UNIT);
  return isSimplePolygon(px) && !isConvex(px);
}

/** Merges two convex index rings across their shared edge `a`–`b`. */
function mergeRings(left: readonly number[], right: readonly number[], a: number, b: number) {
  // `left` runs a→b, `right` runs b→a (both counter-clockwise).
  const rot = (ring: readonly number[], start: number) => {
    const k = ring.indexOf(start);
    return [...ring.slice(k), ...ring.slice(0, k)];
  };
  const l = rot(left, b);
  const r = rot(right, a);
  return [...l, ...r.slice(1, -1)];
}

/** Whether `ring` holds the directed edge `a`→`b`. */
const runs = (ring: readonly number[], a: number, b: number) => {
  const k = ring.indexOf(a);
  return k >= 0 && ring[(k + 1) % ring.length] === b;
};

/**
 * Ear clipping, then Hertel–Mehlhorn merging into convex pieces of at most
 * `maxVertices` (default 8), using only the original vertices. Points are
 * metres, snapped to whole world px at `pxPerMetre` so every test is an
 * exact integer cross product; pieces come back in metres wound as the
 * input is.
 */
export function decomposePolygon(points: readonly Pt[], opts?: DecomposeOptions): DecomposeResult {
  const ppm = opts?.pxPerMetre ?? DEFAULT_LENGTH_UNIT;
  const maxVertices = Math.max(3, opts?.maxVertices ?? DEFAULT_MAX_VERTICES);
  const refuse = (why: string): DecomposeResult => ({
    ok: false,
    issue: makeIssue("poly-invalid", { message: `The polygon can't be split: ${why}` }),
  });
  if (points.length < 3) return refuse("it has fewer than 3 points.");
  if (!finitePts(points)) return refuse("a point isn't a finite number.");
  const input = toPx(points, ppm);
  const area2 = signedArea2(input);
  if (area2 === 0) return refuse("it has zero area.");
  if (!isSimplePolygon(input)) return refuse("its edges cross or touch.");

  const flipped = area2 < 0;
  const px = flipped ? [...input].reverse() : input;
  const indexOf = new Map(px.map((p, i) => [`${p[0]},${p[1]}`, i]));
  const idx = (p: Pt) => indexOf.get(`${p[0]},${p[1]}`)!;

  // Pieces start as the ear clipper's triangles, in its order.
  const rings: (number[] | null)[] = earClip(px).map(([a, b, c]) => [idx(a), idx(b), idx(c)]);
  const diagonals: [number, number][] = [];
  const seen = new Set<string>();
  for (const ring of rings) {
    for (let k = 0; k < 3; k++) {
      const a = ring![k]!;
      const b = ring![(k + 1) % 3]!;
      const n = px.length;
      if ((a + 1) % n === b || (b + 1) % n === a) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagonals.push(a < b ? [a, b] : [b, a]);
    }
  }

  const convexAt = (ring: readonly number[], v: number) => {
    const k = ring.indexOf(v);
    const n = ring.length;
    return cross3(px[ring[(k + n - 1) % n]!]!, px[v]!, px[ring[(k + 1) % n]!]!) >= 0;
  };
  for (const [u, v] of diagonals) {
    const li = rings.findIndex((r) => r !== null && runs(r, u, v));
    const ri = rings.findIndex((r) => r !== null && runs(r, v, u));
    if (li < 0 || ri < 0 || li === ri) continue;
    const merged = mergeRings(rings[li]!, rings[ri]!, u, v);
    if (merged.length > maxVertices || !convexAt(merged, u) || !convexAt(merged, v)) continue;
    rings[Math.min(li, ri)] = merged;
    rings[Math.max(li, ri)] = null;
  }

  const pieces: Pt[][] = [];
  const pieceArea2: number[] = [];
  for (const ring of rings) {
    if (ring === null) continue;
    let pts = ring.map((i) => px[i]!);
    if (!isConvex(pts))
      pts = pts.filter(
        (p, k) =>
          cross3(pts[(k + pts.length - 1) % pts.length]!, p, pts[(k + 1) % pts.length]!) !== 0,
      );
    pieceArea2.push(signedArea2(pts));
    const out = pts.map(([x, y]): Pt => [roundLength(x / ppm), roundLength(y / ppm)]);
    pieces.push(flipped ? out.reverse() : out);
  }
  return { ok: true, pieces, area2: Math.abs(area2), pieceArea2 };
}

/** One shape-valued field an entity writes: on its type, or in one of its behavior blocks. */
export type ShapeSite = {
  /** The dot path an `update` op sets: `shape`, `behaviors.collider.shape`. */
  field: string;
  /** Its JSON pointer below the entity. */
  pointer: string;
  value: ShapeTuple;
  schema: z.core.$ZodType;
  /** Whether it sits in a behavior block, local to the entity's pose. */
  behavior: boolean;
};

/**
 * The shape fields entity `e` writes: its type's geometry fields of the
 * shape kind, then each behavior block it writes, in registry order.
 */
export function entityShapeSites(registry: Registry, e: EntityDef): ShapeSite[] {
  const type = registry.types.get(e.type);
  if (!type) return [];
  const out: ShapeSite[] = [];
  for (const { field, kind } of geometryFields(type)) {
    const value = e[field];
    const schema = type.shape[field];
    if (kind !== "shape" || !Array.isArray(value) || !schema) continue;
    out.push({
      field,
      pointer: jsonPointer([field]),
      value: value as ShapeTuple,
      schema,
      behavior: false,
    });
  }
  const blocks = e[BEHAVIORS_FIELD];
  if (blocks === null || typeof blocks !== "object" || Array.isArray(blocks)) return out;
  const allowed = registry.behaviorRules(e.type).allowed;
  for (const name of registry.behaviorNames) {
    const block = (blocks as Record<string, unknown>)[name];
    const behavior = registry.behaviors.get(name);
    if (!behavior || !allowed.includes(name) || block === null || typeof block !== "object")
      continue;
    for (const [field, schema] of Object.entries(behavior.shape)) {
      const value = (block as Record<string, unknown>)[field];
      if (!Array.isArray(value) || fieldKind(schema) !== "shape") continue;
      out.push({
        field: `${BEHAVIORS_FIELD}.${name}.${field}`,
        pointer: jsonPointer([BEHAVIORS_FIELD, name, field]),
        value: value as ShapeTuple,
        schema,
        behavior: true,
      });
    }
  }
  return out;
}

/** A shape site "Split into convex pieces" splits, with its poly's points (m). */
export type SplittableSite = ShapeSite & { pts: Pt[] };

/**
 * The shape `decomposeBatch` splits on entity `e`: its first poly, over
 * `entityShapeSites`, that may not be concave (a polygon field may) and that
 * `canDecompose` holds for at the game's px per metre; null when none.
 */
export function splittableSite(registry: Registry, e: EntityDef): SplittableSite | null {
  const ppm = pxPerMetreOf(registry);
  for (const site of entityShapeSites(registry, e)) {
    if (isPolygonField(site.schema)) continue;
    const parsed = parseShape(site.value);
    if (!parsed.ok || parsed.shape.type !== "poly") continue;
    if (canDecompose(parsed.shape.pts, { pxPerMetre: ppm }))
      return { ...site, pts: parsed.shape.pts };
  }
  return null;
}

/** The fields of entity `e` (type refs, then behavior fields) that name entity `id`, as dot-path segments. */
export function entityRefSites(
  registry: Registry,
  e: EntityDef,
  id: string,
): { segs: string[]; value: unknown }[] {
  const names = (value: unknown) => value === id || (Array.isArray(value) && value.includes(id));
  const out: { segs: string[]; value: unknown }[] = [];
  for (const { field } of registry.types.get(e.type)?.refs ?? []) {
    const segs = field.split(".");
    let value: unknown = e;
    for (const seg of segs)
      value =
        value !== null && typeof value === "object"
          ? (value as Record<string, unknown>)[seg]
          : undefined;
    if (names(value)) out.push({ segs, value });
  }
  const blocks = e[BEHAVIORS_FIELD];
  if (blocks === null || typeof blocks !== "object" || Array.isArray(blocks)) return out;
  for (const [behavior, block] of Object.entries(blocks as Record<string, unknown>)) {
    const shape = registry.behaviors.get(behavior)?.shape;
    if (!shape || block === null || typeof block !== "object" || Array.isArray(block)) continue;
    for (const [field, schema] of Object.entries(shape)) {
      const value = (block as Record<string, unknown>)[field];
      if (holdsEntityRef(schema) && names(value))
        out.push({ segs: [BEHAVIORS_FIELD, behavior, field], value });
    }
  }
  return out;
}

/** `entity` with the dot path `field` set to `value`, cloned along the way. */
function withField(entity: EntityDef, field: string, value: unknown): EntityDef {
  const segs = field.split(".");
  const out = structuredClone(entity) as Record<string, unknown>;
  let at = out;
  for (const s of segs.slice(0, -1)) at = at[s] as Record<string, unknown>;
  at[segs[segs.length - 1]!] = value;
  return out as EntityDef;
}

/**
 * The batch replacing `id`'s splittable poly (`splittableSite`) with one entity per
 * piece, ids `<id>-n`, or a `group` node named `id` holding them; children move with it.
 */
export function decomposeBatch(
  def: SceneDefinition,
  id: string,
  registry: Registry,
  opts?: { group?: boolean },
): { ok: true; batch: OpBatch } | { ok: false; issue: SceneIssue } {
  const entities = def.entities ?? [];
  const index = entities.findIndex((e) => e.id === id);
  const entity = entities[index];
  if (!entity)
    return {
      ok: false,
      issue: makeIssue("ref-not-found", {
        message: `There's no entity "${id}" to split.`,
        entityIds: [id],
      }),
    };
  const site = splittableSite(registry, entity);
  const at = jsonPointer(["entities", index]);
  if (!site)
    return {
      ok: false,
      issue: makeIssue("poly-invalid", {
        message: `${id} has no simple concave poly to split into convex pieces.`,
        path: at,
        entityIds: [id],
      }),
    };
  const result = decomposePolygon(site.pts, { pxPerMetre: pxPerMetreOf(registry) });
  if (!result.ok)
    return {
      ok: false,
      issue: { ...result.issue, path: `${at}${site.pointer}`, entityIds: [id] },
    };
  // The pieces take new ids, so a ref to `id` would dangle or name a bodiless group.
  const referrers = entities
    .filter((e) => e.id !== id && entityRefSites(registry, e, id).length > 0)
    .map((e) => e.id);
  if (referrers.length > 0)
    return {
      ok: false,
      issue: makeIssue("op-invalid", {
        message: `${id} can't split while ${referrers.join(", ")} ${referrers.length === 1 ? "names" : "name"} it; point ${referrers.length === 1 ? "that ref" : "those refs"} at another entity first.`,
        path: at,
        entityIds: [id, ...referrers],
      }),
    };

  if (opts?.group === true && !canBeInTree(registry.types.get(entity.type)))
    return {
      ok: false,
      issue: makeIssue("parent-type", {
        message: `${id} is a ${entity.type}, which can't be in the tree, so its pieces can't be grouped; split it without a group.`,
        path: at,
        entityIds: [id],
      }),
    };
  const group = opts?.group === true && registry.types.has(NODE_TYPE);
  const taken = takenIds(def);
  taken.delete(id);
  const ids: string[] = [];
  for (let n = 1; ids.length < result.pieces.length; n++) {
    const next = `${id}-${n}`;
    if (!taken.has(next)) ids.push(next);
  }
  const parent = entity.parent;
  const children = entities
    .filter((e) => e.parent === id && e.id !== id)
    .map((e) => e.id)
    .concat((def.instances ?? []).filter((i) => i.parent === id).map((i) => i.id));

  const ops: SceneOp[] = [];
  if (children.length > 0) ops.push({ op: "reparent", refs: children, parent: parent ?? null });
  ops.push({ op: "remove", refs: [id] });
  let slot = index;
  if (group) {
    const node: EntityInput = { id, type: NODE_TYPE, at: [0, 0] };
    if (parent !== undefined) node.parent = parent;
    ops.push({ op: "add", entity: node, index: slot++ });
  }
  result.pieces.forEach((piece, k) => {
    const shape = ["poly", ...piece.flat()] as ShapeTuple;
    const e = withField(entity, site.field, shape) as EntityInput;
    e.id = ids[k]!;
    if (group) e.parent = id;
    ops.push({ op: "add", entity: e, index: slot++ });
  });
  if (group && children.length > 0) ops.push({ op: "reparent", refs: children, parent: id });
  const into = `${result.pieces.length} convex pieces`;
  return {
    ok: true,
    batch: {
      label: group ? `Split ${id} into a group of ${into}` : `Split ${id} into ${into}`,
      ops,
    },
  };
}

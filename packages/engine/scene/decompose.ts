import type { z } from "zod";

import { BEHAVIORS_FIELD } from "../game/behaviors";
import { DEFAULT_LENGTH_UNIT } from "../game/defaults";
import { NODE_TYPE } from "../game/primitives";
import type { Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { takenIds } from "./fragment";
import { jsonPointer, makeIssue } from "./issues";
import { canBeInTree } from "./nav-type";
import { fieldKind, geometryFields } from "./schema";
import { cross3, earClip, isConvex, isSimplePolygon } from "./shape-geometry";
import { parseShape } from "./shapes";
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

/** Twice the signed area, summed in integers for integer points. */
function area2Of(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a;
}

const finitePts = (pts: readonly Pt[]) =>
  pts.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));

/** Whether whole-px `px` is a simple polygon with area: what decomposition needs. */
const decomposable = (px: readonly Pt[]) => px.length >= 3 && isSimplePolygon(px);

/**
 * Whether `points` (metres) is a simple polygon with area that isn't already
 * convex, judged on whole world px: the one rule for offering "Split into
 * convex pieces".
 */
export function canDecompose(points: readonly Pt[], opts?: { pxPerMetre?: number }): boolean {
  if (points.length < 3 || !finitePts(points)) return false;
  const px = toPx(points, opts?.pxPerMetre ?? DEFAULT_LENGTH_UNIT);
  return decomposable(px) && !isConvex(px);
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
 * exact integer cross product; pieces come back in metres (`roundLength`)
 * wound as the input is. A self-intersecting, zero-area or under-3-point
 * polygon is `poly-invalid`.
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
  if (area2Of(input) === 0) return refuse("it has zero area.");
  if (!decomposable(input)) return refuse("its edges cross or touch.");

  const flipped = area2Of(input) < 0;
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

  const pieces = rings
    .filter((r): r is number[] => r !== null)
    .map((ring) => {
      let pts = ring.map((i) => px[i]!);
      if (!isConvex(pts))
        pts = pts.filter(
          (p, k) =>
            cross3(pts[(k + pts.length - 1) % pts.length]!, p, pts[(k + 1) % pts.length]!) !== 0,
        );
      const out = pts.map(([x, y]): Pt => [roundLength(x / ppm), roundLength(y / ppm)]);
      return flipped ? out.reverse() : out;
    });
  return { ok: true, pieces, area2: Math.abs(area2Of(input)) };
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
 * The op batch that replaces entity `id`'s concave `poly` shape with one
 * entity per piece (same type and fields, ids `<id>-1`…, skipping ids
 * taken), or with `group` a node named `id` holding them. The shape is the
 * first concave poly among the entity's shape fields (`entityShapeSites`).
 * Children of `id` move to its parent, or under the group. Refuses with
 * `ref-not-found` for no such entity, `poly-invalid` when it has no
 * shape `decomposePolygon` can split, and `parent-type` for `group` on a
 * type that can't be in the tree.
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
  const ppm = pxPerMetreOf(registry);
  const site = entityShapeSites(registry, entity).find((s) => {
    const parsed = parseShape(s.value);
    return (
      parsed.ok &&
      parsed.shape.type === "poly" &&
      canDecompose(parsed.shape.pts, { pxPerMetre: ppm })
    );
  });
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
  const parsed = parseShape(site.value);
  const pts = parsed.ok && parsed.shape.type === "poly" ? parsed.shape.pts : [];
  const result = decomposePolygon(pts, { pxPerMetre: ppm });
  if (!result.ok)
    return {
      ok: false,
      issue: { ...result.issue, path: `${at}${site.pointer}`, entityIds: [id] },
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

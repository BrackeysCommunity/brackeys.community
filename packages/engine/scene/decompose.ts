import type { z } from "zod";

import { BEHAVIORS_FIELD } from "../game/behaviors";
import { BODY } from "../game/behaviors/body";
import { COLLIDER } from "../game/behaviors/collider";
import { DEFAULT_LENGTH_UNIT } from "../game/defaults";
import { isPolygonField } from "../game/fields";
import { NODE_TYPE } from "../game/primitives";
import type { Registry } from "../game/types";
import { pxPerMetreOf } from "../game/units";
import { refFields, setAt, takenIds } from "./fragment";
import { jsonPointer, makeIssue } from "./issues";
import { canBeInTree } from "./nav-type";
import { entityFrame } from "./resolve";
import { fieldKind, geometryFields } from "./schema";
import { cross3, earClip, isConvex, isSimplePolygon, signedArea2 } from "./shape-geometry";
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
import { isWholePixel } from "./units";

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

export type DecomposeOptions = {
  /** The most vertices a piece may have; default 8. */
  maxVertices?: number;
  /** The game's px per metre, whose whole px every point must sit on; default the engine's. */
  pxPerMetre?: number;
};

const DEFAULT_MAX_VERTICES = 8;

const toPx = (pts: readonly Pt[], ppm: number): Pt[] =>
  pts.map(([x, y]): Pt => [Math.round(x * ppm) + 0, Math.round(y * ppm) + 0]);

const finitePts = (pts: readonly Pt[]) =>
  pts.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));

const onWholePx = (pts: readonly Pt[], ppm: number) =>
  pts.every(([x, y]) => isWholePixel(x, ppm) && isWholePixel(y, ppm));

/**
 * Whether `points` (metres) is a polygon `decomposePolygon` splits that isn't
 * already convex.
 */
export function canDecompose(points: readonly Pt[], opts?: { pxPerMetre?: number }): boolean {
  const ppm = opts?.pxPerMetre ?? DEFAULT_LENGTH_UNIT;
  if (!finitePts(points) || !onWholePx(points, ppm)) return false;
  const px = toPx(points, ppm);
  return isSimplePolygon(px) && !isConvex(px) && decomposePolygon(points, opts).ok;
}

/** Rapier drops a corner turning under ~1.5° (parry's sqrt(f32::EPSILON)) and refuses a triangle that loses one. */
const RAPIER_MIN_TURN = Math.sqrt(2 ** -23);

function rapierKeeps(a: Pt, b: Pt, c: Pt): boolean {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  return (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)) <= 1 - RAPIER_MIN_TURN;
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

type Tri = [number, number, number];

/** Whether `d` lies strictly inside the circle through the positively wound `a`, `b`, `c`. */
function inCircle(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const ax = a[0] - d[0];
  const ay = a[1] - d[1];
  const bx = b[0] - d[0];
  const by = b[1] - d[1];
  const cx = c[0] - d[0];
  const cy = c[1] - d[1];
  return (
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
      (bx * bx + by * by) * (ax * cy - cx * ay) +
      (cx * cx + cy * cy) * (ax * by - bx * ay) >
    0
  );
}

/**
 * Flips diagonals of the triangulation of `px` until it's constrained
 * Delaunay, which leaves no flat triangle the polygon doesn't force. A
 * diagonal flips only inside a strictly convex quad, so the triangles stay
 * inside the polygon and their areas still sum to its.
 */
function delaunayFlips(px: readonly Pt[], tris: Tri[]): Tri[] {
  const n = px.length;
  // Directed edge a→b (as a * n + b) to the triangle that runs it.
  const owner = new Map<number, number>();
  const own = (t: Tri, i: number) => {
    for (let k = 0; k < 3; k++) owner.set(t[k]! * n + t[(k + 1) % 3]!, i);
  };
  tris.forEach(own);
  for (let pass = 0, flipped = true; flipped && pass < n * n; pass++) {
    flipped = false;
    for (let i = 0; i < tris.length; i++)
      for (let k = 0; k < 3; k++) {
        const [a, b, c] = [tris[i]![k]!, tris[i]![(k + 1) % 3]!, tris[i]![(k + 2) % 3]!];
        if ((a + 1) % n === b || (b + 1) % n === a) continue;
        const j = owner.get(b * n + a);
        if (j === undefined || j === i) continue;
        const u = tris[j]!;
        const d = u[(u.indexOf(b) + 2) % 3]!;
        if (cross3(px[c]!, px[a]!, px[d]!) <= 0 || cross3(px[d]!, px[b]!, px[c]!) <= 0) continue;
        if (!inCircle(px[a]!, px[b]!, px[c]!, px[d]!)) continue;
        owner.delete(a * n + b);
        owner.delete(b * n + a);
        tris[i] = [a, d, c];
        tris[j] = [d, b, c];
        own(tris[i]!, i);
        own(tris[j]!, j);
        flipped = true;
      }
  }
  return tris;
}

/**
 * Ear clipping (made Delaunay when its own triangles leave a sliver), then
 * Hertel–Mehlhorn merging into convex pieces of at most `maxVertices`
 * (default 8), using only the original vertices. Points are metres on whole
 * world px at `pxPerMetre`, so every convexity test is an exact integer cross
 * product. Refused: a point off that grid (snap it first, rather than have it
 * moved), and a polygon whose pieces would still hold a sliver Rapier cuts
 * away, a corner within about 1.5° of straight that isn't one of the input's
 * own (Rapier drops those from any poly). Pieces hold the caller's own
 * points, wound as the input is.
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
  if (!onWholePx(points, ppm))
    return refuse(`a point isn't on a whole world pixel at ${ppm} px per metre; snap it first.`);
  const input = toPx(points, ppm);
  const area2 = signedArea2(input);
  if (area2 === 0) return refuse("it has zero area.");
  if (!isSimplePolygon(input)) return refuse("its edges cross or touch.");

  const flipped = area2 < 0;
  const px = flipped ? [...input].reverse() : input;
  const original = flipped ? [...points].reverse() : points;
  const indexOf = new Map(px.map((p, i) => [`${p[0]},${p[1]}`, i]));
  const idx = (p: Pt) => indexOf.get(`${p[0]},${p[1]}`)!;

  const tris = earClip(px).map(([a, b, c]): Tri => [idx(a), idx(b), idx(c)]);
  // Delaunay flips only when the ear clipper's own triangles leave a sliver, so other splits keep their pieces.
  const rings =
    convexPieces(px, tris, maxVertices) ??
    convexPieces(
      px,
      delaunayFlips(
        px,
        tris.map((t): Tri => [...t]),
      ),
      maxVertices,
    );
  if (!rings)
    return refuse(
      "it's too thin in places: a piece would hold a sliver Rapier cuts away, a corner within about 1.5° of straight. Move apart the points that nearly meet, or split it by hand.",
    );
  const pieces = rings.map((ring) => {
    const out = ring.map((i): Pt => [original[i]![0], original[i]![1]]);
    return flipped ? out.reverse() : out;
  });
  const pieceArea2 = rings.map((ring) => signedArea2(ring.map((i) => px[i]!)));
  const covered = pieceArea2.reduce((sum, a) => sum + a, 0);
  if (covered !== Math.abs(area2))
    return refuse(
      `its pieces cover ${covered / 2} px² of its ${Math.abs(area2) / 2} px²; split it by hand.`,
    );
  return { ok: true, pieces, area2: Math.abs(area2), pieceArea2 };
}

/**
 * Hertel–Mehlhorn over `tris` (index triangles of the positively wound `px`,
 * in order): each diagonal is removed when the merged piece stays convex,
 * within `maxVertices`, with no new corner Rapier would drop. Pieces come back
 * as index rings with dead-straight corners left out; null when one would
 * hold a sliver Rapier cuts away.
 */
function convexPieces(
  px: readonly Pt[],
  tris: readonly Tri[],
  maxVertices: number,
): number[][] | null {
  const n = px.length;
  const rings: (number[] | null)[] = tris.map((t) => [...t]);
  const diagonals: [number, number][] = [];
  const seen = new Set<string>();
  for (const [a0, b0, c0] of tris) {
    for (const [a, b] of [
      [a0, b0],
      [b0, c0],
      [c0, a0],
    ] as const) {
      if ((a + 1) % n === b || (b + 1) % n === a) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagonals.push(a < b ? [a, b] : [b, a]);
    }
  }

  // A merged corner must stay convex and, unless dead straight (left out below), turn enough for Rapier.
  const convexAt = (ring: readonly number[], v: number) => {
    const k = ring.indexOf(v);
    const a = px[ring[(k + ring.length - 1) % ring.length]!]!;
    const c = px[ring[(k + 1) % ring.length]!]!;
    const turn = cross3(a, px[v]!, c);
    return turn === 0 || (turn > 0 && rapierKeeps(a, px[v]!, c));
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

  const out: number[][] = [];
  for (const ring of rings) {
    if (ring === null) continue;
    const m0 = ring.length;
    const kept = ring.filter(
      (v, k) => cross3(px[ring[(k + m0 - 1) % m0]!]!, px[v]!, px[ring[(k + 1) % m0]!]!) !== 0,
    );
    const m = kept.length;
    // Rapier drops an input corner within about 1.5° of straight from any poly; any other such corner is a sliver.
    const sliver = kept.some((v, k) => {
      const a = kept[(k + m - 1) % m]!;
      const c = kept[(k + 1) % m]!;
      if (rapierKeeps(px[a]!, px[v]!, px[c]!)) return false;
      return !(a === (v + n - 1) % n && c === (v + 1) % n);
    });
    if (sliver || m < 3) return null;
    out.push(kept);
  }
  return out;
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

const blockNames = (registry: Registry, e: EntityDef): string[] => {
  const blocks = e[BEHAVIORS_FIELD];
  const own =
    blocks !== null && typeof blocks === "object" && !Array.isArray(blocks)
      ? Object.keys(blocks)
      : [];
  return [...new Set([...registry.behaviorRules(e.type).required.keys(), ...own])];
};

/**
 * Why `decomposeBatch` won't split `site` on `e`, or null when it will.
 * The split must leave one of everything the entity is: one body, one set of
 * behaviors, one trigger. A collider's pieces join the entity (it keeps the
 * first, collider-only nodes take the rest), so only a sensor or a body with
 * nowhere to carry them refuses; a type's own shape splits into one entity
 * per piece, so only a plain static solid with no behaviors does.
 */
function splitBlocker(registry: Registry, e: EntityDef, site: ShapeSite): string | null {
  const type = registry.types.get(e.type);
  if (!type) return `${e.type} isn't a type of this game`;
  if (site.behavior) {
    const name = site.field.split(".")[1];
    if (name !== COLLIDER.name)
      return `only a ${COLLIDER.name}'s shape splits, not a ${name ?? "behavior"}'s`;
    const block = (e[BEHAVIORS_FIELD] as Record<string, Record<string, unknown>>)[name];
    if (block?.sensor === true)
      return `its collider is a sensor, and each piece would raise its own sensor events`;
    if (!registry.types.has(NODE_TYPE) || !registry.behaviorRules(NODE_TYPE).allowed.includes(name))
      return `this game has no ${NODE_TYPE} type that takes a ${name} to hold the other pieces`;
    if (!canBeInTree(type) && blockNames(registry, e).includes(BODY.name))
      return `a ${e.type} can't hold children, so its body can't carry the other pieces`;
    return null;
  }
  if ((type.base ?? type.type) !== "solid" || type.system !== undefined)
    return `each piece would be a ${e.type} of its own (a body, a trigger or a system per piece); only a plain solid's shape or a ${COLLIDER.name} behavior's splits`;
  const blocks = blockNames(registry, e);
  if (blocks.length > 0)
    return `each piece would copy its ${blocks.join(", ")}; move ${blocks.length === 1 ? "that" : "those"} to another entity first`;
  return null;
}

/** Each concave poly of `e` that `canDecompose` holds for at the game's px per metre, with why it won't split. */
function concaveSites(
  registry: Registry,
  e: EntityDef,
): { site: SplittableSite; blocker: string | null }[] {
  const ppm = pxPerMetreOf(registry);
  const out: { site: SplittableSite; blocker: string | null }[] = [];
  for (const site of entityShapeSites(registry, e)) {
    if (isPolygonField(site.schema)) continue;
    const parsed = parseShape(site.value);
    if (!parsed.ok || parsed.shape.type !== "poly") continue;
    if (!canDecompose(parsed.shape.pts, { pxPerMetre: ppm })) continue;
    const found = { ...site, pts: parsed.shape.pts };
    out.push({ site: found, blocker: splitBlocker(registry, e, found) });
  }
  return out;
}

/**
 * The shape `decomposeBatch` splits on entity `e`: its first poly, over
 * `entityShapeSites`, that may not be concave (a polygon field may), that
 * `canDecompose` holds for at the game's px per metre, and whose split keeps
 * one body and one of each behavior (a plain solid's shape, or a non-sensor
 * collider's); null when none.
 */
export function splittableSite(registry: Registry, e: EntityDef): SplittableSite | null {
  return concaveSites(registry, e).find((s) => s.blocker === null)?.site ?? null;
}

/** The fields of entity `e` (type refs, then behavior fields) that name entity `id`, as dot-path segments. */
export function entityRefSites(
  registry: Registry,
  e: EntityDef,
  id: string,
): { segs: string[]; value: unknown }[] {
  return refFields(registry, e, { behaviors: true })
    .filter(({ value }) => value === id || (Array.isArray(value) && value.includes(id)))
    .map(({ segs, value }) => ({ segs, value }));
}

/** What `decomposeBatch` builds: the batch, and the split's areas as `decomposePolygon` measures them. */
export type DecomposeBatchResult =
  | { ok: true; batch: OpBatch; area2: number; pieceArea2: readonly number[] }
  | { ok: false; issue: SceneIssue };

/** The next `count` free ids `<id>-n`. */
function pieceIds(def: SceneDefinition, id: string, count: number): string[] {
  const taken = takenIds(def);
  taken.delete(id);
  const ids: string[] = [];
  for (let n = 1; ids.length < count; n++) {
    const next = `${id}-${n}`;
    if (!taken.has(next)) ids.push(next);
  }
  return ids;
}

const polyTuple = (piece: readonly Pt[]) => ["poly", ...piece.flat()] as ShapeTuple;

/**
 * The batch splitting `id`'s splittable poly (`splittableSite`) into convex
 * pieces. A collider's: the entity keeps the first piece, its body and every
 * behavior, and each other piece is a collider-only `node` under it, so it
 * stays one body (beside it at its pose for a type that can't hold children,
 * which refuses `group`). A plain solid's own shape: one solid per piece, ids
 * `<id>-n`, or a `group` node named `id` holding them; children move with it,
 * and it's refused while another entity names `id`, since the pieces take new ids.
 */
export function decomposeBatch(
  def: SceneDefinition,
  id: string,
  registry: Registry,
  opts?: { group?: boolean },
): DecomposeBatchResult {
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
  const at = jsonPointer(["entities", index]);
  const sites = concaveSites(registry, entity);
  const site = sites.find((s) => s.blocker === null)?.site;
  if (!site) {
    const blocked = sites[0];
    return {
      ok: false,
      issue: blocked
        ? makeIssue("op-invalid", {
            message: `${id} can't split into convex pieces: ${blocked.blocker}.`,
            path: `${at}${blocked.site.pointer}`,
            entityIds: [id],
          })
        : makeIssue("poly-invalid", {
            message: `${id} has no simple concave poly to split into convex pieces.`,
            path: at,
            entityIds: [id],
          }),
    };
  }
  const result = decomposePolygon(site.pts, { pxPerMetre: pxPerMetreOf(registry) });
  if (!result.ok)
    return {
      ok: false,
      issue: { ...result.issue, path: `${at}${site.pointer}`, entityIds: [id] },
    };
  const into = `${result.pieces.length} convex pieces`;
  const done = (label: string, ops: SceneOp[]): DecomposeBatchResult => ({
    ok: true,
    batch: { label, ops },
    area2: result.area2,
    pieceArea2: result.pieceArea2,
  });

  const group = opts?.group === true;
  const inTree = canBeInTree(registry.types.get(entity.type));
  if (group && !inTree)
    return {
      ok: false,
      issue: makeIssue("parent-type", {
        message: `${id} is a ${entity.type}, which can't be in the tree, so its pieces can't be grouped; split it without a group.`,
        path: at,
        entityIds: [id],
      }),
    };
  if (site.behavior) {
    const [first, ...rest] = result.pieces;
    const name = site.field.split(".")[1]!;
    const block = (entity[BEHAVIORS_FIELD] as Record<string, Record<string, unknown>>)[name]!;
    const frame = entityFrame(registry, entity);
    const ids = pieceIds(def, id, rest.length);
    const ops: SceneOp[] = [{ op: "update", ref: id, set: { [site.field]: polyTuple(first!) } }];
    rest.forEach((piece, k) => {
      const node: EntityInput = {
        id: ids[k]!,
        type: NODE_TYPE,
        at: inTree ? [0, 0] : frame.at,
        [BEHAVIORS_FIELD]: { [name]: { ...structuredClone(block), shape: polyTuple(piece) } },
      };
      if (inTree) node.parent = id;
      else if (frame.rot !== 0) node.rot = frame.rot;
      ops.push({ op: "add", entity: node, index: index + 1 + k });
    });
    return done(`Split ${id}'s ${name} into ${into}`, ops);
  }

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

  if (group && !registry.types.has(NODE_TYPE))
    return {
      ok: false,
      issue: makeIssue("parent-type", {
        message: `This game has no ${NODE_TYPE} type to group ${id}'s pieces under; split it without a group.`,
        path: at,
        entityIds: [id],
      }),
    };
  const ids = pieceIds(def, id, result.pieces.length);
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
    const e = structuredClone(entity) as EntityInput;
    setAt(e, site.field.split("."), polyTuple(piece));
    e.id = ids[k]!;
    if (group) e.parent = id;
    ops.push({ op: "add", entity: e, index: slot++ });
  });
  if (group && children.length > 0) ops.push({ op: "reparent", refs: children, parent: id });
  return done(group ? `Split ${id} into a group of ${into}` : `Split ${id} into ${into}`, ops);
}

import { BEHAVIORS_FIELD } from "../game/behaviors";
import { NODE_TYPE } from "../game/primitives";
import type { Registry } from "../game/types";
import { bulkId } from "./bulk-ref";
import { isInstanceOverrideField, splitChildRef, splitOverridePath } from "./field-path";
import { compareEntityKeys } from "./format";
import { transformCell } from "./grid";
import { makeIssue } from "./issues";
import { paramTargetValues } from "./prefab-params";
import { fieldKind, geometryFields, gridFieldsOf } from "./schema";
import { geometryPose, normDeg } from "./shape-geometry";
import { parseShape } from "./shapes";
import {
  applyPt,
  applyVec,
  asFrame,
  compose,
  composeOrientations,
  composeSteps,
  dihedralOf,
  frame,
  frameOf,
  IDENTITY_2D,
  invert,
  isIdentity,
  sameFrame,
  turns,
  type Frame,
  type Orientation,
  type Transform2D,
} from "./transform";
import {
  isPt,
  linearPart,
  presentGeometry,
  transformBulkEntry,
  transformEntityDef,
  transformFieldValue,
} from "./translate";
import {
  PARENT_MAX_DEPTH,
  PREFAB_MAX_DEPTH,
  type BulkEntry,
  type EntityDef,
  type InstanceDef,
  type OpBatch,
  type OverridePath,
  type Prefab,
  type PrefabLibrary,
  type PrefabParam,
  type Pt,
  type Ref,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
  type SpotAnchor,
} from "./types";
import { roundLength } from "./units";

/**
 * The resolved view: one scene with every instance inlined and every
 * parent frame applied, in the shape of a scene without instances. Every
 * consumer of world geometry (the runtime, picking, gizmos, renders,
 * physical checks) reads this, never the raw document; an edit made on it
 * maps back through `toSourceBatch`.
 */

/** Separates an instance's id from its child's in a resolved ref: `gate-3/door`. */
export const CHILD_SEPARATOR = "/";

/** The resolved ref of an instance's child: `gate-3/door`, `gate-3/~solid:0`. */
export const childRef = (instance: string, child: Ref): Ref =>
  `${instance}${CHILD_SEPARATOR}${child}`;

/** Splits a resolved child ref; `null` for a ref of the document itself. */
export function parseChildRef(ref: Ref): { instance: string; child: Ref } | null {
  const i = ref.indexOf(CHILD_SEPARATOR);
  if (i <= 0 || ref.startsWith("~")) return null;
  return { instance: ref.slice(0, i), child: ref.slice(i + 1) };
}

export { splitChildRef, splitOverridePath };

/** The document entry a ref sits in: `room-1` for `room-1/door-1/panel`, else the ref itself. */
export const headOfRef = (ref: Ref): string => parseChildRef(ref)?.instance ?? ref;

/** The instance a child ref sits in directly: `room-1/door-1` for `room-1/door-1/panel`; none for a ref of the document itself. */
export const enclosingInstance = (ref: Ref): Ref | undefined =>
  parseChildRef(ref) ? ref.slice(0, ref.lastIndexOf(CHILD_SEPARATOR)) : undefined;

/**
 * The levels from the outermost instance holding `ref` down to `ref`
 * itself: `["room-1", "room-1/door-1", "room-1/door-1/panel"]`; just
 * `[ref]` for a ref of the document itself.
 */
export function instanceLevels(ref: Ref): Ref[] {
  if (!parseChildRef(ref)) return [ref];
  const parts = ref.split(CHILD_SEPARATOR);
  return parts.map((_, i) => parts.slice(0, i + 1).join(CHILD_SEPARATOR));
}

/** A child's own id, the last segment of its ref: `panel` for `room-1/door-1/panel`. */
export const ownChildId = (ref: Ref): string => ref.slice(ref.lastIndexOf(CHILD_SEPARATOR) + 1);

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Whether `t` turns by whole quarter turns, which keep whole numbers whole. */
const quarter = (t: Transform2D) => dihedralOf(t) !== null;

const isIdentityTurn = (o: Orientation) => o.rot === 0 && !o.flip;

const NO_TURN: Orientation = Object.freeze({ rot: 0, flip: false });

/** `p` under `t`, rounded to the file's length precision off the quarter turns. */
function placePoint(t: Transform2D, p: Pt): Pt {
  const [x, y] = applyPt(t, p);
  return quarter(t) ? [x, y] : [roundLength(x), roundLength(y)];
}

/** `v` under `t`'s linear part, rounded to the file's length precision off the quarter turns. */
function placeVector(t: Transform2D, v: Pt): Pt {
  const [x, y] = applyVec(t, v);
  return quarter(t) ? [x, y] : [roundLength(x), roundLength(y)];
}

/** An instance's own frame: its `at`, its angle in degrees and its flip. */
export function instanceFrame(inst: Pick<InstanceDef, "at" | "rot" | "flip">): Frame {
  return {
    at: [inst.at[0], inst.at[1]],
    rot: typeof inst.rot === "number" ? inst.rot : 0,
    flip: inst.flip === true,
  };
}

/** Where an entity's geometry puts it, as `runtime/spawn-pose.ts` reads it, from stored fields. */
function storedPose(registry: Registry | undefined, def: EntityDef): { at: Pt; rotDeg?: number } {
  const t = registry?.types.get(def.type);
  let shape: unknown;
  let at: unknown;
  let path: unknown;
  for (const { field, kind } of t ? geometryFields(t) : []) {
    const value = def[field];
    if (value === undefined || value === null) continue;
    if (kind === "shape") shape ??= value;
    else if (kind === "point") at ??= value;
    else if (kind === "path") path ??= value;
  }
  const parsed = shape === undefined ? null : parseShape(shape);
  const pts = (path as { pts?: unknown } | undefined)?.pts;
  const pose = geometryPose({
    ...(parsed?.ok ? { shape: parsed.shape } : {}),
    ...(isPt(at) ? { at } : {}),
    ...(Array.isArray(pts) && pts.every(isPt) ? { path: { pts } } : {}),
  });
  return pose ?? { at: [0, 0] };
}

/**
 * An entity's own frame from its stored fields: what its children's
 * geometry is written in. A node's `at`, `rot` and `flip`; any other
 * entity's spawn pose, as `runtime/spawn-pose.ts` reads it (the shape's
 * centre, a path rider's shape placed at the path's first point, else its
 * point, else the path's first point) at its box's or capsule's `rotDeg`,
 * unflipped. An entity with no geometry stands at the origin.
 */
export function entityFrame(registry: Registry | undefined, def: EntityDef): Frame {
  if (def.type === NODE_TYPE) {
    return {
      at: isPt(def.at) ? [def.at[0], def.at[1]] : [0, 0],
      rot: typeof def.rot === "number" ? def.rot : 0,
      flip: def.flip === true,
    };
  }
  const pose = storedPose(registry, def);
  return { at: pose.at, rot: pose.rotDeg ?? 0, flip: false };
}

/**
 * The frame of an entity already placed by `turn` (the angle and flip of
 * what is above it, as a resolved entity's origin carries): a node's from
 * its fields, which placing turns; any other entity's spawn point, at its
 * box's or capsule's `rotDeg`, else at `turn`'s angle, with `turn`'s flip.
 */
export function placedFrame(
  registry: Registry | undefined,
  def: EntityDef,
  turn: Orientation = NO_TURN,
): Frame {
  if (def.type === NODE_TYPE) return entityFrame(registry, def);
  const pose = storedPose(registry, def);
  return { at: pose.at, rot: pose.rotDeg ?? turn.rot, flip: turn.flip };
}

/** A node's `rot` and `flip` after `t`: written whatever they were, so an absent angle still turns. */
function turnNode(def: EntityDef, own: EntityDef, t: Transform2D): EntityDef {
  const o = composeOrientations(frameOf(t), {
    rot: typeof own.rot === "number" ? normDeg(own.rot) : 0,
    flip: own.flip === true,
  });
  const out: EntityDef = { ...def };
  delete out.rot;
  delete out.flip;
  if (o.rot !== 0) out.rot = o.rot;
  if (o.flip) out.flip = true;
  return out;
}

/**
 * The transforms that place an instance's children, innermost first: its
 * own angle and flip at its `at`, then its parent chain's.
 * Each is applied in turn, so a child resolves exactly as it would after
 * `unpack` into the parent. Without `registry`, a parent that is
 * neither a node nor an instance counts as the identity.
 */
export function instanceSteps(
  def: SceneDefinition,
  inst: InstanceDef,
  registry?: Registry,
  prefabs?: PrefabLibrary,
): Transform2D[] {
  return [frame(instanceFrame(inst)), ...sceneFrames(def, registry, prefabs).stepsFor(inst)];
}

/** An instance's world transform: its parent chain's after its own angle and flip at its `at`. */
export function instanceTransform(
  def: SceneDefinition,
  inst: InstanceDef,
  registry?: Registry,
  prefabs?: PrefabLibrary,
): Transform2D {
  return composeSteps(instanceSteps(def, inst, registry, prefabs));
}

/** Where an instance's prefab origin lands in the world. */
export function instanceOrigin(
  def: SceneDefinition,
  inst: InstanceDef,
  registry?: Registry,
  prefabs?: PrefabLibrary,
): Pt {
  return placePoint(composeSteps(sceneFrames(def, registry, prefabs).stepsFor(inst)), inst.at);
}

/**
 * The loops `declared`'s links make, each listed from the id the lenient
 * read takes as a root (the one that sorts last) up its parents to the id
 * that names it. `declared` maps each id to the parent it names; a parent
 * `exists` rejects is no link, and a parent naming an instance's child
 * links to that instance.
 */
export function parentCycles(
  declared: ReadonlyMap<string, Ref | undefined>,
  exists: (ref: Ref) => boolean,
): string[][] {
  const next = (id: string): string | undefined => {
    const p = declared.get(id);
    return p === undefined || !exists(p) || !declared.has(headOfRef(p)) ? undefined : headOfRef(p);
  };
  const out: string[][] = [];
  const state = new Map<string, "open" | "done">();
  for (const start of declared.keys()) {
    const path: string[] = [];
    let id: string | undefined = start;
    while (id !== undefined && !state.has(id)) {
      state.set(id, "open");
      path.push(id);
      id = next(id);
    }
    if (id !== undefined && state.get(id) === "open") {
      const loop = path.slice(path.indexOf(id));
      const k = loop.indexOf(loop.reduce((a, b) => (b > a ? b : a)));
      out.push([...loop.slice(k), ...loop.slice(0, k)]);
    }
    for (const p of path) state.set(p, "done");
  }
  return out;
}

/**
 * The parent each id resolves under, read leniently so a file and a doc
 * read alike: none for a root or a parent that doesn't exist, and none for
 * the root of each of `parentCycles`.
 */
function settledParents(
  declared: ReadonlyMap<string, Ref | undefined>,
  exists: (ref: Ref) => boolean,
): Map<string, Ref | undefined> {
  const out = new Map<string, Ref | undefined>();
  for (const [id, p] of declared) out.set(id, p !== undefined && exists(p) ? p : undefined);
  for (const [root] of parentCycles(declared, exists)) out.set(root!, undefined);
  return out;
}

/** The frames of a scene document's entities and instances, by their parent chain. */
export type SceneFrames = {
  /**
   * The transforms that take an entity's or instance's stored geometry to
   * the world, innermost first: its parent's frame and then the parent's
   * own steps; none for a root. An item not in the document
   * (an entity about to be added) is placed by the parent it names.
   */
  stepsFor(item: Pick<EntityDef, "id" | "parent">): readonly Transform2D[];
  /** The steps a child of `parent` goes through: the parent's own frame, then its steps. */
  under(parent: Ref | undefined): readonly Transform2D[];
  /** The parent an entity or instance resolves under, read leniently; none for a root. */
  parentOf(id: string): Ref | undefined;
  /** Whether an entity or instance is `off`, or under one that is. */
  hidden(id: string): boolean;
  /** An instance's children placed in the world (its frame and steps applied), or null when its prefab doesn't resolve. */
  placed(inst: InstanceDef): PlacedInstanceChild[] | null;
};

/**
 * The frames of `def`'s entities and instances, memoised by id. A parent
 * names an entity or an instance of `def`, or an instance's child by its
 * resolved ref; a parent that doesn't exist, and the last id of a cycle,
 * count as roots. Without `registry`, a parent that is neither a node nor
 * an instance counts as the identity.
 */
export function sceneFrames(
  def: SceneDefinition,
  registry?: Registry,
  prefabs?: PrefabLibrary,
): SceneFrames {
  const entities = new Map((def.entities ?? []).map((e) => [e.id, e]));
  const instances = new Map((def.instances ?? []).map((i) => [i.id, i]));
  const cells = gridTurns(def);
  const declared = new Map<string, Ref | undefined>();
  for (const item of [...entities.values(), ...instances.values()])
    declared.set(item.id, item.parent);
  const exists = (ref: Ref) => entities.has(ref) || instances.has(headOfRef(ref));
  const settled = settledParents(declared, exists);
  const steps = new Map<string, readonly Transform2D[]>();
  const unders = new Map<Ref, readonly Transform2D[]>();
  const hiddenIds = new Map<string, boolean>();
  const placedByInst = new Map<InstanceDef, PlacedInstanceChild[] | null>();

  const own = (item: Pick<EntityDef, "id" | "parent">): readonly Transform2D[] => {
    const known = declared.has(item.id);
    const parent = known ? settled.get(item.id) : item.parent;
    return parent !== undefined && (known || exists(parent)) ? under(parent) : [];
  };
  const stepsOf = (id: string): readonly Transform2D[] => {
    let out = steps.get(id);
    if (!out) {
      const item = entities.get(id) ?? instances.get(id);
      steps.set(id, (out = item ? own(item) : []));
    }
    return out;
  };
  const under = (ref: Ref | undefined): readonly Transform2D[] => {
    if (ref === undefined) return [];
    let out = unders.get(ref);
    if (out) return out;
    const e = entities.get(ref);
    const inst = e ? undefined : instances.get(ref);
    if (e) out = [frame(entityFrame(registry, e)), ...stepsOf(ref)];
    else if (inst) out = [frame(instanceFrame(inst)), ...stepsOf(ref)];
    else {
      const child = childOf(ref);
      out = child ? [frame(placedFrame(registry, child.def, child.transform))] : [];
    }
    unders.set(ref, out);
    return out;
  };
  const hiddenRef = (ref: Ref): boolean => {
    if (entities.has(ref) || instances.has(ref)) return hidden(ref);
    return childOf(ref)?.def.off === true;
  };
  const hidden = (id: string): boolean => {
    let out = hiddenIds.get(id);
    if (out === undefined) {
      const item = entities.get(id) ?? instances.get(id);
      const parent = settled.get(id);
      out = item?.off === true || (parent !== undefined && hiddenRef(parent));
      hiddenIds.set(id, out);
    }
    return out;
  };
  const placed = (inst: InstanceDef): PlacedInstanceChild[] | null => {
    if (placedByInst.has(inst)) return placedByInst.get(inst)!;
    const prefab = prefabs?.get(inst.prefab);
    let out: PlacedInstanceChild[] | null = null;
    if (prefab && registry) {
      const at = hidden(inst.id) && !inst.off ? { ...inst, off: true as const } : inst;
      const steps = [frame(instanceFrame(inst)), ...own(inst)];
      const res = placeInstance(prefab, at, registry, steps, cells, prefabs);
      if (res.ok) out = res.children;
    }
    placedByInst.set(inst, out);
    return out;
  };
  const childOf = (ref: Ref): PlacedInstanceChild | undefined => {
    const inst = instances.get(headOfRef(ref));
    return inst ? placed(inst)?.find((c) => c.def.id === ref) : undefined;
  };
  return {
    stepsFor: own,
    under,
    parentOf: (id) => settled.get(id),
    hidden,
    placed,
  };
}

/**
 * Whether grid fields turn and flip with their entity: only on a square
 * grid with equal cells, the one a quarter turn keeps on itself. Elsewhere
 * a turned grid child keeps its cells (validation reports it).
 */
export function gridTurns(def: Pick<SceneDefinition, "settings">): boolean {
  const grid = def.settings?.grid;
  return grid?.kind === "square" && grid.cell[0] === grid.cell[1];
}

/**
 * `def` under `t`, field by field; grid cells stay put when `cells` is
 * false and `t` turns. A node's `rot` and `flip` take `t`'s angle and flip
 * even when it writes neither.
 */
function transformEntity(
  registry: Registry,
  def: EntityDef,
  t: Transform2D,
  cells: boolean,
): EntityDef {
  if (isIdentity(t)) return def;
  if (def.type === NODE_TYPE) return turnNode(transformEntityDef(registry, def, t) ?? def, def, t);
  const held =
    !cells && turns(t)
      ? gridFieldsOf(registry.types.get(def.type)).filter((f) => def[f] !== undefined)
      : [];
  if (held.length === 0) return transformEntityDef(registry, def, t) ?? def;
  const rest: EntityDef = { ...def };
  for (const field of held) delete rest[field];
  const out = transformEntityDef(registry, rest, t) ?? clone(rest);
  for (const field of held) out[field] = clone(def[field]);
  return out;
}

/** `def` with `key` at its canonical place among the keys, or without it for `undefined`. */
export function withKey<T extends object>(def: T, key: string, value: unknown): T {
  const out: Record<string, unknown> = {};
  let placed = value === undefined;
  for (const [k, v] of Object.entries(def)) {
    if (k === key) continue;
    if (!placed && compareEntityKeys(key, k) < 0) {
      out[key] = value;
      placed = true;
    }
    out[k] = clone(v);
  }
  if (!placed) out[key] = value;
  return out as T;
}

/** `def` carrying angle and flip `o`, the identity written as absent. */
export function withOrientation<T extends object>(def: T, o: Orientation): T {
  return withKey(withKey(def, "rot", o.rot === 0 ? undefined : o.rot), "flip", o.flip || undefined);
}

/**
 * `deg` in the 360° window `like` sits in, so an angle a frame change turns
 * stays near the range it was written in.
 */
function inWindow(deg: number, like: number): number {
  const lo = Math.floor(like / 360) * 360;
  return roundLength(lo + normDeg(deg - lo));
}

/**
 * An entity's stored fields re-expressed by `t`, a rigid transform at any
 * angle, as resolving places a child (`transformEntity`, its grid cells
 * kept when `settings`' grid can't turn with them), with a node's `rot`
 * and `flip` at their canonical place and other angle fields kept in the
 * window they were written in. What reparent, paste, unpack and the
 * gizmos' previews all write.
 */
export function reexpressEntity(
  registry: Registry,
  settings: SceneDefinition["settings"],
  def: EntityDef,
  t: Transform2D,
): EntityDef {
  if (isIdentity(t)) return def;
  let next = transformEntity(registry, def, t, gridTurns({ settings }));
  if (next === def) next = clone(def);
  if (def.type === NODE_TYPE)
    return withOrientation(next, {
      rot: typeof next.rot === "number" ? next.rot : 0,
      flip: next.flip === true,
    });
  for (const [field, schema] of Object.entries(registry.types.get(def.type)?.shape ?? {})) {
    const was = def[field];
    const now = next[field];
    if (fieldKind(schema) === "angle" && typeof was === "number" && typeof now === "number")
      next[field] = inWindow(now, was);
  }
  return next;
}

/** An instance's `at`, angle and flip re-expressed by `t`. */
export function reexpressInstance(def: InstanceDef, t: Transform2D): InstanceDef {
  if (isIdentity(t)) return def;
  const placed = asFrame(compose(t, frame(instanceFrame(def))));
  return withOrientation(
    { ...clone(def), at: [roundLength(placed.at[0]), roundLength(placed.at[1])] },
    placed,
  );
}

/**
 * After the entries in `moved` were rewritten into new frames, rewrites
 * each entry under them whose parent's frame changed, level by level, so
 * its world pose stays as `before` placed it. `now` reads the document as
 * it stands (its frames, and its entities' and instances' ids) before each
 * level; `rewrite` re-expresses one entry by `by` (`reexpressEntity`,
 * `reexpressInstance`). Only an entity whose frame comes from its geometry
 * changes its children's frame: it can't carry a flip, and a circle or a
 * point carries no angle.
 */
export function keepInPlace(
  before: SceneFrames,
  moved: ReadonlySet<string>,
  now: () => { frames: SceneFrames; ids: Iterable<string> },
  rewrite: (id: string, by: Transform2D) => void,
): void {
  let level: ReadonlySet<string> = moved;
  for (let guard = 0; level.size > 0 && guard <= PARENT_MAX_DEPTH + 1; guard++) {
    const { frames: after, ids } = now();
    const next = new Set<string>();
    for (const id of ids) {
      const p = after.parentOf(id);
      if (moved.has(id) || p === undefined || !level.has(headOfRef(p))) continue;
      const was = composeSteps(before.under(p));
      const is = composeSteps(after.under(p));
      if (sameFrame(was, is)) continue;
      rewrite(id, compose(invert(is), was));
      next.add(id);
    }
    level = next;
  }
}

/**
 * Parent-to-child links between refs, walked breadth first: what the
 * document's tree and the resolved view's tree are both built on.
 */
export type RefLinks = {
  link(parent: Ref, child: Ref): void;
  /** `starts` in order, each once, then everything below them, level by level, in link order. */
  walk(starts: Iterable<Ref>): Ref[];
};

export function refLinks(): RefLinks {
  const children = new Map<Ref, Ref[]>();
  return {
    link(parent, child) {
      const list = children.get(parent);
      if (list) list.push(child);
      else children.set(parent, [child]);
    },
    walk(starts) {
      const seen = new Set<Ref>();
      const out: Ref[] = [];
      const visit = (ref: Ref) => {
        if (seen.has(ref)) return;
        seen.add(ref);
        out.push(ref);
      };
      for (const ref of starts) visit(ref);
      for (let i = 0; i < out.length; i++) children.get(out[i]!)?.forEach(visit);
      return out;
    },
  };
}

/** Why putting an entry under a parent would break the tree. */
export type TreeRefusal = { kind: "cycle" } | { kind: "depth"; deepest: number };

/**
 * A scene document's tree as the lenient read settles it (`sceneFrames`):
 * a document entry sits under its settled parent, and an instance's child
 * or nested instance under the instance that holds it directly.
 */
export type DocumentTree = {
  /** What `ref` sits under; none at the root. */
  parentOf(ref: Ref): Ref | undefined;
  /** Everything `ref` sits under, nearest first, up to its root. */
  ancestors(ref: Ref): Ref[];
  /** The document ids from `ref`'s own entry up to its root. */
  chain(ref: Ref): string[];
  /** Levels below its root, as validation counts them: 0 for a root; an instance's child one below its instance. */
  depth(ref: Ref): number;
  /**
   * `refs` in order, each once, then the entities and instances below
   * them, level by level: what names a ref as its parent and, below an
   * instance, what names one of its children.
   */
  subtree(refs: readonly Ref[]): Ref[];
  /** The entities and instances below each of `ids`, by id, `ids` themselves left out. */
  below(ids: Iterable<string>): Set<string>;
  /** `refs` without those that sit under another of them, in order, each once. */
  roots(refs: readonly Ref[]): Ref[];
  /** Why `id` (an entity or instance) can't go under `parent`: a loop, or a subtree deeper than `PARENT_MAX_DEPTH`; null when it fits. */
  refusal(id: string, parent: Ref): TreeRefusal | null;
};

export function documentTree(
  def: SceneDefinition,
  frames: SceneFrames = sceneFrames(def),
): DocumentTree {
  const items = [...(def.entities ?? []), ...(def.instances ?? [])];
  const links = refLinks();
  for (const { id } of items) {
    const p = frames.parentOf(id);
    if (p !== undefined) links.link(p, id);
  }
  for (const { id } of items) {
    const p = frames.parentOf(id);
    if (p !== undefined && parseChildRef(p)) links.link(headOfRef(p), id);
  }
  const parentOf = (ref: Ref) => enclosingInstance(ref) ?? frames.parentOf(ref);
  const ancestors = (ref: Ref): Ref[] => {
    const out: Ref[] = [];
    for (let p = parentOf(ref); p !== undefined && !out.includes(p); p = parentOf(p)) out.push(p);
    return out;
  };
  const depths = new Map<string, number>();
  const depthOf = (id: string): number => {
    let d = depths.get(id);
    if (d === undefined) {
      depths.set(id, 0);
      const p = frames.parentOf(id);
      depths.set(id, (d = p === undefined ? 0 : depth(p) + 1));
    }
    return d;
  };
  const depth = (ref: Ref): number => depthOf(headOfRef(ref)) + (parseChildRef(ref) ? 1 : 0);
  const below = (ids: Iterable<string>): Set<string> => {
    const start = [...ids];
    const out = new Set(links.walk(start));
    for (const id of start) out.delete(id);
    return out;
  };
  const chain = (ref: Ref): string[] => {
    const head = headOfRef(ref);
    return [head, ...ancestors(head).filter((a) => !parseChildRef(a))];
  };
  return {
    parentOf,
    ancestors,
    chain,
    depth,
    subtree: (refs) => links.walk(refs),
    below,
    roots(refs) {
      const sel = new Set(refs);
      return [...sel].filter((r) => !ancestors(r).some((a) => sel.has(a)));
    },
    refusal(id, parent) {
      if (chain(parent).includes(id)) return { kind: "cycle" };
      const base = depth(id);
      const height = Math.max(0, ...[...below([id])].map((d) => depth(d) - base));
      const deepest = depth(parent) + 1 + height;
      return deepest > PARENT_MAX_DEPTH ? { kind: "depth", deepest } : null;
    },
  };
}

/** Writes `value` at a dot path, creating objects on the way; false when the path runs into a value. */
function setAtPath(root: Record<string, unknown>, field: string, value: unknown): boolean {
  const segs = field.split(".");
  let cur: unknown = root;
  for (const seg of segs.slice(0, -1)) {
    if (cur === null || typeof cur !== "object") return false;
    const obj = cur as Record<string, unknown>;
    if (obj[seg] === undefined) obj[seg] = {};
    cur = obj[seg];
  }
  if (cur === null || typeof cur !== "object") return false;
  const last = segs[segs.length - 1]!;
  if (Array.isArray(cur)) {
    if (!/^\d+$/.test(last) || Number(last) > cur.length) return false;
    cur[Number(last)] = clone(value);
  } else (cur as Record<string, unknown>)[last] = clone(value);
  return true;
}

/** The value at a dot path, or undefined. */
export function valueAtPath(root: unknown, field: string): unknown {
  let cur = root;
  for (const seg of field.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** What a bulk entry of a nested instance takes from the instances above it, as an entity would. */
export type BulkPlacement = { z?: number; layer?: string; off?: boolean };

/** What a child carries about the parents above it inside its prefab. */
type ChildLinks = {
  /**
   * A parent in the prefab whose frame the child is still written in: its
   * own `parent`, or the `parent` of the nested instance it came through.
   * Placing it (at the end of resolving the prefab with its overrides)
   * applies that parent's chain and clears it.
   */
  under?: Ref;
  /** On a direct child of a nested instance: that instance's `parent`, relative to the prefab, which its node sits under. */
  nodeParent?: Ref;
};

/**
 * A child in a prefab's own frame, overrides applied. `child` is its ref
 * relative to the prefab: its own id, or under the nested instances it is
 * in (`door-1/panel`, `door-1/~solid:0`); an entity's `def.id` stays its id
 * in its own prefab. `turn` is the angle and flip of the nested instances
 * and parents above it, and a nested bulk entry's `placed` the z, layer
 * and `off` they give it.
 */
export type LocalChild = ChildLinks &
  (
    | { kind: "entity"; child: Ref; def: EntityDef; turn?: Orientation }
    | {
        kind: "bulk";
        child: Ref;
        key: string;
        index: number;
        value: BulkEntry;
        turn?: Orientation;
        placed?: BulkPlacement;
      }
  );

/** A prefab's children in its own frame: nested instances expanded, ids relative ("door-1/panel"). */
export type ResolvedPrefab = {
  id: string;
  children: LocalChild[];
  /** Its exposed params. */
  params: Readonly<Record<string, PrefabParam>>;
  /** Every prefab it reached, for hashing and bundles; outermost first. */
  uses: readonly string[];
};

export type PrefabResolution =
  | { ok: true; prefab: ResolvedPrefab }
  | { ok: false; issue: SceneIssue };

export type ResolveOptions = {
  /** Whether grid fields turn with a turned nested instance (`gridTurns` of the scene); default false. */
  cells?: boolean;
};

type Resolved = { prefab: ResolvedPrefab; depth: number };
type Outcome = { ok: true; value: Resolved } | { ok: false; issue: SceneIssue };
/** The prefab objects an outcome read, by id (undefined: it was missing), to tell a stale entry. */
type Deps = Map<string, Prefab | undefined>;
type CacheEntry = { outcome: Outcome; deps: Deps };

type Ctx = {
  library: PrefabLibrary | undefined;
  registry: Registry;
  cells: boolean;
  /** The prefabs being resolved, outermost first. */
  stack: string[];
  deps: Deps;
  /** False below a prefab that isn't the library's own (an edit in progress): its results aren't the library's to keep. */
  pure: boolean;
};

const RESOLVED = new WeakMap<PrefabLibrary, WeakMap<Registry, Map<string, CacheEntry>>>();

function cacheFor(library: PrefabLibrary, registry: Registry): Map<string, CacheEntry> {
  let byRegistry = RESOLVED.get(library);
  if (!byRegistry) RESOLVED.set(library, (byRegistry = new WeakMap()));
  let entries = byRegistry.get(registry);
  if (!entries) byRegistry.set(registry, (entries = new Map()));
  return entries;
}

const fresh = (library: PrefabLibrary, deps: Deps) =>
  [...deps].every(([id, prefab]) => library.get(id) === prefab);

/**
 * A prefab with its base and nested instances resolved: a variant's base's
 * children with the variant's overrides, then its own entities and bulk
 * entries, then each nested instance's children (that prefab resolved, the
 * instance's params and overrides applied, turned and flipped by its `rot`
 * and `flip` at its `at`, its `z` added, ids under `<instance>/`, its
 * `layer` and `off` inherited). At each level an override beats the
 * prefab's own value, and an outer level beats every inner one. Fails with
 * `prefab-unknown` for a missing prefab, `variant-base-unknown` for a
 * missing base, `prefab-cycle` for one that contains itself through
 * instances or bases, and `prefab-depth` past `PREFAB_MAX_DEPTH` levels (a
 * base counts as one). Params are the base's, a redeclared name replacing it.
 * Memoised per library and registry object: a library is a snapshot, and
 * a new version is a new map. Treat the result as read-only.
 */
export function resolvePrefab(
  id: string,
  library: PrefabLibrary,
  registry: Registry,
  opts: ResolveOptions = {},
): PrefabResolution {
  const ctx: Ctx = {
    library,
    registry,
    cells: opts.cells === true,
    stack: [],
    deps: new Map(),
    pure: true,
  };
  const out = resolveId(id, ctx);
  return out.ok ? { ok: true, prefab: out.value.prefab } : out;
}

function resolveId(id: string, ctx: Ctx): Outcome {
  const at = ctx.stack.indexOf(id);
  if (at >= 0) return { ok: false, issue: cycleIssue(ctx.stack.slice(at)) };
  const library = ctx.library;
  if (!library) return { ok: false, issue: unknownIssue(id, ctx.stack) };
  const cache = cacheFor(library, ctx.registry);
  const key = `${ctx.cells ? "cells" : "fixed"}:${id}`;
  const hit = cache.get(key);
  if (hit && fresh(library, hit.deps)) {
    for (const [dep, prefab] of hit.deps) ctx.deps.set(dep, prefab);
    const back = hit.outcome.ok
      ? ctx.stack.findIndex((s) => hit.outcome.ok && hit.outcome.value.prefab.uses.includes(s))
      : -1;
    return back >= 0
      ? { ok: false, issue: cycleIssue([...ctx.stack.slice(back), id]) }
      : hit.outcome;
  }
  const prefab = library.get(id);
  const deps: Deps = new Map([[id, prefab]]);
  let outcome: Outcome;
  if (!prefab) outcome = { ok: false, issue: unknownIssue(id, ctx.stack) };
  else {
    const inner: Ctx = { ...ctx, stack: [...ctx.stack, id], deps };
    outcome = resolveBody(prefab, inner);
  }
  if (ctx.pure) cache.set(key, { outcome, deps });
  for (const [dep, p] of deps) ctx.deps.set(dep, p);
  return outcome;
}

/**
 * `prefab` resolved: through the cache when it is the library's own, else
 * as given. `derived` says it is the library's own with overrides of its
 * nested instances laid over, so what it reaches is still the library's.
 */
function resolveGiven(prefab: Prefab, ctx: Ctx, derived = false): Outcome {
  if (ctx.library?.get(prefab.id) === prefab) return resolveId(prefab.id, ctx);
  const at = ctx.stack.indexOf(prefab.id);
  if (at >= 0) return { ok: false, issue: cycleIssue(ctx.stack.slice(at)) };
  return resolveBody(prefab, {
    ...ctx,
    stack: [...ctx.stack, prefab.id],
    pure: ctx.pure && derived,
  });
}

function cycleIssue(loop: readonly string[]): SceneIssue {
  // Start the chain at its least id, so a cycle reads the same from wherever it was entered.
  const start = loop.indexOf([...loop].sort()[0]!);
  const chain = [...loop.slice(start), ...loop.slice(0, start)];
  return makeIssue("prefab-cycle", {
    message: `Prefab "${chain[0]}" contains itself: ${[...chain, chain[0]].join(" → ")}.`,
    got: chain.join(","),
  });
}

function unknownIssue(id: string, stack: readonly string[]): SceneIssue {
  const parent = stack[stack.length - 1];
  return makeIssue("prefab-unknown", {
    message:
      parent === undefined
        ? `No prefab has the id "${id}".`
        : `Prefab "${parent}" places "${id}", which isn't a prefab in the project.`,
    got: id,
  });
}

/**
 * A prefab's own entities and bulk entries, in its frame. `after` is the
 * children already folded in from a variant's base: its own bulk entries
 * number on from the base's (`~solid:2` after the base's two), so every ref
 * stays unique; `index` stays the entry's place in its own file.
 */
function ownChildren(prefab: Prefab, after: readonly LocalChild[] = []): LocalChild[] {
  const out: LocalChild[] = prefab.entities.map((e) => ({
    kind: "entity",
    child: e.id,
    def: clone(e),
    ...(e.parent !== undefined ? { under: e.parent } : {}),
  }));
  for (const [key, entries] of Object.entries(prefab.bulk ?? {})) {
    const offset = after.filter(
      (c) => c.kind === "bulk" && c.key === key && !c.child.includes(CHILD_SEPARATOR),
    ).length;
    entries.forEach((value, index) =>
      out.push({
        kind: "bulk",
        child: bulkId(key, offset + index),
        key,
        index,
        value: clone(value),
      }),
    );
  }
  return out;
}

/**
 * A variant's base resolved, with the variant's overrides applied to its
 * children (`off: true` hides one). Fails with `variant-base-unknown` for a
 * base that isn't in the library and `prefab-cycle` for a chain of bases
 * that comes back round.
 */
function baseChildren(
  prefab: Prefab & { base: string },
  ctx: Ctx,
):
  | { ok: true; prefab: ResolvedPrefab; children: LocalChild[]; depth: number }
  | { ok: false; issue: SceneIssue } {
  const base = ctx.library?.get(prefab.base);
  if (!base) {
    ctx.deps.set(prefab.base, undefined);
    const at = ctx.stack.indexOf(prefab.base);
    return {
      ok: false,
      issue:
        at >= 0
          ? cycleIssue(ctx.stack.slice(at))
          : makeIssue("variant-base-unknown", {
              message: `Prefab "${prefab.id}" is a variant of "${prefab.base}", which isn't a prefab in the project.`,
              got: prefab.base,
            }),
    };
  }
  const resolved = resolveGiven(base, ctx);
  if (!resolved.ok) return resolved;
  // The base's children stay in their parents' frames: the variant places them with its own.
  return overlaid(base, resolved, Object.entries(prefab.overrides ?? {}), ctx, false);
}

function resolveBody(prefab: Prefab, ctx: Ctx): Outcome {
  const children: LocalChild[] = [];
  const uses: string[] = [prefab.id];
  let depth = 1;
  let params: Record<string, PrefabParam> = {};
  // A variant's base folds in ahead of its own children, and counts as a level.
  if (ctx.library && prefab.base !== undefined) {
    const folded = baseChildren({ ...prefab, base: prefab.base }, ctx);
    if (!folded.ok) return folded;
    children.push(...folded.children);
    for (const id of folded.prefab.uses) if (!uses.includes(id)) uses.push(id);
    depth = folded.depth + 1;
    params = { ...folded.prefab.params };
  }
  children.push(...ownChildren(prefab, children));
  if (ctx.library) {
    for (const n of prefab.instances ?? []) {
      const placed = nestedChildren(n, ctx);
      if (!placed.ok) return placed;
      children.push(...placed.children);
      for (const id of placed.uses) if (!uses.includes(id)) uses.push(id);
      depth = Math.max(depth, placed.depth + 1);
    }
  }
  if (depth > PREFAB_MAX_DEPTH)
    return {
      ok: false,
      issue: makeIssue("prefab-depth", {
        message: `Prefab "${prefab.id}" nests ${depth} levels deep; at most ${PREFAB_MAX_DEPTH} are allowed.`,
        got: String(depth),
      }),
    };
  // A redeclared param replaces the base's.
  Object.assign(params, clone(prefab.params ?? {}));
  return { ok: true, value: { prefab: { id: prefab.id, children, params, uses }, depth } };
}

/** One nested instance's children in the frame of the prefab that holds it. */
function nestedChildren(
  n: InstanceDef,
  ctx: Ctx,
):
  | { ok: true; children: LocalChild[]; uses: readonly string[]; depth: number }
  | { ok: false; issue: SceneIssue } {
  const prefab = ctx.library?.get(n.prefab);
  if (!prefab) {
    ctx.deps.set(n.prefab, undefined);
    const at = ctx.stack.indexOf(n.prefab);
    return {
      ok: false,
      issue: at >= 0 ? cycleIssue(ctx.stack.slice(at)) : unknownIssue(n.prefab, ctx.stack),
    };
  }
  const local = instanceLocal(prefab, n, ctx);
  if (!local.ok) return local;
  const placing = instanceFrame(n);
  const t = frame(placing);
  const own: Orientation = { rot: placing.rot, flip: placing.flip };
  const siblings = new Set(local.children.map((c) => c.child));
  const parented = n.parent !== undefined;
  const children = local.children.map((c): LocalChild => {
    const child = childRef(n.id, c.child);
    const total = c.turn ? composeOrientations(own, c.turn) : own;
    const links: ChildLinks & { turn?: Orientation } = {
      ...(isIdentityTurn(total) ? {} : { turn: total }),
      ...(parented ? { under: n.parent } : {}),
    };
    if (parented && !c.child.includes(CHILD_SEPARATOR)) links.nodeParent = n.parent;
    else if (c.nodeParent !== undefined) links.nodeParent = remapRef(c.nodeParent, n.id, siblings);
    if (c.kind === "bulk") {
      const placed: BulkPlacement = { ...c.placed };
      inherit(placed, n);
      return {
        kind: "bulk",
        child,
        key: c.key,
        index: c.index,
        value: transformBulkValue(c.value, t) as BulkEntry,
        ...links,
        ...(Object.keys(placed).length > 0 ? { placed } : {}),
      };
    }
    const def: EntityDef = { ...transformEntity(ctx.registry, c.def, t, ctx.cells) };
    inherit(def, n);
    remapChildRefs(def, n.id, siblings, ctx.registry);
    return { kind: "entity", child, def, ...links };
  });
  return { ok: true, children, uses: local.prefab.uses, depth: local.depth };
}

/** An instance's `layer`, `z` and `off` on one of its children. */
function inherit(def: BulkPlacement, inst: InstanceDef): void {
  if (def.layer === undefined && inst.layer !== undefined) def.layer = inst.layer;
  if (inst.z) {
    const z = (def.z ?? 0) + inst.z;
    if (z === 0) delete def.z;
    else def.z = z;
  }
  if (inst.off) def.off = true;
}

/**
 * An instance's params as overrides of every target, to go ahead of its own
 * overrides (prefab < param < override). A param the instance leaves unset
 * takes its `default`; with none, its targets keep their own values. A
 * target the param maps takes the mapped value (`paramTargetValues`). Names
 * the prefab doesn't expose feed nothing.
 */
export function paramOverrides(
  params: Readonly<Record<string, PrefabParam>>,
  values: InstanceDef["params"],
): [OverridePath, unknown][] {
  const out: [OverridePath, unknown][] = [];
  for (const [name, param] of Object.entries(params)) {
    const value = values?.[name] ?? param.default;
    if (value === undefined) continue;
    out.push(...paramTargetValues(param, value));
  }
  return out;
}

/**
 * What an instance lays over its prefab, in order, later beating earlier:
 * its params (against the resolved prefab's `params`), then its overrides.
 */
export function instanceOverrideEntries(
  params: Readonly<Record<string, PrefabParam>>,
  inst: Pick<InstanceDef, "overrides" | "params">,
): [OverridePath, unknown][] {
  return [...paramOverrides(params, inst.params), ...Object.entries(inst.overrides ?? {})];
}

/**
 * `prefab` with an instance's overrides of its nested instances laid over,
 * and the overrides left for its own children. A key under a nested
 * instance (`door-1/panel.path.speed`, `door-1/latch.rot`) moves down into
 * that instance's overrides, last, so it beats the inner level's own and
 * lands in the frame of the prefab that holds the child; a nested
 * instance's own field (`door-1.at`, `door-1.params.speed`) is set on it.
 * On a variant, a key of that shape whose head isn't the variant's own
 * moves into the variant's overrides of its base, last, so it reaches the
 * base's nested instance the same way.
 * Override values are always in the frame of the child's own prefab.
 */
function patchedPrefab(
  prefab: Prefab,
  overrides: readonly [OverridePath, unknown][],
): { prefab: Prefab; rest: [OverridePath, unknown][] } {
  const rest: [OverridePath, unknown][] = [];
  let instances: InstanceDef[] | null = null;
  let toBase: Record<OverridePath, unknown> | null = null;
  for (const [path, value] of overrides) {
    const split = splitOverridePath(path);
    const segs = split && splitChildRef(split.child);
    const head = segs && nestedInstance(prefab, segs[0]!);
    const pushed = segs !== null && segs.length > 1;
    const deep = split !== null && (pushed || isInstanceOverrideField(split.field));
    if (deep && !head && prefab.base !== undefined && !ownsChild(prefab, segs![0]!)) {
      toBase ??= { ...prefab.overrides };
      delete toBase[path];
      toBase[path] = clone(value);
      continue;
    }
    if (!split || !head || !deep) {
      rest.push([path, value]);
      continue;
    }
    instances ??= (prefab.instances ?? []).map((i) => ({ ...i }));
    const target = instances.find((i) => i.id === head.id)!;
    if (pushed) {
      const key = `${segs.slice(1).join(CHILD_SEPARATOR)}.${split.field}`;
      const next = { ...target.overrides };
      delete next[key];
      next[key] = clone(value);
      target.overrides = next;
    } else setInstanceField(target, split.field, value);
  }
  if (!instances && !toBase) return { prefab, rest };
  return {
    prefab: {
      ...prefab,
      ...(instances ? { instances } : {}),
      ...(toBase ? { overrides: toBase } : {}),
    },
    rest,
  };
}

/** Whether `id` is one of the prefab's own entities or nested instances, not one its base gives it. */
const ownsChild = (prefab: Prefab, id: string) =>
  prefab.entities.some((e) => e.id === id) || (prefab.instances ?? []).some((n) => n.id === id);

/** The nested instance `id` names in `prefab`; none when an entity has that id. */
function nestedInstance(prefab: Prefab, id: string): InstanceDef | undefined {
  if (prefab.entities.some((e) => e.id === id)) return undefined;
  return prefab.instances?.find((n) => n.id === id);
}

function setInstanceField(inst: InstanceDef, field: string, value: unknown): void {
  const target = inst as Record<string, unknown>;
  if (field.startsWith("params.")) {
    inst.params = { ...inst.params, [field.slice("params.".length)]: clone(value) };
    return;
  }
  if (value === undefined || value === null) delete target[field];
  else target[field] = clone(value);
}

/** Applies child-field overrides, in order, to children in their prefab's frame. */
function applyOverrides(
  children: LocalChild[],
  overrides: readonly [OverridePath, unknown][],
  registry: Registry,
): void {
  if (overrides.length === 0) return;
  const byRef = new Map(children.map((c) => [c.child, c]));
  for (const [path, value] of overrides) {
    const split = splitOverridePath(path);
    const c = split && byRef.get(split.child);
    if (!split || !c) continue;
    if (c.kind === "entity") setAtPath(c.def, split.field, value);
    else if (split.field === registry.bulkKey(c.key)?.field) c.value = clone(value) as BulkEntry;
    else if (split.field === "off") {
      const placed: BulkPlacement = { ...c.placed };
      if (value === true) placed.off = true;
      else delete placed.off;
      if (Object.keys(placed).length > 0) c.placed = placed;
      else delete c.placed;
    }
  }
}

type Overlaid =
  | {
      ok: true;
      prefab: ResolvedPrefab;
      children: LocalChild[];
      depth: number;
      /** The prefab with the overrides of its nested instances laid over. */
      patched: Prefab;
    }
  | { ok: false; issue: SceneIssue };

/**
 * `prefab`'s children (`base` is it resolved) with `entries` laid over in
 * order, later beating earlier, then (unless `place` is false) each one
 * still in a parent's frame placed in the prefab's (`placeUnder`), so an
 * override of a parent's geometry carries its children.
 */
function overlaid(
  prefab: Prefab,
  base: Extract<Outcome, { ok: true }>,
  entries: readonly [OverridePath, unknown][],
  ctx: Ctx,
  place = true,
): Overlaid {
  const { prefab: patched, rest } = patchedPrefab(prefab, entries);
  const own = ctx.library?.get(prefab.id) === prefab;
  const resolved = patched === prefab ? base : resolveGiven(patched, ctx, own);
  if (!resolved.ok) return resolved;
  const children = resolved.value.prefab.children.map(clone);
  applyOverrides(children, rest, ctx.registry);
  if (place) placeUnder(children, parentSteps(children, patched, ctx), ctx);
  return {
    ok: true,
    prefab: resolved.value.prefab,
    children,
    depth: resolved.value.depth,
    patched,
  };
}

/**
 * Places each child `pending` names by its parent chain, in place: its
 * geometry and turn, `off` when the chain is, and, for one whose parent
 * counts as a root (missing or in a cycle), its `parent` dropped so the
 * runtime doesn't link it either.
 */
function placeUnder(
  children: LocalChild[],
  pending: ReadonlyMap<LocalChild, PendingPlacement>,
  ctx: Ctx,
): void {
  children.forEach((c, i) => {
    const p = pending.get(c);
    if (!p) return;
    const next: LocalChild = { ...c };
    delete next.under;
    if (p.root && next.nodeParent === c.under) delete next.nodeParent;
    const total = composeOrientations(frameOf(composeSteps(p.steps)), c.turn ?? NO_TURN);
    if (isIdentityTurn(total)) delete next.turn;
    else next.turn = total;
    if (next.kind === "bulk") {
      next.value = p.steps.reduce(
        (v, t) => transformBulkValue(v, t),
        next.value as unknown,
      ) as BulkEntry;
      if (p.off) next.placed = { ...next.placed, off: true };
    } else {
      let def = p.steps.reduce((d, t) => transformEntity(ctx.registry, d, t, ctx.cells), next.def);
      if (p.root && def.parent === c.under) {
        def = { ...def };
        delete def.parent;
      }
      if (p.off && !def.off) def = { ...def, off: true };
      next.def = def;
    }
    children[i] = next;
  });
}

/** An instance's children in its prefab's frame: the prefab resolved, then the instance's params, then its overrides. */
function instanceLocal(
  prefab: Prefab,
  inst: Pick<InstanceDef, "overrides" | "params">,
  ctx: Ctx,
): Overlaid {
  const base = resolveGiven(prefab, ctx);
  if (!base.ok) return base;
  return overlaid(prefab, base, instanceOverrideEntries(base.value.prefab.params, inst), ctx);
}

/** What placing one child under its parent chain does: the steps, innermost first, and whether that chain is off. */
type PendingPlacement = { steps: Transform2D[]; off: boolean; root: boolean };

/**
 * For each child still in a parent's frame (`under`), the parent chain
 * that places it in the prefab's frame, read leniently as a scene is: a
 * parent that doesn't exist, and the last id of a cycle, count as roots. A
 * parent names an entity of the prefab (its own or its base's), a nested
 * instance, or a nested instance's child (`door-1/panel`).
 */
function parentSteps(
  children: readonly LocalChild[],
  prefab: Prefab,
  ctx: Ctx,
): Map<LocalChild, PendingPlacement> {
  const out = new Map<LocalChild, PendingPlacement>();
  if (!children.some((c) => c.under !== undefined)) return out;
  const byRef = new Map(children.map((c) => [c.child, c]));
  const nested = (id: string) => nestedThrough(prefab, [], id, ctx.library);
  const declared = new Map<string, Ref | undefined>();
  for (const c of children) {
    const nestedChild = c.child.includes(CHILD_SEPARATOR);
    if (!nestedChild && c.kind === "entity") declared.set(c.child, c.under);
    else if (nestedChild && !declared.has(headOfRef(c.child)))
      declared.set(headOfRef(c.child), c.under);
  }
  const exists = (ref: Ref) =>
    byRef.get(ref)?.kind === "entity" ||
    (!ref.includes(CHILD_SEPARATOR) && nested(ref) !== undefined);
  const settled = settledParents(declared, exists);
  const chains = new Map<Ref, { steps: Transform2D[]; off: boolean }>();
  const chain = (ref: Ref | undefined): { steps: Transform2D[]; off: boolean } => {
    if (ref === undefined) return { steps: [], off: false };
    const hit = chains.get(ref);
    if (hit) return hit;
    const c = byRef.get(ref);
    const n = c ? undefined : nested(ref);
    let found = { steps: [] as Transform2D[], off: false };
    if (c?.kind === "entity") {
      // The parent's own frame is in the frame its def is written in, which its chain places.
      const above = chain(settled.get(headOfRef(ref)));
      const own = frame(placedFrame(ctx.registry, c.def, c.turn));
      found = { steps: [own, ...above.steps], off: c.def.off === true || above.off };
    } else if (n) {
      const above = chain(settled.get(ref));
      found = {
        steps: [frame(instanceFrame(n)), ...above.steps],
        off: n.off === true || above.off,
      };
    }
    chains.set(ref, found);
    return found;
  };
  for (const c of children) {
    if (c.under === undefined) continue;
    const parent = settled.get(headOfRef(c.child));
    out.set(c, { ...chain(parent), root: parent === undefined });
  }
  return out;
}

function localCtx(
  registry: Registry,
  library: PrefabLibrary | undefined,
  opts: ResolveOptions,
): Ctx {
  return { library, registry, cells: opts.cells === true, stack: [], deps: new Map(), pure: true };
}

/**
 * Every child of an instance in the prefab's frame, its overrides applied,
 * in prefab order: entities, then bulk entries by key, then the nested
 * instances' children. Without `library`, nested instances and a variant's base are left out;
 * with it, a prefab that doesn't resolve (`resolvePrefab`) has none.
 */
export function localChildren(
  prefab: Prefab,
  inst: InstanceDef,
  registry: Registry,
  library?: PrefabLibrary,
  opts: ResolveOptions = {},
): LocalChild[] {
  const out = instanceLocal(prefab, inst, localCtx(registry, library, opts));
  return out.ok ? out.children : [];
}

/**
 * One child of an instance in the prefab's frame with the instance's
 * overrides applied; `null` when the prefab has no such child. A bulk
 * child's override names its bulk field (`~solid:0.shape`); a nested
 * child is named by its relative ref (`door-1/panel`).
 */
export function localChild(
  prefab: Prefab,
  inst: InstanceDef,
  child: Ref,
  registry: Registry,
  library?: PrefabLibrary,
  opts: ResolveOptions = {},
): LocalChild | null {
  return (
    localChildren(prefab, inst, registry, library, opts).find((c) => c.child === child) ?? null
  );
}

/** A local child as the entity it loads as: its ref as its id, and its fields, still in the prefab's frame. */
export function childEntity(c: LocalChild, registry: Registry): EntityDef | null {
  if (c.kind === "entity") return c.def.id === c.child ? c.def : { ...c.def, id: c.child };
  const info = registry.bulkKey(c.key);
  if (!info) return null;
  const def: EntityDef = { id: c.child, type: info.type, [info.field]: c.value };
  if (info.material !== undefined) def.material = info.material;
  if (c.placed) Object.assign(def, c.placed);
  return def;
}

/** `ref` under `instance` when it names a sibling or a nested child, else as given. */
const remapRef = (ref: Ref, instance: string, siblings: ReadonlySet<string>): Ref =>
  siblings.has(ref) ? childRef(instance, ref) : ref;

/** Rewrites a child's `parent` and reference fields that name a sibling or a nested child to its resolved ref. */
function remapChildRefs(
  def: EntityDef,
  instance: string,
  siblings: ReadonlySet<string>,
  registry: Registry,
): void {
  if (typeof def.parent === "string") def.parent = remapRef(def.parent, instance, siblings);
  for (const { field } of registry.types.get(def.type)?.refs ?? []) {
    const value = valueAtPath(def, field);
    const map = (v: unknown) => (typeof v === "string" ? remapRef(v, instance, siblings) : v);
    if (Array.isArray(value)) setAtPath(def, field, value.map(map));
    else if (value !== undefined) setAtPath(def, field, map(value));
  }
}

/** An instance child as the entity the resolved view holds: its resolved ref, the instance's transform, `z`, layer and `off` applied. */
export type PlacedChild = { child: LocalChild; def: EntityDef };

/**
 * The children of one instance in the world: each in the prefab's frame
 * with the instance's overrides (nested instances resolved when `library`
 * is given), then under `steps`, one transform or several applied in turn
 * (`instanceSteps`), with its resolved ref and its refs to siblings and
 * nested children rewritten to theirs. `cells` says whether grid fields
 * turn (`gridTurns`).
 */
export function placeChildren(
  prefab: Prefab,
  inst: InstanceDef,
  registry: Registry,
  steps: Transform2D | readonly Transform2D[],
  cells: boolean,
  library?: PrefabLibrary,
): PlacedChild[] {
  const out = placeInstance(prefab, inst, registry, steps, cells, library);
  return out.ok ? out.children : [];
}

/**
 * A placed child with the accumulated angle and flip of its instances,
 * and parents; on a direct child of a nested instance with a
 * `parent`, that parent's resolved ref, which the nested instance's node
 * sits under.
 */
export type PlacedInstanceChild = PlacedChild & { transform: Orientation; nodeParent?: Ref };

/**
 * `placeChildren`, with each child's accumulated turn and flip, or the issue
 * when the prefab (with the instance's params and overrides) doesn't
 * resolve: `prefab-unknown`, `prefab-cycle`, `prefab-depth`. The one
 * per-instance step behind the resolved view, load and runtime spawning.
 */
export function placeInstance(
  prefab: Prefab | undefined,
  inst: InstanceDef,
  registry: Registry,
  steps: Transform2D | readonly Transform2D[],
  cells: boolean,
  library?: PrefabLibrary,
): { ok: true; children: PlacedInstanceChild[] } | { ok: false; issue: SceneIssue } {
  if (!prefab) return { ok: false, issue: unknownIssue(inst.prefab, []) };
  const each: readonly Transform2D[] = Array.isArray(steps) ? steps : [steps];
  const local = instanceLocal(prefab, inst, localCtx(registry, library, { cells }));
  if (!local.ok) return local;
  const outer = frameOf(composeSteps(each));
  const siblings = new Set(local.children.map((c) => c.child));
  const children: PlacedInstanceChild[] = [];
  for (const c of local.children) {
    const entity = childEntity(c, registry);
    if (!entity) continue;
    const placed = each.reduce((e, t) => transformEntity(registry, e, t, cells), entity);
    const def: EntityDef = { ...placed, id: childRef(inst.id, c.child) };
    inherit(def, inst);
    remapChildRefs(def, inst.id, siblings, registry);
    const transform = c.turn ? composeOrientations(outer, c.turn) : outer;
    const nodeParent = c.nodeParent && remapRef(c.nodeParent, inst.id, siblings);
    children.push({ child: c, def, transform, ...(nodeParent ? { nodeParent } : {}) });
  }
  return { ok: true, children };
}

/** Where a resolved entity came from, and the angle and flip it was placed with (absent: none). */
export type ResolvedOrigin =
  | { kind: "entity"; index: number; transform?: Orientation }
  | {
      kind: "child";
      instance: number;
      child: Ref;
      /** The instance ids from the scene down to the child's own instance: `["room-1", "door-1"]`. */
      path: string[];
      /** The accumulated angle (degrees clockwise) and flip of its instances and parents. */
      transform: Orientation;
    };

export type ResolvedScene = {
  def: SceneDefinition;
  /** For each of `def.entities`, the document entity or instance child it is. */
  origins: ResolvedOrigin[];
};

/** Whether a document places anything through an instance or a parent. */
const isFlat = (def: SceneDefinition): boolean =>
  (def.instances ?? []).length === 0 && !(def.entities ?? []).some((e) => e.parent !== undefined);

/**
 * The resolved view and where each of its entities came from. A document
 * entity keeps its index, so pointers into `/entities/<i>` stay put; the
 * instances' children follow, instance by instance. A stored geometry maps
 * to the world through its parent chain (`sceneFrames`): `W(child) = W(parent) ∘ frame(entityFrame(parent))`, the
 * innermost frame applied first. An instance's children go through its own
 * frame, then its steps, and its `z` is added to each child's. An instance
 * whose prefab is missing contributes nothing (validation reports it); an
 * `off` instance's children are all `off`, and so is everything under an
 * `off` parent.
 */
export function resolveSceneDetailed(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): ResolvedScene {
  const own = def.entities ?? [];
  if (isFlat(def)) return { def, origins: own.map((_, index) => ({ kind: "entity", index })) };
  return resolveWith(def, registry, sceneFrames(def, registry, prefabs), true);
}

/** `resolveSceneDetailed` over given frames; without `children`, instances add nothing. */
export function resolveWith(
  def: SceneDefinition,
  registry: Registry,
  frames: SceneFrames,
  children: boolean,
): ResolvedScene {
  const cells = gridTurns(def);
  const origins: ResolvedOrigin[] = [];
  const entities: EntityDef[] = (def.entities ?? []).map((e, index) => {
    const steps = frames.stepsFor(e);
    const turn = frameOf(composeSteps(steps));
    origins.push(
      isIdentityTurn(turn) ? { kind: "entity", index } : { kind: "entity", index, transform: turn },
    );
    const placed = steps.reduce((d, t) => transformEntity(registry, d, t, cells), e);
    return !placed.off && frames.hidden(e.id) ? { ...placed, off: true } : placed;
  });
  if (children)
    (def.instances ?? []).forEach((inst, i) => {
      for (const { child, def: entity, transform } of frames.placed(inst) ?? []) {
        entities.push(entity);
        const nested = child.child.split(CHILD_SEPARATOR).slice(0, -1);
        origins.push({
          kind: "child",
          instance: i,
          child: child.child,
          path: [inst.id, ...nested],
          transform,
        });
      }
    });
  const out: SceneDefinition = { ...def, entities };
  delete out.instances;
  if (entities.length === 0) delete out.entities;
  return { def: out, origins };
}

/** The resolved view of a scene (see `resolveSceneDetailed`). Returns `def` itself when it has no instances or parents. */
export function resolveScene(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): SceneDefinition {
  return resolveSceneDetailed(def, registry, prefabs).def;
}

// ─── Edits on the resolved view ──────────────────────────

export type SourceBatchResult = { ok: true; batch: OpBatch } | { ok: false; issue: SceneIssue };

class MapFailure extends Error {
  constructor(readonly issue: SceneIssue) {
    super(issue.message);
  }
}

const refuse = (message: string, ref: Ref): never => {
  throw new MapFailure(makeIssue("op-invalid", { message, entityIds: [ref], got: ref }));
};

/**
 * Maps a batch written against the resolved view (world coordinates,
 * instance children by `gate-3/door`) back onto the document:
 *
 * - an edit to an instance child becomes an `override` of the fields it
 *   changes, in the frame of the child's own prefab: taken back through the
 *   inverse of its world transform (the instance's, and a nested child's
 *   nested instances'), so a world `move` of a flipped child is a mirrored
 *   override, and points, vectors and angles it sets turn back too (a field
 *   moved back to its value without the override drops the override
 *   instead); a `setZ` on one becomes an override of its `z`, less what
 *   its instances add;
 * - a parented entity's geometry and moves, an instance's `at`, an added
 *   entity or instance, and a paint of a child's cells go through the
 *   inverse of its parent chain's transform the same way;
 * - removing, renaming or painting a child is refused, since a child only
 *   exists through its instance.
 *
 * Every other op passes through as written. `apply` runs one op on a
 * scratch scene holding a single child (`toSourceBatch` in `ops.ts` passes
 * the op engine's).
 */
export function mapResolvedBatch(
  def: SceneDefinition,
  batch: OpBatch,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  apply: ChildApply,
): SourceBatchResult {
  try {
    const frames = sceneFrames(def, registry, prefabs);
    const ops = batch.ops.flatMap((op) => mapOp(def, op, registry, prefabs, apply, frames));
    return { ok: true, batch: { ...batch, ops } };
  } catch (err) {
    if (err instanceof MapFailure) return { ok: false, issue: err.issue };
    throw err;
  }
}

/**
 * Runs one op on a scratch scene holding just a child (the entity under its
 * own id, a bulk entry as `~key:0`), as `applyOps` would, and returns the
 * child after it.
 */
export type ChildApply = (child: LocalChild, op: SceneOp) => LocalChild;

/** A `ChildApply` that refuses every child edit, for callers with no op engine at hand. */
export const NO_CHILD_EDITS: ChildApply = (child) =>
  refuse(`${child.child} is an instance child; edit it through an override.`, child.child);

function entityOf(def: SceneDefinition, id: string): EntityDef | undefined {
  return def.entities?.find((e) => e.id === id);
}

function instanceOf(def: SceneDefinition, id: string): InstanceDef | undefined {
  return def.instances?.find((i) => i.id === id);
}

function childTarget(
  def: SceneDefinition,
  ref: Ref,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  frames: SceneFrames,
) {
  const split = parseChildRef(ref);
  if (!split) return null;
  const inst = instanceOf(def, split.instance);
  if (!inst) return refuse(`No instance has the id "${split.instance}".`, ref);
  const prefab = prefabs?.get(inst.prefab);
  if (!prefab) return refuse(`${split.instance}'s prefab "${inst.prefab}" isn't loaded.`, ref);
  const cells = gridTurns(def);
  const own = ownFrameChild(prefab, inst, split.child, registry, prefabs, cells);
  if (!own) return refuse(`Prefab "${inst.prefab}" has no child "${split.child}".`, ref);
  const bare = { ...inst, overrides: {} };
  const base = ownFrameChild(prefab, bare, split.child, registry, prefabs, cells)!.child;
  const steps = [...own.steps, frame(instanceFrame(inst)), ...frames.stepsFor(inst)];
  const z = (inst.z ?? 0) + own.z;
  return { inst, child: own.child, base, steps, z, toLocal: invert(composeSteps(steps)) };
}

/**
 * An instance's child in the frame it is written in (its own prefab's, or
 * its parent's there), the overrides of every level above applied, with
 * the transforms that place it in `prefab`'s frame (innermost first: its
 * parent chain, then each nested instance's frame and that instance's
 * parent chain) and the z the nested instances add. Its `child` is its ref
 * relative to `prefab`, so overrides of it key right.
 */
function ownFrameChild(
  prefab: Prefab,
  inst: InstanceDef,
  ref: Ref,
  registry: Registry,
  library: PrefabLibrary | undefined,
  cells: boolean,
): { child: LocalChild; steps: Transform2D[]; z: number } | null {
  const segs = splitChildRef(ref);
  if (!segs) return null;
  const ctx = localCtx(registry, library, { cells });
  const steps: Transform2D[] = [];
  let z = 0;
  let p = prefab;
  let at = inst;
  for (const seg of segs.slice(0, -1)) {
    const level = unplacedChildren(p, at, ctx);
    if (!level.ok) return null;
    const n = nestedThrough(level.patched, [], seg, library);
    const next = n && library?.get(n.prefab);
    if (!n || !next) return null;
    const under = level.children.find((c) => headOfRef(c.child) === seg && c.child !== seg);
    const chain = (under && level.pending.get(under)?.steps) ?? [];
    steps.unshift(frame(instanceFrame(n)), ...chain);
    z += n.z ?? 0;
    p = next;
    at = n;
  }
  const leaf = segs[segs.length - 1]!;
  const level = unplacedChildren(p, at, ctx);
  const child = level.ok ? level.children.find((c) => c.child === leaf) : undefined;
  if (!level.ok || !child) return null;
  steps.unshift(...(level.pending.get(child)?.steps ?? []));
  const own: LocalChild = { ...child, child: ref };
  delete own.under;
  return { child: own, steps, z };
}

/** An instance's children with its overrides applied, those with a parent in the prefab still in that parent's frame, and the chains that place them. */
function unplacedChildren(prefab: Prefab, inst: InstanceDef, ctx: Ctx) {
  const base = resolveGiven(prefab, ctx);
  if (!base.ok) return base;
  const entries = instanceOverrideEntries(base.value.prefab.params, inst);
  const out = overlaid(prefab, base, entries, ctx, false);
  if (!out.ok) return out;
  return { ...out, pending: parentSteps(out.children, out.patched, ctx) };
}

/**
 * The nested instance `id` names in `prefab` with `entries` laid over: its
 * own, else (on a variant) its base's, with the variant's overrides of it.
 */
function nestedThrough(
  prefab: Prefab,
  entries: readonly [OverridePath, unknown][],
  id: string,
  library: PrefabLibrary | undefined,
): InstanceDef | undefined {
  const seen = new Set<string>();
  let p: Prefab | undefined = patchedPrefab(prefab, entries).prefab;
  while (p && !seen.has(p.id)) {
    seen.add(p.id);
    const n = nestedInstance(p, id);
    if (n || ownsChild(p, id) || p.base === undefined) return n;
    const base: Prefab | undefined = library?.get(p.base);
    p = base && patchedPrefab(base, Object.entries(p.overrides ?? {})).prefab;
  }
  return undefined;
}

type ChildTarget = NonNullable<ReturnType<typeof childTarget>>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The fields of a child that `after` changed, as override set and revert
 * paths. A changed behavior field is overridden on its own
 * (`hero.behaviors.<name>.<field>`), so the instance keeps its prefab's
 * other blocks and the params aimed at them; a block added or dropped
 * whole, or one an existing override already covers whole, is overridden
 * at that level. Every other field is overridden whole.
 */
function overrideOps(
  inst: InstanceDef,
  base: LocalChild,
  before: LocalChild,
  after: LocalChild,
  registry: Registry,
): SceneOp[] {
  const fieldsOf = (c: LocalChild): Record<string, unknown> => {
    // An entity stores a z of 0 as no z, so the two compare equal here.
    if (c.kind === "entity") return { ...c.def, z: c.def.z ?? 0 };
    const info = registry.bulkKey(c.key);
    return info ? { [info.field]: c.value } : {};
  };
  const keys = Object.keys(inst.overrides ?? {});
  const set: Record<string, unknown> = {};
  const revert: string[] = [];
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const leaf = (path: string, a: unknown, o: unknown, label: string) => {
    if (same(a, o)) revert.push(...keys.filter((p) => p === path || p.startsWith(`${path}.`)));
    else if (a === undefined)
      refuse(
        `Can't remove ${before.child}'s ${label} from one instance; edit the prefab.`,
        inst.id,
      );
    else set[path] = clone(a);
  };
  /** Descends `depth` more levels while both sides are objects that keep every key the prefab has. */
  const diff = (path: string, a: unknown, b: unknown, o: unknown, depth: number, label: string) => {
    if (same(a, b)) return;
    const deeper =
      depth > 0 &&
      !keys.includes(path) &&
      isPlainObject(a) &&
      isPlainObject(b) &&
      Object.keys(b).every((k) => a[k] !== undefined || !isPlainObject(o) || o[k] === undefined);
    if (!deeper) return leaf(path, a, o, label);
    const from = isPlainObject(o) ? o : {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)]))
      diff(`${path}.${k}`, a[k], b[k], from[k], depth - 1, `${label}.${k}`);
  };
  const b = fieldsOf(before);
  const a = fieldsOf(after);
  const o = fieldsOf(base);
  for (const field of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (field === "id" || field === "type") continue;
    const depth = before.kind === "entity" && field === BEHAVIORS_FIELD ? 2 : 0;
    diff(`${before.child}.${field}`, a[field], b[field], o[field], depth, field);
  }
  const ops: SceneOp[] = [];
  if (revert.length > 0) ops.push({ op: "revertOverride", ref: inst.id, paths: revert });
  if (Object.keys(set).length > 0) ops.push({ op: "override", ref: inst.id, set });
  return ops;
}

/**
 * The value an update sets at `path` on `def`, taken through `t` by what
 * the field holds (see `transformFieldValue`): a whole field, a path's
 * `pts`, or one of its points. A shape on a type with a path is local to
 * the path, so it only turns. Under a turn or flip, a part of any other
 * value that `t` acts on (one coordinate of a point) has no single
 * counterpart, so it is refused.
 */
function transformSetValue(
  registry: Registry,
  def: EntityDef,
  path: string,
  value: unknown,
  t: Transform2D,
  cells: boolean,
  ref: Ref,
): unknown {
  if (isIdentity(t)) return value;
  const segs = path.split(".");
  const type = registry.types.get(def.type);
  const field = segs[0] ?? "";
  const schema = type && Object.hasOwn(type.shape, field) ? type.shape[field] : undefined;
  if (!schema) return value;
  const kind: string = fieldKind(schema);
  if (kind === "grid" && (!cells || segs.length > 1)) return value;
  if (kind === "angle" && segs.length === 1 && typeof value === "number")
    return angleFromWorld(value, t);
  if (segs.length === 1) {
    const onPath = presentGeometry(registry, def).some((f) => f.kind === "path");
    return transformFieldValue(schema, value, kind === "shape" && onPath ? linearPart(t) : t);
  }
  if (kind === "path" && segs[1] === "pts") {
    if (segs.length === 2 && Array.isArray(value))
      return value.map((q) => (isPt(q) ? placePoint(t, q) : q));
    if (segs.length === 3 && isPt(value)) return placePoint(t, value);
  }
  const acted = kind === "path" ? segs[1] === "pts" : turnedKind(kind);
  if (acted && turns(t))
    refuse(
      `${ref}'s ${field} is turned or flipped in the world; set the whole ${segs[1] === "pts" ? `${field}.pts` : field} instead of ${path}.`,
      ref,
    );
  return value;
}

/**
 * The angle that resolves to `deg` once turned back by `toLocal`'s
 * inverse. Resolving adds 90° per turn without wrapping, so this is the
 * exact inverse rather than the angle `toLocal` itself turns `deg` to.
 */
function angleFromWorld(deg: number, toLocal: Transform2D): number {
  const world = frameOf(invert(toLocal));
  const local = quarter(toLocal) ? deg - world.rot : roundLength(deg - world.rot);
  return world.flip ? 0 - local : local;
}

/** An entity given in world terms, in the frame `toLocal` takes it to. */
function entityFromWorld(
  registry: Registry,
  def: EntityDef,
  toLocal: Transform2D,
  cells: boolean,
): EntityDef {
  const out = transformEntity(registry, def, toLocal, cells);
  if (out === def || !turns(toLocal)) return out;
  for (const [field, schema] of Object.entries(registry.types.get(def.type)?.shape ?? {})) {
    const value = def[field];
    if (typeof value === "number" && fieldKind(schema) === "angle")
      out[field] = angleFromWorld(value, toLocal);
  }
  return out;
}

/** Whether a turn or flip changes a field of this kind, besides paths. */
const turnedKind = (kind: string): boolean =>
  kind === "shape" ||
  kind === "point" ||
  kind === "vector" ||
  kind === "angle" ||
  kind === "mirror";

function transformBulkValue(value: unknown, t: Transform2D): unknown {
  return Array.isArray(value) && value.length > 0
    ? transformBulkEntry(value as BulkEntry, t)
    : value;
}

const ANCHOR_DIRS: readonly [SpotAnchor, Pt][] = [
  ["top", [0, -1]],
  ["bottom", [0, 1]],
  ["left", [-1, 0]],
  ["right", [1, 0]],
];

/** The anchor that `t` takes `anchor` to: a turned box's world top is one of its own sides. */
function transformAnchor(anchor: SpotAnchor | undefined, t: Transform2D): SpotAnchor | undefined {
  const dir = ANCHOR_DIRS.find(([a]) => a === anchor)?.[1];
  if (!dir || !turns(t)) return anchor;
  const [x, y] = applyVec(t, dir);
  return ANCHOR_DIRS.find(([, d]) => d[0] === x && d[1] === y)?.[0] ?? anchor;
}

/** A paint of a parented entity's cells, taken from the world's cells into its own. */
function transformPaint(
  op: Extract<SceneOp, { op: "paintCells" }>,
  t: Transform2D,
): Extract<SceneOp, { op: "paintCells" }> {
  const out = { ...op };
  if (op.cells) out.cells = op.cells.map(([c, r, v]) => [...transformCell(c, r, t), v]);
  if (op.rects)
    out.rects = op.rects.map(([c0, r0, c1, r1, v]) => {
      const [a0, b0] = transformCell(c0, r0, t);
      const [a1, b1] = transformCell(c1, r1, t);
      return [Math.min(a0, a1), Math.min(b0, b1), Math.max(a0, a1), Math.max(b0, b1), v];
    });
  return out;
}

const scratchRef = (c: LocalChild) => (c.kind === "entity" ? c.def.id : bulkId(c.key, 0));

function mapOp(
  def: SceneDefinition,
  op: SceneOp,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  apply: ChildApply,
  frames: SceneFrames,
): SceneOp[] {
  const cells = gridTurns(def);
  const onChild = (ref: Ref, local: (t: ChildTarget) => SceneOp): SceneOp[] | null => {
    const t = childTarget(def, ref, registry, prefabs, frames);
    if (!t) return null;
    const after = apply(t.child, local(t));
    return overrideOps(t.inst, t.base, t.child, after, registry);
  };
  /** What takes world geometry into the frame an item (an entity or instance, or one about to be added) stores it in. */
  const toFrame = (item: Pick<EntityDef, "id" | "parent"> | undefined): Transform2D =>
    item ? invert(composeSteps(frames.stepsFor(item))) : IDENTITY_2D;
  const toParent = (ref: Ref): Transform2D => toFrame(entityOf(def, ref) ?? instanceOf(def, ref));

  switch (op.op) {
    case "update": {
      const child = onChild(op.ref, (t) => {
        const set: Record<string, unknown> = {};
        const local = t.child.kind === "entity" ? t.child.def : undefined;
        for (const [path, value] of Object.entries(op.set ?? {}))
          set[path] =
            path === "z" && typeof value === "number"
              ? value - t.z
              : t.steps.reduceRight(
                  (v, step) =>
                    local
                      ? transformSetValue(registry, local, path, v, invert(step), cells, op.ref)
                      : transformBulkValue(v, invert(step)),
                  value,
                );
        return {
          op: "update",
          ref: scratchRef(t.child),
          ...(op.set ? { set } : {}),
          ...(op.unset ? { unset: op.unset } : {}),
        };
      });
      if (child) return child;
      const e = entityOf(def, op.ref);
      if (e && op.set) {
        const inv = toParent(op.ref);
        if (isIdentity(inv)) return [op];
        const set: Record<string, unknown> = {};
        for (const [path, value] of Object.entries(op.set))
          set[path] = transformSetValue(registry, e, path, value, inv, cells, op.ref);
        return [{ ...op, set }];
      }
      const inst = instanceOf(def, op.ref);
      if (inst && op.set && isPt(op.set.at)) {
        const at = placePoint(toParent(op.ref), op.set.at);
        return [{ ...op, set: { ...op.set, at } }];
      }
      return [op];
    }
    case "move": {
      const out: SceneOp[] = [];
      const plain: Ref[] = [];
      const turned = new Map<string, { by: Pt; refs: Ref[] }>();
      const children: Ref[] = [];
      for (const r of op.refs) {
        if (parseChildRef(r)) {
          children.push(r);
          continue;
        }
        const inv = toParent(r);
        if (!turns(inv)) {
          plain.push(r);
          continue;
        }
        const by = placeVector(inv, op.by);
        const key = by.join(",");
        const entry = turned.get(key) ?? { by, refs: [] };
        entry.refs.push(r);
        turned.set(key, entry);
      }
      if (children.length === 0 && turned.size === 0) return [op];
      if (plain.length > 0) out.push({ ...op, refs: plain });
      for (const { by, refs } of turned.values()) out.push({ ...op, refs, by });
      for (const r of children)
        out.push(
          ...onChild(r, (t) => ({
            op: "move",
            refs: [scratchRef(t.child)],
            by: placeVector(t.toLocal, op.by),
          }))!,
        );
      return out;
    }
    case "place": {
      const placed = (inv: Transform2D): SceneOp => {
        const anchor = transformAnchor(op.anchor, inv);
        return { ...op, at: placePoint(inv, op.at), ...(anchor !== undefined ? { anchor } : {}) };
      };
      const child = onChild(op.ref, (t) => ({ ...placed(t.toLocal), ref: scratchRef(t.child) }));
      if (child) return child;
      const inv = toParent(op.ref);
      return isIdentity(inv) ? [op] : [placed(inv)];
    }
    case "setZ": {
      const children = op.refs.filter((r) => parseChildRef(r));
      if (children.length === 0) return [op];
      const rest = op.refs.filter((r) => !parseChildRef(r));
      const out: SceneOp[] = rest.length > 0 ? [{ ...op, refs: rest }] : [];
      for (const r of new Set(children)) {
        const t = childTarget(def, r, registry, prefabs, frames)!;
        out.push(...childZOps(r, t, op));
      }
      return out;
    }
    case "remove": {
      for (const r of op.refs)
        if (parseChildRef(r))
          refuse(`${r} belongs to an instance; remove the instance, or unpack it first.`, r);
      return [op];
    }
    case "add": {
      const inv = toFrame({ ...op.entity, id: op.entity.id ?? "" });
      if (isIdentity(inv)) return [op];
      const entity = entityFromWorld(registry, op.entity as EntityDef, inv, cells);
      return [{ ...op, entity: entity as typeof op.entity }];
    }
    case "instantiate": {
      const inv = toFrame({ ...op.instance, id: op.instance.id ?? "" });
      if (isIdentity(inv)) return [op];
      const instance = { ...op.instance, at: placePoint(inv, op.instance.at) };
      if (turns(inv)) {
        const local = composeOrientations(frameOf(inv), instanceFrame(op.instance));
        if (local.rot % 90 !== 0)
          throw new MapFailure(
            makeIssue("quarter-turn-only", {
              message: `An instance turns only by quarter turns, and its parent's frame turns it ${local.rot}°.`,
              got: String(local.rot),
            }),
          );
        delete instance.rot;
        delete instance.flip;
        if (local.rot !== 0) instance.rot = (local.rot / 90) as 1 | 2 | 3;
        if (local.flip) instance.flip = true;
      }
      return [{ ...op, instance }];
    }
    case "paintCells": {
      if (parseChildRef(op.ref))
        refuse(`${op.ref} belongs to an instance; open its prefab to paint its cells.`, op.ref);
      const inv = toParent(op.ref);
      return cells && turns(inv) && quarter(inv) ? [transformPaint(op, inv)] : [op];
    }
    case "rename":
      if (parseChildRef(op.from))
        refuse(`${op.from} belongs to an instance; its id comes from the prefab.`, op.from);
      return [op];
    default:
      return [op];
  }
}

/**
 * A `setZ` on one instance child as an override of its `z` in its own
 * prefab's frame, or the override's revert when that is its value without it.
 */
function childZOps(
  ref: Ref,
  { inst, base, child, z }: ChildTarget,
  op: Extract<SceneOp, { op: "setZ" }>,
): SceneOp[] {
  if (child.kind !== "entity" || base.kind !== "entity")
    return refuse(`${ref} is a bulk entry of its prefab, which has no z.`, ref);
  if ((op.z === undefined) === (op.by === undefined))
    return refuse("setZ takes either z (the new value) or by (a shift), not both.", ref);
  const local = op.z !== undefined ? op.z - z : (child.def.z ?? 0) + op.by!;
  const path = `${child.child}.z`;
  if (local === (base.def.z ?? 0)) {
    const held = Object.keys(inst.overrides ?? {}).filter((p) => p === path);
    return held.length > 0 ? [{ op: "revertOverride", ref: inst.id, paths: held }] : [];
  }
  return [{ op: "override", ref: inst.id, set: { [path]: local } }];
}

/**
 * Maps an issue found on the resolved view back onto the document: a
 * pointer into an instance child points at the instance, and a fix goes
 * through `mapBatch` (one it can't map is dropped). The identity when the
 * document has no instances or parents.
 */
export function issueOnSource(
  source: SceneDefinition,
  origins: readonly ResolvedOrigin[],
  mapBatch: (batch: OpBatch) => SourceBatchResult,
): (issue: SceneIssue) => SceneIssue {
  if (isFlat(source)) return (issue) => issue;
  return (issue) => {
    let out = issue;
    const m = issue.path === undefined ? null : /^\/entities\/(\d+)/.exec(issue.path);
    const origin = m ? origins[Number(m[1])] : undefined;
    if (origin?.kind === "child") out = { ...out, path: `/instances/${origin.instance}` };
    if (out.fix) {
      const mapped = mapBatch(out.fix);
      const { fix: _fix, ...rest } = out;
      out = mapped.ok ? { ...rest, fix: mapped.batch } : rest;
    }
    return out;
  };
}

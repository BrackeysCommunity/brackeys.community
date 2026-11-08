import type { Registry } from "../game/types";
import { bulkId } from "./bulk-ref";
import { isInstanceOverrideField, splitChildRef, splitOverridePath } from "./field-path";
import { makeIssue } from "./issues";
import { fieldKind } from "./schema";
import {
  applyPt,
  applyVec,
  compose,
  composeDihedral,
  dihedral,
  dihedralOf,
  IDENTITY_2D,
  invert,
  type Dihedral,
  type Transform2D,
} from "./transform";
import {
  presentGeometry,
  transformBulkEntry,
  transformEntityDef,
  transformFieldValue,
} from "./translate";
import {
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

/**
 * The resolved view: one scene with every instance inlined and every group
 * transform applied, in the shape of a scene without groups or instances. Every
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

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** A group's origin; `[0, 0]` for no group or one that isn't declared. */
export function groupOrigin(def: SceneDefinition, group: string | undefined): Pt {
  const at = group === undefined ? undefined : def.groups?.[group]?.at;
  return at ? [at[0], at[1]] : [0, 0];
}

/** The dihedral element an instance's or group's `rot` and `flip` spell. */
export const turnOf = (d: { rot?: number; flip?: boolean }): Dihedral => ({
  rot: (d.rot === 1 || d.rot === 2 || d.rot === 3 ? d.rot : 0) as Dihedral["rot"],
  flip: d.flip === true,
});

/** The inverse element: what undoes `d`. */
export const inverseTurn = (d: Dihedral): Dihedral =>
  d.flip ? d : { rot: ((4 - d.rot) % 4) as Dihedral["rot"], flip: false };

const isIdentityTurn = (d: Dihedral) => d.rot === 0 && !d.flip;

const isIdentity = (t: Transform2D) =>
  t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.tx === 0 && t.ty === 0;

/** Whether `t` turns or flips, rather than only moving. */
const turns = (t: Transform2D) => !(t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1);

/** The turn and flip part of a scene transform (always quarter turns and flips). */
const turnPart = (t: Transform2D): Dihedral => dihedralOf(t) ?? { rot: 0, flip: false };

/** A group's transform: its turn and flip about its `at`, the identity for no group or one that isn't declared. */
export function groupTransform(def: SceneDefinition, group: string | undefined): Transform2D {
  const g = group === undefined ? undefined : def.groups?.[group];
  return g?.at ? dihedral(turnOf(g), g.at) : IDENTITY_2D;
}

/**
 * The transforms that place an instance's children, innermost first: its
 * own turn and flip at its `at`, then its group's. Each is applied in turn,
 * so a child resolves exactly as it would after `unpack` into the group.
 */
export function instanceSteps(def: SceneDefinition, inst: InstanceDef): Transform2D[] {
  return [dihedral(turnOf(inst), inst.at), groupTransform(def, inst.group)];
}

/** An instance's world transform: its group's after its own turn and flip at its `at`. */
export function instanceTransform(def: SceneDefinition, inst: InstanceDef): Transform2D {
  return composeSteps(instanceSteps(def, inst));
}

const composeSteps = (steps: readonly Transform2D[]): Transform2D =>
  steps.reduce((acc, t) => compose(t, acc), IDENTITY_2D);

/** Where an instance's prefab origin lands in the world. */
export function instanceOrigin(def: SceneDefinition, inst: InstanceDef): Pt {
  return applyPt(groupTransform(def, inst.group), inst.at);
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

/** The grid fields `def` sets. */
function gridFields(registry: Registry, def: EntityDef): string[] {
  const shape = registry.types.get(def.type)?.shape ?? {};
  return Object.entries(shape)
    .filter(([field, schema]) => def[field] !== undefined && fieldKind(schema) === "grid")
    .map(([field]) => field);
}

/** `def` under `t`, field by field; grid cells stay put when `cells` is false and `t` turns. */
function transformEntity(
  registry: Registry,
  def: EntityDef,
  t: Transform2D,
  cells: boolean,
): EntityDef {
  if (isIdentity(t)) return def;
  const held = !cells && turns(t) ? gridFields(registry, def) : [];
  if (held.length === 0) return transformEntityDef(registry, def, t) ?? def;
  const rest: EntityDef = { ...def };
  for (const field of held) delete rest[field];
  const out = transformEntityDef(registry, rest, t) ?? clone(rest);
  for (const field of held) out[field] = clone(def[field]);
  return out;
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

/**
 * A child in a prefab's own frame, overrides applied. `child` is its ref
 * relative to the prefab: its own id, or under the nested instances it is
 * in (`door-1/panel`, `door-1/~solid:0`); an entity's `def.id` stays its id
 * in its own prefab. `turn` is the turn and flip of the nested instances
 * above it, and a nested bulk entry's `placed` the z, layer and `off` they
 * give it.
 */
export type LocalChild =
  | { kind: "entity"; child: Ref; def: EntityDef; turn?: Dihedral }
  | {
      kind: "bulk";
      child: Ref;
      key: string;
      index: number;
      value: BulkEntry;
      turn?: Dihedral;
      placed?: BulkPlacement;
    };

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
  return overlaid(base, resolved, Object.entries(prefab.overrides ?? {}), ctx);
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
  const t = dihedral(turnOf(n), n.at);
  const turn = turnOf(n);
  const siblings = new Set(local.children.map((c) => c.child));
  const children = local.children.map((c): LocalChild => {
    const child = childRef(n.id, c.child);
    const total = c.turn ? composeDihedral(turn, c.turn) : turn;
    const turned = isIdentityTurn(total) ? {} : { turn: total };
    if (c.kind === "bulk") {
      const placed: BulkPlacement = { ...c.placed };
      inherit(placed, n);
      return {
        kind: "bulk",
        child,
        key: c.key,
        index: c.index,
        value: transformBulkValue(c.value, t) as BulkEntry,
        ...turned,
        ...(Object.keys(placed).length > 0 ? { placed } : {}),
      };
    }
    const def: EntityDef = { ...transformEntity(ctx.registry, c.def, t, ctx.cells) };
    inherit(def, n);
    remapChildRefs(def, n.id, siblings, ctx.registry);
    return { kind: "entity", child, def, ...turned };
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
 * takes its `default`; with none, its targets keep their own values. Names
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
    for (const target of param.targets) out.push([target, value]);
  }
  return out;
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
  | { ok: true; prefab: ResolvedPrefab; children: LocalChild[]; depth: number }
  | { ok: false; issue: SceneIssue };

/** `prefab`'s children (`base` is it resolved) with `entries` laid over in order, later beating earlier. */
function overlaid(
  prefab: Prefab,
  base: Extract<Outcome, { ok: true }>,
  entries: readonly [OverridePath, unknown][],
  ctx: Ctx,
): Overlaid {
  const { prefab: patched, rest } = patchedPrefab(prefab, entries);
  const own = ctx.library?.get(prefab.id) === prefab;
  const resolved = patched === prefab ? base : resolveGiven(patched, ctx, own);
  if (!resolved.ok) return resolved;
  const children = resolved.value.prefab.children.map(clone);
  applyOverrides(children, rest, ctx.registry);
  return {
    ok: true,
    prefab: resolved.value.prefab,
    children,
    depth: resolved.value.depth,
  };
}

/** An instance's children in its prefab's frame: the prefab resolved, then the instance's params, then its overrides. */
function instanceLocal(
  prefab: Prefab,
  inst: Pick<InstanceDef, "overrides" | "params">,
  ctx: Ctx,
): Overlaid {
  const base = resolveGiven(prefab, ctx);
  if (!base.ok) return base;
  const entries = [
    ...paramOverrides(base.value.prefab.params, inst.params),
    ...Object.entries(inst.overrides ?? {}),
  ];
  return overlaid(prefab, base, entries, ctx);
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

/** Rewrites a child's reference fields that name a sibling or a nested child to its resolved ref. */
function remapChildRefs(
  def: EntityDef,
  instance: string,
  siblings: ReadonlySet<string>,
  registry: Registry,
): void {
  for (const { field } of registry.types.get(def.type)?.refs ?? []) {
    const value = valueAtPath(def, field);
    const map = (v: unknown) =>
      typeof v === "string" && siblings.has(v) ? childRef(instance, v) : v;
    if (Array.isArray(value)) setAtPath(def, field, value.map(map));
    else if (value !== undefined) setAtPath(def, field, map(value));
  }
}

/** An instance child as the entity the resolved view holds: its resolved ref, the instance's transform, `z`, layer, group and `off` applied. */
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
  const each: readonly Transform2D[] = Array.isArray(steps) ? steps : [steps];
  const children = localChildren(prefab, inst, registry, library, { cells });
  const siblings = new Set(children.map((c) => c.child));
  const out: PlacedChild[] = [];
  for (const c of children) {
    const local = childEntity(c, registry);
    if (!local) continue;
    const placed = each.reduce((e, t) => transformEntity(registry, e, t, cells), local);
    const def: EntityDef = { ...placed, id: childRef(inst.id, c.child) };
    delete def.group;
    if (inst.group !== undefined) def.group = inst.group;
    inherit(def, inst);
    remapChildRefs(def, inst.id, siblings, registry);
    out.push({ child: c, def });
  }
  return out;
}

/** Where a resolved entity came from, and the turn and flip it was placed with (absent: none). */
export type ResolvedOrigin =
  | { kind: "entity"; index: number; transform?: Dihedral }
  | {
      kind: "child";
      instance: number;
      child: Ref;
      /** The instance ids from the scene down to the child's own instance: `["room-1", "door-1"]`. */
      path: string[];
      /** The accumulated turn and flip of its instances and group. */
      transform: Dihedral;
    };

export type ResolvedScene = {
  def: SceneDefinition;
  /** For each of `def.entities`, the document entity or instance child it is. */
  origins: ResolvedOrigin[];
};

/**
 * The resolved view and where each of its entities came from. A document
 * entity keeps its index, so pointers into `/entities/<i>` stay put; the
 * instances' children follow, instance by instance. A child's world
 * transform is its group's, then its instance's, each a turn and flip at
 * its `at` (`instanceTransform`), and an instance's `z` is added to each
 * child's. An instance whose prefab is missing contributes nothing
 * (validation reports it); an `off` instance's children are all `off`.
 */
export function resolveSceneDetailed(
  def: SceneDefinition,
  registry: Registry,
  prefabs?: PrefabLibrary,
): ResolvedScene {
  const own = def.entities ?? [];
  const hasGroups = def.groups !== undefined && Object.keys(def.groups).length > 0;
  if (!hasGroups && (def.instances ?? []).length === 0)
    return { def, origins: own.map((_, index) => ({ kind: "entity", index })) };

  const cells = gridTurns(def);
  const origins: ResolvedOrigin[] = [];
  const entities: EntityDef[] = own.map((e, index) => {
    const t = groupTransform(def, e.group);
    const turn = turnPart(t);
    origins.push(
      isIdentityTurn(turn) ? { kind: "entity", index } : { kind: "entity", index, transform: turn },
    );
    return transformEntity(registry, e, t, cells);
  });
  (def.instances ?? []).forEach((inst, i) => {
    const prefab = prefabs?.get(inst.prefab);
    if (!prefab) return;
    const steps = instanceSteps(def, inst);
    const outer = turnPart(composeSteps(steps));
    for (const { child, def: placed } of placeChildren(
      prefab,
      inst,
      registry,
      steps,
      cells,
      prefabs,
    )) {
      entities.push(placed);
      const nested = child.child.split(CHILD_SEPARATOR).slice(0, -1);
      const transform =
        child.kind === "entity" && child.turn ? composeDihedral(outer, child.turn) : outer;
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
  delete out.groups;
  delete out.instances;
  if (entities.length === 0) delete out.entities;
  return { def: out, origins };
}

/** The resolved view of a scene (see `resolveSceneDetailed`). Returns `def` itself when it has no groups or instances. */
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
 * - a group member's geometry and moves, an instance's `at`, an added
 *   entity or instance, and a paint of a member's cells go through the
 *   inverse of the group's transform the same way;
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
    const ops = batch.ops.flatMap((op) => mapOp(def, op, registry, prefabs, apply));
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
  const steps = [...own.steps, ...instanceSteps(def, inst)];
  const z = (inst.z ?? 0) + own.z;
  return { inst, child: own.child, base, steps, z, toLocal: invert(composeSteps(steps)) };
}

/**
 * An instance's child in the frame of its own prefab, the overrides of
 * every level above applied, with the nested instances' transforms that
 * place it in `prefab`'s frame (innermost first) and the z they add. Its
 * `child` is its ref relative to `prefab`, so overrides of it key right.
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
  const steps: Transform2D[] = [];
  let z = 0;
  let p = prefab;
  let at = inst;
  for (const seg of segs.slice(0, -1)) {
    const n = nestedThrough(p, instanceEntries(p, at, registry, library, cells), seg, library);
    const next = n && library?.get(n.prefab);
    if (!n || !next) return null;
    steps.unshift(dihedral(turnOf(n), n.at));
    z += n.z ?? 0;
    p = next;
    at = n;
  }
  const leaf = segs[segs.length - 1]!;
  const child = localChild(p, at, leaf, registry, library, { cells });
  return child ? { child: { ...child, child: ref }, steps, z } : null;
}

/** What an instance lays over its prefab, in order: its params as overrides of their targets, then its overrides. */
function instanceEntries(
  prefab: Prefab,
  inst: InstanceDef,
  registry: Registry,
  library: PrefabLibrary | undefined,
  cells: boolean,
): [OverridePath, unknown][] {
  const entries = Object.entries(inst.overrides ?? {});
  if (!library) return entries;
  const res = resolveGiven(prefab, localCtx(registry, library, { cells }));
  return res.ok ? [...paramOverrides(res.value.prefab.params, inst.params), ...entries] : entries;
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

/** The top-level fields of a child that `after` changed, as override set and revert paths. */
function overrideOps(
  inst: InstanceDef,
  base: LocalChild,
  before: LocalChild,
  after: LocalChild,
  registry: Registry,
): SceneOp[] {
  const fieldsOf = (c: LocalChild): Record<string, unknown> => {
    if (c.kind === "entity") return c.def;
    const info = registry.bulkKey(c.key);
    return info ? { [info.field]: c.value } : {};
  };
  const b = fieldsOf(before);
  const a = fieldsOf(after);
  const o = fieldsOf(base);
  const set: Record<string, unknown> = {};
  const revert: string[] = [];
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  for (const field of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (field === "id" || field === "type" || same(a[field], b[field])) continue;
    const path = `${before.child}.${field}`;
    if (same(a[field], o[field])) {
      const keys = Object.keys(inst.overrides ?? {});
      revert.push(...keys.filter((p) => p === path || p.startsWith(`${path}.`)));
    } else if (a[field] === undefined) {
      refuse(
        `Can't remove ${before.child}'s ${field} from one instance; edit the prefab.`,
        inst.id,
      );
    } else set[path] = clone(a[field]);
  }
  const ops: SceneOp[] = [];
  if (revert.length > 0) ops.push({ op: "revertOverride", ref: inst.id, paths: revert });
  if (Object.keys(set).length > 0) ops.push({ op: "override", ref: inst.id, set });
  return ops;
}

const isPt = (v: unknown): v is Pt =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number");

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
      return value.map((q) => (isPt(q) ? applyPt(t, q) : q));
    if (segs.length === 3 && isPt(value)) return applyPt(t, value);
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
  const world = inverseTurn(turnPart(toLocal));
  const local = deg - 90 * world.rot;
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

const linearPart = (t: Transform2D): Transform2D => ({ ...t, tx: 0, ty: 0 });

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

/** A cell's column and row under the linear part of `t`, turned about cell (0, 0)'s top-left corner. */
function transformCell(col: number, row: number, t: Transform2D): [number, number] {
  const [x, y] = applyVec(t, [2 * col + 1, 2 * row + 1]);
  return [(x - 1) / 2, (y - 1) / 2];
}

/** A paint of a group member's cells, taken from the world's cells into its own. */
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
): SceneOp[] {
  const cells = gridTurns(def);
  const onChild = (ref: Ref, local: (t: ChildTarget) => SceneOp): SceneOp[] | null => {
    const t = childTarget(def, ref, registry, prefabs);
    if (!t) return null;
    const after = apply(t.child, local(t));
    return overrideOps(t.inst, t.base, t.child, after, registry);
  };
  /** The inverse of the transform of the group `ref` (an entity or instance) is in. */
  const toGroup = (ref: Ref): Transform2D => {
    const group = entityOf(def, ref)?.group ?? instanceOf(def, ref)?.group;
    return invert(groupTransform(def, group));
  };

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
        const inv = toGroup(op.ref);
        if (isIdentity(inv)) return [op];
        const set: Record<string, unknown> = {};
        for (const [path, value] of Object.entries(op.set))
          set[path] = transformSetValue(registry, e, path, value, inv, cells, op.ref);
        return [{ ...op, set }];
      }
      const inst = instanceOf(def, op.ref);
      if (inst && op.set && isPt(op.set.at)) {
        const at = applyPt(toGroup(op.ref), op.set.at);
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
        const inv = toGroup(r);
        if (!turns(inv)) {
          plain.push(r);
          continue;
        }
        const by = applyVec(inv, op.by);
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
            by: applyVec(t.toLocal, op.by),
          }))!,
        );
      return out;
    }
    case "place": {
      const placed = (inv: Transform2D): SceneOp => {
        const anchor = transformAnchor(op.anchor, inv);
        return { ...op, at: applyPt(inv, op.at), ...(anchor !== undefined ? { anchor } : {}) };
      };
      const child = onChild(op.ref, (t) => ({ ...placed(t.toLocal), ref: scratchRef(t.child) }));
      if (child) return child;
      const inv = toGroup(op.ref);
      return isIdentity(inv) ? [op] : [placed(inv)];
    }
    case "setZ": {
      const children = op.refs.filter((r) => parseChildRef(r));
      if (children.length === 0) return [op];
      const rest = op.refs.filter((r) => !parseChildRef(r));
      const out: SceneOp[] = rest.length > 0 ? [{ ...op, refs: rest }] : [];
      for (const r of new Set(children)) {
        const t = childTarget(def, r, registry, prefabs)!;
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
      const inv = invert(groupTransform(def, op.entity.group));
      if (isIdentity(inv)) return [op];
      const entity = entityFromWorld(registry, op.entity as EntityDef, inv, cells);
      return [{ ...op, entity: entity as typeof op.entity }];
    }
    case "instantiate": {
      const g = groupTransform(def, op.instance.group);
      if (isIdentity(g)) return [op];
      const inv = invert(g);
      const instance = { ...op.instance, at: applyPt(inv, op.instance.at) };
      if (turns(g)) {
        const local = composeDihedral(inverseTurn(turnPart(g)), turnOf(op.instance));
        delete instance.rot;
        delete instance.flip;
        if (local.rot !== 0) instance.rot = local.rot;
        if (local.flip) instance.flip = true;
      }
      return [{ ...op, instance }];
    }
    case "paintCells": {
      if (parseChildRef(op.ref))
        refuse(`${op.ref} belongs to an instance; open its prefab to paint its cells.`, op.ref);
      const inv = toGroup(op.ref);
      return cells && turns(inv) ? [transformPaint(op, inv)] : [op];
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
 * document has no groups or instances.
 */
export function issueOnSource(
  source: SceneDefinition,
  origins: readonly ResolvedOrigin[],
  mapBatch: (batch: OpBatch) => SourceBatchResult,
): (issue: SceneIssue) => SceneIssue {
  const plain =
    (source.instances ?? []).length === 0 &&
    (source.groups === undefined || Object.keys(source.groups).length === 0);
  if (plain) return (issue) => issue;
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

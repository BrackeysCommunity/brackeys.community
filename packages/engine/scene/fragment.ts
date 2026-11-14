import { z } from "zod";

import { ENGINE_REGISTRY_ID, type Registry } from "../game/types";
import { bulkEntries, bulkId, bulkKeysOf, parseBulkId } from "./expand";
import { jsonPointer, makeIssue } from "./issues";
import { migrate } from "./migrate";
import { migrateEnvOf, parseScene, type ParseOptions } from "./parse";
import {
  childRef,
  instanceFrame,
  parseChildRef,
  resolveScene,
  resolveWith,
  sceneFrames,
  type SceneFrames,
} from "./resolve";
import {
  builtFor,
  geometryFields,
  InstanceSchema,
  sceneGameOf,
  sceneSchemaFor,
  unknownGameIssue,
} from "./schema";
import { aabb, aabbUnion, translateShape } from "./shape-geometry";
import { parseShape } from "./shapes";
import {
  compose,
  frame,
  frameOf,
  IDENTITY_2D,
  invert,
  isQuarterTurn,
  type Transform2D,
} from "./transform";
import { isZeroPt, translateBulkEntry, translateEntityDef } from "./translate";
import {
  PARENT_MAX_DEPTH,
  RESERVED_SCENE_KEYS,
  SCENE_FORMAT_VERSION,
  type Aabb,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type InstanceDef,
  type PathDef,
  type PrefabLibrary,
  type Pt,
  type Ref,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
  type ShapeInput,
  type ShapeObj,
} from "./types";
import { roundLength } from "./units";

export const FRAGMENT_KIND = "scene-fragment";

/**
 * A piece of a scene on its own: what copy puts on the clipboard as JSON
 * text, so it also pastes into and out of a chat with an agent. Bulk
 * entries have no ids, so they travel under their bulk key.
 */
export type SceneFragment = {
  kind: typeof FRAGMENT_KIND;
  /** The scene format version the fragment was written at. */
  v: number;
  /** The game whose registry judges it; omitted, whichever registry it is pasted into. */
  game?: string;
  entities: EntityDef[];
  bulk?: Record<BulkKey, BulkEntry[]>;
  /** Copied instances; their prefabs travel by id, not in the fragment. */
  instances?: InstanceDef[];
};

const clone = <T>(v: T): T => structuredClone(v);

/** `inst` with the steps above it, innermost first, folded into its `at`, angle and flip. */
function placedInstance(inst: InstanceDef, steps: readonly Transform2D[]): InstanceDef {
  const out = clone(inst);
  if (steps.length === 0) return out;
  const t = steps.reduce((acc, s) => compose(s, acc), frame(instanceFrame(inst)));
  const { rot, flip } = frameOf(t);
  out.at = isQuarterTurn(rot) ? [t.tx, t.ty] : [roundLength(t.tx), roundLength(t.ty)];
  delete out.rot;
  delete out.flip;
  if (rot !== 0) out.rot = rot;
  if (flip) out.flip = true;
  return out;
}

/** An entity's stored fields under `t`, exactly as resolving places a child. */
function placedEntity(
  def: SceneDefinition,
  registry: Registry,
  e: EntityDef,
  t: Transform2D,
): EntityDef {
  const one: SceneFrames = {
    stepsFor: () => [t],
    under: () => [],
    parentOf: () => undefined,
    hidden: () => false,
    placed: () => null,
  };
  const scratch = fragmentScene({ kind: FRAGMENT_KIND, v: def.v, entities: [e] });
  if (def.settings) scratch.settings = def.settings;
  return resolveWith(scratch, registry, one, false).def.entities?.[0] ?? e;
}

const composeAll = (steps: readonly Transform2D[]): Transform2D =>
  steps.reduce((acc, t) => compose(t, acc), IDENTITY_2D);

const sameTransform = (x: Transform2D, y: Transform2D) =>
  (["a", "b", "c", "d", "tx", "ty"] as const).every((k) => Math.abs(x[k] - y[k]) < 1e-9);

/**
 * Rewrites, level by level below the roots, what sits under a parent whose
 * frame its new place changed (an entity whose frame comes from its
 * geometry carries no flip, and a point no angle), so each keeps the world
 * pose `frames` gives it. `entities` and `instances` are the fragment's,
 * rewritten in place.
 */
function keepInPlace(
  def: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  frames: SceneFrames,
  entities: EntityDef[],
  instances: InstanceDef[],
): void {
  let level = new Set(
    [...entities, ...instances].filter((x) => x.parent === undefined).map((x) => x.id),
  );
  for (let guard = 0; level.size > 0 && guard <= PARENT_MAX_DEPTH + 1; guard++) {
    const scene = fragmentScene({ kind: FRAGMENT_KIND, v: def.v, entities, instances });
    if (def.settings) scene.settings = def.settings;
    const now = sceneFrames(scene, registry, prefabs);
    const next = new Set<string>();
    const shift = (x: { id: string; parent?: Ref }): Transform2D | null => {
      const p = x.parent;
      if (p === undefined || !(level.has(p) || level.has(parseChildRef(p)?.instance ?? p)))
        return null;
      next.add(x.id);
      return compose(invert(composeAll(now.under(p))), composeAll(frames.under(p)));
    };
    entities.forEach((e, i) => {
      const t = shift(e);
      if (t && !sameTransform(t, IDENTITY_2D)) entities[i] = placedEntity(def, registry, e, t);
    });
    instances.forEach((inst, i) => {
      const t = shift(inst);
      if (t && !sameTransform(t, IDENTITY_2D)) instances[i] = placedInstance(inst, [t]);
    });
    level = next;
  }
}

/** A ref with its depth below the scene's root: 0 for a root, 1 for a root's child, and so on. */
export type SubtreeEntry = { ref: Ref; depth: number };

/**
 * `refs` and everything below them in `def`, each once: `refs` in their
 * order, then the entities and instances whose parent chain, read
 * leniently, reaches one of them. What sits under an instance's children
 * (`gate-2/door`) is below the instance. Refs that aren't entities or
 * instances of `def` (bulk entries, instance children, missing ids) stay
 * as given, with nothing below them but what names them as a parent.
 */
export function withSubtrees(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
  prefabs?: PrefabLibrary,
): SubtreeEntry[] {
  return subtreeIn(def, refs, sceneFrames(def, registry, prefabs));
}

function subtreeIn(def: SceneDefinition, refs: readonly Ref[], frames: SceneFrames) {
  const byParent = new Map<Ref, string[]>();
  const byInstance = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, id: string) => {
    const list = map.get(key);
    if (list) list.push(id);
    else map.set(key, [id]);
  };
  const items = [...(def.entities ?? []), ...(def.instances ?? [])];
  for (const { id } of items) {
    const parent = frames.parentOf(id);
    if (parent === undefined) continue;
    push(byParent, parent, id);
    const child = parseChildRef(parent);
    if (child) push(byInstance, child.instance, id);
  }
  const instances = new Set((def.instances ?? []).map((i) => i.id));
  const depths = new Map<string, number>();
  const depthOf = (ref: Ref): number => {
    const child = parseChildRef(ref);
    if (child) return depthOf(child.instance) + 1;
    let d = depths.get(ref);
    if (d === undefined) {
      const parent = frames.parentOf(ref);
      depths.set(ref, (d = parent === undefined ? 0 : depthOf(parent) + 1));
    }
    return d;
  };
  const out: Ref[] = [];
  const seen = new Set<Ref>();
  const visit = (ref: Ref) => {
    if (seen.has(ref)) return;
    seen.add(ref);
    out.push(ref);
  };
  refs.forEach(visit);
  for (let i = 0; i < out.length; i++) {
    const ref = out[i]!;
    byParent.get(ref)?.forEach(visit);
    if (instances.has(ref)) byInstance.get(ref)?.forEach(visit);
  }
  return out.map((ref) => ({ ref, depth: parseBulkId(ref) ? 0 : depthOf(ref) }));
}

/**
 * The entities, instances and bulk entries `refs` name, in document order,
 * with everything below them (`withSubtrees`); refs that don't resolve are
 * skipped. The fragment's roots (what has no parent in it) stand where the
 * resolved view puts them, in world coordinates, under nothing; what sits
 * under one of them keeps its `parent` and its stored geometry, rewritten
 * only where a root's own fields can't carry the turn or flip it stood in.
 * An instance travels as itself, its prefab by id; a child of an instance
 * (`gate-2/door`, resolved through `prefabs`) travels as a plain root
 * entity, unless its instance is copied too.
 */
export function fragmentOf(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
  prefabs?: PrefabLibrary,
): SceneFragment {
  const named: Ref[] = [];
  const picked = new Map<BulkKey, Set<number>>();
  for (const ref of refs) {
    const p = parseBulkId(ref);
    if (!p) named.push(ref);
    else if (registry.bulkKey(p.key))
      picked.set(p.key, (picked.get(p.key) ?? new Set()).add(p.index));
  }
  const frames = sceneFrames(def, registry, prefabs);
  const ids = new Set(subtreeIn(def, named, frames).map((e) => e.ref));
  const view = resolveScene(def, registry, prefabs);
  const bulk: Record<BulkKey, BulkEntry[]> = {};
  for (const key of bulkKeysOf(view)) {
    const want = picked.get(key);
    if (!want) continue;
    const entries = bulkEntries(view, key).filter((_, i) => want.has(i));
    if (entries.length > 0) bulk[key] = clone(entries);
  }
  const copied = new Set((def.instances ?? []).filter((i) => ids.has(i.id)).map((i) => i.id));
  const inCopied = (id: string) => {
    const child = parseChildRef(id);
    return child !== null && copied.has(child.instance);
  };
  const inside = (parent: Ref | undefined) =>
    parent !== undefined && (ids.has(parent) || inCopied(parent));
  const instances = (def.instances ?? [])
    .filter((i) => ids.has(i.id))
    .map((i) => {
      if (inside(frames.parentOf(i.id))) return clone(i);
      const out = placedInstance(i, frames.stepsFor(i));
      delete out.parent;
      return out;
    });
  const own = new Map((def.entities ?? []).map((e) => [e.id, e]));
  const entities = (view.entities ?? [])
    .filter((e) => ids.has(e.id) && !inCopied(e.id))
    .map((e) => {
      const stored = own.get(e.id);
      if (stored && inside(frames.parentOf(e.id))) return clone(stored);
      const out = clone(e);
      delete out.parent;
      // The resolved view hides what sits under an `off` parent; a root keeps only its own `off`.
      if (stored && stored.off !== true) delete out.off;
      return out;
    });
  keepInPlace(def, registry, prefabs, frames, entities, instances);
  // A copied child becomes a plain entity under its own id, and refs to it in the fragment follow.
  const taken = new Set([...entities.map((e) => e.id), ...copied]);
  const renamed = new Map<string, string>();
  for (const e of entities) {
    if (!parseChildRef(e.id)) continue;
    const to = nextFreeId(plainId(e), taken);
    taken.add(to);
    renamed.set(e.id, to);
  }
  if (renamed.size > 0)
    for (const e of entities) {
      for (const { segs, value } of refFields(registry, e)) {
        const follow = (id: unknown) => renamed.get(id as string) ?? id;
        setAt(e, segs, Array.isArray(value) ? value.map(follow) : follow(value));
      }
      if (e.parent !== undefined) e.parent = renamed.get(e.parent) ?? e.parent;
      e.id = renamed.get(e.id) ?? e.id;
    }
  return {
    kind: FRAGMENT_KIND,
    v: SCENE_FORMAT_VERSION,
    ...(def.game !== undefined ? { game: def.game } : {}),
    entities,
    ...(Object.keys(bulk).length > 0 ? { bulk } : {}),
    ...(instances.length > 0 ? { instances } : {}),
  };
}

/** The id an entity takes outside its instance: a child's own id (`gate-3/door` → `door`), a bulk child's type. */
function plainId(e: EntityDef): string {
  const stem = e.id.slice(e.id.lastIndexOf("/") + 1);
  return stem.startsWith("~") ? e.type : stem;
}

/** The registry a fragment is judged by: its own game's, or `registry` when it names none. */
function fragmentRegistry(game: string | undefined, registry: Registry): Registry | null {
  return game === undefined || (game === registry.id && game !== ENGINE_REGISTRY_ID)
    ? registry
    : null;
}

/**
 * The schema of a fragment judged by `registry`: entities and bulk entries
 * exactly as a scene of that registry holds them.
 */
export function fragmentSchemaFor(registry: Registry): z.ZodObject {
  return builtFor(registry, "fragment", () => buildFragmentSchema(registry));
}

function buildFragmentSchema(registry: Registry): z.ZodObject {
  const scene = sceneSchemaFor(registry).shape;
  const bulk: Record<string, z.ZodType> = {};
  for (const { key } of registry.bulkKeys) bulk[key] = scene[key] as z.ZodType;
  const entities = (scene.entities as z.ZodOptional<z.ZodArray>).unwrap();
  return z
    .strictObject({
      kind: z.literal(FRAGMENT_KIND),
      v: z.literal(SCENE_FORMAT_VERSION).describe("The scene format version it was written at."),
      ...(registry.id === ENGINE_REGISTRY_ID
        ? {}
        : { game: z.literal(registry.id).optional().describe("The game it was copied from.") }),
      entities: entities
        .default([])
        .describe(
          "Entities with their ids, as a scene holds them; ids are renamed on paste if taken.",
        ),
      bulk: z
        .strictObject(bulk)
        .optional()
        .describe("Id-less bulk entries by bulk key, as a scene holds them."),
      instances: z
        .array(InstanceSchema)
        .optional()
        .describe(
          "Prefab instances, as a scene holds them; the prefabs travel by id, and ids are renamed on paste if taken.",
        ),
    })
    .describe(
      "A piece of a scene: entities, instances and bulk entries, copied or written to be pasted.",
    );
}

// ─── Parsing ─────────────────────────────────────────────

export type ParseFragmentResult =
  | { ok: true; fragment: SceneFragment; migratedFrom?: number; issues: SceneIssue[] }
  | { ok: false; issues: SceneIssue[] };

const FRAGMENT_KEYS = ["kind", "v", "game", "entities", "bulk", "instances"];
const SCRATCH_NAME = "fragment";
const SCRATCH_BOUNDS: SceneDefinition["bounds"] = [0, 0, 1, 1];

const schemaIssue = (message: string, path = "", extra: Partial<SceneIssue> = {}) =>
  makeIssue("schema", { message, path, ...extra });

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The fragment as a scene document, which is how migrations and the scene schema see it. */
function asScene(
  raw: Record<string, unknown>,
  bulk: Record<string, unknown>,
): Record<string, unknown> {
  return {
    v: raw.v,
    ...(raw.game !== undefined ? { game: raw.game } : {}),
    name: SCRATCH_NAME,
    bounds: SCRATCH_BOUNDS,
    ...bulk,
    ...(raw.instances !== undefined ? { instances: raw.instances } : {}),
    ...(raw.entities !== undefined ? { entities: raw.entities } : {}),
  };
}

/** A scene-document pointer as it points into the fragment: bulk arrays sit under `bulk`. */
function relocate(pointer: string, bulk: ReadonlySet<string>): string {
  const first = pointer.split("/")[1];
  return first !== undefined && bulk.has(first) ? `/bulk${pointer}` : pointer;
}

/**
 * Parses a fragment from clipboard text or a parsed value: a stale `v` is
 * lifted by the scene migrations, then the fragment is checked against the
 * registry's scene schema. A fragment naming another game fails with
 * `unknown-game`; one naming none is judged by `registry`. Never throws.
 */
export function parseFragment(
  input: unknown,
  registry: Registry,
  opts: ParseOptions = {},
): ParseFragmentResult {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, issues: [schemaIssue(`the text isn't valid JSON: ${detail}`)] };
    }
  }
  if (!isRecord(raw) || raw.kind !== FRAGMENT_KIND) {
    return {
      ok: false,
      issues: [
        schemaIssue(
          `expected a scene fragment, an object with "kind": "${FRAGMENT_KIND}"`,
          isRecord(raw) ? "/kind" : "",
          {
            expected: `"${FRAGMENT_KIND}"`,
            got: isRecord(raw)
              ? JSON.stringify(raw.kind)
              : Array.isArray(raw)
                ? "array"
                : typeof raw,
          },
        ),
      ],
    };
  }
  const extra = Object.keys(raw).filter((k) => !FRAGMENT_KEYS.includes(k));
  if (extra.length > 0) {
    return {
      ok: false,
      issues: extra.map((k) =>
        makeIssue("unknown-key", {
          message: `unknown key "${k}" in the fragment`,
          path: jsonPointer([k]),
          got: k,
          expected: FRAGMENT_KEYS.join(", "),
        }),
      ),
    };
  }
  const bulk = raw.bulk ?? {};
  if (!isRecord(bulk)) {
    return { ok: false, issues: [schemaIssue("bulk must be an object of bulk arrays", "/bulk")] };
  }
  const reserved = Object.keys(bulk).filter((k) => RESERVED_SCENE_KEYS.includes(k));
  if (reserved.length > 0) {
    return {
      ok: false,
      issues: reserved.map((k) => schemaIssue(`"${k}" isn't a bulk key`, jsonPointer(["bulk", k]))),
    };
  }

  const migrated = migrate(asScene(raw, bulk), undefined, undefined, migrateEnvOf(registry, opts));
  if (!migrated.ok) return { ok: false, issues: [migrated.issue] };
  const doc = migrated.raw as Record<string, unknown>;

  const game = sceneGameOf(doc);
  const judge = fragmentRegistry(game, registry);
  if (!judge) return { ok: false, issues: [unknownGameIssue(game!, registry)] };

  const judged =
    game === undefined && judge.id !== ENGINE_REGISTRY_ID ? { ...doc, game: judge.id } : doc;
  const parsed = parseScene(judged, judge, opts);
  const bulkKeys = new Set(bulkKeysOf(judged as SceneDefinition));
  if (!parsed.ok) {
    return {
      ok: false,
      issues: parsed.issues.map((i) => ({
        ...i,
        ...(i.path !== undefined ? { path: relocate(i.path, bulkKeys) } : {}),
      })),
    };
  }

  const entities = parsed.def.entities ?? [];
  const instances = parsed.def.instances ?? [];
  const seen = new Set<string>();
  const dup = (id: string, path: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      return [];
    }
    return [
      makeIssue("dup-id", {
        message: `two entries in the fragment have the id "${id}"`,
        path,
        entityIds: [id],
      }),
    ];
  };
  const dups = [
    ...instances.flatMap((x, i) => dup(x.id, jsonPointer(["instances", i, "id"]))),
    ...entities.flatMap((e, i) => dup(e.id, jsonPointer(["entities", i, "id"]))),
  ];
  if (dups.length > 0) return { ok: false, issues: dups };

  const outBulk: Record<BulkKey, BulkEntry[]> = {};
  for (const key of bulkKeysOf(parsed.def)) outBulk[key] = bulkEntries(parsed.def, key);
  const fragment: SceneFragment = {
    kind: FRAGMENT_KIND,
    v: parsed.def.v,
    ...(game !== undefined ? { game } : {}),
    entities,
    ...(Object.keys(outBulk).length > 0 ? { bulk: outBulk } : {}),
    ...(instances.length > 0 ? { instances } : {}),
  };
  return migrated.from === parsed.def.v
    ? { ok: true, fragment, issues: [] }
    : { ok: true, fragment, migratedFrom: migrated.from, issues: [] };
}

// ─── Geometry ────────────────────────────────────────────

const pointBox = ([x, y]: Pt): Aabb => ({ minX: x, minY: y, maxX: x, maxY: y });

function shapeOf(value: unknown): ShapeObj | undefined {
  const parsed = parseShape(value);
  return parsed.ok ? parsed.shape : undefined;
}

/** An entity's world box: its shapes and points, a path rider's shape carried along its path. */
function entityBox(e: EntityDef, registry: Registry): Aabb | undefined {
  const type = registry.types.get(e.type);
  if (!type) return undefined;
  const shapes: ShapeObj[] = [];
  const boxes: Aabb[] = [];
  const paths: PathDef[] = [];
  for (const { field, kind } of geometryFields(type)) {
    const value = e[field];
    if (value === undefined) continue;
    if (kind === "shape") {
      const s = shapeOf(value);
      if (s) shapes.push(s);
    } else if (kind === "point") boxes.push(pointBox(value as Pt));
    else if (kind === "path") paths.push(value as PathDef);
  }
  if (paths.length === 0) boxes.push(...shapes.map(aabb));
  for (const path of paths)
    for (const p of path.pts) {
      if (shapes.length === 0) boxes.push(pointBox(p));
      for (const s of shapes) boxes.push(aabb(translateShape(s, p)));
    }
  return boxes.reduce<Aabb | undefined>((acc, b) => (acc ? aabbUnion(acc, b) : b), undefined);
}

/** The fragment as a scene document with its entities and instances, which is how frames read it. */
function fragmentScene(fragment: SceneFragment): SceneDefinition {
  return {
    v: fragment.v,
    name: SCRATCH_NAME,
    bounds: SCRATCH_BOUNDS,
    entities: fragment.entities,
    ...(fragment.instances ? { instances: fragment.instances } : {}),
  };
}

/**
 * The world box around everything in the fragment; `null` when nothing in
 * it has a position. What sits under a parent in it counts where the
 * parent puts it. Its instances count with `prefabs`: the box around each
 * one's resolved children (a variant's base and nested instances'
 * children included), turned and flipped with it; one whose prefab isn't
 * there is skipped.
 */
export function fragmentBounds(
  fragment: SceneFragment,
  registry: Registry,
  prefabs?: PrefabLibrary,
): Aabb | null {
  let box: Aabb | undefined;
  const add = (b: Aabb | undefined) => {
    if (b) box = box ? aabbUnion(box, b) : b;
  };
  const scene = fragmentScene(fragment);
  const placed = resolveWith(scene, registry, sceneFrames(scene, registry, prefabs), true).def;
  for (const e of placed.entities ?? []) add(entityBox(e, registry));
  for (const [key, entries] of Object.entries(fragment.bulk ?? {})) {
    const info = registry.bulkKey(key);
    if (!info) continue;
    for (const entry of entries) {
      if (info.form === "point") add(pointBox(entry as Pt));
      else {
        const s = shapeOf(entry);
        if (s) add(aabb(s));
      }
    }
  }
  return box ?? null;
}

// ─── Placing a fragment ──────────────────────────────────

/** `id` when it's free, else the next free `<stem>-<n>` (`lift` → `lift-2`, `lift-2` → `lift-3`), at most 48 characters. */
export function nextFreeId(id: string, taken: ReadonlySet<string>): string {
  if (!taken.has(id)) return id;
  const m = /^(.*?)-(\d+)$/.exec(id);
  const stem = m ? m[1]! : id;
  for (let n = m ? Number(m[2]) + 1 : 2; ; n++) {
    const suffix = `-${n}`;
    const next = `${stem.slice(0, 48 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(next)) return next;
  }
}

/** Every id a scene's entities and instances hold; a new one must avoid them all. */
export function takenIds(def: SceneDefinition): Set<string> {
  return new Set([
    ...(def.entities ?? []).map((e) => e.id),
    ...(def.instances ?? []).map((i) => i.id),
  ]);
}

/** Each reference field of an entity, as dot-path segments and the ids it names. */
function refFields(registry: Registry, e: EntityDef) {
  return (registry.types.get(e.type)?.refs ?? []).flatMap(({ field }) => {
    const segs = field.split(".");
    let value: unknown = e;
    for (const s of segs) value = (value as Record<string, unknown> | undefined)?.[s];
    return value === undefined ? [] : [{ field, segs, value }];
  });
}

function setAt(root: object, segs: string[], value: unknown): void {
  let cur = root as Record<string, unknown>;
  for (const s of segs.slice(0, -1)) cur = cur[s] as Record<string, unknown>;
  const last = segs[segs.length - 1]!;
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

export type PlacedFragment = {
  /**
   * `addBulk` ops, then one `add` per entity, then one `instantiate` per
   * instance, except that anything placed under a parent from the fragment
   * comes after that parent.
   */
  ops: SceneOp[];
  /** The refs the ops create, bulk entries at the indices they will have. */
  select: Ref[];
  /** Each placed entity's and instance's id, by its id in the fragment. */
  ids: Record<string, Ref>;
  issues: SceneIssue[];
};

/** One `add` or `instantiate` waiting for its place in the batch. */
type Placing = {
  op: SceneOp;
  id: string;
  /** The entity or instance of the fragment it sits under, which must be placed first. */
  after?: string;
  issues: ((index: number) => SceneIssue)[];
};

/**
 * `items` in order, except that one whose `owner` is another item comes
 * after that item, so a parent is placed before what sits under it; a
 * cycle keeps its order.
 */
export function parentsFirst<T>(
  items: readonly T[],
  id: (item: T) => string,
  owner: (item: T) => string | undefined,
): T[] {
  const ids = new Set(items.map(id));
  const done = new Set<string>();
  const out: T[] = [];
  let left = [...items];
  while (left.length > 0) {
    const next = left.filter((item) => {
      const o = owner(item);
      if (o !== undefined && o !== id(item) && ids.has(o) && !done.has(o)) return true;
      out.push(item);
      done.add(id(item));
      return false;
    });
    if (next.length === left.length) {
      out.push(...next);
      break;
    }
    left = next;
  }
  return out;
}

/**
 * The ops that put a fragment into `def`, moved by `by`: ids that clash
 * with `def`'s entities or instances renamed (`lift` → `lift-2`, `gate-2`
 * → `gate-3`), references inside the fragment following the renames (a
 * child ref `gate-2/door` with its instance), and references out of it
 * kept when their target exists in `def`, else cleared with a
 * `dangling-ref` warning. `parent` is a reference like the others: what
 * sits under a parent from the fragment keeps its stored geometry, which
 * is in that parent's frame, and moves with it; everything else moves by
 * `by`. An instance whose prefab isn't in `prefabs` places nothing and
 * warns `prefab-unknown`. Paste and unpack both place fragments this way.
 */
export function placeFragment(
  fragment: SceneFragment,
  def: SceneDefinition,
  registry: Registry,
  by: Pt,
  prefabs?: PrefabLibrary,
): PlacedFragment {
  const existing = takenIds(def);
  const existingInstances = new Set((def.instances ?? []).map((i) => i.id));
  const fragmentInstances = fragment.instances ?? [];
  const taken = new Set([
    ...existing,
    ...fragment.entities.map((e) => e.id),
    ...fragmentInstances.map((i) => i.id),
  ]);
  const renamed = new Map<string, string>();
  for (const e of fragment.entities) {
    const own = plainId(e);
    if (own === e.id && !existing.has(e.id)) continue;
    const to = nextFreeId(own, taken);
    taken.add(to);
    renamed.set(e.id, to);
  }
  const ops: SceneOp[] = [];
  const select: Ref[] = [];
  const issues: SceneIssue[] = [];

  const placing: InstanceDef[] = [];
  const instanceRenamed = new Map<string, string>();
  fragmentInstances.forEach((inst, i) => {
    if (!prefabs?.has(inst.prefab)) {
      issues.push(
        makeIssue("prefab-unknown", {
          severity: "warn",
          message: `${inst.id} places the prefab "${inst.prefab}", which this project doesn't have, so nothing is placed for it`,
          path: jsonPointer(["instances", i, "prefab"]),
          entityIds: [inst.id],
          got: inst.prefab,
        }),
      );
      return;
    }
    placing.push(inst);
    if (!existing.has(inst.id)) return;
    const to = nextFreeId(inst.id, taken);
    taken.add(to);
    instanceRenamed.set(inst.id, to);
  });
  const placedInstances = new Set(placing.map((i) => instanceRenamed.get(i.id) ?? i.id));
  const internal = new Set(fragment.entities.map((e) => renamed.get(e.id) ?? e.id));

  const follow = (id: unknown): unknown => {
    if (typeof id !== "string") return id;
    const own = renamed.get(id);
    if (own !== undefined) return own;
    const child = parseChildRef(id);
    const to = child ? instanceRenamed.get(child.instance) : undefined;
    return child && to !== undefined ? childRef(to, child.child) : (instanceRenamed.get(id) ?? id);
  };
  /** The placed entity or instance a followed ref lands on, when the fragment places it. */
  const placedOwner = (id: unknown): string | undefined => {
    if (typeof id !== "string") return undefined;
    if (internal.has(id) || placedInstances.has(id)) return id;
    const child = parseChildRef(id);
    return child && placedInstances.has(child.instance) ? child.instance : undefined;
  };
  const keep = (id: unknown): boolean => {
    if (typeof id !== "string") return false;
    if (placedOwner(id) !== undefined || existing.has(id)) return true;
    const child = parseChildRef(id);
    return child !== null && existingInstances.has(child.instance);
  };
  const dangling =
    (from: string, field: string, dropped: unknown[], at: string, id: string) => (index: number) =>
      makeIssue("dangling-ref", {
        severity: "warn",
        message: `${from}.${field} named ${dropped.map((d) => `"${String(d)}"`).join(", ")}, which isn't in this scene, so the placed copy doesn't`,
        path: `/ops/${index}/${at}`,
        entityIds: [id],
      });
  /** The followed `parent`, kept or cleared with a warning; whether it is one the fragment places. */
  const placeParent = (
    from: { id: string; parent?: Ref },
    out: { id: string; parent?: Ref },
    kind: "entity" | "instance",
    pending: Placing["issues"],
  ): string | undefined => {
    if (from.parent === undefined) return undefined;
    const parent = follow(from.parent) as string;
    if (keep(parent)) {
      out.parent = parent;
      return placedOwner(parent);
    }
    delete out.parent;
    pending.push(dangling(from.id, "parent", [parent], `${kind}/parent`, out.id));
    return undefined;
  };

  for (const [key, entries] of Object.entries(fragment.bulk ?? {})) {
    const info = registry.bulkKey(key);
    if (!info || entries.length === 0) continue;
    const moved = isZeroPt(by) ? clone(entries) : entries.map((v) => translateBulkEntry(v, by));
    const start = bulkEntries(def, key).length;
    ops.push(
      info.form === "point"
        ? { op: "addBulk", key, points: moved as Pt[] }
        : { op: "addBulk", key, shapes: moved as ShapeInput[] },
    );
    moved.forEach((_, k) => select.push(bulkId(key, start + k)));
  }

  const ids: Record<string, Ref> = {};
  const items: Placing[] = [];
  for (const entity of fragment.entities) {
    const id = renamed.get(entity.id) ?? entity.id;
    const pending: Placing["issues"] = [];
    const out = { ...clone(entity), id } as EntityDef;
    const after = placeParent(entity, out, "entity", pending);
    const moved =
      after !== undefined || isZeroPt(by)
        ? out
        : { ...(translateEntityDef(registry, out, by) ?? out), id };
    for (const { field, segs, value } of refFields(registry, entity)) {
      const next = (Array.isArray(value) ? value : [value]).map(follow);
      const dropped = next.filter((ref) => !keep(ref));
      const kept = next.filter(keep);
      setAt(moved, segs, Array.isArray(value) ? kept : kept[0]);
      if (dropped.length > 0)
        pending.push(dangling(entity.id, field, dropped, `entity/${segs.join("/")}`, id));
    }
    ids[entity.id] = id;
    items.push({ op: { op: "add", entity: moved }, id, after, issues: pending });
  }

  for (const inst of placing) {
    const id = instanceRenamed.get(inst.id) ?? inst.id;
    const pending: Placing["issues"] = [];
    const out = { ...clone(inst), id };
    const after = placeParent(inst, out, "instance", pending);
    if (after === undefined && !isZeroPt(by)) out.at = [inst.at[0] + by[0], inst.at[1] + by[1]];
    ids[inst.id] = id;
    items.push({ op: { op: "instantiate", instance: out }, id, after, issues: pending });
  }

  for (const item of parentsFirst(
    items,
    (p) => p.id,
    (p) => p.after,
  )) {
    for (const issue of item.issues) issues.push(issue(ops.length));
    ops.push(item.op);
    select.push(item.id);
  }
  return { ops, select, ids, issues };
}

import { z } from "zod";

import { ENGINE_REGISTRY_ID, type Registry } from "../game/types";
import { bulkEntries, bulkId, bulkKeysOf, parseBulkId } from "./expand";
import { jsonPointer, makeIssue } from "./issues";
import { migrate } from "./migrate";
import { parseScene } from "./parse";
import {
  childEntity,
  childRef,
  groupTransform,
  localChildren,
  parseChildRef,
  resolveScene,
  turnOf,
} from "./resolve";
import {
  geometryFields,
  InstanceSchema,
  sceneGameOf,
  sceneSchemaFor,
  unknownGameIssue,
} from "./schema";
import { aabb, aabbUnion, translateShape } from "./shape-geometry";
import { parseShape } from "./shapes";
import { applyPt, composeDihedral, dihedral, type Transform2D } from "./transform";
import { isZeroPt, translateBulkEntry, translateEntityDef } from "./translate";
import {
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

/** An instance with its group's turn and offset folded in: where it stands in the world. */
function worldInstance(def: SceneDefinition, inst: InstanceDef): InstanceDef {
  const out = clone(inst);
  const g = inst.group === undefined ? undefined : def.groups?.[inst.group];
  if (!g?.at) return out;
  out.at = applyPt(groupTransform(def, inst.group), inst.at);
  const d = composeDihedral(turnOf(g), turnOf(inst));
  delete out.rot;
  delete out.flip;
  if (d.rot !== 0) out.rot = d.rot;
  if (d.flip) out.flip = true;
  return out;
}

/**
 * The entities, instances and bulk entries `refs` name, in document order,
 * as the resolved view holds them (world coordinates); refs that don't
 * resolve are skipped. An instance travels as itself, its prefab by id; a
 * child of an instance (`gate-2/door`, resolved through `prefabs`) travels
 * as a plain entity, unless its instance is copied too.
 */
export function fragmentOf(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
  prefabs?: PrefabLibrary,
): SceneFragment {
  const ids = new Set<string>();
  const picked = new Map<BulkKey, Set<number>>();
  for (const ref of refs) {
    const p = parseBulkId(ref);
    if (!p) ids.add(ref);
    else if (registry.bulkKey(p.key))
      picked.set(p.key, (picked.get(p.key) ?? new Set()).add(p.index));
  }
  const view = resolveScene(def, registry, prefabs);
  const bulk: Record<BulkKey, BulkEntry[]> = {};
  for (const key of bulkKeysOf(view)) {
    const want = picked.get(key);
    if (!want) continue;
    const entries = bulkEntries(view, key).filter((_, i) => want.has(i));
    if (entries.length > 0) bulk[key] = clone(entries);
  }
  const instances = (def.instances ?? [])
    .filter((i) => ids.has(i.id))
    .map((i) => worldInstance(def, i));
  const copied = new Set(instances.map((i) => i.id));
  const inCopied = (id: string) => {
    const child = parseChildRef(id);
    return child !== null && copied.has(child.instance);
  };
  const entities = clone((view.entities ?? []).filter((e) => ids.has(e.id) && !inCopied(e.id)));
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
const SCRATCH_BOUNDS = [0, 0, 1, 1];

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
export function parseFragment(input: unknown, registry: Registry): ParseFragmentResult {
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

  const migrated = migrate(asScene(raw, bulk));
  if (!migrated.ok) return { ok: false, issues: [migrated.issue] };
  const doc = migrated.raw as Record<string, unknown>;

  const game = sceneGameOf(doc);
  const judge = fragmentRegistry(game, registry);
  if (!judge) return { ok: false, issues: [unknownGameIssue(game!, registry)] };

  const judged =
    game === undefined && judge.id !== ENGINE_REGISTRY_ID ? { ...doc, game: judge.id } : doc;
  const parsed = parseScene(judged, judge);
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

/** A box under a quarter-turn transform, exactly: such a transform takes a box to a box. */
function transformBox(box: Aabb, t: Transform2D): Aabb {
  const [x0, y0] = applyPt(t, [box.minX, box.minY]);
  const [x1, y1] = applyPt(t, [box.maxX, box.maxY]);
  return {
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  };
}

/**
 * The world box around everything in the fragment; `null` when nothing in
 * it has a position. Its instances count with `prefabs`: the box around
 * each one's children, turned and flipped with it; one whose prefab isn't
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
  for (const e of fragment.entities) add(entityBox(e, registry));
  for (const inst of fragment.instances ?? []) {
    const prefab = prefabs?.get(inst.prefab);
    if (!prefab) continue;
    let local: Aabb | undefined;
    for (const c of localChildren(prefab, inst, registry)) {
      const e = childEntity(c, registry);
      const b = e && entityBox(e, registry);
      if (b) local = local ? aabbUnion(local, b) : b;
    }
    if (local) add(transformBox(local, dihedral(turnOf(inst), inst.at)));
  }
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
  /** `addBulk` ops, then one `add` per entity, then one `instantiate` per instance. */
  ops: SceneOp[];
  /** The refs the ops create, bulk entries at the indices they will have. */
  select: Ref[];
  issues: SceneIssue[];
};

/**
 * The ops that put a fragment into `def`, moved by `by`: ids that clash
 * with `def`'s entities or instances renamed (`lift` → `lift-2`, `gate-2`
 * → `gate-3`), references inside the fragment following the renames (a
 * child ref `gate-2/door` with its instance), and references out of it
 * kept when their target exists in `def`, else cleared with a
 * `dangling-ref` warning. An instance whose prefab isn't in `prefabs`
 * places nothing and warns `prefab-unknown`. Paste and unpack both place
 * fragments this way.
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
  const keep = (id: unknown): boolean => {
    if (typeof id !== "string") return false;
    if (internal.has(id) || existing.has(id) || placedInstances.has(id)) return true;
    const child = parseChildRef(id);
    return (
      child !== null &&
      (placedInstances.has(child.instance) || existingInstances.has(child.instance))
    );
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

  for (const entity of fragment.entities) {
    const moved = isZeroPt(by)
      ? clone(entity)
      : (translateEntityDef(registry, entity, by) ?? clone(entity));
    const out = { ...moved, id: renamed.get(entity.id) ?? entity.id } as Record<string, unknown>;
    for (const { field, segs, value } of refFields(registry, entity)) {
      const next = (Array.isArray(value) ? value : [value]).map(follow);
      const dropped = next.filter((id) => !keep(id));
      const kept = next.filter(keep);
      setAt(out, segs, Array.isArray(value) ? kept : kept[0]);
      if (dropped.length === 0) continue;
      issues.push(
        makeIssue("dangling-ref", {
          severity: "warn",
          message: `${entity.id}.${field} named ${dropped.map((d) => `"${String(d)}"`).join(", ")}, which isn't in this scene, so the placed copy doesn't`,
          path: `/ops/${ops.length}/entity/${segs.join("/")}`,
          entityIds: [String(out.id)],
        }),
      );
    }
    ops.push({ op: "add", entity: out as EntityDef });
    select.push(String(out.id));
  }

  for (const inst of placing) {
    const out = clone(inst);
    out.id = instanceRenamed.get(inst.id) ?? inst.id;
    if (!isZeroPt(by)) out.at = [inst.at[0] + by[0], inst.at[1] + by[1]];
    ops.push({ op: "instantiate", instance: out });
    select.push(out.id);
  }
  return { ops, select, issues };
}

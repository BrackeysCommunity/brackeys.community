import { z } from "zod";

import { ENGINE_REGISTRY_ID, type Registry } from "../game/types";
import { bulkEntries, bulkId, bulkKeysOf, parseBulkId } from "./expand";
import { jsonPointer, makeIssue } from "./issues";
import { migrate } from "./migrate";
import { parseScene } from "./parse";
import { geometryFields, sceneGameOf, sceneSchemaFor, unknownGameIssue } from "./schema";
import { aabb, aabbUnion, translateShape } from "./shape-geometry";
import { parseShape } from "./shapes";
import { isZeroPt, translateBulkEntry, translateEntityDef } from "./translate";
import {
  RESERVED_SCENE_KEYS,
  SCENE_FORMAT_VERSION,
  type Aabb,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type PathDef,
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
};

const clone = <T>(v: T): T => structuredClone(v);

/** The entities and bulk entries `refs` name, in document order; refs that don't resolve are skipped. */
export function fragmentOf(
  def: SceneDefinition,
  refs: readonly Ref[],
  registry: Registry,
): SceneFragment {
  const ids = new Set<string>();
  const picked = new Map<BulkKey, Set<number>>();
  for (const ref of refs) {
    const p = parseBulkId(ref);
    if (!p) ids.add(ref);
    else if (registry.bulkKey(p.key))
      picked.set(p.key, (picked.get(p.key) ?? new Set()).add(p.index));
  }
  const bulk: Record<BulkKey, BulkEntry[]> = {};
  for (const key of bulkKeysOf(def)) {
    const want = picked.get(key);
    if (!want) continue;
    const entries = bulkEntries(def, key).filter((_, i) => want.has(i));
    if (entries.length > 0) bulk[key] = clone(entries);
  }
  return {
    kind: FRAGMENT_KIND,
    v: SCENE_FORMAT_VERSION,
    ...(def.game !== undefined ? { game: def.game } : {}),
    entities: clone((def.entities ?? []).filter((e) => ids.has(e.id))),
    ...(Object.keys(bulk).length > 0 ? { bulk } : {}),
  };
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
    })
    .describe("A piece of a scene: entities and bulk entries, copied or written to be pasted.");
}

// ─── Parsing ─────────────────────────────────────────────

export type ParseFragmentResult =
  | { ok: true; fragment: SceneFragment; migratedFrom?: number; issues: SceneIssue[] }
  | { ok: false; issues: SceneIssue[] };

const FRAGMENT_KEYS = ["kind", "v", "game", "entities", "bulk"];
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
  const seen = new Set<string>();
  const dups = entities.flatMap((e, i) => {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      return [];
    }
    return [
      makeIssue("dup-id", {
        message: `two entities in the fragment have the id "${e.id}"`,
        path: jsonPointer(["entities", i, "id"]),
        entityIds: [e.id],
      }),
    ];
  });
  if (dups.length > 0) return { ok: false, issues: dups };

  const outBulk: Record<BulkKey, BulkEntry[]> = {};
  for (const key of bulkKeysOf(parsed.def)) outBulk[key] = bulkEntries(parsed.def, key);
  const fragment: SceneFragment = {
    kind: FRAGMENT_KIND,
    v: parsed.def.v,
    ...(game !== undefined ? { game } : {}),
    entities,
    ...(Object.keys(outBulk).length > 0 ? { bulk: outBulk } : {}),
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
    else paths.push(value as PathDef);
  }
  if (paths.length === 0) boxes.push(...shapes.map(aabb));
  for (const path of paths)
    for (const p of path.pts) {
      if (shapes.length === 0) boxes.push(pointBox(p));
      for (const s of shapes) boxes.push(aabb(translateShape(s, p)));
    }
  return boxes.reduce<Aabb | undefined>((acc, b) => (acc ? aabbUnion(acc, b) : b), undefined);
}

/** The world box around everything in the fragment; `null` when nothing in it has a position. */
export function fragmentBounds(fragment: SceneFragment, registry: Registry): Aabb | null {
  let box: Aabb | undefined;
  const add = (b: Aabb | undefined) => {
    if (b) box = box ? aabbUnion(box, b) : b;
  };
  for (const e of fragment.entities) add(entityBox(e, registry));
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

function setAt(root: Record<string, unknown>, segs: string[], value: unknown): void {
  let cur = root;
  for (const s of segs.slice(0, -1)) cur = cur[s] as Record<string, unknown>;
  const last = segs[segs.length - 1]!;
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

export type PlacedFragment = {
  /** `addBulk` ops, then one `add` per entity. */
  ops: SceneOp[];
  /** The refs the ops create, bulk entries at the indices they will have. */
  select: Ref[];
  issues: SceneIssue[];
};

/**
 * The ops that put a fragment into `def`, moved by `by`: ids that clash
 * with `def`'s entities or instances renamed (`lift` → `lift-2`),
 * references inside the fragment following the renames, and references
 * out of it kept when their target exists in `def`, else cleared with a
 * `dangling-ref` warning. Paste and unpack both place fragments this way.
 */
export function placeFragment(
  fragment: SceneFragment,
  def: SceneDefinition,
  registry: Registry,
  by: Pt,
): PlacedFragment {
  const existing = takenIds(def);
  const taken = new Set([...existing, ...fragment.entities.map((e) => e.id)]);
  const renamed = new Map<string, string>();
  for (const e of fragment.entities) {
    // An instance child copied from the resolved view (`gate-3/door`, `gate-3/~solid:0`) takes its own id, or its type's.
    const stem = e.id.includes("/") ? e.id.slice(e.id.lastIndexOf("/") + 1) : e.id;
    const own = stem.startsWith("~") ? e.type : stem;
    if (own === e.id && !existing.has(e.id)) continue;
    const to = nextFreeId(own, taken);
    taken.add(to);
    renamed.set(e.id, to);
  }
  const internal = new Set(fragment.entities.map((e) => renamed.get(e.id) ?? e.id));
  const ops: SceneOp[] = [];
  const select: Ref[] = [];
  const issues: SceneIssue[] = [];

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
      const follow = (id: unknown) => renamed.get(id as string) ?? id;
      const keep = (id: unknown) => internal.has(id as string) || existing.has(id as string);
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
  return { ops, select, issues };
}

import { z } from "zod";

import { ID_PATTERN } from "../game/fields";
import type { BulkKeyInfo, Registry } from "../game/types";
import { closest } from "./did-you-mean";
import { bulkOffset, diffScenes, isObj, isStructured } from "./diff";
import { bulkEntries, bulkId, parseBulkId } from "./expand";
import { FRAGMENT_KIND, fragmentBounds, placeFragment, type SceneFragment } from "./fragment";
import { sceneHash } from "./hash";
import { jsonPointer, makeIssue } from "./issues";
import { opBatchSchemaFor, opRefs, sceneOpSchemaFor, usesBulkRefs } from "./ops-schema";
import { entityIssues, suggestType } from "./parse";
import { parsePrefab, prefabBody, prefabOf as prefabFile } from "./prefab";
import {
  localChildren,
  mapResolvedBatch,
  parseChildRef,
  type ChildApply,
  type SourceBatchResult,
} from "./resolve";
import {
  entitySchemaFor,
  geometryFields,
  sceneRegistry,
  unknownGameIssue,
  InstanceSchema,
} from "./schema";
import { aabb } from "./shape-geometry";
import { parseShape, shapeToTuple } from "./shapes";
import {
  addPt,
  movableGeometry,
  presentGeometry,
  translateBulkEntry,
  translateEntityDef,
  translateTuple,
  type GeometryKind,
} from "./translate";
import {
  SCENE_FORMAT_VERSION,
  type Aabb,
  type ApplyOptions,
  type ApplyResult,
  type BulkEntry,
  type BulkKey,
  type EntityDef,
  type EntityInput,
  type GroupDef,
  type InstanceDef,
  type InstanceInput,
  type IssueCode,
  type OpBatch,
  type PathDef,
  type Prefab,
  type PrefabBody,
  type PrefabLibrary,
  type Pt,
  type Ref,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
  type ShapeTuple,
  type SpotAnchor,
} from "./types";
import { validateScene } from "./validate";

/** A bulk entry with identity, so references keep pointing at it while indices shift. */
type Slot = { value: BulkEntry; orig: number | null; demotedFrom?: string; tag?: string };
type EntRec = { def: EntityDef; orig: number | null; origId: string | null; tag?: string };
type InstRec = { def: InstanceDef; orig: number | null; origId: string | null; tag?: string };
type Target =
  | { kind: "bulk"; info: BulkKeyInfo; slot: Slot }
  | { kind: "entity"; rec: EntRec }
  | { kind: "instance"; rec: InstRec };
type Json = Record<string, unknown>;

type Work = {
  registry: Registry;
  name: string;
  bounds: SceneDefinition["bounds"];
  settings: Json;
  settingsTouched: boolean;
  buckets: Map<BulkKey, Slot[]>;
  /** Each bucket's slots as the batch found them, for start-of-batch references. */
  start: Map<BulkKey, Slot[]>;
  touchedBuckets: Set<BulkKey>;
  entities: EntRec[];
  entitiesTouched: boolean;
  instances: InstRec[];
  instancesTouched: boolean;
  groups: Record<string, GroupDef>;
  groupsTouched: boolean;
  prefabs: Map<string, Prefab>;
  /** Prefab ids the batch set or deleted. */
  prefabsChanged: Set<string>;
  created: string[];
  /** Start-of-batch bulk refs that were promoted, to the id they became. */
  promoted: Map<Ref, string>;
  /** The document the batch started from, for ops that read the whole current state. */
  startDef: SceneDefinition;
};

class OpFailure extends Error {
  constructor(readonly issue: SceneIssue) {
    super(issue.message);
  }
}

function fail(
  code: IssueCode,
  message: string,
  fields: Partial<Omit<SceneIssue, "code" | "message">> = {},
): never {
  throw new OpFailure(makeIssue(code, { message, ...fields }));
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies a batch atomically: every op resolves its refs against the
 * document the batch started from, and the result carries the inverse batch,
 * the diff and (unless `validate: "none"`) the structural issues of the new
 * document. Types, bulk keys and settings come from the registry the scene's
 * `game` picks out of `given` (`sceneRegistry`), as `validateScene` judges it.
 */
export function applyOps(
  def: SceneDefinition,
  batch: OpBatch,
  given: Registry,
  opts: ApplyOptions = {},
): ApplyResult {
  return applyOpsTracked(def, batch, given, opts).result;
}

/**
 * Opaque identities for a document's entries, by position: one per entity,
 * and one per entry of each bulk key. They follow their entry through the
 * batch, across renames, index shifts, promotes and demotes; a new entry has
 * none.
 */
export type EntryTags = {
  entities: (string | undefined)[];
  buckets: Map<BulkKey, (string | undefined)[]>;
  instances?: (string | undefined)[];
};

/** `applyOps`, plus where each entry of the result came from, as `tags` gave them. */
export function applyOpsTracked(
  def: SceneDefinition,
  batch: OpBatch,
  given: Registry,
  opts: ApplyOptions = {},
  tags?: EntryTags,
): { result: ApplyResult; tags?: EntryTags } {
  const result = run(def, batch, given, opts, tags);
  if (!("work" in result)) return { result };
  const { work: w, ...ok } = result;
  if (!tags) return { result: ok };
  const buckets = new Map(tags.buckets);
  for (const key of w.touchedBuckets)
    buckets.set(
      key,
      w.buckets.get(key)!.map((s) => s.tag),
    );
  return {
    result: ok,
    tags: {
      entities: w.entitiesTouched ? w.entities.map((r) => r.tag) : tags.entities,
      buckets,
      instances: w.instancesTouched ? w.instances.map((r) => r.tag) : (tags.instances ?? []),
    },
  };
}

function run(
  def: SceneDefinition,
  batch: OpBatch,
  given: Registry,
  opts: ApplyOptions,
  tags: EntryTags | undefined,
): ApplyResult | (Extract<ApplyResult, { ok: true }> & { work: Work }) {
  const startHash = sceneHash(def);
  const registry = sceneRegistry(def.game, given);
  if (!registry)
    return { ok: false, hash: startHash, failedAt: 0, issue: unknownGameIssue(def.game!, given) };

  const parsed = opBatchSchemaFor(registry).safeParse(batch);
  if (!parsed.success) {
    const first = parsed.error.issues[0]!;
    const segs = first.path.map((p) => (typeof p === "symbol" ? String(p) : p));
    const failedAt = segs[0] === "ops" && typeof segs[1] === "number" ? segs[1] : 0;
    return {
      ok: false,
      hash: startHash,
      failedAt,
      issue: batchIssue(registry, first, segs, batch),
    };
  }

  if (usesBulkRefs(batch) && batch.base !== startHash) {
    const failedAt = batch.ops.findIndex((op) => opRefs(op).some((r) => r.startsWith("~")));
    return {
      ok: false,
      hash: startHash,
      failedAt,
      issue: makeIssue("stale-base", {
        message: batch.base
          ? `The batch was written against scene ${batch.base}, but the scene is now ${startHash}, so its ~ references may point at different entries.`
          : "The batch uses ~ bulk references but has no base hash.",
        path: batch.base ? "/base" : "",
        expected: batch.base,
        got: startHash,
        hint: "Re-read the scene and rebuild the batch against the current hash, or promote the bulk entries to ids and refer to those.",
      }),
    };
  }

  const start = clone(def);
  const w = initWork(start, registry, tags, opts.prefabs);
  for (let i = 0; i < batch.ops.length; i++) {
    try {
      applyOp(w, batch.ops[i]!, i);
    } catch (err) {
      if (err instanceof OpFailure) {
        const issue =
          err.issue.path === undefined ? { ...err.issue, path: `/ops/${i}` } : err.issue;
        return { ok: false, hash: startHash, failedAt: i, issue };
      }
      throw err;
    }
  }

  const after = materialize(start, w);
  const hash = sceneHash(after);
  const prefabs = w.prefabsChanged.size > 0 ? (w.prefabs as PrefabLibrary) : opts.prefabs;
  const inverse: OpBatch = { ops: buildInverse(start, w, opts.prefabs ?? new Map()) };
  if (batch.label) inverse.label = `Undo ${batch.label}`;
  if (usesBulkRefs(inverse)) inverse.base = hash;

  return {
    ok: true,
    def: after,
    hash,
    inverse,
    touched: touchedRefs(start, w),
    created: w.created,
    remap: refRemap(start, w),
    diff: diffScenes(def, after),
    issues: opts.validate === "none" ? [] : validateScene(after, given, { prefabs }),
    ...(w.prefabsChanged.size > 0
      ? { prefabs: w.prefabs, prefabsChanged: [...w.prefabsChanged].sort() }
      : {}),
    work: w,
  };
}

function initWork(
  start: SceneDefinition,
  registry: Registry,
  tags: EntryTags | undefined,
  prefabs: PrefabLibrary | undefined,
): Work {
  const buckets = new Map<BulkKey, Slot[]>();
  const startSlots = new Map<BulkKey, Slot[]>();
  for (const { key } of registry.bulkKeys) {
    const keyTags = tags?.buckets.get(key);
    const slots = bulkEntries(start, key).map(
      (value, i): Slot => ({ value, orig: i, tag: keyTags?.[i] }),
    );
    buckets.set(key, slots);
    startSlots.set(key, [...slots]);
  }
  return {
    registry,
    name: start.name,
    bounds: start.bounds,
    settings: clone(start.settings ?? {}),
    settingsTouched: false,
    buckets,
    start: startSlots,
    touchedBuckets: new Set(),
    entities: (start.entities ?? []).map((d, i) => ({
      def: d,
      orig: i,
      origId: d.id,
      tag: tags?.entities[i],
    })),
    entitiesTouched: false,
    instances: (start.instances ?? []).map((d, i) => ({
      def: d,
      orig: i,
      origId: d.id,
      tag: tags?.instances?.[i],
    })),
    instancesTouched: false,
    groups: clone(start.groups ?? {}),
    groupsTouched: false,
    prefabs: new Map(prefabs ?? []),
    prefabsChanged: new Set(),
    created: [],
    promoted: new Map(),
    startDef: start,
  };
}

function materialize(start: SceneDefinition, w: Work): SceneDefinition {
  const out: Json = { ...start, name: w.name, bounds: w.bounds };
  if (w.settingsTouched) {
    if (Object.keys(w.settings).length > 0) out.settings = w.settings;
    else delete out.settings;
  }
  for (const key of w.touchedBuckets) {
    const values = w.buckets.get(key)!.map((s) => s.value);
    if (values.length > 0) out[key] = values;
    else delete out[key];
  }
  if (w.entitiesTouched) {
    if (w.entities.length > 0) out.entities = w.entities.map((r) => r.def);
    else delete out.entities;
  }
  if (w.instancesTouched) {
    if (w.instances.length > 0) out.instances = w.instances.map((r) => r.def);
    else delete out.instances;
  }
  if (w.groupsTouched) {
    if (Object.keys(w.groups).length > 0) out.groups = sortedGroups(w.groups);
    else delete out.groups;
  }
  return out as SceneDefinition;
}

function sortedGroups(groups: Record<string, GroupDef>): Record<string, GroupDef> {
  const out: Record<string, GroupDef> = {};
  for (const id of Object.keys(groups).sort()) out[id] = groups[id]!;
  return out;
}

// ─── Resolution and checks ───────────────────────────────

function resolve(w: Work, ref: Ref): Target {
  if (!ref.startsWith("~")) return resolveNamed(w, ref);
  const p = parseBulkId(ref);
  const info = p ? w.registry.bulkKey(p.key) : undefined;
  if (!p || !info) {
    const keys = w.registry.bulkKeys.map((b) => b.key);
    const suggestion = p ? closest(p.key, keys) : undefined;
    fail(
      "ref-not-found",
      `${ref} is not a bulk reference; expected ~<bulkKey>:<index> with a key from ${keys.join(", ")}${
        p && suggestion ? `; did you mean ~${suggestion}:${p.index}?` : "."
      }`,
      { got: ref },
    );
  }
  const slot = w.start.get(info.key)![p.index];
  if (!slot) {
    fail(
      "ref-not-found",
      `${ref} doesn't exist: ${info.key} had ${w.start.get(info.key)!.length} entries when the batch started.`,
      { got: ref },
    );
  }
  if (!w.buckets.get(info.key)!.includes(slot)) {
    fail("ref-not-found", `${ref} was already removed or promoted earlier in this batch.`, {
      got: ref,
    });
  }
  return { kind: "bulk", info, slot };
}

function notFound(w: Work, id: string): never {
  const child = parseChildRef(id);
  if (child) {
    fail(
      "ref-not-found",
      `${id} is a child of instance ${child.instance}; edit it with an override op, or through the editor's resolved view.`,
      {
        got: id,
        hint: `{ "op": "override", "ref": "${child.instance}", "set": { "${child.child}.<field>": ... } }`,
      },
    );
  }
  const suggestion = closest(id, [
    ...w.entities.map((r) => r.def.id),
    ...w.instances.map((r) => r.def.id),
  ]);
  fail(
    "ref-not-found",
    `No entity has the id "${id}"${suggestion ? `; did you mean "${suggestion}"?` : "."}`,
    { got: id },
  );
}

function resolveEntity(w: Work, id: string): EntRec {
  const rec = w.entities.find((r) => r.def.id === id);
  if (!rec) {
    if (w.instances.some((r) => r.def.id === id))
      fail("op-invalid", `${id} is an instance, not an entity.`, { entityIds: [id] });
    notFound(w, id);
  }
  return rec;
}

function resolveInstance(w: Work, id: string): InstRec {
  const rec = w.instances.find((r) => r.def.id === id);
  if (!rec) {
    if (w.entities.some((r) => r.def.id === id))
      fail("op-invalid", `${id} is an entity, not a prefab instance.`, { entityIds: [id] });
    notFound(w, id);
  }
  return rec;
}

/** An entity or an instance by id. */
function resolveNamed(w: Work, id: string): Target {
  const ent = w.entities.find((r) => r.def.id === id);
  if (ent) return { kind: "entity", rec: ent };
  const inst = w.instances.find((r) => r.def.id === id);
  if (inst) return { kind: "instance", rec: inst };
  return notFound(w, id);
}

/** The prefab an instance or op names, or an op failure. */
function prefabOf(w: Work, id: string, path?: string): Prefab {
  const prefab = w.prefabs.get(id);
  if (!prefab) {
    const known = [...w.prefabs.keys()];
    const suggestion = closest(id, known);
    fail(
      "prefab-unknown",
      `No prefab "${id}"${suggestion ? `; did you mean "${suggestion}"?` : known.length > 0 ? ` (prefabs: ${known.join(", ")})` : "; this scene has no prefabs loaded"}.`,
      { got: id, ...(path ? { path } : {}) },
    );
  }
  return prefab;
}

function checkNewId(w: Work, id: string): void {
  if (!ID_PATTERN.test(id)) {
    fail(
      "bad-id",
      `"${id}" isn't a valid id: use lowercase letters, digits and hyphens, starting with a letter or digit, at most 48 characters.`,
      { got: id, expected: String(ID_PATTERN) },
    );
  }
  if (w.entities.some((r) => r.def.id === id) || w.instances.some((r) => r.def.id === id)) {
    fail("id-taken", `The id "${id}" is already used by another entity.`, {
      entityIds: [id],
      got: id,
      hint: `Pick another id, such as "${freeId(w, id)}".`,
    });
  }
}

function freeId(w: Work, prefix: string): string {
  const ids = new Set([...w.entities.map((r) => r.def.id), ...w.instances.map((r) => r.def.id)]);
  let n = prefix.match(/-\d+$/) ? 2 : 1;
  const stem = prefix.replace(/-\d+$/, "");
  while (ids.has(`${stem}-${n}`)) n++;
  return `${stem}-${n}`;
}

/** Where an entity-relative pointer points in the op that produced the entity. */
type Relocate = (rel: string) => string;

const inEntity =
  (i: number): Relocate =>
  (rel) =>
    `/ops/${i}/entity${rel}`;

/** An update's `set` keys are dotted paths, so an entity field maps to one. */
const inSet =
  (i: number): Relocate =>
  (rel) =>
    rel ? `/ops/${i}/set/${rel.slice(1).split("/").join(".")}` : `/ops/${i}`;

/** A bulk entry's field maps to its item in `shapes` or `points`. */
const inBulkItem =
  (i: number, list: "shapes" | "points", k: number): Relocate =>
  (rel) =>
    `/ops/${i}/${list}/${k}${rel.replace(/^\/(shape|at)/, "")}`;

function validateEntity(w: Work, def: EntityDef, relocate: Relocate, label = def.id): void {
  const schema = entitySchemaFor(w.registry, def.type);
  if (!schema) {
    const suggestion = suggestType(def.type, w.registry);
    fail(
      "unknown-type",
      `${label}: type "${def.type}" isn't registered${suggestion ? `; did you mean "${suggestion}"?` : "."}`,
      { entityIds: [label], got: def.type, expected: w.registry.typeNames.join(" | ") },
    );
  }
  const result = schema.safeParse(def);
  if (!result.success) {
    const issue = entityIssues(result.error.issues, def, relocate, w.registry)[0]!;
    throw new OpFailure({ ...issue, message: `${label}: ${issue.message}`, entityIds: [label] });
  }
}

/** The entity a bulk entry stands for. */
function bulkEntity(info: BulkKeyInfo, value: BulkEntry, id: string): EntityDef {
  const def: EntityDef = { id, type: info.type, [info.field]: clone(value) };
  if (info.material !== undefined) def.material = info.material;
  return def;
}

/** A bulk entry checked against its type's schema, as the entity it stands for. */
function validateBulk(w: Work, info: BulkKeyInfo, value: BulkEntry, relocate: Relocate, ref: Ref) {
  validateEntity(w, bulkEntity(info, value, "bulk-entry"), relocate, ref);
}

const BATCH_KEYS = ["label", "base", "actor", "ops"];

function describeValue(v: unknown): string {
  if (v === undefined) return "missing";
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return typeof v === "string" ? JSON.stringify(v) : typeof v;
}

function valueAt(root: unknown, segs: readonly (string | number)[]): unknown {
  let cur = root;
  for (const s of segs) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[s];
  }
  return cur;
}

type ShapeLike = { shape?: Record<string, { value?: unknown }>; options?: readonly ShapeLike[] };

/** The keys an op of this name takes, from the registry's op schema. */
function opKeys(registry: Registry, name: unknown): string[] {
  const keys = new Set<string>();
  const visit = ({ options, shape }: ShapeLike) => {
    if (options) options.forEach(visit);
    else if (shape && shape.op?.value === name) Object.keys(shape).forEach((k) => keys.add(k));
  };
  (sceneOpSchemaFor(registry).options as readonly ShapeLike[]).forEach(visit);
  return [...keys];
}

/** A batch schema failure as an issue with a pointer, `expected`, `got` and a did-you-mean. */
function batchIssue(
  registry: Registry,
  issue: { code: string; message: string; keys?: string[]; expected?: unknown; values?: unknown[] },
  segs: (string | number)[],
  batch: unknown,
): SceneIssue {
  const path = jsonPointer(segs);
  const where = path || "/";
  if (issue.code === "unrecognized_keys" && issue.keys?.length) {
    const key = issue.keys[0]!;
    const known =
      segs.length === 0
        ? BATCH_KEYS
        : segs.length === 2 && segs[0] === "ops"
          ? opKeys(registry, valueAt(batch, [...segs, "op"]))
          : [];
    const suggestion = closest(key, known);
    return makeIssue("op-invalid", {
      message: `unknown key "${key}" at ${where}${suggestion ? `; did you mean "${suggestion}"?` : ""}`,
      path: `${path}${jsonPointer([key])}`,
      got: key,
      expected: known.length > 0 ? known.join(", ") : undefined,
      hint: suggestion ? `Rename "${key}" to "${suggestion}".` : undefined,
    });
  }
  const got = valueAt(batch, segs);
  if (segs.at(-1) === "type" && segs.at(-2) === "entity") {
    const entity = valueAt(batch, segs.slice(0, -1));
    if (got === undefined && isObj(entity) && "b" in entity) {
      return makeIssue("op-invalid", {
        message: `${where}: the entity has "b" but no "type"; the discriminator is now "type".`,
        path,
        expected: registry.typeNames.join(" | "),
        got: describeValue(got),
        hint: `Rename "b" to "type".`,
      });
    }
    const suggestion = typeof got === "string" ? suggestType(got, registry) : undefined;
    return makeIssue("unknown-type", {
      message: `unknown type ${describeValue(got)} at ${where}${suggestion ? `; did you mean "${suggestion}"?` : ""}`,
      path,
      expected: registry.typeNames.join(" | "),
      got: describeValue(got),
      hint: suggestion
        ? `Use type: "${suggestion}".`
        : `type is one of ${registry.typeNames.join(", ")}.`,
    });
  }
  const expected = Array.isArray(issue.values)
    ? issue.values.map(String).join(" | ")
    : typeof issue.expected === "string"
      ? issue.expected
      : undefined;
  return makeIssue("op-invalid", {
    message: `${where}: ${issue.message}`,
    path,
    expected,
    got: describeValue(got),
  });
}

/** A type's shape fields, which take any shape form and store a tuple. */
function shapeFields(w: Work, type: string): string[] {
  const t = w.registry.types.get(type);
  return t ? geometryFields(t).flatMap((f) => (f.kind === "shape" ? [f.field] : [])) : [];
}

/** Any accepted shape form, stored as a tuple. Type-specific limits are the type schema's. */
function storeShape(input: unknown): ShapeTuple {
  const result = parseShape(input);
  if (!result.ok) throw new OpFailure(result.issue);
  return Array.isArray(input) ? (clone(input) as ShapeTuple) : shapeToTuple(result.shape);
}

const storeBulk = (info: BulkKeyInfo, value: unknown): BulkEntry =>
  info.form === "shape" ? storeShape(value) : (clone(value) as Pt);

function insertIndex(index: number | undefined, length: number, what: string): number {
  if (index === undefined) return length;
  if (index > length)
    fail("op-invalid", `index ${index} is past the end of ${what}, which has ${length} entries.`);
  return index;
}

// ─── Geometry ────────────────────────────────────────────

/** What `move` shifts: a type with a path has its shapes local to the path, so only the path moves. */
function geometryOf(w: Work, def: EntityDef): { field: string; kind: GeometryKind }[] {
  return movableGeometry(w.registry, def);
}

/** The point `move` shifts first, for spotting a pure translation. */
function geometryAnchor(w: Work, def: EntityDef): Pt | undefined {
  const first = geometryOf(w, def)[0];
  if (!first) return undefined;
  const v = def[first.field];
  if (first.kind === "path") return (v as PathDef).pts[0];
  if (first.kind === "point") return v as Pt;
  return [(v as ShapeTuple)[1] as number, (v as ShapeTuple)[2] as number];
}

function translateEntity(w: Work, def: EntityDef, by: Pt): EntityDef {
  const next = translateEntityDef(w.registry, def, by);
  if (!next) fail("op-invalid", `${def.id} has no position to move.`, { entityIds: [def.id] });
  return next;
}

function translateTarget(w: Work, t: Target, by: Pt): void {
  if (t.kind === "bulk") {
    t.slot.value =
      t.info.form === "point"
        ? addPt(t.slot.value as Pt, by)
        : translateTuple(t.slot.value as ShapeTuple, by);
  } else if (t.kind === "instance") {
    t.rec.def = { ...clone(t.rec.def), at: addPt(t.rec.def.at, by) };
  } else {
    t.rec.def = translateEntity(w, t.rec.def, by);
  }
}

/** An instance's children in the prefab's frame, as a fragment, for its extent. */
function instanceFragment(w: Work, inst: InstanceDef): SceneFragment {
  const prefab = prefabOf(w, inst.prefab);
  const entities: EntityDef[] = [];
  const bulk: Record<BulkKey, BulkEntry[]> = {};
  for (const c of localChildren(prefab, inst, w.registry)) {
    if (c.kind === "entity") entities.push(c.def);
    else (bulk[c.key] ??= []).push(c.value);
  }
  return { kind: FRAGMENT_KIND, v: SCENE_FORMAT_VERSION, entities, bulk };
}

/** The shape a spot is measured on and the offset it is local to, a box, or a bare point. */
function spotGeometry(
  w: Work,
  t: Target,
): { tuple: ShapeTuple; offset: Pt } | { box: Aabb } | Pt | null {
  if (t.kind === "instance") {
    const box = fragmentBounds(instanceFragment(w, t.rec.def), w.registry);
    if (!box) return null;
    const [x, y] = t.rec.def.at;
    return {
      box: { minX: box.minX + x, minY: box.minY + y, maxX: box.maxX + x, maxY: box.maxY + y },
    };
  }
  if (t.kind === "bulk") {
    return t.info.form === "point"
      ? (t.slot.value as Pt)
      : { tuple: t.slot.value as ShapeTuple, offset: [0, 0] };
  }
  const def = t.rec.def;
  const fields = presentGeometry(w.registry, def);
  const value = (kind: GeometryKind) => {
    const f = fields.find((g) => g.kind === kind);
    return f ? def[f.field] : undefined;
  };
  const path = value("path") as PathDef | undefined;
  const shape = value("shape") as ShapeTuple | undefined;
  const offset: Pt = path?.pts[0] ?? [0, 0];
  if (shape) return { tuple: shape, offset };
  return path ? offset : ((value("point") as Pt | undefined) ?? null);
}

function spotOf(w: Work, t: Target, ref: Ref, anchor: SpotAnchor): Pt {
  const g = spotGeometry(w, t);
  if (!g) fail("op-invalid", `${ref} has no position to place.`, { entityIds: [ref] });
  if (Array.isArray(g)) return g;
  let box: Aabb;
  let offset: Pt = [0, 0];
  if ("box" in g) box = g.box;
  else {
    const parsed = parseShape(g.tuple);
    if (!parsed.ok) fail("bad-shape", `${ref} has an invalid shape: ${parsed.issue.message}`);
    box = aabb(parsed.shape);
    offset = g.offset;
  }
  const minX = box.minX + offset[0];
  const maxX = box.maxX + offset[0];
  const minY = box.minY + offset[1];
  const maxY = box.maxY + offset[1];
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  switch (anchor) {
    case "top":
      return [cx, minY];
    case "bottom":
      return [cx, maxY];
    case "left":
      return [minX, cy];
    case "right":
      return [maxX, cy];
    default:
      return [cx, cy];
  }
}

// ─── Field paths ─────────────────────────────────────────

function arrayIndex(seg: string, arr: unknown[], allowAppend: boolean, path: string): number {
  if (!/^\d+$/.test(seg)) fail("op-invalid", `${path}: "${seg}" isn't an array index.`);
  const idx = Number(seg);
  if (idx > arr.length || (idx === arr.length && !allowAppend)) {
    fail("op-invalid", `${path}: index ${idx} is out of range; the array has ${arr.length} items.`);
  }
  return idx;
}

function setPath(root: Json, segs: string[], value: unknown, path: string): void {
  let cur: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]!;
    if (Array.isArray(cur)) {
      cur = cur[arrayIndex(seg, cur, false, path)];
    } else {
      const obj = cur as Json;
      if (obj[seg] === undefined) obj[seg] = {};
      cur = obj[seg];
    }
    if (cur === null || typeof cur !== "object") {
      fail(
        "op-invalid",
        `${path}: ${segs.slice(0, i + 1).join(".")} holds a value, not an object or array.`,
      );
    }
  }
  const last = segs[segs.length - 1]!;
  if (Array.isArray(cur)) cur[arrayIndex(last, cur, true, path)] = value;
  else (cur as Json)[last] = value;
}

function unsetPath(root: Json, segs: string[]): void {
  let cur: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || typeof cur !== "object") return;
    cur = (cur as Json)[segs[i]!];
  }
  const last = segs[segs.length - 1]!;
  if (Array.isArray(cur)) {
    const idx = Number(last);
    if (/^\d+$/.test(last) && idx < cur.length) cur.splice(idx, 1);
  } else if (cur !== null && typeof cur === "object") {
    delete (cur as Json)[last];
  }
}

function getPath(root: unknown, segs: string[]): unknown {
  let cur = root;
  for (const seg of segs) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Json)[seg];
  }
  return cur;
}

/** Splits dotted paths, refusing empty segments and a path that overlaps another. */
function splitPaths(paths: string[]): string[][] {
  const split = paths.map((p) => p.split("."));
  for (let i = 0; i < split.length; i++) {
    const a = split[i]!;
    if (a.some((s) => s === ""))
      fail(
        "op-invalid",
        `"${paths[i]}" isn't a field path; use dot-separated names like path.speed.`,
      );
    for (let j = 0; j < split.length; j++) {
      const b = split[j]!;
      if (i !== j && a.length <= b.length && a.every((s, k) => s === b[k])) {
        fail(
          "op-invalid",
          `The update names both "${paths[i]}" and "${paths[j]}"; set or unset each field once.`,
        );
      }
    }
  }
  return split;
}

/** Applies `unset` then `set` to a copy of `root`; `store` normalises a value before it lands. */
function patch(
  root: Json,
  set: Json,
  unset: string[],
  split: string[][],
  store: (path: string, value: unknown) => unknown = (_, v) => clone(v),
): Json {
  const next = clone(root);
  const setKeys = Object.keys(set);
  unset.forEach((_, k) => unsetPath(next, split[setKeys.length + k]!));
  setKeys.forEach((path, k) => setPath(next, split[k]!, store(path, set[path]), path));
  return next;
}

/** Each entity's reference fields that name `id`, as `[rec, field segments, value]`. */
function referencesTo(w: Work, id: string): { rec: EntRec; segs: string[]; value: unknown }[] {
  const out: { rec: EntRec; segs: string[]; value: unknown }[] = [];
  for (const rec of w.entities) {
    for (const { field } of w.registry.types.get(rec.def.type)?.refs ?? []) {
      const segs = field.split(".");
      const value = getPath(rec.def, segs);
      if (value === id || (Array.isArray(value) && value.includes(id)))
        out.push({ rec, segs, value });
    }
  }
  return out;
}

function validateSettings(w: Work, settings: Json, i: number): void {
  const result = z.strictObject(w.registry.settings).safeParse(settings);
  if (result.success) return;
  const first = result.error.issues[0]!;
  const segs = first.path.map(String);
  if (first.code === "unrecognized_keys") {
    const key = first.keys[0]!;
    const known = Object.keys(w.registry.settings);
    const suggestion = closest(key, known);
    fail(
      "unknown-key",
      `unknown settings field "${key}"${suggestion ? `; did you mean "${suggestion}"?` : ""}`,
      {
        path: `/ops/${i}/set/${key}`,
        got: key,
        expected: known.join(", "),
        hint: suggestion ? `Rename "${key}" to "${suggestion}".` : undefined,
      },
    );
  }
  fail("schema", `settings.${segs.join(".")}: ${first.message}`, {
    path: `/ops/${i}/set/${segs.join(".")}`,
    got: describeValue(getPath(settings, segs)),
  });
}

// ─── Ops ─────────────────────────────────────────────────

function applyOp(w: Work, op: SceneOp, i: number): void {
  switch (op.op) {
    case "add": {
      const input = clone(op.entity) as Json;
      const givenId = input.id as string | undefined;
      if (givenId !== undefined) checkNewId(w, givenId);
      delete input.id;
      const entity: Json = { id: givenId ?? freeId(w, String(input.type)), ...input };
      for (const field of shapeFields(w, String(entity.type)))
        if (entity[field] !== undefined) entity[field] = storeShape(entity[field]);
      const def = entity as EntityDef;
      validateEntity(w, def, inEntity(i));
      const index = insertIndex(op.index, w.entities.length, "entities");
      w.entities.splice(index, 0, { def, orig: null, origId: null });
      w.entitiesTouched = true;
      w.created.push(def.id);
      return;
    }
    case "addBulk": {
      const info = w.registry.bulkKey(op.key)!;
      const bucket = w.buckets.get(info.key)!;
      const [list, inputs] =
        "points" in op ? (["points", op.points] as const) : (["shapes", op.shapes] as const);
      const index = insertIndex(op.index, bucket.length, info.key);
      const values = (inputs as readonly unknown[]).map((input, k) => {
        const value = storeBulk(info, input);
        validateBulk(w, info, value, inBulkItem(i, list, k), bulkId(info.key, index + k));
        return value;
      });
      bucket.splice(index, 0, ...values.map((value): Slot => ({ value, orig: null })));
      w.touchedBuckets.add(info.key);
      return;
    }
    case "update": {
      const set = op.set ?? {};
      const unset = op.unset ?? [];
      const setKeys = Object.keys(set);
      if (setKeys.length === 0 && unset.length === 0)
        fail("op-invalid", `update of ${op.ref} has nothing to set or unset.`);
      const split = splitPaths([...setKeys, ...unset]);
      if (split.some((s) => s[0] === "id"))
        fail("op-invalid", "An entity's id can't be set by update; use the rename op.");
      if (split.some((s) => s[0] === "type"))
        fail(
          "op-invalid",
          "An entity's type can't change; remove it and add a new entity instead.",
        );
      const t = resolve(w, op.ref);
      if (t.kind === "instance") {
        if (split.some((p) => p[0] === "overrides" && p.length > 1))
          fail(
            "op-invalid",
            "Override keys hold dots, so they can't be set by update; use the override and revertOverride ops.",
            {
              hint: `{ "op": "override", "ref": "${op.ref}", "set": { "<child>.<field>": ... } }`,
            },
          );
        const next = patch(
          t.rec.def as unknown as Json,
          set,
          unset,
          split,
        ) as unknown as InstanceDef;
        validateInstance(w, next, inSet(i));
        t.rec.def = next;
        w.instancesTouched = true;
        return;
      }
      if (t.kind === "bulk") {
        const { field } = t.info;
        if (unset.length > 0 || setKeys.length !== 1 || setKeys[0] !== field) {
          fail(
            "op-invalid",
            `${op.ref} is a bulk entry, which holds only \`${field}\`; promote it to an entity to give it other fields.`,
            { hint: `{ "op": "promote", "ref": "${op.ref}", "id": "..." }` },
          );
        }
        const value = storeBulk(t.info, set[field]);
        validateBulk(w, t.info, value, inSet(i), op.ref);
        t.slot.value = value;
        w.touchedBuckets.add(t.info.key);
        return;
      }
      const shapes = shapeFields(w, t.rec.def.type);
      const next = patch(t.rec.def, set, unset, split, (path, v) =>
        shapes.includes(path) ? storeShape(v) : clone(v),
      ) as EntityDef;
      validateEntity(w, next, inSet(i));
      t.rec.def = next;
      w.entitiesTouched = true;
      return;
    }
    case "move": {
      const targets = [...new Set(op.refs)].map((r) => resolve(w, r));
      for (const t of targets) markTouched(w, t);
      for (const t of targets) translateTarget(w, t, op.by);
      return;
    }
    case "place": {
      const t = resolve(w, op.ref);
      const spot = spotOf(w, t, op.ref, op.anchor ?? "center");
      markTouched(w, t);
      translateTarget(w, t, [Math.round(op.at[0] - spot[0]), Math.round(op.at[1] - spot[1])]);
      return;
    }
    case "remove": {
      const targets = [...new Set(op.refs)].map((r) => resolve(w, r));
      for (const t of targets) {
        if (t.kind === "bulk") {
          const bucket = w.buckets.get(t.info.key)!;
          bucket.splice(bucket.indexOf(t.slot), 1);
        } else if (t.kind === "instance") {
          w.instances.splice(w.instances.indexOf(t.rec), 1);
        } else {
          w.entities.splice(w.entities.indexOf(t.rec), 1);
        }
        markTouched(w, t);
      }
      return;
    }
    case "rename": {
      const named = resolveNamed(w, op.from);
      if (op.from === op.to) fail("op-invalid", `rename from "${op.from}" to itself does nothing.`);
      checkNewId(w, op.to);
      if (named.kind === "instance") {
        named.rec.def = { ...clone(named.rec.def), id: op.to };
        w.instancesTouched = true;
        return;
      }
      const rec = resolveEntity(w, op.from);
      const referrers = referencesTo(w, op.from);
      rec.def = { ...clone(rec.def), id: op.to };
      for (const { rec: other, segs, value } of referrers) {
        const rewritten = clone(other.def) as Json;
        setPath(
          rewritten,
          segs,
          Array.isArray(value) ? value.map((x) => (x === op.from ? op.to : x)) : op.to,
          segs.join("."),
        );
        other.def = rewritten as EntityDef;
      }
      w.entitiesTouched = true;
      return;
    }
    case "promote": {
      if (!op.ref.startsWith("~"))
        fail(
          "op-invalid",
          `${op.ref} is already an entity; promote takes a bulk reference such as ~solid:3.`,
        );
      const t = resolve(w, op.ref);
      if (t.kind !== "bulk") return;
      checkNewId(w, op.id);
      const def = bulkEntity(t.info, t.slot.value, op.id);
      validateEntity(w, def, () => `/ops/${i}`);
      const bucket = w.buckets.get(t.info.key)!;
      bucket.splice(bucket.indexOf(t.slot), 1);
      w.touchedBuckets.add(t.info.key);
      if (t.slot.orig !== null) w.promoted.set(bulkId(t.info.key, t.slot.orig), op.id);
      w.entities.push({ def, orig: null, origId: null, tag: t.slot.tag });
      w.entitiesTouched = true;
      w.created.push(op.id);
      return;
    }
    case "demote": {
      const rec = resolveEntity(w, op.id);
      const def = rec.def;
      const bulk = w.registry.types.get(def.type)?.bulk;
      if (!bulk) {
        const types = [...new Set(w.registry.bulkKeys.map((b) => b.type))];
        fail(
          "op-invalid",
          `Only entities of a type with a bulk form (${types.join(", ")}) can be demoted; ${def.id} is a ${def.type}.`,
          { entityIds: [def.id] },
        );
      }
      const key = typeof def.material === "string" ? `${def.type}:${def.material}` : def.type;
      const info = w.registry.bulkKey(key);
      const field = bulk.form === "shape" ? "shape" : "at";
      const keys = ["id", "type", field, ...(info?.material !== undefined ? ["material"] : [])];
      const extra = Object.keys(def).filter((k) => !keys.includes(k));
      if (extra.length > 0 || !info) {
        fail(
          "op-invalid",
          `${def.id} has ${extra.join(", ")}, which a bulk entry can't hold; unset ${extra.length === 1 ? "it" : "them"} first.`,
          { entityIds: [def.id] },
        );
      }
      if (!Array.isArray(def[field]))
        fail("op-invalid", `${def.id} has no ${field}, so it can't be demoted to a bulk entry.`, {
          entityIds: [def.id],
        });
      const refs = referencesTo(w, def.id).map((r) => r.rec.def.id);
      if (refs.length > 0)
        fail("op-invalid", `${def.id} is still referenced by ${refs.join(", ")}.`, {
          entityIds: [def.id, ...refs],
        });
      w.entities.splice(w.entities.indexOf(rec), 1);
      w.entitiesTouched = true;
      const slot: Slot = { value: clone(def[field] as BulkEntry), orig: null, tag: rec.tag };
      if (rec.origId !== null) slot.demotedFrom = rec.origId;
      w.buckets.get(info.key)!.push(slot);
      w.touchedBuckets.add(info.key);
      return;
    }
    case "setScene": {
      if (op.set.name !== undefined) w.name = op.set.name;
      if (op.set.bounds !== undefined) {
        const [minX, minY, maxX, maxY] = op.set.bounds;
        if (minX >= maxX || minY >= maxY)
          fail(
            "op-invalid",
            "bounds must be [minX, minY, maxX, maxY] with min below max on both axes.",
          );
        w.bounds = clone(op.set.bounds);
      }
      return;
    }
    case "setSettings": {
      const set = op.set ?? {};
      const unset = op.unset ?? [];
      if (Object.keys(set).length === 0 && unset.length === 0)
        fail("op-invalid", "setSettings has nothing to set or unset.");
      const next = patch(w.settings, set, unset, splitPaths([...Object.keys(set), ...unset]));
      validateSettings(w, next, i);
      w.settings = next;
      w.settingsTouched = true;
      return;
    }
    case "reorder": {
      const targets = [...new Set(op.refs)].map((r) => resolve(w, r));
      const kinds = new Set(targets.map((t) => t.kind));
      if (kinds.has("bulk"))
        fail(
          "op-invalid",
          "Bulk entries keep their order; promote them to entities to order them.",
        );
      if (kinds.size > 1)
        fail("op-invalid", "reorder moves entities or instances, not both in one op.");
      const list: (EntRec | InstRec)[] = kinds.has("instance") ? w.instances : w.entities;
      const recs = targets.map((t) => (t as { rec: EntRec | InstRec }).rec);
      const moving = list.filter((r) => recs.includes(r));
      const rest = list.filter((r) => !recs.includes(r));
      const index = insertIndex(
        op.index,
        rest.length,
        kinds.has("instance") ? "instances" : "entities",
      );
      list.splice(0, list.length, ...rest.slice(0, index), ...moving, ...rest.slice(index));
      if (kinds.has("instance")) w.instancesTouched = true;
      else w.entitiesTouched = true;
      return;
    }
    case "instantiate": {
      const input = clone(op.instance) as Json;
      const givenId = input.id as string | undefined;
      if (givenId !== undefined) checkNewId(w, givenId);
      delete input.id;
      const def = { id: givenId ?? freeId(w, String(input.prefab)), ...input } as InstanceDef;
      validateInstance(w, def, (rel) => `/ops/${i}/instance${rel}`);
      const index = insertIndex(op.index, w.instances.length, "instances");
      w.instances.splice(index, 0, { def, orig: null, origId: null });
      w.instancesTouched = true;
      w.created.push(def.id);
      return;
    }
    case "setGroup": {
      if (!ID_PATTERN.test(op.id))
        fail("bad-id", `"${op.id}" isn't a valid group id.`, { got: op.id, path: `/ops/${i}/id` });
      const current = w.groups[op.id];
      if (op.remove) {
        if (op.at !== undefined || op.name !== undefined)
          fail("op-invalid", "setGroup with remove takes no at or name.");
        if (!current) fail("ref-not-found", `No group "${op.id}" to remove.`, { got: op.id });
        const members = [
          ...w.entities.filter((r) => r.def.group === op.id),
          ...w.instances.filter((r) => r.def.group === op.id),
        ].map((r) => r.def.id);
        if (members.length > 0)
          fail(
            "op-invalid",
            `Group "${op.id}" still holds ${members.join(", ")}; take them out first.`,
            { entityIds: members },
          );
        delete w.groups[op.id];
        w.groupsTouched = true;
        return;
      }
      const next: GroupDef = current ? clone(current) : { at: [0, 0] };
      if (op.at !== undefined) next.at = [op.at[0], op.at[1]];
      if (op.name === null) delete next.name;
      else if (op.name !== undefined) next.name = op.name;
      w.groups[op.id] = { at: next.at, ...(next.name !== undefined ? { name: next.name } : {}) };
      w.groupsTouched = true;
      return;
    }
    case "override": {
      const rec = resolveInstance(w, op.ref);
      const keys = Object.keys(op.set);
      if (keys.length === 0) fail("op-invalid", `override of ${op.ref} sets nothing.`);
      const overrides = { ...clone(rec.def.overrides ?? {}) };
      for (const key of keys) {
        for (const other of Object.keys(overrides))
          if (other !== key && (other.startsWith(`${key}.`) || key.startsWith(`${other}.`)))
            delete overrides[other];
        overrides[key] = clone(op.set[key]);
      }
      const next = { ...clone(rec.def), overrides };
      validateInstance(w, next, (rel) => `/ops/${i}/set${rel.replace(/^\/overrides/, "")}`);
      rec.def = next;
      w.instancesTouched = true;
      return;
    }
    case "revertOverride": {
      const rec = resolveInstance(w, op.ref);
      const overrides = { ...clone(rec.def.overrides ?? {}) };
      for (const key of op.paths ?? Object.keys(overrides)) {
        delete overrides[key];
        for (const other of Object.keys(overrides))
          if (other.startsWith(`${key}.`)) delete overrides[other];
      }
      const next = { ...clone(rec.def) };
      if (Object.keys(overrides).length > 0) next.overrides = overrides;
      else delete next.overrides;
      rec.def = next;
      w.instancesTouched = true;
      return;
    }
    case "applyToPrefab": {
      const rec = resolveInstance(w, op.ref);
      const prefab = prefabOf(w, rec.def.prefab);
      const all = rec.def.overrides ?? {};
      const paths = op.paths ?? Object.keys(all);
      const missing = paths.filter((p) => !(p in all));
      if (missing.length > 0)
        fail("op-invalid", `${op.ref} has no override ${missing.map((p) => `"${p}"`).join(", ")}.`);
      if (paths.length === 0) fail("op-invalid", `${op.ref} has no overrides to apply.`);
      const applied = { ...rec.def, overrides: Object.fromEntries(paths.map((p) => [p, all[p]])) };
      const body = bodyWithOverrides(w, prefab, applied);
      definePrefab(w, prefab.id, body, i);
      const left = Object.fromEntries(Object.entries(all).filter(([p]) => !paths.includes(p)));
      const next = { ...clone(rec.def) };
      if (Object.keys(left).length > 0) next.overrides = left;
      else delete next.overrides;
      rec.def = next;
      w.instancesTouched = true;
      return;
    }
    case "unpack": {
      const rec = resolveInstance(w, op.ref);
      for (const sub of unpackOps(w, rec.def)) applyOp(w, sub, i);
      return;
    }
    case "createPrefab": {
      for (const sub of createPrefabOps(w, op, i)) applyOp(w, sub, i);
      return;
    }
    case "definePrefab": {
      if (op.prefab === null) {
        if (!w.prefabs.has(op.id))
          fail("prefab-unknown", `No prefab "${op.id}" to delete.`, { got: op.id });
        w.prefabs.delete(op.id);
        w.prefabsChanged.add(op.id);
        return;
      }
      definePrefab(w, op.id, op.prefab, i);
      return;
    }
    default: {
      const unknown: never = op;
      fail("op-invalid", `Unknown op at index ${i}: ${JSON.stringify(unknown)}`);
    }
  }
}

// ─── Instances and prefabs ───────────────────────────────

function validateInstance(w: Work, def: InstanceDef, relocate: Relocate): void {
  const result = InstanceSchema.safeParse(def);
  if (!result.success) {
    const first = result.error.issues[0]!;
    const rel = first.path.length > 0 ? jsonPointer(first.path.map(String)) : "";
    fail(
      first.code === "unrecognized_keys" ? "unknown-key" : "schema",
      `${def.id}: ${first.message}`,
      {
        path: relocate(rel),
        entityIds: [def.id],
      },
    );
  }
  const prefab = prefabOf(w, def.prefab, relocate("/prefab"));
  const children = new Set<Ref>();
  for (const key of Object.keys(def.overrides ?? {})) children.add(key.slice(0, key.indexOf(".")));
  for (const ref of children) {
    const c = localChildren(prefab, { ...def }, w.registry).find((x) => x.child === ref);
    if (!c) continue;
    if (c.kind === "entity")
      validateEntity(w, c.def, () => relocate("/overrides"), `${def.id}/${ref}`);
    else {
      const info = w.registry.bulkKey(c.key);
      if (info) validateBulk(w, info, c.value, () => relocate("/overrides"), `${def.id}/${ref}`);
    }
  }
}

/** A prefab's body with an instance's overrides written into its children. */
function bodyWithOverrides(w: Work, prefab: Prefab, inst: InstanceDef): PrefabBody {
  const entities: EntityDef[] = [];
  const bulk: Record<BulkKey, BulkEntry[]> = {};
  for (const c of localChildren(prefab, inst, w.registry)) {
    if (c.kind === "entity") entities.push(c.def);
    else (bulk[c.key] ??= []).push(c.value);
  }
  return {
    entities,
    ...(Object.keys(bulk).length > 0 ? { bulk } : {}),
    ...(prefab.contract !== undefined ? { contract: clone(prefab.contract) } : {}),
  };
}

function definePrefab(w: Work, id: string, body: PrefabBody, i: number): void {
  if (!ID_PATTERN.test(id))
    fail("bad-id", `"${id}" isn't a valid prefab id.`, { got: id, path: `/ops/${i}/id` });
  const file = prefabFile(id, body, w.startDef.game);
  const parsed = parsePrefab(file, w.registry);
  if (!parsed.ok) {
    const first = parsed.issues[0]!;
    throw new OpFailure({
      ...first,
      message: `prefab ${id}: ${first.message}`,
      path: `/ops/${i}/prefab${first.path ?? ""}`,
    });
  }
  w.prefabs.set(id, parsed.prefab);
  w.prefabsChanged.add(id);
}

/** The document as the batch has left it so far. */
function current(w: Work): SceneDefinition {
  return materialize(w.startDef, {
    ...w,
    entitiesTouched: true,
    instancesTouched: true,
    groupsTouched: true,
    touchedBuckets: new Set(w.buckets.keys()),
  });
}

/** `remove` of the instance, then its children placed as plain entries where they stood. */
function unpackOps(w: Work, inst: InstanceDef): SceneOp[] {
  const prefab = prefabOf(w, inst.prefab);
  const entities: EntityDef[] = [];
  const bulk: Record<BulkKey, BulkEntry[]> = {};
  const groupAt = inst.group === undefined ? undefined : w.groups[inst.group]?.at;
  for (const c of localChildren(prefab, inst, w.registry)) {
    if (c.kind === "entity") {
      const e = clone(c.def);
      delete e.group;
      if (inst.group !== undefined) e.group = inst.group;
      if (e.layer === undefined && inst.layer !== undefined) e.layer = inst.layer;
      if (inst.off) e.off = true;
      entities.push(e);
    } else {
      // Bulk entries can't join a group, so they land in world coordinates.
      const value = groupAt ? translateBulkEntry(c.value, groupAt) : c.value;
      (bulk[c.key] ??= []).push(value);
    }
  }
  const def = current(w);
  const without = {
    ...def,
    instances: (def.instances ?? []).filter((x) => x.id !== inst.id),
  };
  const placed = placeFragment(
    { kind: FRAGMENT_KIND, v: SCENE_FORMAT_VERSION, entities, bulk },
    without,
    w.registry,
    inst.at,
  );
  return [{ op: "remove", refs: [inst.id] }, ...placed.ops];
}

/**
 * `definePrefab` with the entries `refs` name around the origin, `remove`
 * of them, and one `instantiate` of the new prefab at the origin. Group
 * members leave their group (the instance takes no group); the origin is
 * `at`, or the top-left of the entries' box.
 */
function createPrefabOps(
  w: Work,
  op: Extract<SceneOp, { op: "createPrefab" }>,
  i: number,
): SceneOp[] {
  if (w.prefabs.has(op.id))
    fail("id-taken", `There is already a prefab "${op.id}".`, { got: op.id, path: `/ops/${i}/id` });
  const entities: EntityDef[] = [];
  const picked = new Map<BulkKey, { index: number; value: BulkEntry }[]>();
  for (const ref of [...new Set(op.refs)]) {
    const t = resolve(w, ref);
    if (t.kind === "instance")
      fail("op-invalid", `${ref} is an instance; prefabs can't hold instances.`, {
        entityIds: [ref],
      });
    if (t.kind === "bulk") {
      const list = picked.get(t.info.key) ?? [];
      list.push({ index: w.buckets.get(t.info.key)!.indexOf(t.slot), value: clone(t.slot.value) });
      picked.set(t.info.key, list);
      continue;
    }
    const groupAt = t.rec.def.group === undefined ? undefined : w.groups[t.rec.def.group]?.at;
    const world = groupAt
      ? (translateEntityDef(w.registry, t.rec.def, groupAt) ?? t.rec.def)
      : t.rec.def;
    const e = clone(world);
    delete e.group;
    entities.push(e);
  }
  entities.sort(
    (a, b) =>
      w.entities.findIndex((r) => r.def.id === a.id) -
      w.entities.findIndex((r) => r.def.id === b.id),
  );
  const bulk: Record<BulkKey, BulkEntry[]> = {};
  for (const key of [...picked.keys()].sort())
    bulk[key] = picked
      .get(key)!
      .sort((a, b) => a.index - b.index)
      .map((x) => x.value);
  if (entities.length === 0 && Object.keys(bulk).length === 0)
    fail("op-invalid", "createPrefab needs at least one entity or bulk entry.");
  let origin: Pt;
  if (op.at) origin = [op.at[0], op.at[1]];
  else {
    const box = fragmentBounds(
      { kind: FRAGMENT_KIND, v: SCENE_FORMAT_VERSION, entities, bulk },
      w.registry,
    );
    if (!box)
      fail("op-invalid", "None of those entries has a position to put the prefab's origin at.");
    origin = [Math.floor(box.minX), Math.floor(box.minY)];
  }
  const back: Pt = [-origin[0], -origin[1]];
  const body: PrefabBody = {
    entities: entities.map((e) => translateEntityDef(w.registry, e, back) ?? e),
    ...(Object.keys(bulk).length > 0
      ? {
          bulk: Object.fromEntries(
            Object.entries(bulk).map(([k, vs]) => [k, vs.map((v) => translateBulkEntry(v, back))]),
          ),
        }
      : {}),
  };
  const refs = [...new Set(op.refs)];
  return [
    { op: "definePrefab", id: op.id, prefab: body },
    { op: "remove", refs },
    {
      op: "instantiate",
      instance: { ...(op.instance ? { id: op.instance } : {}), prefab: op.id, at: origin },
    },
  ];
}

function markTouched(w: Work, t: Target): void {
  if (t.kind === "bulk") w.touchedBuckets.add(t.info.key);
  else if (t.kind === "instance") w.instancesTouched = true;
  else w.entitiesTouched = true;
}

// ─── Inverse ─────────────────────────────────────────────

function entityTranslation(w: Work, o: EntityDef, c: EntityDef): Pt | null {
  const a = geometryAnchor(w, o);
  const b = geometryAnchor(w, c);
  if (!a || !b || o.type !== c.type) return null;
  const d: Pt = [a[0] - b[0], a[1] - b[1]];
  if (d[0] === 0 && d[1] === 0) return null;
  return same(translateEntity(w, c, d), o) ? d : null;
}

/**
 * Set and unset paths that turn `c` back into `o` with the same key order,
 * or null when only replacing the whole value can restore the order.
 */
function restorePaths(o: Json, c: Json): { set: Json; unset: string[] } | null {
  const out = { set: {} as Json, unset: [] as string[] };
  const walk = (ov: unknown, cv: unknown, prefix: string): boolean => {
    if (same(ov, cv)) return true;
    const join = (k: string | number) => (prefix ? `${prefix}.${k}` : String(k));
    if (isObj(ov) && isObj(cv) && keyOrderRestorable(ov, cv)) {
      for (const k of Object.keys(cv)) if (!(k in ov)) out.unset.push(join(k));
      for (const k of Object.keys(ov)) {
        if (k in cv) walk(ov[k], cv[k], join(k));
        else out.set[join(k)] = clone(ov[k]);
      }
      return true;
    }
    if (
      Array.isArray(ov) &&
      Array.isArray(cv) &&
      ov.length === cv.length &&
      ov.some(isStructured)
    ) {
      ov.forEach((item, k) => walk(item, cv[k], join(k)));
      return true;
    }
    if (!prefix) return false;
    out.set[prefix] = clone(ov);
    return true;
  };
  return walk(o, c, "") ? out : null;
}

/** Unsetting `c`'s extra keys and appending `o`'s missing ones gives `o`'s order. */
function keyOrderRestorable(o: Json, c: Json): boolean {
  const ok = Object.keys(o);
  const restored = [...Object.keys(c).filter((k) => k in o), ...ok.filter((k) => !(k in c))];
  return restored.every((k, i) => k === ok[i]);
}

/** The `set` and `unset` keys an update-like op takes, leaving out empty ones. */
function pathsOf(restore: { set: Json; unset: string[] }): { set?: Json; unset?: string[] } {
  return {
    ...(Object.keys(restore.set).length > 0 ? { set: restore.set } : {}),
    ...(restore.unset.length > 0 ? { unset: restore.unset } : {}),
  };
}

function settingsInverse(start: SceneDefinition, w: Work): SceneOp[] {
  const o = (start.settings ?? {}) as Json;
  if (!w.settingsTouched || same(o, w.settings)) return [];
  const restore = restorePaths(o, w.settings);
  if (restore) return [{ op: "setSettings", ...pathsOf(restore) }];
  const ops: SceneOp[] = [{ op: "setSettings", unset: Object.keys(w.settings) }];
  if (Object.keys(o).length > 0) ops.push({ op: "setSettings", set: clone(o) });
  return ops;
}

function buildInverse(start: SceneDefinition, w: Work, startPrefabs: PrefabLibrary): SceneOp[] {
  const ops: SceneOp[] = [];
  const last: SceneOp[] = [];

  // Prefabs the batch changed or deleted come back first, so instances of them can return.
  for (const id of [...w.prefabsChanged].sort()) {
    const was = startPrefabs.get(id);
    const now = w.prefabs.get(id);
    if (was && !same(was, now)) ops.push({ op: "definePrefab", id, prefab: prefabBody(was) });
    else if (!was && now) last.push({ op: "definePrefab", id, prefab: null });
  }

  // Groups: restored and re-declared first, ones the batch declared dropped last.
  if (w.groupsTouched) {
    const was = start.groups ?? {};
    for (const id of Object.keys(was).sort()) {
      const g = was[id]!;
      const now = w.groups[id];
      if (same(g, now)) continue;
      ops.push({ op: "setGroup", id, at: clone(g.at), name: g.name ?? null });
    }
    for (const id of Object.keys(w.groups).sort())
      if (!(id in was)) last.push({ op: "setGroup", id, remove: true });
  }

  const sceneSet: { name?: string; bounds?: SceneDefinition["bounds"] } = {};
  if (w.name !== start.name) sceneSet.name = start.name;
  if (!same(w.bounds, start.bounds)) sceneSet.bounds = clone(start.bounds);
  if (Object.keys(sceneSet).length > 0) ops.push({ op: "setScene", set: sceneSet });
  ops.push(...settingsInverse(start, w));

  const removeRefs: Ref[] = [];
  const moves = new Map<string, { by: Pt; refs: Ref[] }>();
  const updates: SceneOp[] = [];
  const readds: SceneOp[] = [];
  const addMove = (ref: Ref, by: Pt) => {
    const k = by.join(",");
    const group = moves.get(k) ?? { by, refs: [] };
    group.refs.push(ref);
    moves.set(k, group);
  };

  const startEnts = start.entities ?? [];
  const replaced = new Set<number>();
  const survivors = w.entities.filter((r) => r.orig !== null);
  for (const rec of w.entities) if (rec.orig === null) removeRefs.push(rec.def.id);
  for (const rec of survivors) {
    const original = startEnts[rec.orig!]!;
    const current = { ...clone(rec.def), id: original.id };
    if (same(original, current)) continue;
    const d = entityTranslation(w, original, current);
    if (d) {
      addMove(original.id, d);
      continue;
    }
    const restore = restorePaths(original, current);
    if (!restore) {
      replaced.add(rec.orig!);
      removeRefs.push(rec.def.id);
      continue;
    }
    updates.push({ op: "update", ref: original.id, ...pathsOf(restore) });
  }

  const startInsts = start.instances ?? [];
  const instSurvivors = w.instances.filter((r) => r.orig !== null);
  for (const rec of w.instances) if (rec.orig === null) removeRefs.push(rec.def.id);
  for (const rec of instSurvivors) {
    const original = startInsts[rec.orig!]!;
    const now = rec.def as unknown as Json;
    const was = original as unknown as Json;
    const set: Json = {};
    const unset: string[] = [];
    for (const k of Object.keys(now)) if (k !== "id" && !(k in was)) unset.push(k);
    for (const k of Object.keys(was))
      if (k !== "id" && !same(was[k], now[k])) set[k] = clone(was[k]);
    if (Object.keys(set).length > 0 || unset.length > 0)
      updates.push({ op: "update", ref: original.id, ...pathsOf({ set, unset }) });
  }

  const renames = [
    ...survivors.filter((r) => !replaced.has(r.orig!) && r.def.id !== r.origId),
    ...instSurvivors.filter((r) => r.def.id !== r.origId),
  ];
  const renameOps: SceneOp[] = [];
  if (renames.length > 0) {
    const held = new Set([
      ...survivors.filter((r) => !replaced.has(r.orig!)).map((r) => r.def.id),
      ...instSurvivors.map((r) => r.def.id),
    ]);
    if (renames.every((r) => !held.has(r.origId!))) {
      for (const r of renames) renameOps.push({ op: "rename", from: r.def.id, to: r.origId! });
    } else {
      const taken = new Set([
        ...held,
        ...startEnts.map((e) => e.id),
        ...startInsts.map((e) => e.id),
      ]);
      let n = 1;
      const temps = renames.map(() => {
        while (taken.has(`tmp-${n}`)) n++;
        taken.add(`tmp-${n}`);
        return `tmp-${n}`;
      });
      renames.forEach((r, k) => renameOps.push({ op: "rename", from: r.def.id, to: temps[k]! }));
      renames.forEach((r, k) => renameOps.push({ op: "rename", from: temps[k]!, to: r.origId! }));
    }
  }

  const surviving = new Set(survivors.filter((r) => !replaced.has(r.orig!)).map((r) => r.orig!));
  startEnts.forEach((e, i) => {
    if (!surviving.has(i)) readds.push({ op: "add", entity: clone(e) as EntityInput, index: i });
  });
  const instSurviving = new Set(instSurvivors.map((r) => r.orig!));
  startInsts.forEach((e, i) => {
    if (!instSurviving.has(i))
      readds.push({ op: "instantiate", instance: clone(e) as InstanceInput, index: i });
  });

  for (const info of w.registry.bulkKeys) {
    const { key } = info;
    if (!w.touchedBuckets.has(key)) continue;
    const original = bulkEntries(start, key);
    const slots = w.buckets.get(key)!;
    slots.forEach((s, i) => {
      const ref = bulkId(key, i);
      if (s.orig === null) {
        removeRefs.push(ref);
        return;
      }
      const o = original[s.orig]!;
      if (same(o, s.value)) return;
      const d = bulkOffset(s.value, o);
      if (d) addMove(ref, d);
      else updates.push({ op: "update", ref, set: { [info.field]: clone(o) } });
    });
    const kept = new Set(slots.filter((s) => s.orig !== null).map((s) => s.orig!));
    let run: { index: number; values: BulkEntry[] } | null = null;
    const flush = () => {
      if (!run) return;
      readds.push(
        info.form === "point"
          ? { op: "addBulk", key, points: run.values as Pt[], index: run.index }
          : { op: "addBulk", key, shapes: run.values as ShapeTuple[], index: run.index },
      );
      run = null;
    };
    original.forEach((v, i) => {
      if (kept.has(i)) {
        flush();
        return;
      }
      if (run) run.values.push(clone(v));
      else run = { index: i, values: [clone(v)] };
    });
    flush();
  }

  if (removeRefs.length > 0) ops.push({ op: "remove", refs: removeRefs });
  ops.push(...renameOps);
  for (const { by, refs } of moves.values()) ops.push({ op: "move", refs, by });
  ops.push(...updates, ...readds);
  ops.push(
    ...orderInverse(
      startEnts.map((e) => e.id),
      survivors.filter((r) => !replaced.has(r.orig!)).map((r) => startEnts[r.orig!]!.id),
    ),
    ...orderInverse(
      startInsts.map((e) => e.id),
      instSurvivors.map((r) => startInsts[r.orig!]!.id),
    ),
  );
  ops.push(...last);
  return ops;
}

/**
 * `reorder` ops that put a list back in its start order, once the rest of
 * the inverse has re-added what the batch removed at their old indices.
 * `kept` is the survivors in their order after the batch, by start id.
 */
function orderInverse(startIds: readonly string[], kept: readonly string[]): SceneOp[] {
  const keptSet = new Set(kept);
  const inOrder = startIds.filter((id) => keptSet.has(id));
  if (same(inOrder, kept)) return [];
  const list = [...kept];
  startIds.forEach((id, i) => {
    if (!keptSet.has(id)) list.splice(i, 0, id);
  });
  const ops: SceneOp[] = [];
  startIds.forEach((id, i) => {
    if (list[i] === id) return;
    list.splice(list.indexOf(id), 1);
    list.splice(i, 0, id);
    ops.push({ op: "reorder", refs: [id], index: i });
  });
  return ops;
}

/**
 * Where each start-of-batch ref ended up when it changed: a bulk entry whose
 * index shifted, was promoted, or an entity renamed or demoted. `null` when
 * it was removed.
 */
function refRemap(start: SceneDefinition, w: Work): Record<Ref, Ref | null> {
  const out: Record<Ref, Ref | null> = {};
  for (const key of w.touchedBuckets) {
    const finalIndex = new Map<number, number>();
    w.buckets.get(key)!.forEach((s, i) => {
      if (s.orig !== null) finalIndex.set(s.orig, i);
      if (s.demotedFrom !== undefined) out[s.demotedFrom] = bulkId(key, i);
    });
    const startLen = bulkEntries(start, key).length;
    for (let i = 0; i < startLen; i++) {
      const from = bulkId(key, i);
      const j = finalIndex.get(i);
      if (j === undefined) out[from] = w.promoted.get(from) ?? null;
      else if (j !== i) out[from] = bulkId(key, j);
    }
  }
  const named = (
    touched: boolean,
    recs: readonly { def: { id: string }; origId: string | null }[],
    was: readonly { id: string }[],
  ) => {
    if (!touched) return;
    const surviving = new Map<string, string>();
    for (const rec of recs) if (rec.origId !== null) surviving.set(rec.origId, rec.def.id);
    for (const e of was) {
      const to = surviving.get(e.id);
      if (to === undefined) {
        if (!(e.id in out)) out[e.id] = null;
      } else if (to !== e.id) out[e.id] = to;
    }
  };
  named(w.entitiesTouched, w.entities, start.entities ?? []);
  named(w.instancesTouched, w.instances, start.instances ?? []);
  return out;
}

function touchedRefs(start: SceneDefinition, w: Work): Ref[] {
  const out: Ref[] = [];
  const startEnts = start.entities ?? [];
  for (const rec of w.entities) {
    if (rec.orig === null || !same(rec.def, startEnts[rec.orig])) out.push(rec.def.id);
  }
  const startInsts = start.instances ?? [];
  const changedPrefabs = w.prefabsChanged;
  for (const rec of w.instances) {
    if (
      rec.orig === null ||
      !same(rec.def, startInsts[rec.orig]) ||
      changedPrefabs.has(rec.def.prefab)
    )
      out.push(rec.def.id);
  }
  for (const key of w.touchedBuckets) {
    const original = bulkEntries(start, key);
    w.buckets.get(key)!.forEach((s, i) => {
      if (s.orig === null || !same(s.value, original[s.orig])) out.push(bulkId(key, i));
    });
  }
  return out;
}

// ─── Edits on the resolved view ──────────────────────────

/**
 * Maps a batch written against the resolved view (`resolveScene`: world
 * coordinates, instance children as `gate-3/door`) onto the document, as
 * `mapResolvedBatch` describes: a child's edit becomes overrides, a group
 * member's geometry loses the group's origin. The editor sends every batch
 * through it; an agent working on the file writes document ops directly.
 */
export function toSourceBatch(
  def: SceneDefinition,
  batch: OpBatch,
  given: Registry,
  prefabs?: PrefabLibrary,
): SourceBatchResult {
  const registry = sceneRegistry(def.game, given) ?? given;
  const apply: ChildApply = (child, op) => {
    const scratch: SceneDefinition = {
      v: SCENE_FORMAT_VERSION,
      ...(def.game !== undefined ? { game: def.game } : {}),
      name: "child",
      bounds: def.bounds,
      ...(child.kind === "entity"
        ? { entities: [clone(child.def)] }
        : { [child.key]: [clone(child.value)] }),
    };
    const result = applyOps(
      scratch,
      usesBulkRefs({ ops: [op] }) ? { base: sceneHash(scratch), ops: [op] } : { ops: [op] },
      registry,
      { validate: "none" },
    );
    if (!result.ok) throw new OpFailure(result.issue);
    if (child.kind === "entity") return { ...child, def: result.def.entities![0]! };
    return { ...child, value: bulkEntries(result.def, child.key)[0]! };
  };
  try {
    return mapResolvedBatch(def, batch, registry, prefabs, apply);
  } catch (err) {
    if (err instanceof OpFailure) return { ok: false, issue: err.issue };
    throw err;
  }
}

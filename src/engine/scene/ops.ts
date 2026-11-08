import { z } from "zod";

import { BEHAVIORS_FIELD } from "../game/behaviors";
import { ID_PATTERN } from "../game/fields";
import type { BulkKeyInfo, Registry } from "../game/types";
import { closest } from "./did-you-mean";
import { bulkOffset, diffScenes, isObj, isStructured } from "./diff";
import { setGroupFields } from "./diff-to-ops";
import { bulkEntries, bulkId, parseBulkId } from "./expand";
import { INSTANCE_OVERRIDE_FIELDS, isInstanceOverrideField, splitFieldPath } from "./field-path";
import { compareEntityKeys, sortedAssets } from "./format";
import {
  FRAGMENT_KIND,
  fragmentBounds,
  nextFreeId,
  placeFragment,
  takenIds,
  type SceneFragment,
} from "./fragment";
import { decodeRow, GRID_CHUNK, paintGrid, parseChunkKey, type GridCells } from "./grid";
import { sceneHash } from "./hash";
import { jsonPointer, makeIssue } from "./issues";
import {
  MAX_PAINT_CELLS,
  opBatchSchemaFor,
  opRefs,
  sceneOpSchemaFor,
  usesBulkRefs,
} from "./ops-schema";
import { entityIssues, suggestType } from "./parse";
import {
  parsePrefab,
  prefabBody,
  prefabOf as prefabFile,
  prefabsUsedBy,
  sceneBody,
} from "./prefab";
import {
  CHILD_SEPARATOR,
  gridTurns,
  localChild,
  localChildren,
  mapResolvedBatch,
  parseChildRef,
  placeChildren,
  resolvePrefab,
  splitOverridePath,
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
  applyPt,
  compose,
  composeDihedral,
  dihedral,
  dihedralOf,
  flipWorld,
  IDENTITY_2D,
  invert,
  inverseTurn,
  translation,
  turnOf,
  type Dihedral,
  type Transform2D,
} from "./transform";
import {
  addPt,
  movableGeometry,
  presentGeometry,
  transformBulkEntry,
  translateBulkEntry,
  translateEntityDef,
  translateTuple,
  type GeometryKind,
} from "./translate";
import {
  PREFAB_KIND,
  PREFAB_MAX_DEPTH,
  SCENE_FORMAT_VERSION,
  type Aabb,
  type ApplyOptions,
  type ApplyResult,
  type BulkEntry,
  type BulkKey,
  type CellEdit,
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
  type PrefabParam,
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
  /** The `assets` header, sorted and unique. */
  assets: string[];
  assetsTouched: boolean;
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
  /** The prefab this document is a view of, when it is one. */
  view?: string;
  /** The viewed prefab's variant base and own exposed params, which header ops change. */
  header: ViewHeader;
  headerTouched: boolean;
};

type ViewHeader = { base?: string; params: Record<string, PrefabParam> };

function headerOf(prefab: Prefab | undefined): ViewHeader {
  return {
    ...(prefab?.base !== undefined ? { base: prefab.base } : {}),
    params: sortedParams(clone(prefab?.params ?? {})),
  };
}

function sortedParams(params: Record<string, PrefabParam>): Record<string, PrefabParam> {
  const out: Record<string, PrefabParam> = {};
  for (const name of Object.keys(params).sort()) out[name] = params[name]!;
  return out;
}

/** Refuses a prefab-header op outside a prefab's own document. */
function viewOnly(w: Work, op: string): void {
  if (w.view !== undefined) return;
  fail(
    "op-invalid",
    `${op} changes a prefab's header, so it works only in that prefab's document, not in a scene.`,
    {
      hint: 'Send it through editScene with the prefab\'s id, or open the prefab and apply it there (applyOps with { prefab: "<id>" }).',
    },
  );
}

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
  if (opts.prefab !== undefined) {
    w.view = opts.prefab;
    w.header = headerOf(opts.prefabs?.get(opts.prefab));
  }
  for (let i = 0; i < batch.ops.length; i++) {
    try {
      const op = batch.ops[i]!;
      const cycled = NESTING_OPS.includes(op.op) ? cycleIn(w) : null;
      applyOp(w, op, i);
      if (cycled === null && NESTING_OPS.includes(op.op)) refuseCycle(w);
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
  if (w.view !== undefined && headerChanged(w, opts.prefabs)) {
    w.prefabs.set(w.view, viewedPrefab(w, start, after));
    w.prefabsChanged.add(w.view);
  }
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
    issues:
      opts.validate === "none"
        ? []
        : validateScene(after, given, {
            prefabs,
            ...(opts.prefab !== undefined ? { prefab: opts.prefab } : {}),
          }),
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
    assets: sortedAssets(start.assets ?? []),
    assetsTouched: false,
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
    header: headerOf(undefined),
    headerTouched: false,
  };
}

function materialize(start: SceneDefinition, w: Work): SceneDefinition {
  const out: Json = { ...start, name: w.name, bounds: w.bounds };
  if (w.settingsTouched) {
    if (Object.keys(w.settings).length > 0) out.settings = w.settings;
    else delete out.settings;
  }
  if (w.assetsTouched) {
    if (w.assets.length > 0) out.assets = [...w.assets];
    else delete out.assets;
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

/** A type's grid fields, which `update` sets whole and `paintCells` paints. */
function gridFields(w: Work, type: string): string[] {
  const t = w.registry.types.get(type);
  return t ? geometryFields(t).flatMap((f) => (f.kind === "grid" ? [f.field] : [])) : [];
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

/** Splits field paths, refusing one outside the grammar and a path that overlaps another. */
function splitPaths(paths: string[]): string[][] {
  const split = paths.map((p) => {
    const segs = splitFieldPath(p);
    if (!segs)
      fail(
        "op-invalid",
        `"${p}" isn't a field path; use dot-separated names and indices like path.speed, path.pts.1 or behaviors.sprite.frame.`,
        { got: p },
      );
    return segs;
  });
  for (let i = 0; i < split.length; i++) {
    const a = split[i]!;
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

const Z_LIMIT = 10_000;

/** `def` with `key` at its canonical place among the keys, or without it for `undefined`. */
function withKey<T extends object>(def: T, key: string, value: unknown): T {
  const out: Json = {};
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

/** `def` with `z` at its canonical place among the keys, or without it for 0. */
const withZ = <T extends { z?: number }>(def: T, z: number): T =>
  withKey(def, "z", z === 0 ? undefined : z);

/** `def` carrying `d`, the identity written as absent. */
function withDihedral<T extends { rot?: number; flip?: boolean }>(def: T, d: Dihedral): T {
  return withKey(withKey(def, "rot", d.rot === 0 ? undefined : d.rot), "flip", d.flip || undefined);
}

/** A group's frame: what its members' stored geometry is relative to. */
function groupFrame(w: Work, group: string | undefined): Transform2D {
  const g = group === undefined ? undefined : w.groups[group];
  return g ? dihedral(turnOf(g), g.at) : IDENTITY_2D;
}

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
        const next = patch(t.rec.def as unknown as Json, set, unset, split) as Json;
        // A null param, as setParam takes it, clears the param.
        setKeys.forEach((key, k) => {
          const segs = split[k]!;
          if (segs.length === 2 && segs[0] === "params" && set[key] === null && isObj(next.params))
            delete next.params[segs[1]!];
        });
        if (next.rot === 0) delete next.rot;
        if (next.flip === false) delete next.flip;
        if (next.z === 0) delete next.z;
        if (isObj(next.params) && Object.keys(next.params).length === 0) delete next.params;
        validateInstance(w, next as unknown as InstanceDef, inSet(i));
        t.rec.def = next as unknown as InstanceDef;
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
      const grids = gridFields(w, t.rec.def.type);
      const below = split.findIndex((s) => s.length > 1 && grids.includes(s[0]!));
      if (below >= 0) {
        const [field] = split[below]!;
        fail(
          "op-invalid",
          `${op.ref}: ${field} is a grid field; set the whole field, or paint its cells with paintCells.`,
          {
            entityIds: [t.rec.def.id],
            got: [...setKeys, ...unset][below],
            hint: `{ "op": "paintCells", "ref": "${op.ref}", "field": "${field}", "cells": [[col, row, value]] }`,
          },
        );
      }
      const shapes = shapeFields(w, t.rec.def.type);
      const next = patch(t.rec.def, set, unset, split, (path, v) =>
        shapes.includes(path) ? storeShape(v) : clone(v),
      ) as EntityDef;
      const blocks = next[BEHAVIORS_FIELD];
      if (
        split.some((s) => s[0] === BEHAVIORS_FIELD) &&
        isObj(blocks) &&
        Object.keys(blocks).length === 0
      )
        delete next[BEHAVIORS_FIELD];
      if (next.z === 0) delete next.z;
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
      if (input.z === 0) delete input.z;
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
        if (
          op.at !== undefined ||
          op.name !== undefined ||
          op.rot !== undefined ||
          op.flip !== undefined
        )
          fail("op-invalid", "setGroup with remove takes no at, rot, flip or name.");
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
      const d = turnOf({
        rot: op.rot ?? next.rot,
        flip: op.flip ?? next.flip,
      });
      w.groups[op.id] = groupDef(next.at, d, next.name);
      w.groupsTouched = true;
      return;
    }
    case "override": {
      const rec = resolveInstance(w, op.ref);
      const keys = Object.keys(op.set);
      if (keys.length === 0) fail("op-invalid", `override of ${op.ref} sets nothing.`);
      refuseGridOverrides(w, rec.def, keys);
      const overrides = { ...clone(rec.def.overrides ?? {}) };
      for (const key of keys) setOverride(overrides, key, op.set[key]);
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
      applyIntoPrefab(
        w,
        rec.def,
        prefab,
        paths.map((p) => [p, all[p]] as const),
        op.to,
        i,
      );
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
    case "setZ": {
      if ((op.z === undefined) === (op.by === undefined))
        fail("op-invalid", "setZ takes either z (the new value) or by (a shift), not both.", {
          hint: `{ "op": "setZ", "refs": ${JSON.stringify(op.refs)}, "by": 1 }`,
        });
      const targets = [...new Set(op.refs)].map((ref) => [ref, resolve(w, ref)] as const);
      for (const [ref, t] of targets) {
        if (t.kind === "bulk")
          fail(
            "op-invalid",
            `${ref} is a bulk entry, which has no z; promote it to an entity to give it one.`,
            { got: ref, hint: `{ "op": "promote", "ref": "${ref}", "id": "..." }` },
          );
        const was = t.rec.def.z ?? 0;
        const z = op.z ?? was + op.by!;
        if (!Number.isInteger(z) || Math.abs(z) > Z_LIMIT)
          fail("op-invalid", `${ref}'s z would be ${z}; z stays within [-10000, 10000].`, {
            entityIds: [t.rec.def.id],
            got: String(z),
          });
        if (t.kind === "instance") {
          const next = withZ(t.rec.def, z);
          validateInstance(w, next, () => `/ops/${i}`);
          t.rec.def = next;
        } else {
          const next = withZ(t.rec.def, z);
          validateEntity(w, next, () => `/ops/${i}`);
          t.rec.def = next;
        }
        markTouched(w, t);
      }
      return;
    }
    case "useAssets": {
      const add = op.add ?? [];
      const remove = op.remove ?? [];
      if (add.length === 0 && remove.length === 0)
        fail("op-invalid", "useAssets has nothing to add or remove.");
      const both = add.find((id) => remove.includes(id));
      if (both !== undefined)
        fail("op-invalid", `useAssets both adds and removes "${both}".`, { got: both });
      const gone = new Set(remove);
      w.assets = sortedAssets([...w.assets.filter((id) => !gone.has(id)), ...add]);
      w.assetsTouched = true;
      return;
    }
    case "transform": {
      transformOp(w, op, i);
      return;
    }
    case "paintCells": {
      paintCellsOp(w, op, i);
      return;
    }
    case "setPrefabBase": {
      viewOnly(w, op.op);
      if (op.base === null) delete w.header.base;
      else {
        if (op.base === w.view)
          fail("prefab-cycle", `Prefab "${op.base}" can't be a variant of itself.`, {
            path: `/ops/${i}/base`,
            got: op.base,
          });
        if (!w.prefabs.has(op.base)) {
          const known = [...w.prefabs.keys()].filter((id) => id !== w.view);
          const suggestion = closest(op.base, known);
          fail(
            "variant-base-unknown",
            `No prefab "${op.base}" to be a variant of${suggestion ? `; did you mean "${suggestion}"?` : "."}`,
            { path: `/ops/${i}/base`, got: op.base, expected: known.join(", ") },
          );
        }
        w.header.base = op.base;
      }
      w.headerTouched = true;
      return;
    }
    case "exposeParam": {
      viewOnly(w, op.op);
      if (op.param === null) {
        if (!(op.name in w.header.params)) {
          const suggestion = closest(op.name, Object.keys(w.header.params));
          fail(
            "op-invalid",
            `Prefab "${w.view}" declares no parameter "${op.name}"${suggestion ? `; did you mean "${suggestion}"?` : "."}`,
            { path: `/ops/${i}/name`, got: op.name },
          );
        }
        delete w.header.params[op.name];
      } else w.header.params = sortedParams({ ...w.header.params, [op.name]: clone(op.param) });
      w.headerTouched = true;
      return;
    }
    case "setParam": {
      const rec = resolveInstance(w, op.ref);
      const params: Json = { ...rec.def.params };
      if (op.value === null || op.value === undefined) delete params[op.name];
      else params[op.name] = clone(op.value);
      const next = clone(rec.def);
      if (Object.keys(params).length > 0) next.params = params;
      else delete next.params;
      validateInstance(w, next, () => `/ops/${i}/value`);
      rec.def = next;
      w.instancesTouched = true;
      return;
    }
    default: {
      const unknown: never = op;
      fail("op-invalid", `Unknown op at index ${i}: ${JSON.stringify(unknown)}`);
    }
  }
}

function groupDef(at: Pt, d: Dihedral, name: string | undefined): GroupDef {
  return {
    at,
    ...(d.rot !== 0 ? { rot: d.rot } : {}),
    ...(d.flip ? { flip: true as const } : {}),
    ...(name !== undefined ? { name } : {}),
  };
}

/**
 * Turns and flips instances and groups in world terms about `about` (each
 * one's own origin by default): the world op `flip ∘ turn` composes onto
 * what each has, and its origin moves about the point. An instance in a
 * group keeps its group-local `at`, conjugated through the group's frame.
 */
function transformOp(w: Work, op: Extract<SceneOp, { op: "transform" }>, i: number): void {
  const refs = [...new Set(op.refs ?? [])];
  const groups = [...new Set(op.groups ?? [])];
  if (refs.length === 0 && groups.length === 0)
    fail("op-invalid", "transform names no instances (refs) and no groups.");
  if (op.turn === undefined && op.flip === undefined)
    fail("op-invalid", "transform has no turn and no flip, so it changes nothing.", {
      hint: `{ "op": "transform", "refs": [...], "turn": 1 }`,
    });
  const turned: Dihedral = { rot: op.turn === -1 ? 3 : (op.turn ?? 0), flip: false };
  const world = op.flip === undefined ? turned : flipWorld(turned, op.flip);
  const about = (origin: Pt) => {
    const p = op.about ?? origin;
    return compose(dihedral(world, p), translation([-p[0], -p[1]]));
  };
  for (const id of groups) {
    if (!w.groups[id]) {
      const suggestion = closest(id, Object.keys(w.groups));
      fail(
        "ref-not-found",
        `No group "${id}"${suggestion ? `; did you mean "${suggestion}"?` : "."}`,
        {
          got: id,
        },
      );
    }
  }
  const recs = refs.map((ref) => resolveInstance(w, ref));
  for (const rec of recs) {
    if (rec.def.group !== undefined && groups.includes(rec.def.group))
      fail(
        "op-invalid",
        `${rec.def.id} is in group "${rec.def.group}", which this op also transforms; transform the group alone to turn its members with it.`,
        { entityIds: [rec.def.id] },
      );
  }
  for (const rec of recs) {
    const frame = groupFrame(w, rec.def.group);
    const g = rec.def.group === undefined ? undefined : w.groups[rec.def.group];
    const gd = turnOf(g ?? {});
    const origin = applyPt(frame, rec.def.at);
    const at = applyPt(invert(frame), applyPt(about(origin), origin));
    const d = composeDihedral(
      inverseTurn(gd),
      composeDihedral(world, composeDihedral(gd, turnOf(rec.def))),
    );
    const next = withDihedral({ ...clone(rec.def), at }, d);
    validateInstance(w, next, () => `/ops/${i}`);
    rec.def = next;
    w.instancesTouched = true;
  }
  for (const id of groups) {
    const g = w.groups[id]!;
    const at = applyPt(about(g.at), g.at);
    w.groups[id] = groupDef(at, composeDihedral(world, turnOf(g)), g.name);
    w.groupsTouched = true;
  }
}

function paintCellsOp(w: Work, op: Extract<SceneOp, { op: "paintCells" }>, i: number): void {
  const child = parseChildRef(op.ref);
  if (child) {
    const prefab = w.instances.find((r) => r.def.id === child.instance)?.def.prefab;
    fail(
      "op-invalid",
      `${op.ref} is a child of instance ${child.instance}, and grid fields can't be overridden; open the prefab${prefab ? ` "${prefab}"` : ""} and paint ${child.child} there.`,
      {
        got: op.ref,
        hint: `Paint ${child.child} in the prefab's own document.`,
      },
    );
  }
  const t = resolve(w, op.ref);
  if (t.kind !== "entity")
    fail(
      "op-invalid",
      `${op.ref} is ${t.kind === "bulk" ? "a bulk entry" : "an instance"}, which has no grid field.`,
      { got: op.ref },
    );
  const def = t.rec.def;
  const grids = gridFields(w, def.type);
  if (!grids.includes(op.field)) {
    const suggestion = closest(op.field, grids);
    fail(
      "op-invalid",
      `${op.ref}: "${op.field}" isn't a grid field of ${def.type}${
        grids.length === 0
          ? ", which has none."
          : suggestion
            ? `; did you mean "${suggestion}"?`
            : ` (grid fields: ${grids.join(", ")}).`
      }`,
      { entityIds: [def.id], got: op.field, path: `/ops/${i}/field` },
    );
  }
  if ((op.cells?.length ?? 0) === 0 && (op.rects?.length ?? 0) === 0)
    fail("op-invalid", `paintCells of ${op.ref} paints nothing.`);
  const was = def[op.field];
  const painted = paintGrid(isObj(was) ? (was as GridCells) : {}, {
    cells: op.cells,
    rects: op.rects,
  }).grid;
  const next = clone(def);
  if (Object.keys(painted).length > 0) next[op.field] = painted;
  else delete next[op.field];
  validateEntity(w, next, () => `/ops/${i}`);
  t.rec.def = next;
  w.entitiesTouched = true;
}

/** The edits that turn grid `now` back into `was`, one per cell that differs. */
function gridRestore(was: GridCells, now: GridCells): CellEdit[] {
  const edits: CellEdit[] = [];
  const empty = new Uint16Array(GRID_CHUNK);
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    const chunk = parseChunkKey(key);
    if (!chunk) continue;
    const [cx, cy] = chunk;
    const a = was[key] ?? [];
    const b = now[key] ?? [];
    for (let r = 0; r < Math.max(a.length, b.length); r++) {
      const ra = a[r] ?? "";
      const rb = b[r] ?? "";
      if (ra === rb) continue;
      const ca = decodeRow(ra) ?? empty;
      const cb = decodeRow(rb) ?? empty;
      for (let c = 0; c < GRID_CHUNK; c++)
        if (ca[c] !== cb[c]) edits.push([cx * GRID_CHUNK + c, cy * GRID_CHUNK + r, ca[c]!]);
    }
  }
  return edits;
}

/** `paintCells` ops that write `edits`, split to stay within the per-op cap. */
function paintOps(ref: Ref, field: string, edits: CellEdit[]): SceneOp[] {
  const ops: SceneOp[] = [];
  for (let k = 0; k < edits.length; k += MAX_PAINT_CELLS)
    ops.push({ op: "paintCells", ref, field, cells: edits.slice(k, k + MAX_PAINT_CELLS) });
  return ops;
}

/** Grid fields can't be overridden: a key naming one, or a path inside one, refuses. */
function refuseGridOverrides(w: Work, inst: InstanceDef, keys: readonly string[]): void {
  const prefab = w.prefabs.get(inst.prefab);
  if (!prefab) return;
  for (const key of keys) {
    const split = splitOverridePath(key);
    if (!split) continue;
    const c = localChild(prefab, inst, split.child, w.registry, w.prefabs);
    if (c?.kind !== "entity") continue;
    const field = splitFieldPath(split.field)?.[0] ?? split.field;
    if (gridFields(w, c.def.type).includes(field))
      fail(
        "grid-invalid",
        `${inst.id}: ${split.child}.${field} is a grid field, and grid fields can't be overridden; open the prefab "${inst.prefab}" and paint it there, or unpack the instance.`,
        { entityIds: [inst.id], got: key },
      );
  }
}

// ─── Nested prefabs ──────────────────────────────────────

/** Ops that can make a prefab contain itself, through an instance or a prefab's body. */
const NESTING_OPS: readonly SceneOp["op"][] = [
  "instantiate",
  "update",
  "definePrefab",
  "createPrefab",
  "applyToPrefab",
  "setPrefabBase",
];

/** Whether a child ref runs through a nested instance (`door-1/panel`). */
const isNestedRef = (ref: Ref) => ref.includes(CHILD_SEPARATOR);

/** Sets `key` in an override map, dropping the keys it contains or that contain it. */
function setOverride(overrides: Json, key: string, value: unknown): void {
  for (const other of Object.keys(overrides))
    if (other !== key && (other.startsWith(`${key}.`) || key.startsWith(`${other}.`)))
      delete overrides[other];
  overrides[key] = clone(value);
}

/** Whether two override keys touch the same value: equal, or one inside the other. */
const overlaps = (a: string, b: string) =>
  a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

/** An instance without its identity values written as absent: rot 0, flip false, z 0, no params or overrides. */
function tidyInstance(def: Json): InstanceDef {
  if (def.rot === 0) delete def.rot;
  if (def.flip === false) delete def.flip;
  if (def.z === 0) delete def.z;
  if (def.off === false) delete def.off;
  if (isObj(def.params) && Object.keys(def.params).length === 0) delete def.params;
  if (isObj(def.overrides) && Object.keys(def.overrides).length === 0) delete def.overrides;
  return def as unknown as InstanceDef;
}

/**
 * A nested instance with what an outer level's overrides say about it
 * folded in: keys on the instance itself (`n.at`) set its fields, keys
 * through it (`n/panel.path.speed`) become its own overrides and beat the
 * ones it had. Override values are in the frame of the child's own
 * prefab at every level, so they move down as they are.
 */
function overrideNested(n: InstanceDef, overrides: Readonly<Json>): InstanceDef {
  const out = clone(n) as unknown as Json;
  const inner: Json = { ...((out.overrides as Json | undefined) ?? {}) };
  for (const [key, value] of Object.entries(overrides)) {
    const split = splitOverridePath(key);
    if (!split) continue;
    if (split.child === n.id) setNestedField(out, split.field, value);
    else if (split.child.startsWith(`${n.id}${CHILD_SEPARATOR}`))
      setOverride(inner, `${split.child.slice(n.id.length + 1)}.${split.field}`, value);
  }
  out.overrides = inner;
  return tidyInstance(out);
}

/** Sets a nested instance's own field from an override: `params.<name>` within its params, null clearing. */
function setNestedField(n: Json, field: string, value: unknown): void {
  if (field.startsWith("params.")) {
    n.params = { ...((n.params as Json | undefined) ?? {}), [field.slice(7)]: clone(value) };
    return;
  }
  if (value === undefined || value === null) delete n[field];
  else n[field] = clone(value);
}

/** A prefab's own variant base, unless the chain is already too deep to follow. */
function baseOf(w: Work, prefab: Prefab, depth: number): Prefab | undefined {
  return prefab.base === undefined || depth >= PREFAB_MAX_DEPTH
    ? undefined
    : w.prefabs.get(prefab.base);
}

/** A prefab's nested instances in its own frame: its base's first, the variant's overrides folded in, then its own. */
function nestedInstances(w: Work, prefab: Prefab, depth = 0): InstanceDef[] {
  const own = clone(prefab.instances ?? []);
  const base = baseOf(w, prefab, depth);
  if (!base) return own;
  const overrides = prefab.overrides ?? {};
  return [...nestedInstances(w, base, depth + 1).map((n) => overrideNested(n, overrides)), ...own];
}

/** The nested instance `segs` names through the prefabs it passes (`door-1`, `room-1/door-1`), or undefined. */
function nestedAlong(w: Work, prefab: Prefab, segs: readonly string[]): InstanceDef | undefined {
  let at: Prefab | undefined = prefab;
  for (let k = 0; k < segs.length && k <= PREFAB_MAX_DEPTH && at; k++) {
    const n = nestedInstances(w, at).find((x) => x.id === segs[k]);
    if (!n || k === segs.length - 1) return n;
    at = w.prefabs.get(n.prefab);
  }
  return undefined;
}

/** Whether the batch left the viewed prefab's header other than `prefabs` holds it. */
function headerChanged(w: Work, prefabs: PrefabLibrary | undefined): boolean {
  return w.headerTouched && !same(w.header, headerOf(prefabs?.get(w.view!)));
}

/** The viewed prefab as the batch leaves it: the document's children and `assets` under its header. */
function viewedPrefab(w: Work, start: SceneDefinition, after: SceneDefinition): Prefab {
  const id = w.view!;
  const was = w.prefabs.get(id);
  const {
    entities: _e,
    bulk: _b,
    instances: _i,
    base: _base,
    params: _p,
    assets: wasAssets,
    contract,
    ...head
  }: Prefab = was ?? {
    kind: PREFAB_KIND,
    v: SCENE_FORMAT_VERSION,
    ...(after.game !== undefined ? { game: after.game } : {}),
    id,
    entities: [],
  };
  const assets = w.assetsTouched || start.assets !== undefined ? after.assets : wasAssets;
  return {
    ...head,
    ...sceneBody(after, w.registry, contract),
    ...(w.header.base !== undefined ? { base: w.header.base } : {}),
    ...(Object.keys(w.header.params).length > 0 ? { params: clone(w.header.params) } : {}),
    ...(assets && assets.length > 0 ? { assets: [...assets] } : {}),
  };
}

/** The library as the batch has left it, the viewed prefab holding the instances the document holds now. */
function nestingLibrary(w: Work): PrefabLibrary {
  if (w.view === undefined) return w.prefabs;
  const lib = new Map(w.prefabs);
  const was = lib.get(w.view);
  const viewed: Prefab = {
    ...(was ?? { kind: PREFAB_KIND, v: SCENE_FORMAT_VERSION, id: w.view }),
    entities: [],
    instances: w.instances.map((r) => r.def),
  };
  delete viewed.bulk;
  if (w.header.base !== undefined) viewed.base = w.header.base;
  else delete viewed.base;
  lib.set(w.view, viewed);
  return lib;
}

/** The `prefab-cycle` issue of the viewed prefab or a prefab the batch changed, as `resolvePrefab` finds it. */
function cycleIn(w: Work): SceneIssue | null {
  const lib = nestingLibrary(w);
  const ids = [...(w.view !== undefined ? [w.view] : []), ...[...w.prefabsChanged].sort()];
  for (const id of new Set(ids)) {
    if (!lib.has(id)) continue;
    const resolved = resolvePrefab(id, lib, w.registry);
    if (!resolved.ok && resolved.issue.code === "prefab-cycle") return resolved.issue;
  }
  return null;
}

/** Refuses the op that just ran when it made a prefab contain itself. */
function refuseCycle(w: Work): void {
  const issue = cycleIn(w);
  if (!issue) return;
  throw new OpFailure({
    ...issue,
    message: `${issue.message}${w.view !== undefined ? ` (editing prefab "${w.view}")` : ""}`,
    path: undefined,
  });
}

// ─── Instances and prefabs ───────────────────────────────

/** Checks a nested instance with an outer level's overrides on it, as the instance it becomes. */
function validateNested(n: InstanceDef, relocate: Relocate, label: string): void {
  const result = InstanceSchema.safeParse(n);
  if (result.success) return;
  const first = result.error.issues[0]!;
  fail("schema", `${label}: ${first.message}`, {
    path: relocate(""),
    entityIds: [label],
  });
}

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
  // A param's value lands on each of its targets as an override, under the instance's own.
  const overrides: Json = { ...paramOverrides(w, def), ...def.overrides };
  const checked: InstanceDef = { ...def, overrides };
  delete checked.params;
  const children = new Set<Ref>();
  for (const [key, value] of Object.entries(overrides)) {
    const split = splitOverridePath(key);
    if (!split) continue;
    const n = split.child.startsWith("~")
      ? undefined
      : nestedAlong(w, prefab, split.child.split(CHILD_SEPARATOR));
    if (!n) {
      children.add(split.child);
      continue;
    }
    if (!isInstanceOverrideField(split.field))
      fail(
        "op-invalid",
        `${def.id}: ${split.child} is a nested instance, whose overridable fields are ${[...INSTANCE_OVERRIDE_FIELDS, "params.<name>"].join(", ")}; "${split.field}" isn't one.`,
        { path: relocate("/overrides"), entityIds: [def.id], got: key },
      );
    validateNested(
      overrideNested(n, { [`${n.id}.${split.field}`]: value }),
      () => relocate("/overrides"),
      `${def.id}/${split.child}`,
    );
  }
  for (const ref of children) {
    const c = localChild(prefab, checked, ref, w.registry, w.prefabs);
    if (!c) continue;
    if (c.kind === "entity") {
      // A nested child's id is its relative ref (`door-1/panel`); its fields are what's checked.
      const stem = ref.slice(ref.lastIndexOf(CHILD_SEPARATOR) + 1);
      const own = isNestedRef(ref)
        ? { ...c.def, id: ID_PATTERN.test(stem) ? stem : "child" }
        : c.def;
      validateEntity(w, own, () => relocate("/overrides"), `${def.id}/${ref}`);
    } else {
      const info = w.registry.bulkKey(c.key);
      if (info) validateBulk(w, info, c.value, () => relocate("/overrides"), `${def.id}/${ref}`);
    }
  }
}

/** The overrides an instance's params make: each set param's value on every target its prefab declares for it. */
function paramOverrides(w: Work, def: InstanceDef): Json {
  const names = Object.keys(def.params ?? {});
  if (names.length === 0) return {};
  const resolved = resolvePrefab(def.prefab, w.prefabs, w.registry);
  if (!resolved.ok) return {};
  const out: Json = {};
  for (const name of names) {
    const value = def.params![name];
    if (value === null || value === undefined) continue;
    for (const target of resolved.prefab.params[name]?.targets ?? []) out[target] = clone(value);
  }
  return out;
}

/** The header values beyond `prefabBody`'s that a prefab's body carries: its base, variant overrides, parameters and assets. */
function bodyExtras(p: PrefabBody): Partial<PrefabBody> {
  return {
    ...(p.base !== undefined ? { base: p.base } : {}),
    ...(p.overrides && Object.keys(p.overrides).length > 0
      ? { overrides: clone(p.overrides) }
      : {}),
    ...(p.params && Object.keys(p.params).length > 0 ? { params: clone(p.params) } : {}),
    ...(p.assets && p.assets.length > 0 ? { assets: [...p.assets] } : {}),
  };
}

/** Everything `definePrefab` needs to put `prefab` back as it is. */
const fullBody = (prefab: Prefab): PrefabBody => ({ ...prefabBody(prefab), ...bodyExtras(prefab) });

/**
 * `prefab`'s body with `writes` (each a child ref relative to it, a field
 * path and a value) written in: into its own entities and bulk entries,
 * onto its own nested instances (a field of one, or an override through
 * one), and for a variant, into its overrides when the child is its base's.
 * A child the prefab doesn't reach is left out.
 */
function foldIntoBody(
  w: Work,
  prefab: Prefab,
  writes: readonly (readonly [Ref, string, unknown])[],
): PrefabBody {
  const body = fullBody(prefab);
  const overrides: Json = { ...(body.overrides ?? {}) };
  for (const [child, field, value] of writes) {
    const slash = child.indexOf(CHILD_SEPARATOR);
    if (slash < 0) {
      const e = body.entities.find((x) => x.id === child);
      if (e) {
        setPath(e as Json, field.split("."), clone(value), `${child}.${field}`);
        continue;
      }
      const bulk = parseBulkId(child);
      const info = bulk ? w.registry.bulkKey(bulk.key) : undefined;
      const list = bulk ? body.bulk?.[bulk.key] : undefined;
      if (bulk && info && list && bulk.index < list.length) {
        if (field === info.field) list[bulk.index] = storeBulk(info, value);
        continue;
      }
    }
    const head = slash < 0 ? child : child.slice(0, slash);
    const at = (body.instances ?? []).findIndex((x) => x.id === head);
    if (at >= 0) {
      const n = clone(body.instances![at]!) as unknown as Json;
      if (slash < 0) setNestedField(n, field, value);
      else {
        const inner: Json = { ...((n.overrides as Json | undefined) ?? {}) };
        setOverride(inner, `${child.slice(slash + 1)}.${field}`, value);
        n.overrides = inner;
      }
      body.instances![at] = tidyInstance(n);
      continue;
    }
    if (prefab.base !== undefined) setOverride(overrides, `${child}.${field}`, value);
  }
  if (Object.keys(overrides).length > 0) body.overrides = overrides;
  else delete body.overrides;
  return body;
}

/**
 * Writes an instance's override `entries` into a prefab of its chain: its
 * own prefab, or `to`, the prefab of a nested instance every path runs
 * through. A path that doesn't reach `to`, or one a level between
 * overrides too (which would hide the value), refuses.
 */
function applyIntoPrefab(
  w: Work,
  inst: InstanceDef,
  prefab: Prefab,
  entries: readonly (readonly [string, unknown])[],
  to: string | undefined,
  i: number,
): void {
  const target = to ?? prefab.id;
  let into: Prefab | undefined;
  const writes: [Ref, string, unknown][] = [];
  for (const [path, value] of entries) {
    const split = splitOverridePath(path);
    if (!split) continue;
    const segs = split.child.startsWith("~") ? [split.child] : split.child.split(CHILD_SEPARATOR);
    const chain: Prefab[] = [prefab];
    const via: InstanceDef[] = [];
    for (let j = 0; j < segs.length - 1 && chain.length <= PREFAB_MAX_DEPTH; j++) {
      const n = nestedInstances(w, chain[j]!).find((x) => x.id === segs[j]);
      const next = n && w.prefabs.get(n.prefab);
      if (!n || !next) break;
      via.push(n);
      chain.push(next);
    }
    const k = chain.findIndex((p) => p.id === target);
    if (k < 0)
      fail(
        "op-invalid",
        `${inst.id}: "${path}" doesn't run through prefab "${target}"; its prefabs are ${chain.map((p) => `"${p.id}"`).join(", ")}.`,
        { entityIds: [inst.id], got: target, path: `/ops/${i}/to` },
      );
    for (let j = 0; j < k; j++) {
      const rest = `${segs.slice(j + 1).join(CHILD_SEPARATOR)}.${split.field}`;
      const hiding = Object.keys(via[j]!.overrides ?? {}).find((key) => overlaps(key, rest));
      if (hiding !== undefined)
        fail(
          "op-invalid",
          `${inst.id}: ${via[j]!.id} in prefab "${chain[j]!.id}" overrides "${hiding}", which would hide "${path}" applied to "${target}"; apply it to "${chain[j]!.id}" instead, or revert that override first.`,
          { entityIds: [inst.id], got: path, path: `/ops/${i}/to` },
        );
    }
    into = chain[k]!;
    writes.push([segs.slice(k).join(CHILD_SEPARATOR), split.field, value]);
  }
  if (!into) return;
  definePrefab(w, into.id, foldIntoBody(w, into, writes), i);
}

function definePrefab(w: Work, id: string, body: PrefabBody, i: number): void {
  if (!ID_PATTERN.test(id))
    fail("bad-id", `"${id}" isn't a valid prefab id.`, { got: id, path: `/ops/${i}/id` });
  const file = { ...prefabFile(id, body, w.startDef.game), ...bodyExtras(body) };
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

/** Points `def`'s reference fields that named a child of a nested instance (`door-1/panel`, or resolved, `gate-1/door-1/panel`) at the instance it became. */
function retargetNested(
  w: Work,
  def: EntityDef,
  outer: string,
  renamed: ReadonlyMap<string, string>,
): Ref[] {
  const named: Ref[] = [];
  const map = (v: unknown) => {
    if (typeof v !== "string") return v;
    const local = v.startsWith(`${outer}${CHILD_SEPARATOR}`) ? v.slice(outer.length + 1) : v;
    const slash = local.indexOf(CHILD_SEPARATOR);
    const to = slash > 0 ? renamed.get(local.slice(0, slash)) : undefined;
    if (to === undefined) return v;
    const ref = `${to}${local.slice(slash)}`;
    named.push(ref);
    return ref;
  };
  for (const { field } of w.registry.types.get(def.type)?.refs ?? []) {
    const segs = field.split(".");
    const value = getPath(def, segs);
    if (value === undefined) continue;
    setPath(def as Json, segs, Array.isArray(value) ? value.map(map) : map(value), field);
  }
  return named;
}

/**
 * `remove` of the instance, then one level of it placed where it stood:
 * its own children as plain entries, the instance's turn and flip baked
 * into their fields, and its nested instances as instances of the
 * document, their `at`, turn, `z`, layer and `off` composed with the
 * outer instance's and its overrides through them folded in.
 */
function unpackOps(w: Work, inst: InstanceDef): SceneOp[] {
  const prefab = prefabOf(w, inst.prefab);
  const d = turnOf(inst);
  const overrides = inst.overrides ?? {};
  // Entities stay in the group's frame and `placeFragment` adds `at`, so they take only the turn.
  const children = placeChildren(
    prefab,
    inst,
    w.registry,
    [dihedral(d, [0, 0])],
    gridTurns({ settings: w.settings }),
  ).filter(({ child }) => !isNestedRef(child.child));
  // Bulk entries can't join a group, so they land in world coordinates, less the `at` placing adds.
  const toWorld = [
    dihedral(d, inst.at),
    groupFrame(w, inst.group),
    translation([-inst.at[0], -inst.at[1]]),
  ];
  const def = current(w);
  const without = {
    ...def,
    instances: (def.instances ?? []).filter((x) => x.id !== inst.id),
  };

  const nested = nestedInstances(w, prefab).map((n) => overrideNested(n, overrides));
  const taken = takenIds(without);
  for (const { child } of children) if (child.kind === "entity") taken.add(child.child);
  const renamed = new Map<string, string>();
  for (const n of nested) {
    const id = nextFreeId(n.id, taken);
    taken.add(id);
    renamed.set(n.id, id);
  }

  const entities: EntityDef[] = [];
  const bulk: Record<BulkKey, BulkEntry[]> = {};
  const targets: Ref[] = [];
  for (const { child, def: placed } of children) {
    if (child.kind === "entity") {
      targets.push(...retargetNested(w, placed, inst.id, renamed));
      entities.push(placed);
    } else
      (bulk[child.key] ??= []).push(
        toWorld.reduce((v, t) => transformBulkEntry(v, t), child.value),
      );
  }
  // The nested instances and their children count as present, so refs to them survive placing.
  const placedInto: SceneDefinition = {
    ...without,
    instances: [
      ...(without.instances ?? []),
      ...nested.map((n) => ({ ...n, id: renamed.get(n.id)! })),
    ],
    entities: [
      ...(without.entities ?? []),
      ...targets.map((id) => ({ id, type: "marker" }) as EntityDef),
    ],
  };
  const placed = placeFragment(
    { kind: FRAGMENT_KIND, v: SCENE_FORMAT_VERSION, entities, bulk },
    placedInto,
    w.registry,
    inst.at,
  );

  const outer = dihedral(d, inst.at);
  const index = w.instances.findIndex((r) => r.def.id === inst.id);
  const instantiates: SceneOp[] = nested.map((n, k) => {
    let out = { ...clone(n), id: renamed.get(n.id)!, at: applyPt(outer, n.at) } as InstanceDef;
    out = withDihedral(out, composeDihedral(d, turnOf(n)));
    out = withZ(out, (inst.z ?? 0) + (n.z ?? 0));
    if (out.layer === undefined && inst.layer !== undefined) out.layer = inst.layer;
    if (inst.off) out.off = true;
    delete out.group;
    if (inst.group !== undefined) out.group = inst.group;
    return { op: "instantiate", instance: out as InstanceInput, index: index + k };
  });
  return [{ op: "remove", refs: [inst.id] }, ...placed.ops, ...instantiates];
}

/**
 * `definePrefab` with the entries `refs` name around the origin, `remove`
 * of them, and one `instantiate` of the new prefab at the origin. Group
 * members leave their group (the instance takes no group); instances among
 * the refs become the prefab's nested instances, their group's transform
 * baked in. The origin is `at`, or the top-left of the entries' box and
 * the instances' `at`s.
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
  const nested: { index: number; def: InstanceDef }[] = [];
  for (const ref of [...new Set(op.refs)]) {
    const t = resolve(w, ref);
    if (t.kind === "instance") {
      const placed = compose(
        groupFrame(w, t.rec.def.group),
        dihedral(turnOf(t.rec.def), t.rec.def.at),
      );
      const n = { ...clone(t.rec.def), at: [placed.tx, placed.ty] as Pt };
      delete n.group;
      nested.push({
        index: w.instances.indexOf(t.rec),
        def: withDihedral(n, dihedralOf(placed) ?? { rot: 0, flip: false }),
      });
      continue;
    }
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
  nested.sort((a, b) => a.index - b.index);
  const bulk: Record<BulkKey, BulkEntry[]> = {};
  for (const key of [...picked.keys()].sort())
    bulk[key] = picked
      .get(key)!
      .sort((a, b) => a.index - b.index)
      .map((x) => x.value);
  if (entities.length === 0 && Object.keys(bulk).length === 0 && nested.length === 0)
    fail("op-invalid", "createPrefab needs at least one entity, bulk entry or instance.");
  let origin: Pt;
  if (op.at) origin = [op.at[0], op.at[1]];
  else {
    const box = fragmentBounds(
      { kind: FRAGMENT_KIND, v: SCENE_FORMAT_VERSION, entities, bulk },
      w.registry,
    );
    const xs = [...(box ? [box.minX] : []), ...nested.map((n) => n.def.at[0])];
    const ys = [...(box ? [box.minY] : []), ...nested.map((n) => n.def.at[1])];
    if (xs.length === 0)
      fail("op-invalid", "None of those entries has a position to put the prefab's origin at.");
    origin = [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys))];
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
    ...(nested.length > 0
      ? { instances: nested.map(({ def }) => ({ ...def, at: addPt(def.at, back) })) }
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

function assetsInverse(start: SceneDefinition, w: Work): SceneOp[] {
  if (!w.assetsTouched) return [];
  const was = sortedAssets(start.assets ?? []);
  const add = was.filter((id) => !w.assets.includes(id));
  const remove = w.assets.filter((id) => !was.includes(id));
  if (add.length === 0 && remove.length === 0) return [];
  return [
    {
      op: "useAssets",
      ...(add.length > 0 ? { add } : {}),
      ...(remove.length > 0 ? { remove } : {}),
    },
  ];
}

/** The header ops that put the viewed prefab's base and params back as `startPrefabs` holds them. */
function headerInverse(w: Work, startPrefabs: PrefabLibrary): SceneOp[] {
  if (w.view === undefined || !w.headerTouched) return [];
  const was = headerOf(startPrefabs.get(w.view));
  const ops: SceneOp[] = [];
  if (was.base !== w.header.base) ops.push({ op: "setPrefabBase", base: was.base ?? null });
  const names = new Set([...Object.keys(was.params), ...Object.keys(w.header.params)]);
  for (const name of [...names].sort()) {
    const param = was.params[name];
    if (!same(param, w.header.params[name]))
      ops.push({ op: "exposeParam", name, param: param ? clone(param) : null });
  }
  return ops;
}

/**
 * The setParam ops that give an instance `was`'s params back, one per param
 * that differs; null when a param it held is null, which setParam can't set.
 */
function paramsInverse(was: InstanceDef, now: InstanceDef): SceneOp[] | null {
  const a = was.params ?? {};
  const b = now.params ?? {};
  if (Object.values(a).some((v) => v === null)) return null;
  const ops: SceneOp[] = [];
  for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort())
    if (!same(a[name], b[name]))
      ops.push({ op: "setParam", ref: was.id, name, value: name in a ? clone(a[name]) : null });
  return ops;
}

function buildInverse(start: SceneDefinition, w: Work, startPrefabs: PrefabLibrary): SceneOp[] {
  const ops: SceneOp[] = [];
  const last: SceneOp[] = [];

  // Prefabs the batch changed or deleted come back first, so instances of them can return.
  for (const id of [...w.prefabsChanged].sort()) {
    if (id === w.view) continue;
    const was = startPrefabs.get(id);
    const now = w.prefabs.get(id);
    if (was && !same(was, now)) ops.push({ op: "definePrefab", id, prefab: fullBody(was) });
    else if (!was && now) last.push({ op: "definePrefab", id, prefab: null });
  }

  // Groups: restored and re-declared first, ones the batch declared dropped last.
  if (w.groupsTouched) {
    const was = start.groups ?? {};
    for (const id of Object.keys(was).sort()) {
      const g = was[id]!;
      const now = w.groups[id];
      if (same(g, now)) continue;
      ops.push({ op: "setGroup", id, ...setGroupFields(g, now) });
    }
    for (const id of Object.keys(w.groups).sort())
      if (!(id in was)) last.push({ op: "setGroup", id, remove: true });
  }

  const sceneSet: { name?: string; bounds?: SceneDefinition["bounds"] } = {};
  if (w.name !== start.name) sceneSet.name = start.name;
  if (!same(w.bounds, start.bounds)) sceneSet.bounds = clone(start.bounds);
  if (Object.keys(sceneSet).length > 0) ops.push({ op: "setScene", set: sceneSet });
  ops.push(...settingsInverse(start, w));
  ops.push(...assetsInverse(start, w));
  last.unshift(...headerInverse(w, startPrefabs));

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
  const zRestores = new Map<number, Ref[]>();
  /** Whether `now` is `was` with only its z changed; if so the inverse is one setZ. */
  const restoreZ = <T extends { z?: number }>(ref: Ref, was: T, now: T): boolean => {
    if (same(was, now) || !same(withZ(now, was.z ?? 0), was)) return false;
    const z = was.z ?? 0;
    zRestores.set(z, [...(zRestores.get(z) ?? []), ref]);
    return true;
  };

  const startEnts = start.entities ?? [];
  const replaced = new Set<number>();
  const survivors = w.entities.filter((r) => r.orig !== null);
  for (const rec of w.entities) if (rec.orig === null) removeRefs.push(rec.def.id);
  for (const rec of survivors) {
    const was = startEnts[rec.orig!]!;
    const current: EntityDef = { ...clone(rec.def), id: was.id };
    if (same(was, current)) continue;
    // A grid present on both sides comes back cell by cell; the rest is restored as usual.
    const original = { ...was };
    const paints: SceneOp[] = [];
    for (const field of gridFields(w, was.type)) {
      const a = was[field];
      const b = current[field];
      if (!isObj(a) || !isObj(b) || same(a, b)) continue;
      paints.push(...paintOps(was.id, field, gridRestore(a as GridCells, b as GridCells)));
      original[field] = b;
    }
    if (same(original, current) || restoreZ(original.id, original, current)) {
      updates.push(...paints);
      continue;
    }
    const d = entityTranslation(w, original, current);
    if (d) {
      addMove(original.id, d);
      updates.push(...paints);
      continue;
    }
    const restore = restorePaths(original, current);
    if (!restore) {
      replaced.add(rec.orig!);
      removeRefs.push(rec.def.id);
      continue;
    }
    updates.push(...paints, { op: "update", ref: original.id, ...pathsOf(restore) });
  }

  const startInsts = start.instances ?? [];
  const instSurvivors = w.instances.filter((r) => r.orig !== null);
  for (const rec of w.instances) if (rec.orig === null) removeRefs.push(rec.def.id);
  for (const rec of instSurvivors) {
    const original = startInsts[rec.orig!]!;
    if (restoreZ(original.id, original, { ...rec.def, id: original.id })) continue;
    const now = { ...rec.def } as unknown as Json;
    const was = { ...original } as unknown as Json;
    const params = original.prefab === rec.def.prefab ? paramsInverse(original, rec.def) : null;
    if (params) {
      delete now.params;
      delete was.params;
    }
    const set: Json = {};
    const unset: string[] = [];
    for (const k of Object.keys(now)) if (k !== "id" && !(k in was)) unset.push(k);
    for (const k of Object.keys(was))
      if (k !== "id" && !same(was[k], now[k])) set[k] = clone(was[k]);
    if (Object.keys(set).length > 0 || unset.length > 0)
      updates.push({ op: "update", ref: original.id, ...pathsOf({ set, unset }) });
    if (params) updates.push(...params);
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
  for (const [z, refs] of zRestores) ops.push({ op: "setZ", refs, z });
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
  const reachesChanged = (inst: InstanceDef) =>
    changedPrefabs.size > 0 &&
    prefabsUsedBy({ instances: [inst] } as SceneDefinition, w.prefabs).some((id) =>
      changedPrefabs.has(id),
    );
  for (const rec of w.instances) {
    if (rec.orig === null || !same(rec.def, startInsts[rec.orig]) || reachesChanged(rec.def))
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
